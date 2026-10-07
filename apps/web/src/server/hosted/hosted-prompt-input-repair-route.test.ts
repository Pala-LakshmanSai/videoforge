import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH } from "@videoforge/pipeline";
import { sha256 } from "./crypto";
import { canonicalJson } from "./submission";
import {
  hostedPromptAuthority,
  hostedPromptBatchPlan,
  hostedPromptBatchPlanDocument,
} from "./hosted-prompt-run";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  scope: vi.fn(),
  credits: vi.fn(),
}));
vi.mock("./neon", () => ({
  createNeonPool: () => ({ end: mocks.end }),
  createNeonExecutor: () => ({
    transaction: (work: (tx: { query: typeof mocks.query }) => unknown) =>
      work({ query: mocks.query }),
  }),
}));
vi.mock("./hosted-product-route-common", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sameOrigin: () => true,
  sessionScope: mocks.scope,
}));
vi.mock("../providers/runware-http-transport", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readRunwareCreditBalance: mocks.credits,
}));

import { writeProjectPrompts } from "./hosted-prompt-route";

const id = (ordinal: number) => `10000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
const scope = { account_id: id(1), workspace_id: id(2), user_id: id(3) };
const digest = `sha256:${"a".repeat(64)}` as const;
const projectId = id(4);
const identity = {
  runId: id(10),
  taskId: id(11),
  attemptId: id(12),
  outboxId: id(13),
  executionProfileId: id(14),
  reservationCostEventId: id(10),
  claimTokenHash: digest,
};
const profile = JSON.parse(
  readFileSync("../../project-context/evidence/natural_documentary_image_style_v1.json", "utf8"),
);
const plan = {
  workspace_id: scope.workspace_id,
  project_id: projectId,
  revision_id: id(5),
  project_title: "Home vegetable seedlings",
  revision_state: "LOCKED",
  timeline_id: id(6),
  timeline_hash: digest,
  image_style_version_id: id(7),
  revision_style_hash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
  style_state: "PUBLISHED",
  style_profile_hash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
  profile_payload: profile,
  story_context: JSON.stringify({
    subject: "home vegetable seedlings",
    visual_facts: ["vegetable seedlings in pots"],
    continuity: [],
    resolved_references: [],
  }),
  all_segments: [{ scene_id: "scene_01", segment_index: 0, phrase: "Seedlings grow in pots." }],
  scenes: [
    {
      scene_id: "scene_01",
      phrase: "Seedlings grow in pots.",
      in_image_shot_role: "OBJECT_EVIDENCE",
      layout: "IMAGE_FULL",
    },
  ],
  extra_prompt_keywords: null,
  apply_extra_prompt_keywords: false,
  existing_run_state: "FAILED",
  existing_run_problem_code: "HOSTED_PROMPT_INPUT_INVALID",
  existing_run_has_accepted_set: false,
  existing_run_provider_may_have_charged: false,
  existing_run_redispatch_count: 0,
};
const config = {
  neon: { databaseUrl: "postgres://unused" },
  styleAnalysis: { apiKey: "runware-test-key-at-least-twenty-characters" },
} as never;
let pinned: Record<string, unknown>;
let refusePreparation: boolean;
let fetcher: ReturnType<typeof vi.fn>;
const prepareCalls = () =>
  mocks.query.mock.calls.filter(([sql]) =>
    String(sql).includes("videoforge_prepare_hosted_prompt_run"),
  );
const request = () =>
  new Request(`https://example.test/api/v2/hosted/projects/${projectId}/prompts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maximum_prompt_spend_micro_usd: 8_000_000 }),
  });
const run = (automatic = false) =>
  writeProjectPrompts(
    request(),
    projectId,
    config,
    { waitUntil() {} } as never,
    automatic ? scope : undefined,
  );

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  fetcher = vi.fn().mockRejectedValue(new Error("Provider HTTP must not run"));
  vi.stubGlobal("fetch", fetcher);
  mocks.scope.mockResolvedValue(scope);
  mocks.credits.mockResolvedValue(10);
  refusePreparation = false;
  const authority = hostedPromptAuthority({
    plan,
    identity,
    reservedCostMicroUsd: 250_000,
    redispatchApproved: true,
  });
  const original = hostedPromptBatchPlan(authority);
  pinned = {
    identity,
    input_hash: authority.recordedInputHash,
    reserved_cost_micro_usd: 250_000,
    planned_batch_count: original.batchCount,
    planned_scene_count: original.totalScenes,
    batch_plan_hash: await sha256(canonicalJson(hostedPromptBatchPlanDocument(original))),
  };
  mocks.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
    if (sql.includes("videoforge_load_hosted_prompt_plan"))
      return { rows: [{ plan, run_started_at: null, run_reserved_cost_micro_usd: 250_000 }] };
    if (sql.includes("SELECT jsonb_build_object('runId'")) return { rows: [pinned] };
    if (sql.includes("videoforge_prepare_hosted_prompt_run")) {
      const prepared = JSON.parse(String(parameters[0]));
      return {
        rows: [
          {
            prepared: {
              created: !refusePreparation,
              run_id: identity.runId,
              planned_batch_count: prepared.planned_batch_count,
              planned_scene_count: prepared.planned_scene_count,
              batch_plan_hash: prepared.batch_plan_hash,
            },
          },
        ],
      };
    }
    if (sql.includes("videoforge_claim_next_hosted_prompt_batch"))
      return { rows: [{ claimed: false }] };
    return { rows: [] };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("manual Retry submits the exact original repair proof and reaches guarded dispatch", async () => {
  const result = await run();
  expect(result.status).toBe(202);
  expect(prepareCalls()).toHaveLength(1);
  const payload = JSON.parse(String(prepareCalls()[0]![1][0]));
  expect(payload).toMatchObject({
    redispatch: true,
    request_policy: "runware-luna-grounded-v2",
    input_repair_redispatch: true,
    original_run_id: identity.runId,
    original_input_hash: pinned.input_hash,
    original_batch_plan_hash: pinned.batch_plan_hash,
    original_planned_batch_count: pinned.planned_batch_count,
    original_planned_scene_count: pinned.planned_scene_count,
    original_reserved_cost_micro_usd: pinned.reserved_cost_micro_usd,
    reserved_cost_micro_usd: 250_000,
  });
  const claimCall = mocks.query.mock.calls.find(([sql]) =>
    String(sql).includes("videoforge_claim_next_hosted_prompt_batch"),
  );
  expect(claimCall?.[1][0]).toBe(identity.runId);
  expect(claimCall?.[1][1]).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["input_hash", "batch_plan_hash"])(
  "rejects changed original %s before preparation or HTTP",
  async (field) => {
    pinned[field] = digest;
    const result = await run();
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: { code: "HOSTED_PROMPT_INPUT_INVALID" } });
    expect(prepareCalls()).toHaveLength(0);
    expect(mocks.credits).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("automatic continuation does not retry a deterministic input failure", async () => {
  expect((await run(true)).status).toBe(409);
  expect(prepareCalls()).toHaveLength(0);
  expect(mocks.scope).not.toHaveBeenCalled();
  expect(mocks.credits).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("native preparation refusal prevents a provider claim and HTTP", async () => {
  refusePreparation = true;
  expect((await run()).status).toBe(409);
  expect(prepareCalls()).toHaveLength(1);
  expect(mocks.credits).not.toHaveBeenCalled();
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      String(sql).includes("videoforge_claim_next_hosted_prompt_batch"),
    ),
  ).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
