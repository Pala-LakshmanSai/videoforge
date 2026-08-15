import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthWorkspaceBoundary,
  DeterministicLocalAuthorizationDirectory,
  DeterministicLocalIdentityProvider,
} from "../dist/src/auth/index.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { FIXED_TIME, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

const NOW = Date.parse("2026-08-10T13:00:00.000Z");
const SCOPE_A = Object.freeze({
  accountId: IDS.accountA,
  workspaceId: IDS.workspaceA,
  actorUserId: IDS.userA,
});
const SCOPE_B = Object.freeze({
  accountId: IDS.accountB,
  workspaceId: IDS.workspaceB,
  actorUserId: IDS.userB,
});

function session(token, workspaceId, userId, email) {
  return Object.freeze({
    sessionToken: token,
    session: Object.freeze({
      sessionId: `session_${workspaceId}`,
      userId,
      normalizedEmail: email,
      provider: "LOCAL",
      status: "ACTIVE",
      issuedAt: "2026-08-10T12:00:00.000Z",
      expiresAt: "2026-08-10T14:00:00.000Z",
    }),
  });
}

function access(workspaceId, membershipId, userId, email) {
  return Object.freeze({
    workspace: Object.freeze({
      workspaceId,
      accountId: `account_for_${workspaceId}`,
      status: "ACTIVE",
    }),
    identity: Object.freeze({ userId, normalizedEmail: email, status: "ACTIVE" }),
    invitation: Object.freeze({ workspaceId, normalizedEmail: email, status: "ACCEPTED" }),
    membership: Object.freeze({
      membershipId,
      workspaceId,
      userId,
      role: "ADMIN",
      status: "ACTIVE",
    }),
  });
}

function twoAccountBoundary() {
  return new AuthWorkspaceBoundary({
    sessions: new DeterministicLocalIdentityProvider([
      session("phase1_token_a", IDS.workspaceA, IDS.userA, "owner-a@example.test"),
      session("phase1_token_b", IDS.workspaceB, IDS.userB, "owner-b@example.test"),
    ]),
    directory: new DeterministicLocalAuthorizationDirectory([
      access(IDS.workspaceA, IDS.membershipA, IDS.userA, "owner-a@example.test"),
      access(IDS.workspaceB, IDS.membershipB, IDS.userB, "owner-b@example.test"),
    ]),
    clock: Object.freeze({ nowEpochMs: () => NOW }),
  });
}

function assertNotFound(result, label) {
  assert.equal(result.ok, false, `${label} unexpectedly succeeded`);
  assert.equal(result.kind, "NOT_FOUND", `${label} did not fail generically`);
}

async function lineageCounts(executor) {
  const result = await executor.query(
    `SELECT
       (SELECT count(*)::text FROM assets
         WHERE workspace_id = $1 AND kind IN ('AVATAR_ORIGINAL', 'AVATAR_RUNTIME', 'AVATAR_THUMBNAIL')) AS avatar_assets,
       (SELECT count(*)::text FROM avatar_compatibility_assessments
         WHERE workspace_id = $1) AS avatar_assessments,
       (SELECT count(*)::text FROM generation_tasks
         WHERE workspace_id = $1 AND owner_type = 'AVATAR_PROFILE_VERSION') AS avatar_tasks,
       (SELECT count(*)::text FROM cost_events
         WHERE workspace_id = $1 AND owner_type = 'AVATAR_PROFILE_VERSION') AS avatar_cost_events`,
    [IDS.workspaceA],
  );
  return result.rows[0];
}

test("two invited accounts cannot cross workspace records and one ready avatar version is reused without upload or cost", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const auth = twoAccountBoundary();

    const accountA = await auth.authorizeWorkspace({
      sessionToken: "phase1_token_a",
      workspaceId: IDS.workspaceA,
    });
    const accountB = await auth.authorizeWorkspace({
      sessionToken: "phase1_token_b",
      workspaceId: IDS.workspaceB,
    });
    assert.equal(accountA.ok, true);
    assert.equal(accountB.ok, true);
    assert.deepEqual(
      await auth.authorizeWorkspace({
        sessionToken: "phase1_token_b",
        workspaceId: IDS.workspaceA,
      }),
      {
        ok: false,
        problem: {
          code: "WORKSPACE_ACCESS_REQUIRED",
          status: 403,
          title: "Workspace access is required",
          detail: "This account is not authorized for the requested workspace.",
          retryable: false,
        },
      },
    );

    assertNotFound(
      await repositories.projects.resolveExactRevision(SCOPE_B, {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
      }),
      "cross-workspace revision read",
    );
    assertNotFound(
      await repositories.avatarProfiles.resolveExactReadyVersion(SCOPE_B, {
        profileId: IDS.avatarProfileA,
        versionId: IDS.avatarVersionA,
        use: "NEW_REVISION",
      }),
      "cross-workspace avatar read",
    );
    assertNotFound(
      await repositories.artifacts.resolveExact(SCOPE_B, IDS.voiceoverA),
      "cross-workspace artifact read",
    );
    assertNotFound(
      await repositories.artifacts.bindBinaryContent(SCOPE_B, {
        idempotencyKey: "phase1:cross-bind",
        assetId: IDS.voiceoverA,
        binarySha256: HASHES.voiceoverA,
        byteSize: 128n,
        contentType: "application/octet-stream",
        widthPx: null,
        heightPx: null,
        durationMs: null,
        verifiedAt: FIXED_TIME,
      }),
      "cross-workspace artifact bind",
    );
    const hashProbe = await repositories.artifacts.findByContentAddress(SCOPE_B, {
      kind: "BINARY",
      sha256: HASHES.voiceoverA,
    });
    assert.equal(hashProbe.ok, true);
    assert.deepEqual(hashProbe.value, []);
    assertNotFound(
      await repositories.projects.archiveProject(SCOPE_B, {
        idempotencyKey: "phase1:cross-project-archive",
        projectId: IDS.projectA,
        expectedVersion: 1,
        archivedAt: FIXED_TIME,
      }),
      "cross-workspace project archive",
    );
    assertNotFound(
      await repositories.avatarProfiles.archiveProfile(SCOPE_B, {
        idempotencyKey: "phase1:cross-avatar-archive",
        profileId: IDS.avatarProfileA,
        expectedUpdatedAt: FIXED_TIME,
        archivedAt: FIXED_TIME,
      }),
      "cross-workspace avatar archive",
    );
    const wrongReviewer = await auth.authorizeReviewerMutation(
      { sessionToken: "phase1_token_b", workspaceId: IDS.workspaceA },
      { projectId: IDS.projectA, revisionId: IDS.revisionA },
    );
    assert.equal(wrongReviewer.ok, false);
    assert.equal(wrongReviewer.problem.code, "WORKSPACE_ACCESS_REQUIRED");
    assert.equal(JSON.stringify(wrongReviewer).includes(IDS.projectA), false);

    const before = await lineageCounts(executor);
    const projectId = uuid(20_001);
    const revisionId = uuid(20_002);
    const revisionHash = sha256("phase1-avatar-reuse-revision");
    const project = await repositories.projects.createShell(SCOPE_A, {
      idempotencyKey: "phase1:avatar-reuse-project",
      projectId,
      name: "Second Avatar Reuse Project",
      normalizedName: "second avatar reuse project",
    });
    assert.equal(project.ok, true);
    const draft = await repositories.projects.createRevisionDraft(SCOPE_A, {
      idempotencyKey: "phase1:avatar-reuse-revision",
      projectId,
      revisionId,
      revisionNumber: 1,
      expectedProjectVersion: project.value.value.version,
      title: "Second project, same exact avatar version",
      voiceoverAssetId: IDS.voiceoverA,
      voiceoverBinarySha256: HASHES.voiceoverA,
      avatarProfileId: IDS.avatarProfileA,
      avatarProfileVersionId: IDS.avatarVersionA,
      avatarProfileHash: HASHES.avatarProfileA,
      avatarRuntimeSourceAssetId: IDS.avatarRuntimeA,
      avatarRuntimeSourceBinarySha256: HASHES.avatarRuntimeA,
      avatarSourcePreparationProfile: "owned-preparation-v1",
      avatarSourceValidationProfile: "owned-validation-v1",
      avatarCompatibility: { state: "UNTESTED", assessmentId: null, evidenceHash: null },
      imageStyleId: IDS.styleA,
      imageStyleVersionId: IDS.styleVersionA,
      styleProfileHash: HASHES.styleA,
      extraPromptKeywords: "preserved while disabled",
      applyExtraPromptKeywords: false,
      generationMode: "LOWEST_COST",
      maximumCostMicroUsd: 1_500_000n,
      currency: "USD",
      seed: 73n,
      revisionConfig: {
        contractName: "project-revision-config",
        contractVersion: "v2",
        payload: { source: "phase1-avatar-reuse" },
        canonicalDocumentSha256: revisionHash,
      },
    });
    assert.equal(draft.ok, true);
    const locked = await repositories.projects.lockRevision(SCOPE_A, {
      idempotencyKey: "phase1:avatar-reuse-lock",
      projectId,
      revisionId,
      expectedProjectVersion: project.value.value.version,
      expectedRevisionConfigHash: revisionHash,
      lockedAt: FIXED_TIME,
    });
    assert.equal(locked.ok, true);
    assert.equal(locked.value.value.avatarProfileVersionId, IDS.avatarVersionA);
    assert.equal(locked.value.value.avatarRuntimeSourceAssetId, IDS.avatarRuntimeA);
    assert.equal(locked.value.value.avatarRuntimeSourceBinarySha256, HASHES.avatarRuntimeA);

    const after = await lineageCounts(executor);
    assert.deepEqual(after, before, "avatar reuse must create no upload, test, task, or cost row");
    const reused = await executor.query(
      `SELECT count(*)::text AS count
         FROM project_revisions
        WHERE workspace_id = $1 AND avatar_profile_version_id = $2`,
      [IDS.workspaceA, IDS.avatarVersionA],
    );
    assert.equal(reused.rows[0].count, "2");
  });
});
