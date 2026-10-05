import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMigratedDatabase } from "./support/pglite.mjs";
import { IDS } from "./support/fixtures.mjs";

const signature = "public.videoforge_hosted_videos_ready(uuid,uuid,uuid)";
const migration = readFileSync(
  new URL("../migrations/0274_hosted_continuation_readiness_grant.sql", import.meta.url),
  "utf8",
);

test("0274 allows runtime readiness reads while preserving tenant and operator fences", async () => {
  const { database, executor } = await createMigratedDatabase();
  try {
    const before = (
      await executor.query(`SELECT pg_get_functiondef($1::regprocedure) AS body`, [signature])
    ).rows;
    await executor.execute(migration);
    assert.deepEqual(
      (await executor.query(`SELECT pg_get_functiondef($1::regprocedure) AS body`, [signature]))
        .rows,
      before,
    );
    for (const [role, allowed] of [
      ["videoforge_v209_runtime_dc9612d6", true],
      ["videoforge_v209_reconciler_dc9612d6", false],
    ]) {
      assert.equal(
        (
          await executor.query(`SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed`, [
            role,
            signature,
          ])
        ).rows[0].allowed,
        allowed,
      );
    }
    assert.equal(
      (
        await executor.query(
          `SELECT EXISTS (
      SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
      WHERE p.oid=$1::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS allowed`,
          [signature],
        )
      ).rows[0].allowed,
      false,
    );
    await executor.execute(`BEGIN; SET LOCAL ROLE videoforge_v209_runtime_dc9612d6;`);
    try {
      await executor.query(`SELECT set_config('videoforge.account_id',$1,true)`, [IDS.accountA]);
      assert.equal(
        (
          await executor.query(`SELECT videoforge_hosted_videos_ready($1,$2,$3) AS ready`, [
            IDS.accountB,
            IDS.workspaceB,
            IDS.projectB,
          ])
        ).rows[0].ready,
        false,
      );
      await assert.rejects(
        executor.query(
          `SELECT videoforge_reconcile_hosted_video_unknown_no_task($1,$2,$3,$4,$5,$6,$7,$8)`,
          [IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.projectA, IDS.projectA, "x", "x", "x"],
        ),
        /permission denied/,
      );
    } finally {
      await executor.execute("ROLLBACK");
    }
  } finally {
    await database.close();
  }
});
