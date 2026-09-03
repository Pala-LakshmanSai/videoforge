import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { insertProjectRevisionDraft } from "./support/hardening-fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

test("compatibility uses absence for UNTESTED and persists immutable STALE evidence", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);

    const untested = await executor.query(
      `SELECT avatar_compatibility_state,
              avatar_compatibility_assessment_id,
              avatar_compatibility_evidence_hash,
              (SELECT count(*)::int
                 FROM public.avatar_compatibility_assessments assessment
                WHERE assessment.workspace_id = revision.workspace_id
                  AND assessment.avatar_profile_version_id = revision.avatar_profile_version_id) AS assessments
         FROM public.project_revisions revision
        WHERE revision.workspace_id = $1 AND revision.id = $2`,
      [IDS.workspaceA, IDS.revisionA],
    );
    assert.deepEqual(untested.rows[0], {
      avatar_compatibility_state: "UNTESTED",
      avatar_compatibility_assessment_id: null,
      avatar_compatibility_evidence_hash: null,
      assessments: 0,
    });

    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO public.avatar_compatibility_assessments (
             id, workspace_id, avatar_profile_version_id, execution_profile_id, state
           ) VALUES ($1, $2, $3, $4, 'UNTESTED')`,
          [uuid(1001), IDS.workspaceA, IDS.avatarVersionA, IDS.executionProfileA],
        ),
      "23514",
    );

    const assessmentId = uuid(1002);
    const evidenceHash = sha256("stale-compatibility-evidence");
    await executor.query(
      `INSERT INTO public.avatar_compatibility_assessments (
         id, workspace_id, avatar_profile_version_id, execution_profile_id, state,
         evidence_contract_name, evidence_contract_version, evidence_payload,
         evidence_hash, model_snapshot_hash, reviewer_user_id, finished_at
       ) VALUES ($1, $2, $3, $4, 'STALE',
                 'avatar-compatibility-evidence', 'v1', '{"reason":"profile-changed"}'::jsonb,
                 $5, $6, $7, $8)`,
      [
        assessmentId,
        IDS.workspaceA,
        IDS.avatarVersionA,
        IDS.executionProfileA,
        evidenceHash,
        sha256("stale-model-snapshot"),
        IDS.userA,
        FIXED_TIME,
      ],
    );
    await insertProjectRevisionDraft(executor, {
      id: uuid(1003),
      revisionNumber: 2,
      avatarCompatibilityState: "STALE",
      avatarCompatibilityAssessmentId: assessmentId,
      avatarCompatibilityEvidenceHash: evidenceHash,
    });
    await executor.query(
      `UPDATE public.project_revisions
          SET status = 'LOCKED', locked_at = $1
        WHERE workspace_id = $2 AND id = $3`,
      [FIXED_TIME, IDS.workspaceA, uuid(1003)],
    );

    const stored = await executor.query(
      `SELECT avatar_compatibility_state, avatar_compatibility_assessment_id,
              avatar_compatibility_evidence_hash
         FROM public.project_revisions
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, uuid(1003)],
    );
    assert.deepEqual(stored.rows[0], {
      avatar_compatibility_state: "STALE",
      avatar_compatibility_assessment_id: assessmentId,
      avatar_compatibility_evidence_hash: evidenceHash,
    });
    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE public.avatar_compatibility_assessments
              SET evidence_payload = '{"mutated":true}'::jsonb
            WHERE workspace_id = $1 AND id = $2`,
          [IDS.workspaceA, assessmentId],
        ),
      "23514",
    );
  });
});

test("avatar version states exclude the noncanonical UPLOADING state", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO public.avatar_profile_versions (
             id, workspace_id, profile_id, version_number, state
           ) VALUES ($1, $2, $3, 2, 'UPLOADING')`,
          [uuid(1010), IDS.workspaceA, IDS.avatarProfileA],
        ),
      "23514",
    );
  });
});

test("tested execution profiles preserve their snapshot through retirement", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const before = await executor.query(
      `SELECT state, configuration::text AS configuration, configuration_hash,
              maximum_rate_micro_usd::text AS maximum_rate
         FROM public.execution_profiles
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, IDS.executionProfileA],
    );
    assert.equal(before.rows[0].state, "TESTED");

    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE public.execution_profiles
              SET configuration = '{"mutated":true}'::jsonb,
                  configuration_hash = $1,
                  maximum_rate_micro_usd = 999999
            WHERE workspace_id = $2 AND id = $3`,
          [sha256("mutated-execution-profile"), IDS.workspaceA, IDS.executionProfileA],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          "DELETE FROM public.execution_profiles WHERE workspace_id = $1 AND id = $2",
          [IDS.workspaceA, IDS.executionProfileA],
        ),
      "23514",
    );

    await executor.query(
      `UPDATE public.execution_profiles
          SET state = 'RETIRED', retired_at = $1
        WHERE workspace_id = $2 AND id = $3`,
      [FIXED_TIME, IDS.workspaceA, IDS.executionProfileA],
    );
    const retired = await executor.query(
      `SELECT state, configuration::text AS configuration, configuration_hash,
              maximum_rate_micro_usd::text AS maximum_rate
         FROM public.execution_profiles
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, IDS.executionProfileA],
    );
    assert.deepEqual(retired.rows[0], { ...before.rows[0], state: "RETIRED" });

    await expectDatabaseError(
      () =>
        executor.query("UPDATE public.execution_profiles SET name = 'mutated' WHERE id = $1", [
          IDS.executionProfileA,
        ]),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query("DELETE FROM public.execution_profiles WHERE id = $1", [
          IDS.executionProfileA,
        ]),
      "23514",
    );
  });
});

test("revision keyword, spend-cap, and seed boundaries match canonical contracts", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);

    const validCases = [
      {
        id: uuid(1020),
        revisionNumber: 2,
        extraPromptKeywords: null,
        applyExtraPromptKeywords: false,
        maximumCostMicroUsd: 100_000,
        seed: 0,
        expectedKeywordLength: null,
      },
      {
        id: uuid(1021),
        revisionNumber: 3,
        extraPromptKeywords: "x".repeat(500),
        applyExtraPromptKeywords: true,
        maximumCostMicroUsd: 2_000_000,
        seed: 4_294_967_295,
        expectedKeywordLength: 500,
      },
    ];

    for (const valid of validCases) {
      await insertProjectRevisionDraft(executor, valid);
      const stored = await executor.query(
        `SELECT length(extra_prompt_keywords)::int AS keyword_length,
                maximum_cost_micro_usd::text AS maximum_cost,
                seed::text AS seed
           FROM public.project_revisions
          WHERE workspace_id = $1 AND id = $2`,
        [IDS.workspaceA, valid.id],
      );
      assert.deepEqual(stored.rows[0], {
        keyword_length: valid.expectedKeywordLength,
        maximum_cost: String(valid.maximumCostMicroUsd),
        seed: String(valid.seed),
      });
      await executor.query("DELETE FROM public.project_revisions WHERE id = $1", [valid.id]);
    }

    const invalidCases = [
      { extraPromptKeywords: "x".repeat(501) },
      { extraPromptKeywords: null, applyExtraPromptKeywords: true },
      { maximumCostMicroUsd: 49_999 },
      { maximumCostMicroUsd: 2_000_001 },
      { seed: -1 },
      { seed: 4_294_967_296 },
    ];
    for (const [index, invalid] of invalidCases.entries()) {
      await expectDatabaseError(
        () =>
          insertProjectRevisionDraft(executor, {
            id: uuid(1030 + index),
            revisionNumber: 10 + index,
            ...invalid,
          }),
        "23514",
      );
    }
  });
});

test("STALE revisions reject absent or mismatched terminal evidence", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await expectDatabaseError(
      () =>
        insertProjectRevisionDraft(executor, {
          id: uuid(1040),
          revisionNumber: 2,
          avatarCompatibilityState: "STALE",
          avatarCompatibilityAssessmentId: null,
          avatarCompatibilityEvidenceHash: null,
        }),
      "23514",
    );

    const assessmentId = uuid(1041);
    await executor.query(
      `INSERT INTO public.avatar_compatibility_assessments (
         id, workspace_id, avatar_profile_version_id, execution_profile_id, state,
         evidence_contract_name, evidence_contract_version, evidence_payload,
         evidence_hash, model_snapshot_hash, finished_at
       ) VALUES ($1, $2, $3, $4, 'STALE', 'avatar-compatibility-evidence', 'v1', '{}'::jsonb,
                 $5, $6, $7)`,
      [
        assessmentId,
        IDS.workspaceA,
        IDS.avatarVersionA,
        IDS.executionProfileA,
        sha256("actual-stale-evidence"),
        sha256("stale-model"),
        FIXED_TIME,
      ],
    );
    await insertProjectRevisionDraft(executor, {
      id: uuid(1042),
      revisionNumber: 3,
      avatarCompatibilityState: "STALE",
      avatarCompatibilityAssessmentId: assessmentId,
      avatarCompatibilityEvidenceHash: sha256("mismatched-stale-evidence"),
    });
    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE public.project_revisions
              SET status = 'LOCKED', locked_at = $1
            WHERE workspace_id = $2 AND id = $3`,
          [FIXED_TIME, IDS.workspaceA, uuid(1042)],
        ),
      "23514",
    );
  });
});
