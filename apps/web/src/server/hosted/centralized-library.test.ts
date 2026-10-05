// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canViewCentralizedLibrary, handleCentralizedLibrary } from "./centralized-library";
import {
  LIBRARY_VIDEO_DETAILS_SQL,
  LIBRARY_VIDEO_DETAILS_JOINS_SQL,
} from "./library-video-details";
import { HOSTED_COMPLETED_RENDER_SQL } from "./completed-render";
import type { HostedR2BucketBinding } from "./configuration";
const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../packages/control-plane/migrations/0275_hosted_centralized_library.sql",
  ),
  "utf8",
);
const sessionMigration = readFileSync(
  resolve(process.cwd(), "../../packages/control-plane/migrations/0238_hosted_team_access.sql"),
  "utf8",
);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;
async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE videoforge_v209_runtime_dc9612d6 NOSUPERUSER NOBYPASSRLS;
    CREATE TABLE hosted_auth_users(id text, name text, email text, email_verified boolean);
    CREATE TABLE hosted_auth_sessions(token text, user_id text, expires_at timestamptz);
    CREATE TABLE hosted_auth_links(hosted_auth_user_id text, user_id uuid, admitted_account_id uuid, workspace_id uuid);
    CREATE TABLE hosted_access_revocations(hosted_auth_user_id text);
    CREATE TABLE projects(id uuid, account_id uuid, workspace_id uuid, name text, project_kind text, status text);
    CREATE TABLE project_revisions(id uuid, account_id uuid, workspace_id uuid, project_id uuid, status text, voiceover_asset_id uuid);
    CREATE TABLE assets(id uuid,account_id uuid,workspace_id uuid,project_id uuid,kind text,metadata jsonb);
    CREATE TABLE hosted_cpu_job_attempts(id uuid, account_id uuid, workspace_id uuid, project_id uuid, project_revision_id uuid,kind text,state text,created_at timestamptz,retention_deleted_at timestamptz,result_object_key text,result_content_length bigint,result_checksum_sha256 text);
    CREATE TABLE hosted_cpu_upload_authorities(attempt_id uuid,account_id uuid,workspace_id uuid,source text,issued_at timestamptz,object_key text,content_type text,issued_content_length bigint,issued_checksum_sha256 text);
    CREATE TABLE hosted_render_only_runs(id uuid,account_id uuid,workspace_id uuid,state text,output_receipt_id uuid,final_output jsonb);
    INSERT INTO hosted_auth_users VALUES('owner','Studio owner','demo9gss@gmail.com',true),('member','Alex','alex@example.test',true),('manager','Other manager','lakshman121@gmail.com',true);
    INSERT INTO hosted_auth_links VALUES('owner','${uuid(100)}','${uuid(1)}','${uuid(11)}'),('member','${uuid(200)}','${uuid(2)}','${uuid(12)}'),('manager','${uuid(300)}','${uuid(3)}','${uuid(13)}');
    INSERT INTO hosted_auth_sessions VALUES('owner-token','owner',now()+interval '1 hour'),('member-token','member',now()+interval '1 hour'),('manager-token','manager',now()+interval '1 hour');
    INSERT INTO projects VALUES('${uuid(21)}','${uuid(1)}','${uuid(11)}','Owner film','USER','ACTIVE'),('${uuid(22)}','${uuid(2)}','${uuid(12)}','Harbor film','USER','ACTIVE');
    INSERT INTO project_revisions VALUES('${uuid(31)}','${uuid(1)}','${uuid(11)}','${uuid(21)}','LOCKED',null),('${uuid(32)}','${uuid(2)}','${uuid(12)}','${uuid(22)}','LOCKED',null);
    INSERT INTO hosted_cpu_job_attempts SELECT ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${uuid(2)}','${uuid(12)}','${uuid(22)}','${uuid(32)}','RENDER','SUCCEEDED',now()+n*interval '1 second',null,'final-'||n,42,'${hash}' FROM generate_series(1,50) n;
    INSERT INTO hosted_cpu_job_attempts VALUES('${uuid(40)}','${uuid(1)}','${uuid(11)}','${uuid(21)}','${uuid(31)}','RENDER','SUCCEEDED',now(),null,'owner-final',42,'${hash}');
    INSERT INTO hosted_cpu_upload_authorities SELECT id,account_id,workspace_id,'PRIMARY_RESULT_OUTPUT',now(),result_object_key,'video/mp4',42,'${hash}' FROM hosted_cpu_job_attempts;
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY; ALTER TABLE projects FORCE ROW LEVEL SECURITY;
    CREATE POLICY private_projects ON projects USING(account_id::text=current_setting('videoforge.account_id',true));
    GRANT SELECT ON projects TO videoforge_v209_runtime_dc9612d6;
  `);
  const start = sessionMigration.indexOf(
    "CREATE OR REPLACE FUNCTION public.videoforge_hosted_session_scope",
  );
  await db.exec(sessionMigration.slice(start, sessionMigration.indexOf("$$;", start) + 3));
  await db.exec(migration);
  await db.exec(
    `ALTER TABLE hosted_cpu_job_attempts ADD COLUMN job_spec_object_key text, ADD COLUMN version integer DEFAULT 1, ADD COLUMN updated_at timestamptz; CREATE TABLE hosted_cpu_job_events(id uuid,account_id uuid,workspace_id uuid,attempt_id uuid,sequence integer,kind text,facts_sha256 text,occurred_at timestamptz);`,
  );
  await db.exec(
    readFileSync(
      resolve(
        process.cwd(),
        "../../packages/control-plane/migrations/0276_hosted_centralized_video_delete.sql",
      ),
      "utf8",
    ),
  );
  await db.exec(`
    ALTER TABLE project_revisions ADD COLUMN revision_config_payload jsonb, ADD COLUMN avatar_profile_id uuid,
      ADD COLUMN avatar_profile_version_id uuid, ADD COLUMN image_style_id uuid, ADD COLUMN image_style_version_id uuid;
    ALTER TABLE assets ADD COLUMN binary_sha256 text;
    CREATE TABLE avatar_profile_versions(id uuid, account_id uuid, workspace_id uuid, profile_id uuid, version_number integer);
    CREATE TABLE avatar_profiles(id uuid, account_id uuid, workspace_id uuid, name text);
    CREATE TABLE image_style_versions(id uuid, account_id uuid, workspace_id uuid, style_id uuid, version_number integer);
    CREATE TABLE image_styles(id uuid, account_id uuid, workspace_id uuid, name text);
    CREATE TABLE hosted_script_projects(project_id uuid, account_id uuid, workspace_id uuid, voice_name text, audio jsonb);
  `);
  const metadataMigration = readFileSync(
    resolve(
      process.cwd(),
      "../../packages/control-plane/migrations/0277_hosted_library_video_details.sql",
    ),
    "utf8",
  );
  expect(metadataMigration).toContain(LIBRARY_VIDEO_DETAILS_SQL);
  expect(metadataMigration).toContain(LIBRARY_VIDEO_DETAILS_JOINS_SQL);
  await db.exec(metadataMigration);
  return db;
}
describe("centralized Library owner boundary", () => {
  it("projects another creator's completed metadata without granting foreign access or leaking source keys", async () => {
    const db = await database();
    try {
      await db.exec(
        `UPDATE project_revisions SET revision_config_payload='{"avatar_enabled":false}' WHERE id='${uuid(32)}';`,
      );
      await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
      const result = await db.query<{ data: { outputs: { video_details: unknown }[] } }>(
        "SELECT videoforge_read_centralized_library('owner-token', $1) data",
        [uuid(1001)],
      );
      expect(result.rows[0]!.data.outputs[0]!.video_details).toEqual({
        avatar_enabled: false,
        avatar_name: null,
        avatar_version: null,
        voiceover_name: null,
        voiceover_filename: null,
        image_style_name: null,
        image_style_version: null,
      });
      expect(
        (
          await db.query<{ data: unknown }>(
            "SELECT videoforge_read_centralized_library('member-token') data",
          )
        ).rows[0]!.data,
      ).toEqual({ error: "CENTRALIZED_LIBRARY_FORBIDDEN" });
    } finally {
      await db.close();
    }
  });
  it("executes real migration and session fences under the runtime role, with retained-history pagination and search", async () => {
    const db = await database();
    try {
      const read = async (
        token = "owner-token",
        attempt: string | null = null,
        search = "",
        creator: string | null = null,
        offset = 0,
      ) =>
        (
          await db.query<{
            data: {
              error?: string;
              total: number;
              total_videos: number;
              outputs: { attempt_id: string; title: string }[];
              creators: unknown[];
            };
          }>("SELECT videoforge_read_centralized_library($1,$2,$3,$4,$5) data", [
            token,
            attempt,
            search,
            creator,
            offset,
          ])
        ).rows[0]!.data;
      await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
      expect((await db.query("SELECT * FROM projects")).rows).toHaveLength(0);
      const first = await read();
      expect(first.total).toBe(51);
      expect(first.outputs).toHaveLength(48);
      expect(first.creators).toHaveLength(2);
      const second = await read("owner-token", null, "", null, 48);
      expect(second.outputs).toHaveLength(3);
      expect(new Set([...first.outputs, ...second.outputs].map((x) => x.attempt_id)).size).toBe(51);
      expect((await read("owner-token", uuid(40))).outputs[0]?.title).toBe("Owner film");
      expect((await read("owner-token", null, "alex")).total).toBe(50);
      expect((await read("owner-token", null, "", uuid(1))).total).toBe(1);
      expect((await read("owner-token", null, "%_'")).total).toBe(0);
      for (const token of ["member-token", "manager-token", "missing"])
        expect((await read(token)).error).toBe("CENTRALIZED_LIBRARY_FORBIDDEN");
      await db.exec("RESET ROLE");
      for (const change of [
        "UPDATE hosted_auth_users SET email_verified=false WHERE id='owner'",
        "UPDATE hosted_auth_sessions SET expires_at=now()-interval '1 second' WHERE user_id='owner'",
        "INSERT INTO hosted_access_revocations VALUES('owner')",
        "UPDATE hosted_auth_users SET email='demo9gss+other@gmail.com' WHERE id='owner'",
      ]) {
        await db.exec("BEGIN");
        await db.exec(change);
        await db.exec("SET LOCAL ROLE videoforge_v209_runtime_dc9612d6");
        expect((await read()).error).toBe("CENTRALIZED_LIBRARY_FORBIDDEN");
        await db.exec("ROLLBACK");
      }
      for (const change of [
        "state='RUNNING'",
        "retention_deleted_at=now()",
        "result_checksum_sha256='sha256:'||repeat('b',64)",
        "result_content_length=41",
        "result_object_key='different'",
      ]) {
        await db.exec("BEGIN");
        await db.exec(`UPDATE hosted_cpu_job_attempts SET ${change} WHERE id='${uuid(40)}'`);
        expect((await read("owner-token", uuid(40))).outputs).toHaveLength(0);
        await db.exec("ROLLBACK");
      }
      await db.exec(
        `INSERT INTO hosted_render_only_runs VALUES('${uuid(40)}','${uuid(1)}','${uuid(11)}','PREPARING',null,null)`,
      );
      expect((await read("owner-token", uuid(40))).outputs).toHaveLength(0);
      await db.exec(
        `UPDATE hosted_render_only_runs SET state='SUCCEEDED',output_receipt_id='${uuid(40)}',final_output=jsonb_build_object('checksumSha256','${hash}')`,
      );
      expect((await read("owner-token", uuid(40))).outputs).toHaveLength(1);
      const privileges = await db.query<{ runtime: boolean; public: boolean }>(
        "SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_read_centralized_library(text,uuid,text,uuid,integer)','EXECUTE') runtime, EXISTS(SELECT 1 FROM pg_proc, LATERAL aclexplode(proacl) a WHERE proname='videoforge_read_centralized_library' AND a.grantee=0) public",
      );
      expect(privileges.rows[0]).toEqual({ runtime: true, public: false });
      expect(migration.replace(/\s+/gu, " ")).toContain(
        HOSTED_COMPLETED_RENDER_SQL.replace(/\s+/gu, " "),
      );
    } finally {
      await db.close();
    }
  }, 30_000);
  it("rejects all other accounts and mutations before reading media; proxies authorized MP4 ranges without signing a public URL", async () => {
    const output = {
      attempt_id: uuid(40),
      project_id: uuid(21),
      title: "Film",
      created_at: "2026-10-05",
      object_key: "private/output",
      content_length: 42,
      checksum_sha256: hash,
      voiceover_filename: "Harbor.mp3",
      creator_id: uuid(2),
      creator_name: "Alex",
      creator_email: "alex@example.test",
    };
    const read = vi.fn(async () => ({
      outputs: [output],
      total: 1,
      total_videos: 1,
      total_bytes: 42,
      creators: [],
    }));
    const bucket = {
      head: vi.fn(async () => ({
        size: 42,
        httpMetadata: { contentType: "video/mp4" },
        checksums: { sha256: new Uint8Array(32).fill(170).buffer },
      })),
      get: vi.fn(async (_key: string, options?: { range: { offset: number; length: number } }) => ({
        size: 42,
        httpMetadata: { contentType: "video/mp4" },
        body: new Response(new Uint8Array(options?.range.length ?? 42)).body,
      })),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as HostedR2BucketBinding;
    let identity = { email: "demo9gss@gmail.com", token: "token", verified: true };
    const deps = { authenticate: async () => identity, read, bucket };
    for (const email of [
      "alex@example.test",
      "lakshman121@gmail.com",
      "demo9gss+other@gmail.com",
    ]) {
      identity = { ...identity, email };
      expect(
        (
          await handleCentralizedLibrary(
            new Request(`https://site/api/v2/centralized-library/${uuid(40)}/download`),
            deps,
          )
        ).status,
      ).toBe(403);
    }
    expect(read).not.toHaveBeenCalled();
    identity = { ...identity, email: "demo9gss@gmail.com", verified: false };
    expect(
      (await handleCentralizedLibrary(new Request("https://site/api/v2/centralized-library"), deps))
        .status,
    ).toBe(403);
    identity = { ...identity, verified: true };
    const list = await handleCentralizedLibrary(
      new Request("https://site/api/v2/centralized-library"),
      deps,
    );
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).not.toContain("private/output");
    expect(text).not.toContain("Harbor.mp3");
    expect(text).toContain('"available":true');
    const databaseUuid = "00000000-0000-f000-2000-000000000001";
    expect(
      (
        await handleCentralizedLibrary(
          new Request(`https://site/api/v2/centralized-library?creator=${databaseUuid}`),
          deps,
        )
      ).status,
    ).toBe(200);
    expect(read.mock.calls.at(-1)).toEqual(["token", null, "", databaseUuid, 0]);
    expect(
      (
        await handleCentralizedLibrary(
          new Request(`https://site/api/v2/centralized-library/${databaseUuid}/watch`),
          deps,
        )
      ).status,
    ).toBe(200);
    const range = await handleCentralizedLibrary(
      new Request(`https://site/api/v2/centralized-library/${uuid(40)}/watch`, {
        headers: { range: "bytes=0-9" },
      }),
      deps,
    );
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 0-9/42");
    expect(range.headers.get("content-disposition")).toContain("inline");
    expect((await range.arrayBuffer()).byteLength).toBe(10);
    const download = await handleCentralizedLibrary(
      new Request(`https://site/api/v2/centralized-library/${uuid(40)}/download`),
      deps,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(
      'attachment; filename="Harbor.mp4"',
    );
    expect(
      (
        await handleCentralizedLibrary(
          new Request("https://site/api/v2/centralized-library", { method: "DELETE" }),
          deps,
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await handleCentralizedLibrary(
          new Request("https://site/api/v2/centralized-library?page=-1"),
          deps,
        )
      ).status,
    ).toBe(400);
    read.mockResolvedValueOnce({
      outputs: [],
      total: 0,
      total_videos: 0,
      total_bytes: 0,
      creators: [],
    });
    expect(
      (
        await handleCentralizedLibrary(
          new Request(`https://site/api/v2/centralized-library/${uuid(41)}/watch`),
          deps,
        )
      ).status,
    ).toBe(404);
    expect(canViewCentralizedLibrary(" DEMO9GSS@GMAIL.COM ")).toBe(true);
  });
});

describe("centralized per-video deletion", () => {
  it("keeps foreign tenants private and records exactly one idempotent retention event for the owner", async () => {
    const db = await database();
    try {
      const remove = async (token: string, facts: string | null = null) =>
        (
          await db.query<{
            data: { error?: string; deleted?: boolean; job_spec_object_key?: string };
          }>("SELECT videoforge_delete_centralized_video($1,$2,$3) data", [
            token,
            uuid(1001),
            facts,
          ])
        ).rows[0]!.data;
      await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
      for (const token of ["member-token", "manager-token", "missing"])
        expect((await remove(token, hash)).error).toBe("CENTRALIZED_LIBRARY_FORBIDDEN");
      expect((await remove("owner-token", "bad")).error).toBe("DELETION_FACTS_INVALID");
      expect((await remove("owner-token")).deleted).not.toBe(true);
      expect(await remove("owner-token", hash)).toEqual({ deleted: true });
      expect(await remove("owner-token", hash)).toEqual({ deleted: true });
      await db.exec("RESET ROLE");
      expect(
        (await db.query("SELECT * FROM hosted_cpu_job_events WHERE attempt_id=$1", [uuid(1001)]))
          .rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query(
            "SELECT * FROM hosted_cpu_job_attempts WHERE retention_deleted_at IS NOT NULL",
          )
        ).rows,
      ).toHaveLength(1);
      expect((await db.query("SELECT * FROM projects WHERE status='ACTIVE'")).rows).toHaveLength(2);
      const list = (
        await db.query<{ data: { total: number } }>(
          "SELECT videoforge_read_centralized_library('owner-token') data",
        )
      ).rows[0]!.data;
      expect(list.total).toBe(50);
      const publicExecute = (
        await db.query(
          "SELECT 1 FROM pg_proc,LATERAL aclexplode(proacl) acl WHERE proname='videoforge_delete_centralized_video' AND acl.grantee=0",
        )
      ).rows;
      expect(publicExecute).toHaveLength(0);
      await db.exec("UPDATE hosted_auth_users SET email_verified=false WHERE id='owner'");
      expect((await remove("owner-token", hash)).error).toBe("CENTRALIZED_LIBRARY_FORBIDDEN");
    } finally {
      await db.close();
    }
  }, 30_000);
  it("requires owner and same origin, verifies exact R2 absence before audit, and leaves retry possible on failure", async () => {
    const prefix = `tenant/${uuid(2)}/workspace/${uuid(12)}/project/${uuid(22)}/revision/${uuid(32)}/lane/render/job/${uuid(1001)}/artifact/`;
    const keys = [prefix + "job.json", prefix + "output.mp4", prefix + "result.json"];
    let identity = { token: "owner-token", email: "demo9gss@gmail.com", verified: true };
    const remove = vi.fn(async (_token: string, _attempt: string, facts: string | null) =>
      facts
        ? { deleted: true }
        : { artifact_prefix: prefix, job_spec_object_key: keys[0], object_keys: keys.slice(1) },
    );
    const bucket = {
      delete: vi.fn(),
      head: vi.fn(async () => null),
      list: vi.fn(async () => ({ objects: [], truncated: false })),
    } as unknown as HostedR2BucketBinding;
    const deps = {
      authenticate: async () => identity,
      read: vi.fn(),
      remove,
      bucket,
      publicOrigin: "https://site",
    };
    const request = (origin: string | null = "https://site") =>
      new Request(`https://site/api/v2/centralized-library/${uuid(1001)}`, {
        method: "DELETE",
        headers: origin ? { origin } : {},
      });
    expect((await handleCentralizedLibrary(request(null), deps)).status).toBe(403);
    expect((await handleCentralizedLibrary(request("https://evil"), deps)).status).toBe(403);
    identity = { ...identity, email: "alex@example.test" };
    expect((await handleCentralizedLibrary(request(), deps)).status).toBe(403);
    expect(remove).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
    identity = { ...identity, email: "demo9gss@gmail.com" };
    expect((await handleCentralizedLibrary(request(), deps)).status).toBe(204);
    expect(bucket.delete).toHaveBeenCalledWith([...keys].sort());
    expect(remove.mock.calls[1]![2]).toMatch(/^sha256:[0-9a-f]{64}$/u);
    remove.mockClear();
    vi.mocked(bucket.head).mockResolvedValueOnce({} as never);
    expect((await handleCentralizedLibrary(request(), deps)).status).toBe(503);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
