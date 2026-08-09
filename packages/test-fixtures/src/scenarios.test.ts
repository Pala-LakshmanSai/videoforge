import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_FIXTURE_SCENARIO_ID,
  FIXTURE_SCENARIO_IDS,
  fixtureScenarioRegistry,
  getFixtureScenario,
  isFixtureScenarioId,
  listFixtureScenarios,
  toBootstrapResponse,
} from "./index";

const PLAYBOOK_SCENARIO_IDS = [
  "happy_generating",
  "project_create_ready",
  "avatar_hub_empty",
  "avatar_profile_uploading",
  "avatar_profile_invalid",
  "avatar_profile_ready",
  "avatar_profile_archived_during_draft",
  "avatar_profile_newer_version_available",
  "avatar_test_cancelled",
  "style_analyzing",
  "style_v2_analyzing_v1_active",
  "style_needs_review",
  "style_analysis_failed",
  "extra_keywords_not_applied",
  "extra_keywords_conflict",
  "preset_roundtrip_draft_preserved",
  "gpu_cold_start",
  "image_partial_failure",
  "avatar_lip_failure",
  "skyreels_approval_required",
  "budget_blocked",
  "dispatch_ack_unknown",
  "callback_reconciling",
  "cancel_requested",
  "project_ready_for_review",
  "project_approved",
] as const;

describe("fixture scenario registry", () => {
  it("covers every stable playbook scenario exactly once", () => {
    assert.deepEqual(FIXTURE_SCENARIO_IDS, PLAYBOOK_SCENARIO_IDS);
    assert.deepEqual(Object.keys(fixtureScenarioRegistry), PLAYBOOK_SCENARIO_IDS);
    assert.equal(listFixtureScenarios().length, 26);
    assert.equal(DEFAULT_FIXTURE_SCENARIO_ID, "happy_generating");
  });

  it("marks every scenario as synthetic fixture mode and gives it a stable route", () => {
    for (const id of FIXTURE_SCENARIO_IDS) {
      const scenario = fixtureScenarioRegistry[id];
      assert.equal(scenario.id, id);
      assert.equal(scenario.snapshot.development.providerMode, "fixture");
      assert.equal(scenario.snapshot.development.synthetic, true);
      assert.match(scenario.route, new RegExp(`[?&]fixture=${id}$`, "u"));
      assert.doesNotThrow(() => JSON.stringify(scenario));
    }
  });

  it("returns defensive scenario copies", () => {
    const first = getFixtureScenario("project_create_ready");
    first.snapshot.draft.title = "mutated by test";
    const second = getFixtureScenario("project_create_ready");
    assert.equal(second.snapshot.draft.title, "How to Recognize a Sweet Watermelon");
  });

  it("recognizes only stable fixture IDs", () => {
    assert.equal(isFixtureScenarioId("project_approved"), true);
    assert.equal(isFixtureScenarioId("unknown_scenario"), false);
  });

  it("encodes the high-risk scenario invariants", () => {
    assert.equal(getFixtureScenario("avatar_hub_empty").snapshot.avatarHub.profiles.length, 0);
    assert.equal(
      getFixtureScenario("avatar_hub_empty").snapshot.draft.avatarProfileVersionId,
      null,
    );
    assert.equal(
      getFixtureScenario("avatar_profile_archived_during_draft").snapshot.draft.preflight.status,
      "BLOCKED",
    );
    assert.equal(
      getFixtureScenario("extra_keywords_not_applied").snapshot.draft.effectiveExtraPromptKeywords,
      null,
    );
    assert.equal(
      getFixtureScenario("extra_keywords_conflict").snapshot.mutationProblem?.status,
      422,
    );
    assert.equal(
      getFixtureScenario("budget_blocked").snapshot.mutationProblem?.code,
      "BUDGET_CAP_EXCEEDED",
    );
    assert.equal(
      getFixtureScenario("dispatch_ack_unknown").snapshot.project?.status,
      "RECONCILING",
    );
    assert.equal(
      getFixtureScenario("project_ready_for_review").snapshot.project?.review.state,
      "READY_FOR_REVIEW",
    );
    assert.equal(getFixtureScenario("project_approved").snapshot.project?.review.state, "APPROVED");
  });

  it("builds the direct client bootstrap shape", () => {
    const scenario = getFixtureScenario("happy_generating");
    const bootstrap = toBootstrapResponse(scenario);
    assert.equal(bootstrap.scenario, "happy_generating");
    assert.equal(bootstrap.user.role, "ADMIN");
    assert.equal(bootstrap.projects.length, 1);
    assert.equal(bootstrap.avatars[0]?.status, "READY");
    assert.equal(bootstrap.styles[0]?.status, "PUBLISHED");
    assert.equal(bootstrap.usage.projectSpend, 0.41);
  });
});
