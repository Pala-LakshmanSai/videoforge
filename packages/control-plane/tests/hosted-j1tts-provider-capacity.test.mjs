import assert from "node:assert/strict";
import test from "node:test";
import { withMigratedDatabase, uuid, sha256 } from "./support/pglite.mjs";
import { seedFairAccount } from "./support/fair-account.mjs";

test("shared J1 claims: queue fairness, exact rejection retry and uncertainty occupancy", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const a = await seedFairAccount(executor, 410),
      b = await seedFairAccount(executor, 411);
    const call = async (name, account, args) =>
      (
        await executor.query(
          `WITH bound AS (SELECT set_config('videoforge.account_id',($1::uuid)::text,true)) SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) AS value FROM bound`,
          args,
        )
      ).rows[0].value;
    const start = (account, id) =>
      call("videoforge_queue_voiceover_job", account, [
        account.accountId,
        account.workspaceId,
        id,
        sha256("script"),
        "Script",
        "voice",
        "voice.mp3",
      ]);
    const claim = (account, id, token) =>
      call("videoforge_claim_voiceover_submission", account, [
        account.accountId,
        account.workspaceId,
        id,
        token,
      ]);
    const finish = (account, id, token, state, provider, error, retry = null) =>
      call("videoforge_finish_voiceover_submission", account, [
        account.accountId,
        account.workspaceId,
        id,
        token,
        state,
        provider,
        error,
        retry,
      ]);
    const ja = uuid(410001),
      jb = uuid(411001),
      ca = uuid(410002),
      cb = uuid(411002);
    assert.equal((await start(a, ja)).job.state, "WAITING");
    await start(b, jb);
    await assert.rejects(start(a, uuid(410003)), /VOICEOVER_CAPACITY_BUSY/);
    assert.equal((await claim(a, ja, ca)).state, "SUBMITTING");
    assert.equal(await claim(a, ja, uuid(410004)), null);
    assert.equal(await claim(b, jb, cb), null);
    // A legacy generic recorder has no proof that the provider rejected submission.
    await assert.rejects(
      call("videoforge_record_voiceover_job", a, [
        a.accountId,
        a.workspaceId,
        ja,
        "WAITING",
        null,
        "J1TTS_RATE_LIMITED",
      ]),
      /cannot replay/,
    );
    assert.equal(
      (await finish(a, ja, ca, "WAITING", null, "J1TTS_RATE_LIMITED", 1000)).state,
      "WAITING",
    );
    assert.equal(await claim(b, jb, cb), null);
    const receipts = (await executor.query("SELECT count(*)::int n FROM provider_api_rejections"))
      .rows[0].n;
    assert.equal(receipts, 1);
    await executor.query(
      "UPDATE provider_api_policies SET next_start_at='-infinity',cooldown_until='-infinity' WHERE provider='J1_TTS'",
    );
    // Account B gets its turn before rejected account A becomes eligible again.
    assert.equal((await claim(b, jb, cb)).state, "SUBMITTING");
    assert.equal(
      (await finish(b, jb, cb, "UNKNOWN_NO_RETRY", null, "J1TTS_NETWORK_UNCERTAIN")).state,
      "UNKNOWN_NO_RETRY",
    );
    await executor.query(
      "UPDATE provider_api_policies SET next_start_at='-infinity',cooldown_until='-infinity' WHERE provider='J1_TTS'",
    );
    await executor.query(
      "UPDATE hosted_voiceover_jobs SET next_attempt_at='-infinity' WHERE id=$1",
      [ja],
    );
    // Time and retries cannot release the unknown provider submission.
    assert.equal(await claim(a, ja, uuid(410005)), null);
    assert.equal(
      (await finish(b, jb, uuid(411003), "WAITING", null, "J1TTS_RATE_LIMITED", 1000)).state,
      "UNKNOWN_NO_RETRY",
    );
    assert.equal(
      (await executor.query("SELECT public.videoforge_provider_api_active_count('J1_TTS') n"))
        .rows[0].n,
      1,
    );
    await assert.rejects(executor.query("DELETE FROM provider_api_rejections"), /immutable/);
  });
});

test("queued script narration can cancel before dispatch; provider submission cannot cancel", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const a = await seedFairAccount(executor, 412),
      j = uuid(412001);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.accountId]);
    await executor.query(
      "SELECT public.videoforge_queue_voiceover_job($1,$2,$3,$4,'Script','voice','voice.mp3')",
      [a.accountId, a.workspaceId, j, sha256("cancel")],
    );
    await executor.query(
      `INSERT INTO hosted_script_projects(project_id,account_id,workspace_id,idempotency_key,request_sha256,options,script,voice_id,voice_name,voiceover_job_id,state)
    VALUES($1,$2,$3,'cancel-script',$4,'{}','Script','voice','Voice',$5,'GENERATING')`,
      [a.projectId, a.accountId, a.workspaceId, sha256("cancel"), j],
    );
    await executor.query("UPDATE projects SET status='ARCHIVED',archived_at=now() WHERE id=$1", [
      a.projectId,
    ]);
    assert.equal(
      (await executor.query("SELECT state FROM hosted_voiceover_jobs WHERE id=$1", [j])).rows[0]
        .state,
      "CANCELLED",
    );
    assert.equal(
      (
        await executor.query(
          "SELECT public.videoforge_claim_voiceover_submission($1,$2,$3,$4) job",
          [a.accountId, a.workspaceId, j, uuid(412002)],
        )
      ).rows[0].job,
      null,
    );
    await assert.rejects(
      executor.query(
        "SELECT public.videoforge_record_voiceover_job($1,$2,$3,'SUBMITTING',NULL,NULL)",
        [a.accountId, a.workspaceId, j],
      ),
      /cannot replay/,
    );
    await executor.query("SELECT set_config('videoforge.account_id','',false)");
    const b = await seedFairAccount(executor, 413),
      jb = uuid(413001),
      cb = uuid(413002);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [b.accountId]);
    await executor.query(
      "SELECT public.videoforge_queue_voiceover_job($1,$2,$3,$4,'Script','voice','voice.mp3')",
      [b.accountId, b.workspaceId, jb, sha256("submitted")],
    );
    await executor.query(
      `INSERT INTO hosted_script_projects(project_id,account_id,workspace_id,idempotency_key,request_sha256,options,script,voice_id,voice_name,voiceover_job_id,state)
    VALUES($1,$2,$3,'submitted-script',$4,'{}','Script','voice','Voice',$5,'GENERATING')`,
      [b.projectId, b.accountId, b.workspaceId, sha256("submitted"), jb],
    );
    await executor.query("SELECT public.videoforge_claim_voiceover_submission($1,$2,$3,$4)", [
      b.accountId,
      b.workspaceId,
      jb,
      cb,
    ]);
    await assert.rejects(
      executor.query("UPDATE projects SET status='ARCHIVED',archived_at=now() WHERE id=$1", [
        b.projectId,
      ]),
      /active work/,
    );
  });
});

test("additive rollout preserves old start and recording while new queue requires a claim", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const a = await seedFairAccount(executor, 414),
      oldId = uuid(414001),
      newId = uuid(414002);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.accountId]);
    const old = (
      await executor.query(
        "SELECT public.videoforge_start_voiceover_job($1,$2,$3,$4,'Script','voice','voice.mp3') value",
        [a.accountId, a.workspaceId, oldId, sha256("old")],
      )
    ).rows[0].value;
    assert.equal(old.claimed, true);
    assert.equal(old.job.state, "SUBMITTING");
    const observed = (
      await executor.query(
        "SELECT public.videoforge_record_voiceover_job($1,$2,$3,'PROCESSING','old-provider-id',NULL) value",
        [a.accountId, a.workspaceId, oldId],
      )
    ).rows[0].value;
    assert.equal(observed.provider_job_id, "old-provider-id");
    await executor.query(
      "SELECT public.videoforge_record_voiceover_job($1,$2,$3,'COMPLETED','old-provider-id',NULL)",
      [a.accountId, a.workspaceId, oldId],
    );
    const queued = (
      await executor.query(
        "SELECT public.videoforge_queue_voiceover_job($1,$2,$3,$4,'Script','voice','voice.mp3') value",
        [a.accountId, a.workspaceId, newId, sha256("new")],
      )
    ).rows[0].value;
    assert.equal(queued.job.state, "WAITING");
    await assert.rejects(
      executor.query(
        "SELECT public.videoforge_record_voiceover_job($1,$2,$3,'PROCESSING','unclaimed-provider-id',NULL)",
        [a.accountId, a.workspaceId, newId],
      ),
      /cannot replay/,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT public.videoforge_claim_voiceover_submission($1,$2,$3,$4) value",
          [a.accountId, a.workspaceId, newId, uuid(414003)],
        )
      ).rows[0].value.state,
      "SUBMITTING",
    );
  });
});
