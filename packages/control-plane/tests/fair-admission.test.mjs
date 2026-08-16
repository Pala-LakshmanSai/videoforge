import assert from "node:assert/strict";
import test from "node:test";

import {
  FairAdmissionError,
  FairAdmissionRepository,
  trustedTenantActorScope,
  trustedTenantScope,
} from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { FIXED_TIME, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

const t = (seconds) => new Date(Date.parse(FIXED_TIME) + seconds * 1_000).toISOString();
const actorA = () =>
  trustedTenantActorScope(trustedTenantScope(IDS.accountA, IDS.workspaceA), IDS.userA);
const actorB = () =>
  trustedTenantActorScope(trustedTenantScope(IDS.accountB, IDS.workspaceB), IDS.userB);

function video(serial, projectId, revisionId, now = FIXED_TIME) {
  return {
    requestId: uuid(serial),
    projectId,
    projectRevisionId: revisionId,
    idempotencyKey: `video-${serial}`,
    now,
    auditId: uuid(serial + 100_000),
  };
}

function preview(serial, presetVersionId, now = FIXED_TIME) {
  return {
    requestId: uuid(serial),
    lane: serial % 2 === 0 ? "MAGE" : "SOULX",
    presetVersionId,
    idempotencyKey: `preview-${serial}`,
    now,
    auditId: uuid(serial + 100_000),
  };
}

function promotion(serial, now = t(1), expiresAt = t(61)) {
  return {
    leaseId: uuid(serial),
    auditId: uuid(serial + 100_000),
    ownerTokenSha256: sha256(`lease-owner-${serial}`),
    now,
    expiresAt,
  };
}

async function seeded(work) {
  return withMigratedDatabase(async (context) => {
    await seedLockedProjects(context.executor);
    return work({ ...context, repository: new FairAdmissionRepository(context.executor) });
  });
}

async function seedFairAccount(executor, index) {
  const base = 400_000 + index * 100;
  const identity = {
    accountId: uuid(base + 1),
    workspaceId: uuid(base + 2),
    userId: uuid(base + 3),
    membershipId: uuid(base + 4),
    avatarOriginalId: uuid(base + 5),
    avatarRuntimeId: uuid(base + 6),
    voiceoverId: uuid(base + 7),
    avatarProfileId: uuid(base + 8),
    avatarVersionId: uuid(base + 9),
    styleId: uuid(base + 10),
    styleVersionId: uuid(base + 11),
    projectId: uuid(base + 12),
    revisionId: uuid(base + 13),
  };
  const email = `fair-${index}@example.test`;
  await executor.query(
    `INSERT INTO users (id, email, normalized_email, display_name)
     VALUES ($1, $2, $2, $3)`,
    [identity.userId, email, `Fair account ${index}`],
  );
  await executor.query(
    `INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
     VALUES ($1, 'USER', $2, $3, 'ACTIVE')`,
    [identity.accountId, identity.userId, email],
  );
  await executor.query(
    `INSERT INTO workspaces (id, name, normalized_name, account_id, is_default)
     VALUES ($1, $2, $3, $4, true)`,
    [
      identity.workspaceId,
      `Fair workspace ${index}`,
      `fair workspace ${index}`,
      identity.accountId,
    ],
  );
  await executor.query(
    `INSERT INTO memberships (id, workspace_id, user_id, normalized_name, role, status)
     VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE')`,
    [identity.membershipId, identity.workspaceId, identity.userId, `fair owner ${index}`],
  );
  for (const [assetId, kind, label] of [
    [identity.avatarOriginalId, "AVATAR_ORIGINAL", "avatar-original"],
    [identity.avatarRuntimeId, "AVATAR_RUNTIME", "avatar-runtime"],
    [identity.voiceoverId, "VOICEOVER", "voiceover"],
  ]) {
    await executor.query(
      `INSERT INTO assets (
         id, workspace_id, kind, state, object_key, binary_sha256,
         content_type, byte_size, verified_at
       ) VALUES ($1, $2, $3, 'VERIFIED', $4, $5, 'application/octet-stream', 128, $6)`,
      [
        assetId,
        identity.workspaceId,
        kind,
        `workspace/fair-${index}/${label}.bin`,
        sha256(`fair-${index}-${label}`),
        FIXED_TIME,
      ],
    );
  }
  await executor.query(
    `INSERT INTO avatar_profiles (id, workspace_id, name, normalized_name, created_by_user_id)
     VALUES ($1, $2, 'Fair Presenter', 'fair presenter', $3)`,
    [identity.avatarProfileId, identity.workspaceId, identity.userId],
  );
  await executor.query(
    `INSERT INTO avatar_profile_versions (
       id, workspace_id, profile_id, version_number, state,
       profile_contract_name, profile_contract_version, profile_payload, profile_hash,
       original_asset_id, runtime_source_asset_id, runtime_source_binary_sha256,
       source_preparation_profile, source_validation_profile,
       rights_attested_by_user_id, likeness_attested_by_user_id, ready_at
     ) VALUES ($1, $2, $3, 1, 'READY', 'avatar-profile-version', 'v1',
               '{"source":"owned-synthetic"}'::jsonb, $4, $5, $6, $7,
               'owned-preparation-v1', 'owned-validation-v1', $8, $8, $9)`,
    [
      identity.avatarVersionId,
      identity.workspaceId,
      identity.avatarProfileId,
      sha256(`fair-${index}-avatar-profile`),
      identity.avatarOriginalId,
      identity.avatarRuntimeId,
      sha256(`fair-${index}-avatar-runtime`),
      identity.userId,
      FIXED_TIME,
    ],
  );
  await executor.query(`UPDATE avatar_profiles SET active_version_id = $1 WHERE id = $2`, [
    identity.avatarVersionId,
    identity.avatarProfileId,
  ]);
  await executor.query(
    `INSERT INTO image_styles (id, workspace_id, name, normalized_name, created_by_user_id)
     VALUES ($1, $2, 'Fair Documentary', 'fair documentary', $3)`,
    [identity.styleId, identity.workspaceId, identity.userId],
  );
  await executor.query(
    `INSERT INTO image_style_versions (
       id, workspace_id, style_id, version_number, state,
       profile_contract_name, profile_contract_version, profile_payload, style_profile_hash,
       disclosure_attested_by_user_id, published_at
     ) VALUES ($1, $2, $3, 1, 'PUBLISHED', 'image-style-profile', 'v1',
               '{"source":"owned-synthetic"}'::jsonb, $4, $5, $6)`,
    [
      identity.styleVersionId,
      identity.workspaceId,
      identity.styleId,
      sha256(`fair-${index}-style`),
      identity.userId,
      FIXED_TIME,
    ],
  );
  await executor.query(`UPDATE image_styles SET active_version_id = $1 WHERE id = $2`, [
    identity.styleVersionId,
    identity.styleId,
  ]);
  await executor.query(
    `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
     VALUES ($1, $2, $3, 'Fair Project', 'fair project')`,
    [identity.projectId, identity.workspaceId, identity.userId],
  );
  await executor.query(
    `INSERT INTO project_revisions (
       id, workspace_id, project_id, revision_number, status, title,
       voiceover_asset_id, voiceover_binary_sha256,
       avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
       avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
       avatar_source_preparation_profile, avatar_source_validation_profile,
       avatar_compatibility_state, image_style_id, image_style_version_id, style_profile_hash,
       generation_mode, maximum_cost_micro_usd, seed,
       revision_config_contract_name, revision_config_contract_version,
       revision_config_payload, revision_config_hash, created_by_user_id, locked_at
     ) VALUES ($1, $2, $3, 1, 'LOCKED', $4, $5, $6, $7, $8, $9, $10, $11,
               'owned-preparation-v1', 'owned-validation-v1', 'UNTESTED', $12, $13, $14,
               'LOWEST_COST', 1500000, $15, 'project-revision-config', 'v2',
               '{"source":"owned-synthetic"}'::jsonb, $16, $17, $18)`,
    [
      identity.revisionId,
      identity.workspaceId,
      identity.projectId,
      `Fair Revision ${index}`,
      identity.voiceoverId,
      sha256(`fair-${index}-voiceover`),
      identity.avatarProfileId,
      identity.avatarVersionId,
      sha256(`fair-${index}-avatar-profile`),
      identity.avatarRuntimeId,
      sha256(`fair-${index}-avatar-runtime`),
      identity.styleId,
      identity.styleVersionId,
      sha256(`fair-${index}-style`),
      index,
      sha256(`fair-${index}-revision`),
      identity.userId,
      FIXED_TIME,
    ],
  );
  return identity;
}

test("two different accounts win exactly two slots; same-account double submit and a third slot wait", async () => {
  await seeded(async ({ executor, repository }) => {
    await repository.enqueueVideo(actorA(), video(10_001, IDS.projectA, IDS.revisionA));
    await repository.enqueueVideo(actorA(), video(10_002, IDS.projectA, IDS.revisionA));
    await repository.enqueueVideo(actorB(), video(10_003, IDS.projectB, IDS.revisionB));

    const first = await repository.promoteNext(promotion(20_001));
    const second = await repository.promoteNext(promotion(20_002));
    const third = await repository.promoteNext(promotion(20_003));

    assert.equal(first?.requestId, uuid(10_001));
    assert.equal(second?.requestId, uuid(10_003));
    assert.equal(first?.accountId === second?.accountId, false);
    assert.deepEqual([first?.slot, second?.slot], [1, 2]);
    assert.equal(third, null);

    const capacity = await executor.query(
      `SELECT active_lease_count FROM global_generation_capacity WHERE singleton`,
    );
    assert.equal(capacity.rows[0].active_lease_count, 2);
    const inert = await executor.query(
      `SELECT (SELECT count(*)::int FROM generation_tasks) AS tasks,
              (SELECT count(*)::int FROM outbox) AS outbox`,
    );
    assert.deepEqual(inert.rows[0], { tasks: 0, outbox: 0 });
  });
});

test("duplicate Generate replays one durable request and conflicts on changed work", async () => {
  await seeded(async ({ executor, repository }) => {
    const command = video(10_101, IDS.projectA, IDS.revisionA);
    const first = await repository.enqueueVideo(actorA(), command);
    const replay = await repository.enqueueVideo(actorA(), command);
    assert.deepEqual(replay, first);
    await assert.rejects(
      repository.enqueueVideo(actorA(), { ...command, requestId: uuid(10_102) }),
      (error) => error instanceof FairAdmissionError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    const rows = await executor.query(
      `SELECT count(*)::int AS requests,
              (SELECT count(*)::int FROM generation_queue_audits WHERE operation = 'ENQUEUE') AS audits
         FROM generation_requests`,
    );
    assert.deepEqual(rows.rows[0], { requests: 1, audits: 1 });
  });
});

test("preview admission resolves an exact owned preset and rejects a foreign tenant version", async () => {
  await seeded(async ({ executor, repository }) => {
    await assert.rejects(
      repository.enqueuePreview(actorA(), preview(10_111, IDS.avatarVersionB)),
      (error) => error instanceof FairAdmissionError && error.code === "NOT_FOUND",
    );
    const queued = await repository.enqueuePreview(actorA(), preview(10_112, IDS.styleVersionA));
    const binding = await executor.query(
      `SELECT preset_account_id, preset_workspace_id, preset_scope_kind,
              mage_image_style_version_id, soulx_avatar_profile_version_id
         FROM preset_preview_requests WHERE id = $1`,
      [queued.requestId],
    );
    assert.deepEqual(binding.rows[0], {
      preset_account_id: IDS.accountA,
      preset_workspace_id: IDS.workspaceA,
      preset_scope_kind: "WORKSPACE",
      mage_image_style_version_id: IDS.styleVersionA,
      soulx_avatar_profile_version_id: null,
    });
  });
});

test("eligible video heads always outrank previews and preview promotion never moves the video cursor", async () => {
  await seeded(async ({ executor, repository }) => {
    await repository.enqueuePreview(actorA(), preview(11_001, IDS.avatarVersionA));
    await repository.enqueueVideo(actorB(), video(11_002, IDS.projectB, IDS.revisionB));

    const videoWinner = await repository.promoteNext(promotion(21_001));
    assert.equal(videoWinner?.requestKind, "VIDEO");
    assert.equal(videoWinner?.requestId, uuid(11_002));
    const videoCursor = videoWinner.videoFairCursor;

    const previewWinner = await repository.promoteNext(promotion(21_002));
    assert.equal(previewWinner?.requestKind, "PRESET_PREVIEW");
    assert.equal(previewWinner?.videoFairCursor, videoCursor);
    assert.ok(previewWinner.previewFairCursor > 0n);

    const leases = await executor.query(
      `SELECT count(*)::int AS count, count(DISTINCT account_id)::int AS accounts
         FROM provider_workload_leases WHERE state = 'ACTIVE'`,
    );
    assert.deepEqual(leases.rows[0], { count: 2, accounts: 2 });
  });
});

test("owned reorder and cancel preserve cross-account cursor; active work cannot move", async () => {
  await seeded(async ({ executor, repository }) => {
    const firstA = await repository.enqueueVideo(
      actorA(),
      video(12_001, IDS.projectA, IDS.revisionA),
    );
    const secondA = await repository.enqueueVideo(
      actorA(),
      video(12_002, IDS.projectA, IDS.revisionA),
    );
    await repository.enqueueVideo(actorB(), video(12_003, IDS.projectB, IDS.revisionB));
    const cursorBefore = await executor.query(
      `SELECT video_fair_cursor FROM global_generation_capacity WHERE singleton`,
    );

    await repository.reorderOwnedWaiting(actorA(), {
      requestKind: "VIDEO",
      requestId: secondA.requestId,
      expectedVersion: secondA.version,
      toPosition: 1,
      auditId: uuid(112_010),
      now: t(1),
    });
    await assert.rejects(
      repository.reorderOwnedWaiting(actorA(), {
        requestKind: "VIDEO",
        requestId: secondA.requestId,
        expectedVersion: secondA.version,
        toPosition: 1,
        auditId: uuid(112_013),
        now: t(2),
      }),
      (error) =>
        error instanceof FairAdmissionError &&
        error.code === "EXPECTED_VERSION_MISMATCH" &&
        error.currentVersion === secondA.version + 1,
    );
    await repository.cancelOwned(actorA(), {
      requestKind: "VIDEO",
      requestId: firstA.requestId,
      expectedVersion: firstA.version,
      auditId: uuid(112_011),
      now: t(3),
    });
    const cursorAfter = await executor.query(
      `SELECT video_fair_cursor FROM global_generation_capacity WHERE singleton`,
    );
    assert.deepEqual(cursorAfter.rows[0], cursorBefore.rows[0]);

    const winnerA = await repository.promoteNext(promotion(22_001, t(4), t(64)));
    const winnerB = await repository.promoteNext(promotion(22_002, t(4), t(64)));
    assert.equal(winnerA?.requestId, secondA.requestId);
    assert.equal(winnerB?.requestId, uuid(12_003));

    await assert.rejects(
      repository.reorderOwnedWaiting(actorA(), {
        requestKind: "VIDEO",
        requestId: secondA.requestId,
        expectedVersion: winnerA.requestVersion,
        toPosition: 1,
        auditId: uuid(112_012),
        now: t(5),
      }),
      (error) => error instanceof FairAdmissionError && error.code === "INVALID_STATE_TRANSITION",
    );
    assert.equal(
      (await repository.listOwned(trustedTenantScope(IDS.accountB, IDS.workspaceB))).length,
      1,
    );
    assert.equal(
      (await repository.listOwned(trustedTenantScope(IDS.accountA, IDS.workspaceA))).length,
      2,
    );
  });
});

test("terminal release and next fair promotion commit atomically; failed work retries with a new ordinal", async () => {
  await seeded(async ({ repository }) => {
    await repository.enqueueVideo(actorA(), video(13_001, IDS.projectA, IDS.revisionA));
    await repository.enqueueVideo(actorA(), video(13_002, IDS.projectA, IDS.revisionA));
    await repository.enqueueVideo(actorB(), video(13_003, IDS.projectB, IDS.revisionB));
    const leaseA = await repository.promoteNext(promotion(23_001));
    const leaseB = await repository.promoteNext(promotion(23_002));
    assert.ok(leaseA && leaseB);

    const promoted = await repository.settleAndPromote({
      leaseId: leaseA.leaseId,
      ownerTokenSha256: sha256("lease-owner-23001"),
      expectedLeaseVersion: leaseA.leaseVersion,
      terminalState: "FAILED",
      auditId: uuid(113_010),
      now: t(5),
      nextPromotion: promotion(23_003, t(5), t(65)),
    });
    assert.equal(promoted?.requestId, uuid(13_002));
    assert.equal(promoted?.accountId, IDS.accountA);

    await repository.retryOwnedFailed(actorA(), {
      requestKind: "VIDEO",
      requestId: leaseA.requestId,
      expectedVersion: leaseA.requestVersion + 1,
      auditId: uuid(113_011),
      now: t(6),
    });
    const own = await repository.listOwned(trustedTenantScope(IDS.accountA, IDS.workspaceA));
    assert.equal(own.find((item) => item.requestId === leaseA.requestId)?.attemptOrdinal, 2);
  });
});

test("lease ownership/version theft fails; expiry reclamation and restart reconstruction stay bounded", async () => {
  await seeded(async ({ executor, repository }) => {
    await repository.enqueueVideo(actorA(), video(14_001, IDS.projectA, IDS.revisionA));
    await repository.enqueueVideo(actorB(), video(14_002, IDS.projectB, IDS.revisionB));
    const leaseA = await repository.promoteNext(promotion(24_001, t(1), t(10)));
    const leaseB = await repository.promoteNext(promotion(24_002, t(1), t(70)));
    assert.ok(leaseA && leaseB);

    await assert.rejects(
      repository.heartbeatLease({
        leaseId: leaseA.leaseId,
        ownerTokenSha256: sha256("thief"),
        expectedVersion: 1,
        auditId: uuid(114_010),
        now: t(2),
        expiresAt: t(80),
      }),
      (error) => error instanceof FairAdmissionError && error.code === "LEASE_OWNER_MISMATCH",
    );

    const reclaimed = await repository.reclaimExpired({
      now: t(11),
      expirations: [{ leaseId: leaseA.leaseId, auditId: uuid(114_011) }],
      promotions: [promotion(24_003, t(11), t(71))],
    });
    assert.equal(reclaimed.length, 1);
    const rebuilt = await repository.reconstruct({ now: t(12), auditId: uuid(114_012) });
    assert.equal(rebuilt.activeLeaseCount, 2);
    assert.equal(new Set(rebuilt.accountIds).size, 2);

    const capacity = await executor.query(
      `SELECT active_lease_count FROM global_generation_capacity WHERE singleton`,
    );
    assert.equal(capacity.rows[0].active_lease_count, 2);
  });
});

test("zero-lease restart reconstruction repairs stale capacity with a SYSTEM audit", async () => {
  await seeded(async ({ executor, repository }) => {
    await executor.query(
      `UPDATE global_generation_capacity SET active_lease_count = 1 WHERE singleton`,
    );
    const auditId = uuid(114_101);
    const rebuilt = await repository.reconstruct({ now: t(12), auditId });
    assert.deepEqual(rebuilt, { activeLeaseCount: 0, accountIds: [] });
    const repaired = await executor.query(
      `SELECT capacity.active_lease_count, audit.request_kind, audit.operation,
              audit.detail->>'activeLeaseCount' AS audited_count,
              account.scope_kind
         FROM global_generation_capacity capacity
         JOIN generation_queue_audits audit ON audit.id = $1
         JOIN accounts account ON account.id = audit.account_id
        WHERE capacity.singleton`,
      [auditId],
    );
    assert.deepEqual(repaired.rows[0], {
      active_lease_count: 0,
      request_kind: "CAPACITY",
      operation: "RECONSTRUCT",
      audited_count: "0",
      scope_kind: "SYSTEM",
    });
  });
});

test("concurrent cancel-versus-promote remains atomic and never over-admits", async () => {
  await seeded(async ({ executor, repository }) => {
    await repository.enqueueVideo(actorA(), video(14_101, IDS.projectA, IDS.revisionA));
    const waitingB = await repository.enqueueVideo(
      actorB(),
      video(14_102, IDS.projectB, IDS.revisionB),
    );
    const activeA = await repository.promoteNext(promotion(24_101, t(1), t(61)));
    assert.ok(activeA);
    const race = await Promise.allSettled([
      repository.cancelOwned(actorB(), {
        requestKind: "VIDEO",
        requestId: waitingB.requestId,
        expectedVersion: waitingB.version,
        auditId: uuid(114_102),
        now: t(2),
      }),
      repository.promoteNext(promotion(24_102, t(2), t(62))),
    ]);
    assert.ok(race.some((result) => result.status === "fulfilled"));
    const truth = await executor.query(
      `SELECT capacity.active_lease_count,
              (SELECT count(DISTINCT account_id)::int
                 FROM provider_workload_leases WHERE state = 'ACTIVE') AS active_accounts
         FROM global_generation_capacity capacity WHERE singleton`,
    );
    assert.ok(truth.rows[0].active_lease_count <= 2);
    assert.equal(truth.rows[0].active_lease_count, truth.rows[0].active_accounts);
  });
});

test("a crash after promotion mutations but before commit leaves no lease, cursor, or request drift", async () => {
  await seeded(async ({ executor, repository }) => {
    await repository.enqueueVideo(actorA(), video(15_001, IDS.projectA, IDS.revisionA));
    await assert.rejects(
      repository.promoteNext({
        ...promotion(25_001),
        beforeCommit() {
          throw new Error("synthetic crash before commit");
        },
      }),
      /synthetic crash before commit/u,
    );
    const truth = await executor.query(
      `SELECT capacity.active_lease_count, capacity.video_fair_cursor,
              request.state, request.version
         FROM global_generation_capacity capacity
         CROSS JOIN generation_requests request
        WHERE capacity.singleton AND request.id = $1`,
      [uuid(15_001)],
    );
    assert.deepEqual(truth.rows[0], {
      active_lease_count: 0,
      video_fair_cursor: 0,
      state: "WAITING",
      version: 1,
    });
  });
});

test("database triggers reject a third active lease even when application admission is bypassed", async () => {
  await seeded(async ({ executor, repository }) => {
    await repository.enqueueVideo(actorA(), video(16_001, IDS.projectA, IDS.revisionA));
    await repository.enqueueVideo(actorB(), video(16_002, IDS.projectB, IDS.revisionB));
    const first = await repository.promoteNext(promotion(26_001));
    const second = await repository.promoteNext(promotion(26_002));
    assert.ok(first && second);

    await assert.rejects(
      executor.query(
        `INSERT INTO provider_workload_leases (
           id, slot, account_id, workspace_id, request_kind, generation_request_id,
           owner_token_sha256, state, acquired_at, heartbeat_at, expires_at
         ) VALUES ($1, 1, $2, $3, 'VIDEO', $4, $5, 'ACTIVE', $6, $6, $7)`,
        [
          uuid(26_003),
          IDS.accountA,
          IDS.workspaceA,
          first.requestId,
          sha256("bypass"),
          t(2),
          t(70),
        ],
      ),
      (error) => error instanceof Error && error.code === "23514",
    );
  });
});

test("ten-account simultaneous load rotates every video account before a second turn and holds previews", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const accounts = [];
    for (let index = 1; index <= 10; index += 1) {
      accounts.push(await seedFairAccount(executor, index));
    }
    const repository = new FairAdmissionRepository(executor);
    const enqueue = [];
    for (const [index, account] of accounts.entries()) {
      const scope = trustedTenantActorScope(
        trustedTenantScope(account.accountId, account.workspaceId),
        account.userId,
      );
      enqueue.push(
        repository.enqueueVideo(
          scope,
          video(500_000 + index * 10 + 1, account.projectId, account.revisionId),
        ),
        repository.enqueueVideo(
          scope,
          video(500_000 + index * 10 + 2, account.projectId, account.revisionId),
        ),
        repository.enqueuePreview(
          scope,
          preview(500_000 + index * 10 + 3, account.avatarVersionId),
        ),
      );
    }
    await Promise.all(enqueue);

    let promotionSerial = 700_000;
    let settlementAuditSerial = 900_000;
    const makePromotion = () => {
      const identity = promotion(promotionSerial, t(1), t(3_600));
      promotionSerial += 1;
      return identity;
    };
    const simultaneous = Array.from({ length: 10 }, () => makePromotion());
    const simultaneousResults = await Promise.all(
      simultaneous.map((identity) => repository.promoteNext(identity)),
    );
    const active = simultaneousResults.flatMap((result, index) =>
      result === null ? [] : [{ result, identity: simultaneous[index] }],
    );
    assert.equal(active.length, 2, "ten simultaneous promoters still own only two slots");
    assert.equal(new Set(active.map(({ result }) => result.accountId)).size, 2);

    const videoAccounts = active.map(({ result }) => result.accountId);
    while (videoAccounts.length < 20) {
      const current = active.shift();
      assert.ok(current, "one active video must remain while video heads are waiting");
      const nextIdentity = makePromotion();
      const next = await repository.settleAndPromote({
        leaseId: current.result.leaseId,
        ownerTokenSha256: current.identity.ownerTokenSha256,
        expectedLeaseVersion: current.result.leaseVersion,
        terminalState: "SUCCEEDED",
        auditId: uuid(settlementAuditSerial),
        now: t(videoAccounts.length + 2),
        nextPromotion: nextIdentity,
      });
      settlementAuditSerial += 1;
      if (next !== null) {
        assert.equal(next.requestKind, "VIDEO", "a preview cannot outrank any eligible video head");
        videoAccounts.push(next.accountId);
        active.push({ result: next, identity: nextIdentity });
      }
    }

    assert.equal(new Set(videoAccounts.slice(0, 10)).size, 10);
    assert.equal(new Set(videoAccounts.slice(10, 20)).size, 10);
    for (const current of active) {
      await repository.settleAndPromote({
        leaseId: current.result.leaseId,
        ownerTokenSha256: current.identity.ownerTokenSha256,
        expectedLeaseVersion: current.result.leaseVersion,
        terminalState: "SUCCEEDED",
        auditId: uuid(settlementAuditSerial),
        now: t(40 + promotionSerial - 700_000),
      });
      settlementAuditSerial += 1;
      promotionSerial += 1;
    }

    const beforePreview = await executor.query(
      `SELECT video_fair_cursor FROM global_generation_capacity WHERE singleton`,
    );
    const previewWinner = await repository.promoteNext(makePromotion());
    assert.equal(previewWinner?.requestKind, "PRESET_PREVIEW");
    const afterPreview = await executor.query(
      `SELECT video_fair_cursor FROM global_generation_capacity WHERE singleton`,
    );
    assert.deepEqual(afterPreview.rows[0], beforePreview.rows[0]);

    const waitingProviderWork = await executor.query(
      `SELECT (SELECT count(*)::int FROM generation_tasks) AS tasks,
              (SELECT count(*)::int FROM outbox) AS outbox`,
    );
    assert.deepEqual(waitingProviderWork.rows[0], { tasks: 0, outbox: 0 });
  });
});

test("1/2/5-account wait-distribution simulations report exact two-slot behavior", async () => {
  const reports = [];
  for (const accountCount of [1, 2, 5]) {
    await withMigratedDatabase(async ({ executor }) => {
      const accounts = [];
      for (let index = 1; index <= accountCount; index += 1) {
        accounts.push(await seedFairAccount(executor, 20 + accountCount * 10 + index));
      }
      const repository = new FairAdmissionRepository(executor);
      for (const [index, account] of accounts.entries()) {
        await repository.enqueueVideo(
          trustedTenantActorScope(
            trustedTenantScope(account.accountId, account.workspaceId),
            account.userId,
          ),
          video(800_000 + accountCount * 100 + index, account.projectId, account.revisionId),
        );
      }
      await Promise.all(
        accounts.map((_, index) =>
          repository.promoteNext(promotion(810_000 + accountCount * 100 + index, t(1), t(61))),
        ),
      );
      const distribution = await executor.query(
        `SELECT count(*) FILTER (WHERE state = 'ADMITTED')::int AS active,
                count(*) FILTER (WHERE state = 'WAITING')::int AS waiting
           FROM generation_requests`,
      );
      reports.push({ accountCount, ...distribution.rows[0] });
    });
  }
  assert.deepEqual(reports, [
    { accountCount: 1, active: 1, waiting: 0 },
    { accountCount: 2, active: 2, waiting: 0 },
    { accountCount: 5, active: 2, waiting: 3 },
  ]);
});
