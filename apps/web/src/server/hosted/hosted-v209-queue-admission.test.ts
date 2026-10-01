// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { SqlExecutor } from "@videoforge/control-plane";
import { expect, it } from "vitest";
import { hostedAccountCleanupPending } from "./hosted-v209-queue-admission";

it("holds only the current tenant's earlier unconfirmed cleanup and releases after verified cleanup", async () => {
  const db = new PGlite();
  const account = "11111111-1111-4111-8111-111111111111";
  const workspace = "22222222-2222-4222-8222-222222222222";
  const earlier = "33333333-3333-4333-8333-333333333333";
  const current = "44444444-4444-4444-8444-444444444444";
  try {
    await db.exec(`CREATE TABLE cloud_media_reservations (
      account_id uuid, workspace_id uuid, project_id uuid, state text, cleanup_verified_at timestamptz);
      INSERT INTO cloud_media_reservations VALUES ('${account}','${workspace}','${earlier}','STOPPING',NULL);`);
    const sql = db as unknown as SqlExecutor;
    expect(await hostedAccountCleanupPending(sql, account, workspace, current)).toBe(true);
    expect(await hostedAccountCleanupPending(sql, account, workspace)).toBe(true);
    expect(await hostedAccountCleanupPending(sql, account, workspace, earlier)).toBe(false);
    expect(await hostedAccountCleanupPending(sql, current, workspace)).toBe(false);
    expect(await hostedAccountCleanupPending(sql, account, current)).toBe(false);
    await db.exec("UPDATE cloud_media_reservations SET state='AMBIGUOUS'");
    expect(await hostedAccountCleanupPending(sql, account, workspace, current)).toBe(true);
    await db.exec("UPDATE cloud_media_reservations SET state='STARTING'");
    expect(await hostedAccountCleanupPending(sql, account, workspace, current)).toBe(false);
    await db.exec("UPDATE cloud_media_reservations SET state='CLEAN',cleanup_verified_at=now()");
    expect(await hostedAccountCleanupPending(sql, account, workspace, current)).toBe(false);
  } finally { await db.close(); }
});
