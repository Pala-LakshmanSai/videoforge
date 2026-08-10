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
  "invite_sign_in",
  "invite_access_denied",
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
  "project_failed",
  "project_cancelled",
  "project_ready_for_review",
  "project_approved",
] as const;

const STATIC_APP_PATHS = new Set([
  "/",
  "/projects",
  "/projects/new",
  "/avatars",
  "/avatars/new",
  "/styles",
  "/styles/new",
  "/library",
  "/usage",
  "/settings",
]);

function isRealAppPath(pathname: string): boolean {
  return STATIC_APP_PATHS.has(pathname) || /^\/projects\/[^/]+(?:\/review)?$/u.test(pathname);
}

describe("fixture scenario registry", () => {
  it("covers every stable playbook scenario exactly once", () => {
    assert.deepEqual(FIXTURE_SCENARIO_IDS, PLAYBOOK_SCENARIO_IDS);
    assert.deepEqual(Object.keys(fixtureScenarioRegistry), PLAYBOOK_SCENARIO_IDS);
    assert.equal(listFixtureScenarios().length, 30);
    assert.equal(DEFAULT_FIXTURE_SCENARIO_ID, "happy_generating");
  });

  it("marks every scenario as synthetic fixture mode and gives it a real stable app route", () => {
    for (const id of FIXTURE_SCENARIO_IDS) {
      const scenario = fixtureScenarioRegistry[id];
      const route = new URL(scenario.route, "http://videoforge.local");
      assert.equal(scenario.id, id);
      assert.equal(scenario.snapshot.development.providerMode, "fixture");
      assert.equal(scenario.snapshot.development.synthetic, true);
      assert.equal(
        isRealAppPath(route.pathname),
        true,
        `${id} uses unknown path ${route.pathname}`,
      );
      assert.equal(scenario.snapshot.navigation.activeRoute, route.pathname);
      assert.deepEqual([...route.searchParams.keys()], ["fixture"]);
      assert.equal(route.searchParams.get("fixture"), id);
      if (scenario.snapshot.draft.returnRoute !== null) {
        const returnRoute = new URL(scenario.snapshot.draft.returnRoute, "http://videoforge.local");
        assert.equal(
          isRealAppPath(returnRoute.pathname),
          true,
          `${id} uses unknown return path ${returnRoute.pathname}`,
        );
      }
      assert.doesNotThrow(() => JSON.stringify(scenario));
    }
  });

  it("uses the approved human pipeline vocabulary", () => {
    const project = getFixtureScenario("happy_generating").snapshot.project;
    assert.deepEqual(
      project?.stages.map((stage) => stage.label),
      [
        "Prepare",
        "Transcribe",
        "Plan",
        "Write image prompts",
        "Generate media",
        "Assemble",
        "Technical check",
        "Review",
      ],
    );
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
    const readyAvatar = getFixtureScenario("avatar_profile_ready").snapshot.avatarHub.profiles[0];
    const styles = getFixtureScenario("happy_generating").snapshot.imageStyles.styles;
    const documentary = styles.find((style) => style.id === "style_documentary_stock");
    const warmRural = styles.find((style) => style.id === "style_warm_rural");

    assert.equal(readyAvatar?.thumbnailUrl, "/fixtures/avatar/amish-farm-host.svg");
    assert.deepEqual(documentary?.referenceUrls, []);
    assert.equal(documentary?.exampleUrls.length, 3);
    assert.equal(warmRural?.referenceUrls.length, 4);
    assert.deepEqual(warmRural?.exampleUrls, []);
    assert.equal(warmRural?.referenceCount, 4);
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
    assert.equal(getFixtureScenario("project_cancelled").snapshot.project?.status, "CANCELLED");
    assert.equal(
      getFixtureScenario("project_ready_for_review").snapshot.project?.review.state,
      "READY_FOR_REVIEW",
    );
    assert.equal(getFixtureScenario("project_approved").snapshot.project?.review.state, "APPROVED");
  });

  it("keeps signed-out and denied fixture responses outside the workspace data boundary", () => {
    const signIn = getFixtureScenario("invite_sign_in");
    const denied = getFixtureScenario("invite_access_denied");

    assert.equal(signIn.snapshot.access.state, "SIGN_IN_REQUIRED");
    assert.equal(denied.snapshot.access.state, "DENIED");

    for (const scenario of [signIn, denied]) {
      assert.equal(scenario.snapshot.project, null);
      assert.deepEqual(scenario.snapshot.events, []);
      assert.deepEqual(scenario.snapshot.avatarHub.profiles, []);
      assert.deepEqual(scenario.snapshot.imageStyles.styles, []);
      assert.equal(scenario.snapshot.draft.title, "");
      assert.equal(scenario.snapshot.draft.voiceover.assetId, null);
      assert.equal(scenario.snapshot.usage.projectUsd, 0);

      const bootstrap = toBootstrapResponse(scenario);
      assert.equal(bootstrap.projects.length, 0);
      assert.equal(bootstrap.avatars.length, 0);
      assert.equal(bootstrap.styles.length, 0);
      assert.equal(bootstrap.usage.currentMonth, 0);
      assert.equal(bootstrap.draft.title, "");
      assert.equal(bootstrap.activeOperations.avatar, null);
      assert.equal(bootstrap.activeOperations.style, null);
    }

    assert.equal(toBootstrapResponse(signIn).user.invited, true);
    assert.equal(toBootstrapResponse(denied).user.invited, false);
  });

  it("builds the direct client bootstrap shape", () => {
    const scenario = getFixtureScenario("happy_generating");
    const bootstrap = toBootstrapResponse(scenario);
    assert.equal(bootstrap.scenario, "happy_generating");
    assert.equal(bootstrap.user.role, "ADMIN");
    assert.equal(bootstrap.projects.length, 1);
    assert.equal(bootstrap.avatars[0]?.status, "READY");
    assert.equal(bootstrap.avatars[0]?.thumbnailUrl, "/fixtures/avatar/amish-farm-host.svg");
    assert.equal(bootstrap.styles[0]?.status, "PUBLISHED");
    assert.equal(bootstrap.styles[0]?.exampleUrls.length, 3);
    assert.equal(bootstrap.styles[0]?.rightsStatus, "SYSTEM_OWNED");
    assert.equal(bootstrap.styles[0]?.retentionSummary, "Built-in owned examples");
    assert.equal(bootstrap.styles[1]?.referenceUrls.length, 4);
    assert.equal(bootstrap.usage.projectSpend, 0.41);
  });
});
