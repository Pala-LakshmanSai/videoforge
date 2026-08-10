import { HASHES, IDS } from "./fixtures.mjs";
import { FIXED_TIME, sha256 } from "./pglite.mjs";

export async function insertTestedExecutionProfile(
  executor,
  { id, name = "owned-hardening-alternate" },
) {
  await executor.query(
    `INSERT INTO public.execution_profiles (
       id, workspace_id, name, revision, lane, state, dispatch_target,
       configuration, configuration_hash, maximum_rate_micro_usd, checked_at
     ) VALUES ($1, $2, $3, 1, 'IMAGE_MEDIA', 'TESTED', 'LOCAL',
               '{"provider":"none","profile":"alternate"}'::jsonb, $4, 0, $5)`,
    [id, IDS.workspaceA, name, sha256(`execution-profile-${id}`), FIXED_TIME],
  );
}

export async function insertProjectRevisionDraft(
  executor,
  {
    id,
    revisionNumber,
    sourceRevisionId = IDS.revisionA,
    avatarProfileHash = HASHES.avatarProfileA,
    avatarCompatibilityState = "UNTESTED",
    avatarCompatibilityAssessmentId = null,
    avatarCompatibilityEvidenceHash = null,
    styleProfileHash = HASHES.styleA,
    extraPromptKeywords = null,
    applyExtraPromptKeywords = false,
    maximumCostMicroUsd = 100_000,
    seed = 0,
    revisionConfigHash = sha256(`hardening-revision-${String(revisionNumber)}`),
  },
) {
  await executor.query(
    `INSERT INTO public.project_revisions (
       id, workspace_id, project_id, revision_number, status, title,
       voiceover_asset_id, voiceover_binary_sha256,
       avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
       avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
       avatar_source_preparation_profile, avatar_source_validation_profile,
       avatar_compatibility_state, avatar_compatibility_assessment_id,
       avatar_compatibility_evidence_hash,
       image_style_id, image_style_version_id, style_profile_hash,
       extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
       maximum_cost_micro_usd, currency, seed,
       revision_config_contract_name, revision_config_contract_version,
       revision_config_payload, revision_config_hash, created_by_user_id
     )
     SELECT $1, workspace_id, project_id, $2, 'DRAFT', $3,
            voiceover_asset_id, voiceover_binary_sha256,
            avatar_profile_id, avatar_profile_version_id, $4,
            avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
            avatar_source_preparation_profile, avatar_source_validation_profile,
            $5, $6, $7,
            image_style_id, image_style_version_id, $8,
            $9, $10, generation_mode,
            $11, currency, $12,
            revision_config_contract_name, revision_config_contract_version,
            revision_config_payload, $13, created_by_user_id
       FROM public.project_revisions
      WHERE workspace_id = $14 AND id = $15`,
    [
      id,
      revisionNumber,
      `Hardening Draft ${String(revisionNumber)}`,
      avatarProfileHash,
      avatarCompatibilityState,
      avatarCompatibilityAssessmentId,
      avatarCompatibilityEvidenceHash,
      styleProfileHash,
      extraPromptKeywords,
      applyExtraPromptKeywords,
      maximumCostMicroUsd,
      seed,
      revisionConfigHash,
      IDS.workspaceA,
      sourceRevisionId,
    ],
  );
}
