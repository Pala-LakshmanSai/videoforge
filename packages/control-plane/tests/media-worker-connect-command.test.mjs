import assert from "node:assert/strict";
import test from "node:test";
import { IDS } from "./support/fixtures.mjs";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { PGliteExecutor } from "./support/pglite.mjs";

async function withConnectDatabase(work) {
  const database = new PGlite();
  const executor = new PGliteExecutor(database);
  try {
    await executor.execute(`CREATE TABLE workspaces(account_id uuid,id uuid,PRIMARY KEY(account_id,id));
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql AS $$
        SELECT nullif(current_setting('videoforge.account_id',true),'')::uuid $$;
      CREATE FUNCTION videoforge_assert_tenant_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.account_id IS DISTINCT FROM videoforge_current_account_id() THEN RAISE EXCEPTION 'tenant mismatch'; END IF;
        RETURN NEW; END $$;`);
    await executor.query('INSERT INTO workspaces VALUES ($1,$2),($3,$4)',[IDS.accountA,IDS.workspaceA,IDS.accountB,IDS.workspaceB]);
    await executor.execute(await readFile(new URL('../migrations/0212_media_worker_connect_commands.sql',import.meta.url),'utf8'));
    await work({executor});
  } finally { await database.close(); }
}

test("connect commands enforce single use, expiry, tenant scope and rollback", async () => {
  await withConnectDatabase(async ({ executor }) => {
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    const hash = `sha256:${"c".repeat(64)}`;
    await executor.query(`INSERT INTO media_worker_connect_commands(id,account_id,workspace_id,token_sha256,expires_at)
      VALUES ('00000000-0000-4000-8000-000000212001',$1,$2,$3,now()+interval '15 minutes')`, [IDS.accountA,IDS.workspaceA,hash]);
    // Rollback after an enrollment failure leaves the same command usable.
    await assert.rejects(executor.transaction(async transaction => {
      const result = await transaction.query("SELECT * FROM videoforge_media_worker_connect_consume($1)", [hash]);
      assert.equal(result.rows[0].account_id,IDS.accountA);
      assert.equal(result.rows[0].workspace_id,IDS.workspaceA);
      throw new Error("enrollment failed");
    }), /enrollment failed/);
    await executor.query("SET ROLE videoforge_v209_runtime_dc9612d6");
    try {
      await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
      assert.equal((await executor.query("SELECT * FROM media_worker_connect_commands")).rows.length,0);
      assert.equal((await executor.query("SELECT * FROM videoforge_media_worker_connect_consume($1)", [`sha256:${"d".repeat(64)}`])).rows.length,0);
      const consumed = await executor.transaction(transaction => transaction.query("SELECT * FROM videoforge_media_worker_connect_consume($1)",[hash]));
      assert.equal(consumed.rows[0].account_id,IDS.accountA);
      assert.equal((await executor.query("SELECT * FROM videoforge_media_worker_connect_consume($1)",[hash])).rows.length,0);
      await executor.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountA]);
      await executor.query(`INSERT INTO media_worker_connect_commands(id,account_id,workspace_id,token_sha256,created_at,expires_at)
        VALUES ('00000000-0000-4000-8000-000000212002',$1,$2,$3,now()-interval '20 minutes',now()-interval '5 minutes')`,[IDS.accountA,IDS.workspaceA,`sha256:${"e".repeat(64)}`]);
      assert.equal((await executor.query("SELECT * FROM videoforge_media_worker_connect_consume($1)",[`sha256:${"e".repeat(64)}`])).rows.length,0);
    } finally { await executor.query("RESET ROLE"); }
  });
});
