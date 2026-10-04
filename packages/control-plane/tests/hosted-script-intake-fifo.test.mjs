import assert from "node:assert/strict";
import test from "node:test";
import { withMigratedDatabase, uuid, sha256 } from "./support/pglite.mjs";
import { seedFairAccount } from "./support/fair-account.mjs";

test("newer script workflow cannot overtake older pending intake; exact identity recovery wins", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const a = await seedFairAccount(executor, 490);
    const second = uuid(490001),
      oldestJob = uuid(490002),
      newerJob = uuid(490003);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.accountId]);
    await executor.query(
      "INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name) VALUES($1,$2,$3,'Second','second')",
      [second, a.workspaceId, a.userId],
    );
    for (const [id, job, time] of [
      [a.projectId, oldestJob, "2026-01-01"],
      [second, newerJob, "2026-01-02"],
    ]) {
      await executor.query(
        `INSERT INTO hosted_script_projects(project_id,account_id,workspace_id,idempotency_key,request_sha256,options,script,voice_id,voice_name,voiceover_job_id,state,created_at)
      VALUES($1::uuid,$2,$3,($1::uuid)::text,$4,'{}','Script','voice','Voice',$5,'WAITING',$6)`,
        [id, a.accountId, a.workspaceId, sha256("script"), job, time],
      );
    }
    const queue = async (id) =>
      (
        await executor.query(
          "SELECT public.videoforge_queue_voiceover_job($1,$2,$3,$4,'Script','voice','voice.mp3') value",
          [a.accountId, a.workspaceId, id, sha256("script")],
        )
      ).rows[0].value;
    await assert.rejects(queue(newerJob), /VOICEOVER_CAPACITY_BUSY/);
    assert.equal((await queue(oldestJob)).claimed, true);
    // A crash leaves the oldest intake WAITING despite its durable job: same identity must recover.
    assert.equal((await queue(oldestJob)).claimed, false);
    await assert.rejects(queue(newerJob), /VOICEOVER_CAPACITY_BUSY/);
    await executor.query("UPDATE projects SET status='ARCHIVED',archived_at=now() WHERE id=$1", [
      a.projectId,
    ]);
    assert.equal((await queue(newerJob)).claimed, true);
    // Re-observation retains the exact durable identity after the older intake cancellation.
    assert.equal((await queue(newerJob)).claimed, false);
  });
});
