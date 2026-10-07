import assert from "node:assert/strict";
import test from "node:test";

import { sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

async function admit(executor, serial, email) {
  const rawCode = `voiceover-library-invite-${serial}`;
  const userId = `voiceover-library-user-${String(serial).padStart(4, "0")}`;
  const authAccountId = `voiceover-library-google-${String(serial).padStart(4, "0")}`;
  const sessionId = `voiceover-library-session-${String(serial).padStart(4, "0")}`;
  const token = `voiceover-library-token-${String(serial).padStart(32, "0")}`;
  await executor.query(
    `INSERT INTO invite_codes(
       id,verifier_sha256,intended_normalized_email,state,expires_at,created_at
     ) VALUES(gen_random_uuid(),$1,$2,'ACTIVE',now()+interval '1 day',now())`,
    [sha256(rawCode), email],
  );
  await executor.query(
    `INSERT INTO hosted_auth_users(id,name,email,email_verified,created_at,updated_at)
     VALUES($1,$2,$3,true,now(),now())`,
    [userId, `Voiceover User ${serial}`, email],
  );
  await executor.query(
    `INSERT INTO hosted_auth_accounts(
       id,provider_account_id,provider_id,user_id,created_at,updated_at
     ) VALUES($1,$1,'google',$2,now(),now())`,
    [authAccountId, userId],
  );
  await executor.query(
    `INSERT INTO hosted_auth_sessions(id,expires_at,token,created_at,updated_at,user_id)
     VALUES($1,now()+interval '1 hour',$2,now(),now(),$3)`,
    [sessionId, token, userId],
  );
  const outcome = (
    await executor.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [
      token,
      sha256(rawCode),
    ])
  ).rows[0]?.outcome;
  assert.equal(outcome, "ADMITTED");
  const scope = (
    await executor.query(
      `SELECT user_id,account_id,workspace_id,normalized_email
         FROM videoforge_hosted_session_scope($1)`,
      [token],
    )
  ).rows[0];
  assert.ok(scope, `admitted scope missing for ${email}`);
  return { ...scope, token };
}

async function tenantCall(executor, functionName, args) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  const sql = `WITH bound AS (
    SELECT set_config('videoforge.account_id',($1::uuid)::text,true)
  ) SELECT public.${functionName}(${placeholders}) AS value FROM bound`;
  return (await executor.query(sql, args)).rows[0]?.value;
}

async function tokenCall(executor, functionName, args) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  return (await executor.query(`SELECT public.${functionName}(${placeholders}) AS value`, args))
    .rows[0]?.value;
}

function queueArgs(identity, jobId, suffix = "one") {
  return [
    identity.account_id,
    identity.workspace_id,
    identity.user_id,
    jobId,
    sha256(`voiceover-request-${suffix}`),
    `Narration ${suffix}`,
    `voice-${suffix}`,
    `${suffix}.mp3`,
    `Voiceover ${suffix}`,
    `Narrator ${suffix}`,
  ];
}

async function queue(executor, identity, jobId, suffix = "one") {
  return tenantCall(
    executor,
    "videoforge_queue_standalone_voiceover",
    queueArgs(identity, jobId, suffix),
  );
}

async function insertCompletedJob(executor, identity, jobId, suffix) {
  const args = queueArgs(identity, jobId, suffix);
  const providerJobId = `provider-${suffix}`;
  await executor.query(
    `WITH bound AS (
       SELECT set_config('videoforge.account_id',($1::uuid)::text,true)
     )
     INSERT INTO hosted_voiceover_jobs(
       id,account_id,workspace_id,request_hash,script,voice_id,filename,state,provider_job_id
     )
     SELECT $4::uuid,$1::uuid,$2::uuid,$5::text,$6::text,$7::text,$8::text,'COMPLETED',$9::text
       FROM bound WHERE $3::uuid IS NOT NULL`,
    [
      identity.account_id,
      identity.workspace_id,
      identity.user_id,
      args[3],
      args[4],
      args[5],
      args[6],
      args[7],
      providerJobId,
    ],
  );
  return { args, providerJobId };
}

async function insertPipelineProject(executor, identity, projectId, jobId, suffix) {
  const args = queueArgs(identity, jobId, suffix);
  await executor.query(
    `WITH bound AS (
       SELECT set_config('videoforge.account_id',($1::uuid)::text,true)
     )
     INSERT INTO projects(id,account_id,workspace_id,owner_user_id,name,normalized_name)
     SELECT $3::uuid,$1::uuid,$2::uuid,$4::uuid,$5::text,$6::text FROM bound`,
    [
      identity.account_id,
      identity.workspace_id,
      projectId,
      identity.user_id,
      `Pipeline ${suffix}`,
      `pipeline-${suffix}`,
    ],
  );
  await executor.query(
    `WITH bound AS (
       SELECT set_config('videoforge.account_id',($1::uuid)::text,true)
     )
     INSERT INTO hosted_script_projects(
       project_id,account_id,workspace_id,idempotency_key,request_sha256,options,
       script,voice_id,voice_name,voiceover_job_id,state
     )
     SELECT $3::uuid,$1::uuid,$2::uuid,$5::text,$6::text,'{}'::jsonb,$7::text,$8::text,$9::text,$4::uuid,'WAITING' FROM bound`,
    [
      identity.account_id,
      identity.workspace_id,
      projectId,
      jobId,
      `pipeline-${suffix}`,
      args[4],
      args[5],
      args[6],
      `Pipeline voice ${suffix}`,
    ],
  );
}

async function completeArchive(executor, identity, jobId, suffix, claimId) {
  const queued = await queue(executor, identity, jobId, suffix);
  assert.equal(queued.claimed, true);
  const providerJobId = `provider-${suffix}`;
  const submitClaim = uuid(Number(String(jobId).replace(/-/g, "").slice(-6), 16));
  const submitted = await tenantCall(executor, "videoforge_claim_voiceover_submission", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    submitClaim,
  ]);
  assert.equal(submitted.state, "SUBMITTING");
  await tenantCall(executor, "videoforge_record_voiceover_job", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    "PROCESSING",
    providerJobId,
    null,
  ]);
  await tenantCall(executor, "videoforge_record_voiceover_job", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    "COMPLETED",
    providerJobId,
    null,
  ]);
  const claimed = await tenantCall(executor, "videoforge_claim_voiceover_library_archive", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    claimId,
  ]);
  assert.equal(claimed.provider_job_id, providerJobId);
  const objectKey = `${claimed.object_prefix}${claimId}.mp3`;
  const finalized = await tenantCall(executor, "videoforge_finalize_voiceover_library_archive", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    claimId,
    objectKey,
    "audio/mpeg",
    42,
    sha256(`audio-${suffix}`),
    1_045,
  ]);
  return { providerJobId, queued, claimed, finalized, objectKey };
}

test("0289 standalone voiceover library preserves identity, tenancy, archive fencing, and no-video admission", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const owner = await admit(executor, 1, "demo9gss@gmail.com");
    const memberA = await admit(executor, 2, "voiceover-a@example.test");
    const memberB = await admit(executor, 3, "voiceover-b@example.test");
    const jobA = uuid(2_890_001);
    const beforeProjects = (
      await executor.query("SELECT count(*)::int AS count FROM projects WHERE workspace_id=$1", [
        memberA.workspace_id,
      ])
    ).rows[0].count;
    const beforeScriptProjects = (
      await executor.query(
        "SELECT count(*)::int AS count FROM hosted_script_projects WHERE workspace_id=$1",
        [memberA.workspace_id],
      )
    ).rows[0].count;

    const first = await queue(executor, memberA, jobA);
    assert.equal(first.claimed, true);
    assert.equal(first.job.state, "WAITING");
    const replay = await queue(executor, memberA, jobA);
    assert.equal(replay.claimed, false);
    assert.equal(replay.job.id, jobA);
    await assert.rejects(
      queue(executor, memberA, jobA, "different-input"),
      /VOICEOVER_REQUEST_CONFLICT|VOICEOVER_LIBRARY_REQUEST_CONFLICT/,
    );

    const afterProjects = (
      await executor.query("SELECT count(*)::int AS count FROM projects WHERE workspace_id=$1", [
        memberA.workspace_id,
      ])
    ).rows[0].count;
    const afterScriptProjects = (
      await executor.query(
        "SELECT count(*)::int AS count FROM hosted_script_projects WHERE workspace_id=$1",
        [memberA.workspace_id],
      )
    ).rows[0].count;
    assert.equal(afterProjects, beforeProjects);
    assert.equal(afterScriptProjects, beforeScriptProjects);
    // Release the account's single queued admission before seeding completed
    // provider identities for the guard cases below.
    await executor.query(
      "UPDATE hosted_voiceover_jobs SET state='CANCELLED',updated_at=now() WHERE id=$1",
      [jobA],
    );

    // A J1 identity admitted by the video pipeline cannot be promoted into the
    // standalone library, even when its request payload matches. An existing
    // hosted job without a standalone asset is likewise never adopted.
    const pipelineJob = uuid(2_890_003);
    await insertCompletedJob(executor, memberA, pipelineJob, "pipeline");
    await insertPipelineProject(executor, memberA, uuid(2_890_004), pipelineJob, "pipeline");
    await assert.rejects(
      queue(executor, memberA, pipelineJob, "pipeline"),
      /VOICEOVER_LIBRARY_PIPELINE_JOB_CONFLICT/,
    );
    const orphanJob = uuid(2_890_005);
    await insertCompletedJob(executor, memberA, orphanJob, "orphan");
    await assert.rejects(
      queue(executor, memberA, orphanJob, "orphan"),
      /VOICEOVER_LIBRARY_EXISTING_JOB_CONFLICT/,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int AS count FROM hosted_voiceover_library_assets WHERE voiceover_job_id = ANY($1::uuid[])",
          [[pipelineJob, orphanJob]],
        )
      ).rows[0].count,
      0,
    );

    await assert.rejects(
      tenantCall(executor, "videoforge_finalize_voiceover_library_archive", [
        memberB.account_id,
        memberB.workspace_id,
        jobA,
        uuid(2_890_002),
        `tenant/${memberB.account_id}/workspace/${memberB.workspace_id}/voiceover/${jobA}/${uuid(2_890_002)}.mp3`,
        "audio/mpeg",
        42,
        sha256("foreign"),
        1_045,
      ]),
      /VOICEOVER_NOT_READY/,
    );

    const own = await tokenCall(executor, "videoforge_read_voiceover_library", [
      memberA.token,
      false,
      null,
      "",
      null,
      0,
    ]);
    assert.equal(own.total, 1);
    assert.equal(own.voiceovers[0].id, jobA);
    const foreign = await tokenCall(executor, "videoforge_read_voiceover_library", [
      memberB.token,
      false,
      jobA,
      "",
      null,
      0,
    ]);
    assert.equal(foreign.total, 0);
    assert.deepEqual(
      await tokenCall(executor, "videoforge_read_voiceover_library", [
        memberA.token,
        true,
        null,
        "",
        null,
        0,
      ]),
      { error: "CENTRALIZED_LIBRARY_FORBIDDEN" },
    );

    const jobB = uuid(2_890_011);
    const claimB = uuid(2_890_012);
    const completedB = await completeArchive(executor, memberB, jobB, "member-b", claimB);
    const central = await tokenCall(executor, "videoforge_read_voiceover_library", [
      owner.token,
      true,
      null,
      "",
      null,
      0,
    ]);
    assert.equal(central.total, 2);
    assert.equal(central.voiceovers.find((voiceover) => voiceover.id === jobB).id, jobB);
    assert.deepEqual(central.creators, [
      {
        id: memberA.account_id,
        name: "Voiceover User 2",
        email: "voiceover-a@example.test",
      },
      {
        id: memberB.account_id,
        name: "Voiceover User 3",
        email: "voiceover-b@example.test",
      },
    ]);
    assert.equal(
      central.voiceovers.find((voiceover) => voiceover.id === jobB).object_key,
      completedB.objectKey,
    );

    const jobC = uuid(2_890_021);
    const claimC1 = uuid(2_890_022);
    const claimC2 = uuid(2_890_023);
    await queue(executor, memberA, jobC, "claim-race");
    await executor.query(
      "UPDATE provider_api_policies SET next_start_at='-infinity',cooldown_until='-infinity' WHERE provider='J1_TTS'",
    );
    const submissionClaimC = uuid(2_890_024);
    const providerJobC = "provider-claim-race";
    assert.equal(
      (
        await tenantCall(executor, "videoforge_claim_voiceover_submission", [
          memberA.account_id,
          memberA.workspace_id,
          jobC,
          submissionClaimC,
        ])
      ).state,
      "SUBMITTING",
    );
    await tenantCall(executor, "videoforge_record_voiceover_job", [
      memberA.account_id,
      memberA.workspace_id,
      jobC,
      "PROCESSING",
      providerJobC,
      null,
    ]);
    await tenantCall(executor, "videoforge_record_voiceover_job", [
      memberA.account_id,
      memberA.workspace_id,
      jobC,
      "COMPLETED",
      providerJobC,
      null,
    ]);
    const [claimOne, claimTwo] = await Promise.all([
      tenantCall(executor, "videoforge_claim_voiceover_library_archive", [
        memberA.account_id,
        memberA.workspace_id,
        jobC,
        claimC1,
      ]),
      tenantCall(executor, "videoforge_claim_voiceover_library_archive", [
        memberA.account_id,
        memberA.workspace_id,
        jobC,
        claimC2,
      ]),
    ]);
    assert.equal([claimOne, claimTwo].filter(Boolean).length, 1);
    const winningClaim = claimOne ? claimC1 : claimC2;
    const winningKey = `${(claimOne ?? claimTwo).object_prefix}${winningClaim}.mp3`;
    await executor.query(
      "UPDATE hosted_voiceover_library_assets SET deleted_at=now() WHERE voiceover_job_id=$1",
      [jobC],
    );
    await assert.rejects(
      tenantCall(executor, "videoforge_finalize_voiceover_library_archive", [
        memberA.account_id,
        memberA.workspace_id,
        jobC,
        winningClaim,
        winningKey,
        "audio/mpeg",
        42,
        sha256("deleted"),
        1_045,
      ]),
      /VOICEOVER_NOT_READY/,
    );

    const ownDeletePlan = await tokenCall(executor, "videoforge_delete_voiceover_library", [
      memberB.token,
      false,
      jobB,
      false,
    ]);
    assert.equal(ownDeletePlan.object_key, completedB.objectKey);
    assert.deepEqual(
      await tokenCall(executor, "videoforge_delete_voiceover_library", [
        memberA.token,
        false,
        jobB,
        false,
      ]),
      { error: "VOICEOVER_NOT_FOUND" },
    );
    assert.deepEqual(
      await tokenCall(executor, "videoforge_delete_voiceover_library", [
        memberB.token,
        false,
        jobB,
        true,
      ]),
      { deleted: true },
    );
    assert.deepEqual(
      await tokenCall(executor, "videoforge_delete_voiceover_library", [
        memberB.token,
        false,
        jobB,
        false,
      ]),
      { deleted: true },
    );
  });
});

test("standalone queue retains successive scripts and advances in FIFO order without browser polling", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const member = await admit(executor, 10, "voiceover-queue@example.test");
    const first = uuid(2_890_100),
      second = uuid(2_890_101);
    const scope = [member.account_id, member.workspace_id];
    await executor.query(
      "UPDATE provider_api_policies SET max_inflight=1,min_start_interval_ms=0,next_start_at='-infinity',cooldown_until='-infinity' WHERE provider='J1_TTS'",
    );
    assert.equal((await queue(executor, member, first, "first")).job.state, "WAITING");
    assert.equal((await queue(executor, member, second, "second")).job.state, "WAITING");
    const claim = (id) =>
      tenantCall(executor, "videoforge_claim_voiceover_submission", [
        ...scope,
        id,
        uuid(2_890_102),
      ]);
    assert.equal(await claim(second), null);
    assert.equal((await claim(first)).state, "SUBMITTING");
    await tenantCall(executor, "videoforge_record_voiceover_job", [
      ...scope,
      first,
      "PROCESSING",
      "provider-first",
      null,
    ]);
    assert.equal(await claim(second), null);
    const saved = await tokenCall(executor, "videoforge_read_voiceover_library", [
      member.token,
      false,
      null,
      "",
      null,
      0,
    ]);
    assert.equal(saved.voiceovers.length, 2);
    assert.equal(saved.voiceovers.find((row) => row.id === second).state, "WAITING");
    await tenantCall(executor, "videoforge_record_voiceover_job", [
      ...scope,
      first,
      "COMPLETED",
      "provider-first",
      null,
    ]);
    assert.equal((await claim(second)).state, "SUBMITTING");
    assert.equal(await claim(second), null);
  });
});
