// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { handleHostedV209ProjectDispatch, resumeHostedV209ProjectDispatch } from "./hosted-v209-project-dispatch";

const id = (d: string) => `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`;
const scope = { account_id: id("1"), workspace_id: id("2"), user_id: id("3") };
const identity = { accountId: scope.account_id, workspaceId: scope.workspace_id, userId: scope.user_id, projectId: id("4") };
const environment = {
  VIDEOFORGE_ENVIRONMENT: "staging", VIDEOFORGE_CLOUD_MEDIA_QUALIFICATION_ONLY: "true",
  VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID: id("5"),
} as HostedRuntimeEnvironment;
const config = {
  environment: "staging", gpuTransport: "DISABLED_UNQUALIFIED", cloudMedia: { image: "qualified-fixture" },
  publicOrigin: "https://videoforge.example", neon: { databaseUrl: "postgres://unused" },
  apiGeneration: { kieApiKey: "fixture", falApiKey: "fixture" },
} as unknown as HostedRuntimeConfiguration;
const request = () => new Request(`${config.publicOrigin}/api/v2/hosted/projects/${identity.projectId}/gpu-dispatch`,
  { method: "POST", headers: { origin: config.publicOrigin, "content-length": "0" } });

function dependencies(allowed: boolean | null = true) {
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => ({ rows: sql.includes("qualification_scope") ?
    (allowed === null ? [] : [{ allowed }]) : [], affectedRows: 0 }));
  const db = { query, transaction: async (run: (sql: { query: typeof query }) => unknown) => run({ query }) };
  const pool = { end: vi.fn(async () => {}) };
  const methods = { createPool: vi.fn(() => pool), createExecutor: vi.fn(() => db), scope: vi.fn(async () => scope),
    ensureAdmission: vi.fn(), findExistingGeneration: vi.fn(), inspectExistingGeneration: vi.fn(),
    materialize: vi.fn(), observe: vi.fn(), commitAndSchedule: vi.fn(), ensureWorkflow: vi.fn(),
    hasExistingPair: vi.fn(), correlationId: () => "fixture-correlation" };
  return { query, pool, methods, injected: methods as never };
}

describe("staging qualification uses normal span scheduling without provider dispatch", () => {
  it("checks latest revision, admission, ASR and idle states using the actual PostgreSQL query", async () => {
    const { PGlite } = await import("@electric-sql/pglite"), db = new PGlite();
    try {
      await db.exec(`CREATE FUNCTION videoforge_cloud_media_qualification_scope(uuid,uuid) RETURNS boolean
        LANGUAGE sql AS 'SELECT true';
        CREATE TABLE projects(id uuid,account_id uuid,workspace_id uuid,owner_user_id uuid,status text);
        CREATE TABLE project_revisions(id uuid,account_id uuid,workspace_id uuid,project_id uuid,status text,
          revision_number integer,media_execution_backend text);
        CREATE TABLE generation_requests(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,state text);
        CREATE TABLE provider_workload_leases(account_id uuid,workspace_id uuid,generation_request_id uuid,
          request_kind text,state text,expires_at timestamptz);
        CREATE TABLE hosted_cpu_job_attempts(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,
          kind text,execution_backend text,state text,result_receipt_sha256 text);
        CREATE TABLE cloud_media_jobs(attempt_id uuid,reservation_id uuid);
        CREATE TABLE cloud_media_reservations(id uuid,account_id uuid,state text,cleanup_verified_at timestamptz);
        CREATE TABLE hosted_api_generation_jobs(account_id uuid,workspace_id uuid,project_id uuid,state text);`);
      const revision = id("6"), generation = id("7"), asr = id("8"), reservation = id("9");
      await db.query("INSERT INTO projects VALUES($1,$2,$3,$4,'ACTIVE')", [identity.projectId, identity.accountId, identity.workspaceId, identity.userId]);
      await db.query("INSERT INTO project_revisions VALUES($1,$2,$3,$4,'LOCKED',1,'RUNPOD_POD')", [revision, identity.accountId, identity.workspaceId, identity.projectId]);
      await db.query("INSERT INTO generation_requests VALUES($1,$2,$3,$4,$5,'ACTIVE')", [generation, identity.accountId, identity.workspaceId, identity.projectId, revision]);
      await db.query("INSERT INTO provider_workload_leases VALUES($1,$2,$3,'VIDEO','ACTIVE',now()+interval '1 hour')", [identity.accountId, identity.workspaceId, generation]);
      await db.query("INSERT INTO hosted_cpu_job_attempts VALUES($1,$2,$3,$4,$5,'ASR','RUNPOD_POD','SUCCEEDED','sha256:fixture')", [asr, identity.accountId, identity.workspaceId, identity.projectId, revision]);
      await db.query("INSERT INTO cloud_media_jobs VALUES($1,$2)", [asr, reservation]);
      await db.query("INSERT INTO cloud_media_reservations VALUES($1,$2,'CLEAN',now())", [reservation, identity.accountId]);
      const d = dependencies();
      d.query.mockImplementation(async (sql, parameters) => {
        const result = await db.query<{ allowed: boolean }>(sql, parameters);
        return { rows: result.rows, affectedRows: result.affectedRows ?? 0 };
      });
      const check = () => resumeHostedV209ProjectDispatch(environment, config, identity, d.injected);
      expect((await check()).status).toBe(200);
      for (const [change, restore] of [
        ["UPDATE projects SET owner_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'", `UPDATE projects SET owner_user_id='${identity.userId}'`],
        ["UPDATE provider_workload_leases SET expires_at=now()-interval '1 second'", "UPDATE provider_workload_leases SET expires_at=now()+interval '1 hour'"],
        ["UPDATE provider_workload_leases SET request_kind='PRESET_PREVIEW'", "UPDATE provider_workload_leases SET request_kind='VIDEO'"],
        ["UPDATE hosted_cpu_job_attempts SET state='FAILED'", "UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED'"],
        ["UPDATE cloud_media_reservations SET state='STOPPING'", "UPDATE cloud_media_reservations SET state='CLEAN'"],
        ["UPDATE cloud_media_reservations SET cleanup_verified_at=NULL", "UPDATE cloud_media_reservations SET cleanup_verified_at=now()"],
        [`INSERT INTO hosted_api_generation_jobs VALUES('${identity.accountId}','${identity.workspaceId}','${identity.projectId}','UNKNOWN_NO_RETRY')`, "DELETE FROM hosted_api_generation_jobs"],
        [`INSERT INTO project_revisions VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${identity.accountId}','${identity.workspaceId}','${identity.projectId}','LOCKED',2,'PERSONAL_WORKER')`, "DELETE FROM project_revisions WHERE revision_number=2"],
      ]) {
        await db.exec(change!); expect((await check()).status).toBe(403); await db.exec(restore!);
      }
      expect((await check()).status).toBe(200);
      await db.query("INSERT INTO cloud_media_reservations VALUES($1,$2,'STOPPING',NULL)", [id("a"), identity.accountId]);
      // Completion remains an inert no-op while its owned span is still saving/stopping.
      expect((await check()).status).toBe(200);
      const prepare = vi.fn();
      expect((await handleHostedV209ProjectDispatch(request(), environment, config, { waitUntil() {} }, d.injected, { prepare }))?.status).toBe(403);
      expect(prepare).not.toHaveBeenCalled();
      expect(d.methods.ensureAdmission).not.toHaveBeenCalled();
    } finally { await db.close(); }
  });
  it("authenticates and verifies the admitted owner's clean ASR before normal preparation", async () => {
    const d = dependencies(), prepare = vi.fn(async () => ({ state: "PREPARING_INPUTS" as const }));
    const result = await handleHostedV209ProjectDispatch(request(), environment, config, { waitUntil() {} }, d.injected, { prepare });
    expect(result?.status).toBe(202);
    expect(await result?.json()).toMatchObject({ state: "PREPARING_INPUTS" });
    expect(d.methods.scope).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith(identity);
    const check = d.query.mock.calls.find(([sql]) => sql.includes("qualification_scope"));
    expect(check?.[0]).toContain("p.owner_user_id=$5::uuid");
    expect(check?.[0]).toContain("a.state='SUCCEEDED'");
    expect(check?.[0]).toContain("r.state='CLEAN'");
    expect(check?.[0]).toContain("revision.media_execution_backend='RUNPOD_POD'");
    for (const name of ["ensureAdmission", "findExistingGeneration", "inspectExistingGeneration", "materialize", "observe", "commitAndSchedule", "ensureWorkflow"] as const)
      expect(d.methods[name]).not.toHaveBeenCalled();
    expect(d.pool.end).toHaveBeenCalledOnce();
  });
  it.each([false, null])("rejects an unapproved or incomplete scope before scheduling: %s", async allowed => {
    const d = dependencies(allowed), prepare = vi.fn();
    const result = await handleHostedV209ProjectDispatch(request(), environment, config, { waitUntil() {} }, d.injected, { prepare });
    expect(result?.status).toBe(403); expect(prepare).not.toHaveBeenCalled();
    expect(d.methods.ensureAdmission).not.toHaveBeenCalled();
  });
  it("reports empty preparations as provider-inert rather than a scheduled provider pair", async () => {
    const d = dependencies(), prepare = vi.fn(async () => ({ state: "PAIR_RESUMED" as const }));
    const result = await handleHostedV209ProjectDispatch(request(), environment, config, { waitUntil() {} }, d.injected, { prepare });
    expect(result?.status).toBe(200); expect(await result?.json()).toEqual({ state: "QUALIFICATION_PROVIDER_INERT" });
    expect(d.methods.inspectExistingGeneration).not.toHaveBeenCalled();
  });
  it("keeps ordinary staging dispatch disabled when qualification is absent", async () => {
    const d = dependencies(), prepare = vi.fn();
    const result = await handleHostedV209ProjectDispatch(request(), {}, config, { waitUntil() {} }, d.injected, { prepare });
    expect(result?.status).toBe(503); expect(d.methods.scope).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
  it("does not use qualification for a Local-only or unqualified Cloud configuration", async () => {
    const d = dependencies(), prepare = vi.fn();
    const result = await handleHostedV209ProjectDispatch(request(), environment, { ...config, cloudMedia: undefined }, { waitUntil() {} }, d.injected, { prepare });
    expect(result?.status).toBe(503); expect(d.query).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
  it("preserves owner authentication and same-origin checks", async () => {
    const d = dependencies(), prepare = vi.fn();
    d.methods.scope.mockResolvedValueOnce(new Response(null, { status: 401 }) as never);
    expect((await handleHostedV209ProjectDispatch(request(), environment, config, { waitUntil() {} }, d.injected, { prepare }))?.status).toBe(401);
    const crossOrigin = new Request(request(), { headers: { origin: "https://other.example", "content-length": "0" } });
    expect((await handleHostedV209ProjectDispatch(crossOrigin, environment, config, { waitUntil() {} }, d.injected, { prepare }))?.status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([true, false])("keeps terminal span resumption provider-inert for every qualification scope: %s", async allowed => {
    const d = dependencies(allowed);
    const result = await resumeHostedV209ProjectDispatch(environment, config, identity, d.injected);
    expect(result.status).toBe(allowed ? 200 : 403);
    if (allowed) expect(await result.json()).toEqual({ state: "QUALIFICATION_PROVIDER_INERT" });
    expect(d.methods.ensureAdmission).not.toHaveBeenCalled();
    expect(d.methods.findExistingGeneration).not.toHaveBeenCalled();
    expect(d.methods.inspectExistingGeneration).not.toHaveBeenCalled();
    expect(d.methods.commitAndSchedule).not.toHaveBeenCalled();
  });
});
