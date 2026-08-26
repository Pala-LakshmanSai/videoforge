import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createConcreteFullLiveAdapters,
  createGitReleaseAdapters,
  createGuardedActivationAdapter,
  createStagedQualificationAdapters,
  createTypeScriptBridgeAdapters,
  createV213AcceptanceAdapters,
  createV213DurableStageStore,
  createGithubDispatchAdapters,
  createGithubVerificationAdapters,
  TAG,
} from "../../deploy/v2-13/full-live-adapters.mjs";

const sourceCommit = "4".repeat(40);
const state = {
  release_source_commit: sourceCommit,
  release_ref: {
    exact_tag_name: TAG,
    exact_target_commit: sourceCommit,
    state: "VERIFIED_EXACT_REMOTE",
  },
};
const result = (status = 0, stdout = "", stderr = "") => ({ status, stdout, stderr });

test("git release adapters require absence, create one lightweight tag, push non-force, and read it back", async () => {
  const calls = [];
  const replies = [
    result(1),
    result(0),
    result(0),
    result(0, `${sourceCommit}\n`),
    result(0, `${sourceCommit}\n`),
    result(0, "ok\n"),
    result(0, `${sourceCommit}\trefs/tags/${TAG}\n`),
  ];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  assert.equal((await adapters["release-tag-create"]({}, state)).created, true);
  assert.equal((await adapters["release-tag-push"]({}, state)).forceUsed, false);
  assert.equal((await adapters["release-tag-readback"]({}, state)).targetCommit, sourceCommit);
  assert.deepEqual(calls[5][1], [
    "push",
    "--porcelain",
    "origin",
    `refs/tags/${TAG}:refs/tags/${TAG}`,
  ]);
  assert.equal(replies.length, 0);
});

test("git release adapter rejects either local or remote tag collision before creation", async () => {
  const local = createGitReleaseAdapters({
    run: () => result(0, `${sourceCommit} refs/tags/${TAG}\n`),
  });
  await assert.rejects(local["release-tag-create"]({}, state), /LOCAL_TAG_ALREADY_EXISTS/u);

  const replies = [result(1), result(0, `${"5".repeat(40)}\trefs/tags/${TAG}\n`)];
  const remote = createGitReleaseAdapters({ run: () => replies.shift() });
  await assert.rejects(remote["release-tag-create"]({}, state), /REMOTE_TAG_READBACK/u);

  const exactReplies = [result(1), result(0, `${sourceCommit}\trefs/tags/${TAG}\n`)];
  const exactRemote = createGitReleaseAdapters({ run: () => exactReplies.shift() });
  await assert.rejects(exactRemote["release-tag-create"]({}, state), /REMOTE_TAG_ALREADY_EXISTS/u);
});

test("GitHub workflow dispatch is single-shot and binds the one new exact-head run", async () => {
  const calls = [];
  const oldRun = {
    databaseId: 10,
    headSha: sourceCommit,
    workflowName: "mage-image",
    status: "completed",
  };
  const newRun = {
    databaseId: 11,
    headSha: sourceCommit,
    workflowName: "mage-image",
    status: "queued",
  };
  const replies = [
    result(0, JSON.stringify([oldRun])),
    result(0),
    result(0, JSON.stringify([newRun, oldRun])),
  ];
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  const dispatched = await adapters["mage-image-workflow-dispatch"]({}, state);
  assert.equal(dispatched.runId, "11");
  assert.equal(
    calls.filter(([command, args]) => command === "gh" && args[0] === "workflow").length,
    1,
  );
  assert.deepEqual(calls[1][1], [
    "workflow",
    "run",
    "mage-image.yml",
    "--ref",
    TAG,
    "--field",
    "publish=true",
  ]);
});

test("GitHub dispatch rejects ambiguous new runs and never redispatches", async () => {
  const calls = [];
  const makeRun = (databaseId) => ({
    databaseId,
    headSha: sourceCommit,
    workflowName: "avatar-primary-serverless-image",
    status: "queued",
  });
  const replies = [
    result(0, "[]"),
    result(0),
    result(0, JSON.stringify([makeRun(20), makeRun(21)])),
  ];
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  await assert.rejects(
    adapters["soulx-image-workflow-dispatch"]({}, state),
    /GITHUB_DISPATCH_AMBIGUOUS/u,
  );
  assert.equal(
    calls.filter(([command, args]) => command === "gh" && args[0] === "workflow").length,
    1,
  );
});

test("GitHub verification binds exact successful run and immutable deployability artifact", async () => {
  const digest = `sha256:${"6".repeat(64)}`;
  const evidence = {
    schema_version: "videoforge-image-deployability/v1",
    checkpoint: "V2-07",
    lane: "mage_image",
    source_commit: sourceCommit,
    registry_repository: "pala-lakshmansai/videoforge-mage-v2-07",
    publication_requested: true,
    published: true,
    publication_state: "PUBLISHED_NEW_DIGEST",
    status: "PUBLISHED_IMMUTABLE_IMAGE",
    qualification_status: "REQUIRES_FRESH_LIVE_REQUALIFICATION",
    prior_qualification_reused: false,
    platform: "linux/amd64",
    model_volume: "/runpod-volume",
    model_download_performed: false,
    provider_endpoint_mutation_performed: false,
    immutable_image: `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@${digest}`,
    manifest_digest: digest,
  };
  const adapters = createGithubVerificationAdapters({
    run: (_command, args) => {
      if (args[1] === "view")
        return result(
          0,
          JSON.stringify({
            databaseId: 11,
            headSha: sourceCommit,
            workflowName: "mage-image",
            status: "completed",
            conclusion: "success",
          }),
        );
      const directory = args.at(-1);
      writeFileSync(
        resolve(directory, "mage-serverless-v2-07.json"),
        `${JSON.stringify(evidence)}\n`,
      );
      return result(0);
    },
  });
  const prior = new Map([["mage-image-workflow-dispatch", { runId: "11" }]]);
  const verified = await adapters["mage-image-workflow-verification"]({}, state, prior);
  assert.equal(verified.imageDigest, digest);
  assert.equal(verified.publicAllBlobsVerified, true);
  assert.match(verified.evidenceSha256, /^sha256:[0-9a-f]{64}$/u);
});

test("guarded adapter calls the existing executor once and authenticates its durable evidence", async () => {
  const environment = Object.fromEntries(
    [
      "ACTIVATION_RECORD",
      "CONFIG_ACTIVATION_RECORD",
      "PROPOSAL_FILE",
      "RELEASE_MANIFEST_FILE",
      "USER_APPROVAL_FILE",
      "CLOUDFLARE_TOKEN_FILE",
      "ACTIVATION_EVIDENCE_OUTPUT",
      "POSTGRES_INPUT_DIR",
      "SECRET_INPUT_DIR",
    ].map((suffix) => [`VIDEOFORGE_V2_13_${suffix}`, `/private/${suffix.toLowerCase()}`]),
  );
  const evidence = Buffer.from(
    `${JSON.stringify({
      schema_version: "videoforge-v2-13-guarded-activation-evidence/v1",
      commit: sourceCommit,
      outcome: "SUCCEEDED",
      external_spend_cap_usd: 0,
      new_paid_retained_resources_authorized: false,
    })}\n`,
  );
  let calls = 0;
  const adapter = createGuardedActivationAdapter({
    environment,
    readEvidence: () => evidence,
    run: (command, args) => {
      calls += 1;
      assert.equal(command, process.execPath);
      assert.equal(args.filter((value) => value === "--execute").length, 1);
      assert.equal(args.at(-1), "EXECUTE_EXACT_GUARDED_V2_13_ACTIVATION");
      return result(
        0,
        JSON.stringify({
          schema_version: "videoforge-v2-13-guarded-activation-result/v1",
          state: "DISABLED_UNQUALIFIED",
          commit: sourceCommit,
        }),
      );
    },
  });
  const value = await adapter({}, state);
  assert.equal(calls, 1);
  assert.equal(value.executedOnce, true);
  assert.match(value.evidenceSha256, /^sha256:[0-9a-f]{64}$/u);
});

test("staged qualification adapters preserve admission, Mage, SoulX, then max-one boundaries", async () => {
  const calls = [];
  const deployment = (lane, marker) => ({
    lane,
    workersMin: 0,
    workersMax: 1,
    endpointIdSha256: `sha256:${marker.repeat(64)}`,
    deploymentSha256: `sha256:${marker.repeat(64)}`,
  });
  const receipt = (marker, cost) => ({
    settledCostUsd: cost,
    deploymentSha256: `sha256:${marker.repeat(64)}`,
  });
  const input = { soulx: { deploymentSha256: `sha256:${"9".repeat(64)}` } };
  const transport = {};
  const api = {
    issueV213StageAuthority: async (_transport, _input, stage) => {
      calls.push(`authority-${stage}`);
      return { stage };
    },
    readV213DualLaneAdmission: async () => {
      calls.push("admission");
      return {
        schemaVersion: "videoforge.v213-admission-handoff/v1",
        handoffSha256: `sha256:${"1".repeat(64)}`,
        admission: {
          gpu: "NVIDIA GeForce RTX 4090",
          region: "EU-RO-1",
          availability: "LOW",
          flexRateUsdPerGpuHour: 1.1,
          cumulativeBillingUsd: 2,
        },
      };
    },
    runV213MageQualification: async () => {
      calls.push("mage");
      return {
        schemaVersion: "videoforge.v213-mage-qualification-handoff/v1",
        handoffSha256: `sha256:${"2".repeat(64)}`,
        threeStableZeroWorkerReads: true,
        receipt: receipt("3", 0.5),
      };
    },
    runV213SoulXQualification: async () => {
      calls.push("soulx");
      return {
        schemaVersion: "videoforge.v213-soulx-qualification-handoff/v1",
        handoffSha256: `sha256:${"4".repeat(64)}`,
        threeStableZeroWorkerReads: true,
        receipts: [receipt("5", 0.1), receipt("6", 0.1), receipt("7", 0.1), receipt("8", 0.1)],
      };
    },
    createV213Max1Deployments: async () => {
      calls.push("max-one");
      return {
        schemaVersion: "videoforge.v213-dual-lane-live/v1",
        qualified: true,
        production: { mage: deployment("mage", "a"), soulx: deployment("soulx", "b") },
        settled: { threeStableZeroWorkerReads: true },
      };
    },
  };
  const adapters = createStagedQualificationAdapters({ api, transport, input });
  assert.equal((await adapters["fresh-live-preflight"]()).noFallback, true);
  assert.equal((await adapters["mage-live-qualification"]()).actualUsd, 0.5);
  assert.equal((await adapters["soulx-live-qualification"]()).actualUsd, 0.4);
  assert.equal((await adapters["create-exact-max-one-endpoints"]()).createdExactTwoEndpoints, true);
  assert.deepEqual(calls, [
    "admission",
    "authority-mage",
    "mage",
    "authority-soulx",
    "soulx",
    "authority-production",
    "max-one",
  ]);
  await assert.rejects(adapters["soulx-live-qualification"](), /QUALIFICATION_STAGE_ORDER/u);
});

test("concrete catalog exposes publication, guarded activation, and the protected TS bridge", () => {
  assert.deepEqual(Object.keys(createConcreteFullLiveAdapters()).sort(), [
    "approval-commit-push",
    "create-exact-max-one-endpoints",
    "fresh-live-preflight",
    "guarded-activation-once",
    "mage-image-workflow-dispatch",
    "mage-image-workflow-verification",
    "mage-live-qualification",
    "promote-qualified-production",
    "prove-zero-workers",
    "read-settled-billing",
    "reconcile-exact-resources",
    "release-tag-create",
    "release-tag-push",
    "release-tag-readback",
    "restore-endpoints-max-one",
    "soulx-image-workflow-dispatch",
    "soulx-image-workflow-verification",
    "soulx-live-qualification",
    "v2-09-short-hosted-project",
    "v2-10-operator-free-ranga-pilot",
    "v2-11-two-concurrent-owned-projects",
    "v2-12-long-output",
    "v2-13-final-two-lane-smoke",
  ]);
});

test("protected TypeScript bridge chains only opaque qualification hashes across processes", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-bridge-adapter-test-"));
  chmodSync(directory, 0o700);
  const inputPath = resolve(directory, "production-input.json");
  writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      authorityDocument: { exact: true },
      dualLaneInput: {
        mage: { sourceCommit, deploymentSha256: `sha256:${"1".repeat(64)}` },
        soulx: { sourceCommit, deploymentSha256: `sha256:${"2".repeat(64)}` },
      },
      commandPayloads: {},
    }),
    { mode: 0o600 },
  );
  const requests = [];
  const spawnBridge = async ({ request }) => {
    requests.push(request);
    const summary =
      request.command === "fresh-live-preflight"
        ? {
            schemaVersion: "videoforge.v213-admission-handoff/v1",
            handoffSha256: `sha256:${"3".repeat(64)}`,
            admission: {
              gpu: "NVIDIA GeForce RTX 4090",
              region: "EU-RO-1",
              availability: "LOW",
              flexRateUsdPerGpuHour: 1,
              cumulativeBillingUsd: 10,
            },
          }
        : {
            handoffSha256: `sha256:${"4".repeat(64)}`,
            billingAfterUsd: 10.5,
            qualified: true,
            zeroWorkersAfter: true,
          };
    return {
      schemaVersion: "videoforge.v213-full-live-command-result/v1",
      commandId: request.commandId,
      command: request.command,
      state: "TERMINAL",
      evidenceSha256: summary.handoffSha256,
      summary,
    };
  };
  try {
    const adapters = createTypeScriptBridgeAdapters({
      environment: { VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: inputPath },
      spawnBridge,
    });
    const prior = new Map();
    const preflight = await adapters["fresh-live-preflight"](
      {},
      state,
      prior,
      `sha256:${"a".repeat(64)}`,
    );
    prior.set("fresh-live-preflight", preflight);
    const mage = await adapters["mage-live-qualification"](
      {},
      state,
      prior,
      `sha256:${"b".repeat(64)}`,
    );
    assert.equal(mage.actualUsd, 0.5);
    assert.deepEqual(
      requests[1].input.commandPayload.admission,
      requests[0] ? preflight.bridgeSummary : null,
    );
    assert.equal(JSON.stringify(requests).includes("dispatch_token"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protected cleanup bridge returns the exact four outer proof contracts without prior deployments", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-cleanup-adapter-test-"));
  chmodSync(directory, 0o700);
  const inputPath = resolve(directory, "production-input.json");
  writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      authorityDocument: { exact: true },
      dualLaneInput: { mage: { sourceCommit }, soulx: { sourceCommit } },
      commandPayloads: {},
    }),
    { mode: 0o600 },
  );
  const summaries = {
    "restore-endpoints-max-one": { bothEndpointsMaxWorkersOne: true },
    "prove-zero-workers": { zeroWorkers: true, reads: [{}, {}, {}] },
    "read-settled-billing": { withinCumulativeCap: true, cumulativeBillingUsd: 12 },
    "reconcile-exact-resources": { onlyApprovedRetainedVolumes: true },
  };
  try {
    const requests = [];
    const adapters = createTypeScriptBridgeAdapters({
      environment: { VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: inputPath },
      spawnBridge: async ({ request }) => {
        requests.push(request);
        return {
          schemaVersion: "videoforge.v213-full-live-command-result/v1",
          commandId: request.commandId,
          command: request.command,
          state: "TERMINAL",
          evidenceSha256: `sha256:${"9".repeat(64)}`,
          summary: summaries[request.command],
        };
      },
    });
    const prior = new Map();
    const outputs = [];
    for (const command of Object.keys(summaries))
      outputs.push(await adapters[command]({}, state, prior, `sha256:${"a".repeat(64)}`));
    assert.equal(
      outputs.every((output) => output.proofSha256 === `sha256:${"9".repeat(64)}`),
      true,
    );
    assert.equal(outputs[0].bothEndpointsMaxWorkersOne, true);
    assert.equal(outputs[1].zeroWorkers, true);
    assert.equal(outputs[2].withinCumulativeCap, true);
    assert.equal(outputs[3].onlyApprovedRetainedVolumes, true);
    assert.equal(
      requests.every((request) => JSON.stringify(request.input.commandPayload) === "{}"),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("durable stage-store adapter uses only the reviewed 0045 functions", async () => {
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push([sql, parameters]);
      if (sql.startsWith("SELECT to_char"))
        return { rows: [{ value: "2026-08-26T04:00:00.000Z" }] };
      if (sql.includes("record_v213_stage_authority"))
        return { rows: [{ value: JSON.parse(parameters[1]) }] };
      if (sql.includes("claim_v213_stage_authority"))
        return { rows: [{ value: { decision: "EXECUTE" } }] };
      if (sql.includes("claim_v213_operation")) return { rows: [{ value: { action: "EXECUTE" } }] };
      if (sql.includes("transition_v213_operation"))
        return { rows: [{ value: { state: "ACKED" } }] };
      return { rows: [{ value: null }] };
    },
  };
  const store = createV213DurableStageStore({
    database,
    fullLiveAuthorityId: "00000000-0000-4000-8000-000000000045",
    signAuthority: async () => "A".repeat(88),
    nonce: () => "n".repeat(32),
  });
  const authority = await store.issueStageAuthority({
    stage: "mage",
    inputSha256: `sha256:${"1".repeat(64)}`,
    predecessorHandoffSha256: `sha256:${"2".repeat(64)}`,
  });
  assert.equal(authority.stage, "mage");
  assert.equal((await store.claimStageAuthority(authority)).decision, "EXECUTE");
  assert.equal(
    (
      await store.claimOperation({
        operationId: "op",
        stageAuthorityId: authority.authorityId,
        kind: "create",
        requestSha256: `sha256:${"3".repeat(64)}`,
        resourceKey: "resource",
      })
    ).action,
    "EXECUTE",
  );
  assert.equal(
    (await store.transitionOperation({ operationId: "op", from: "IN_FLIGHT", to: "ACKED" })).state,
    "ACKED",
  );
  await store.completeStageAuthority(authority.authorityId, `sha256:${"4".repeat(64)}`);
  assert.ok(calls.some(([sql]) => sql.includes("complete_v213_stage_authority")));
});

test("acceptance adapter maps only redacted settled summaries into outer receipts", async () => {
  const summary = {
    settledCostUsd: 0.5,
    zeroWorkersAfter: true,
    terminal: true,
    evidenceSha256: `sha256:${"5".repeat(64)}`,
    durationSeconds: 240,
    operatorIntervention: false,
  };
  const adapter = Object.fromEntries(
    ["executeV210", "executeV211", "executeV212", "executeV213"].map((name) => [
      name,
      async () => ({ liveAcceptanceClaimed: true, summary }),
    ]),
  );
  const adapters = createV213AcceptanceAdapters({
    adapter,
    calls: { v210: {}, v211: {}, v212: {}, v213: {} },
    v209: async () => ({
      actualUsd: 0.1,
      accepted: true,
      terminal: true,
      zeroWorkersAfter: true,
      evidenceSha256: `sha256:${"6".repeat(64)}`,
      durationSeconds: 40,
    }),
  });
  const result = await adapters["v2-10-operator-free-ranga-pilot"]();
  assert.deepEqual(result, { actualUsd: 0.5, accepted: true, ...summary });
});
