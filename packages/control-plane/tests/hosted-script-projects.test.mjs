import assert from "node:assert/strict";
import test from "node:test";
import { withMigratedDatabase, uuid, sha256 } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
test("script intake accepts a durable queue before narration; tenant fences, archive, identity and capacity survive", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    // Existing hosted deployment grants needed by the tenant-write trigger; not new authority.
    await executor.query(
      "GRANT SELECT ON workspaces, projects TO videoforge_v209_runtime_dc9612d6",
    );
    const scoped = (account, work) =>
      executor.transaction(async (sql) => {
        await sql.query("SELECT set_config('videoforge.account_id',$1,true)", [account]);
        return work(sql);
      });
    const add = async (project, key) =>
      scoped(IDS.accountA, async (sql) => {
        await sql.query(
          "INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,project_kind,generation_provider) VALUES($1,$2,$3,$4,$4,'USER','KIE_FAL')",
          [project, IDS.workspaceA, IDS.userA, key],
        );
        await sql.query(
          "INSERT INTO hosted_script_projects(project_id,account_id,workspace_id,idempotency_key,request_sha256,options,script,voice_id,voice_name,voiceover_job_id) VALUES($1,$2,$3,$4,$5,'{}','Every river begins with a single drop.','voice','Alice',$6)",
          [
            project,
            IDS.accountA,
            IDS.workspaceA,
            key,
            sha256(key),
            uuid(Number(key.slice(1)) + 100),
          ],
        );
      });
    const first = uuid(253001),
      second = uuid(253002);
    await add(first, "p253001");
    await add(second, "p253002");
    assert.equal(
      (await executor.query("SELECT count(*)::int AS n FROM hosted_voiceover_jobs")).rows[0].n,
      0,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int AS n FROM project_revisions WHERE project_id=$1",
          [first],
        )
      ).rows[0].n,
      0,
    );
    await scoped(IDS.accountA, async (sql) => {
      await sql.query("SET LOCAL ROLE videoforge_v209_runtime_dc9612d6");
      await sql.query(
        "INSERT INTO project_inputs(id,workspace_id,project_id,kind,state,idempotency_key,optional_script) VALUES($1,$2,$3,'OPTIONAL_SCRIPT','UPLOADED','script-intake-proof','Original script')",
        [uuid(254001), IDS.workspaceA, first],
      );
    });
    await assert.rejects(
      scoped(IDS.accountB, async (sql) => {
        await sql.query("SET LOCAL ROLE videoforge_v209_runtime_dc9612d6");
        await sql.query(
          "INSERT INTO project_inputs(id,workspace_id,project_id,kind,state,idempotency_key,optional_script) VALUES($1,$2,$3,'OPTIONAL_SCRIPT','UPLOADED','foreign-script-proof','Foreign script')",
          [uuid(254002), IDS.workspaceA, second],
        );
      }),
      /tenant|row-level security|has no owning account/i,
    );
    const due = (await executor.query("SELECT videoforge_pending_script_projects() AS due")).rows[0]
      .due;
    assert.equal(due.length, 1);
    assert.equal(due[0].accountId, IDS.accountA);
    await scoped(IDS.accountB, async (sql) => {
      await sql.query("SET LOCAL ROLE videoforge_v209_runtime_dc9612d6");
      assert.equal(
        (await sql.query("SELECT * FROM hosted_script_projects WHERE project_id=$1", [first])).rows
          .length,
        0,
      );
      assert.equal(
        (
          await sql.query(
            "UPDATE hosted_script_projects SET state='FAILED' WHERE project_id=$1 RETURNING project_id",
            [first],
          )
        ).rows.length,
        0,
      );
    });
    await assert.rejects(
      scoped(IDS.accountA, (sql) =>
        sql.query("UPDATE hosted_script_projects SET script='different' WHERE project_id=$1", [
          first,
        ]),
      ),
      /identity cannot replay/,
    );
    await scoped(IDS.accountA, async (sql) => {
      await sql.query("SELECT * FROM videoforge_archive_hosted_project($1,$2,$3)", [
        IDS.accountA,
        IDS.workspaceA,
        second,
      ]);
      assert.equal(
        (await sql.query("SELECT state FROM hosted_script_projects WHERE project_id=$1", [second]))
          .rows[0].state,
        "CANCELLED",
      );
      const claim = await sql.query(
        "SELECT videoforge_start_voiceover_job($1,$2,$3,$4,$5,$6,$7) AS value",
        [
          IDS.accountA,
          IDS.workspaceA,
          uuid(253101),
          sha256("tts"),
          "Every river begins",
          "voice",
          "voiceover.mp3",
        ],
      );
      assert.equal(claim.rows[0].value.claimed, true);
      await sql.query("UPDATE hosted_script_projects SET state='GENERATING' WHERE project_id=$1", [
        first,
      ]);
    });
    await assert.rejects(
      scoped(IDS.accountA, (sql) =>
        sql.query("SELECT * FROM videoforge_archive_hosted_project($1,$2,$3)", [
          IDS.accountA,
          IDS.workspaceA,
          first,
        ]),
      ),
      /active work/,
    );
    const third = uuid(253003);
    await add(third, "p253003"); // Occupancy cannot reject durable queue intake.
    await assert.rejects(
      scoped(IDS.accountA, (sql) =>
        sql.query("SELECT videoforge_start_voiceover_job($1,$2,$3,$4,$5,$6,$7)", [
          IDS.accountA,
          IDS.workspaceA,
          uuid(253103),
          sha256("other"),
          "Other script",
          "voice",
          "voiceover.mp3",
        ]),
      ),
      /VOICEOVER_CAPACITY_BUSY/,
    );
  });
});
