import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  closedTrustedTimeCommand,
  createConcreteFullLiveAdapters,
  createPrequalificationDatabaseBootstrapAdapter,
  createGitReleaseAdapters,
  createGuardedActivationAdapter,
  createWorkflowStartAuthorityAdapter,
  createProtectedInputMaterializer,
  createStagedQualificationAdapters,
  createTypeScriptBridgeAdapters,
  createV213AcceptanceAdapters,
  createV213DurableStageStore,
  createGithubDispatchAdapters,
  createGithubVerificationAdapters,
  PREQUALIFICATION_OPERATOR_FUNCTIONS,
  readAuthenticatedGithubTime,
  TAG,
  verifyPrequalificationDatabaseReceipt,
} from "../../deploy/v2-13/full-live-adapters.mjs";
import { materializationSeedFixture } from "./fixtures/v2-13-materialization-seed.mjs";

const sourceCommit = "4".repeat(40);
const state = {
  release_source_commit: sourceCommit,
  approved_at: "2026-01-01T00:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
  release_ref: {
    exact_tag_name: TAG,
    exact_target_commit: sourceCommit,
    state: "VERIFIED_EXACT_REMOTE",
  },
};
const result = (status = 0, stdout = "", stderr = "") => ({ status, stdout, stderr });
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalJson = (value) =>
  Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item)).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const preEndpointSecrets = () => ({
  schemaVersion: "videoforge.v213-full-live-pre-endpoint-secrets/v1",
  stageAuthoritySigningKeyBase64: Buffer.alloc(32, 1).toString("base64"),
  provenanceReceiptHmacKeyBase64: Buffer.alloc(32, 2).toString("base64"),
  provenanceReceiptKeyId: "receipt-key",
  acceptanceEvidenceSigningKeyBase64: Buffer.alloc(32, 3).toString("base64"),
  pairDispatchTokenKeyBase64: Buffer.alloc(32, 4).toString("base64"),
  pairDispatchTokenKeyId: "dispatch-key",
  pairEnvelopeSigningKeyHex: Buffer.alloc(32, 5).toString("hex"),
  pairEnvelopeSigningKeyId: "envelope-key",
  pairProviderProofKeyHex: Buffer.alloc(32, 6).toString("hex"),
  pairProviderProofKeyId: "proof-key",
});

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

test("approval publication pushes the exact authority-record commit with FF and tree-byte proof", async () => {
  const approval = '{"approval":true}\n';
  const authority = '{"authority":true}\n';
  const proposalCommit = "2".repeat(40);
  const authorityCommit = "3".repeat(40);
  const remoteCommit = "1".repeat(40);
  const publicationState = {
    ...state,
    proposal_record_commit: proposalCommit,
    authority_record_commit: authorityCommit,
    approval_record_path: "evidence/user-approval.json",
    authority_record_path: "evidence/approved-authority.json",
    approval_sha256: hash(approval),
    authority_sha256: hash(authority),
  };
  const replies = [
    result(0, "commit\n"),
    result(0, `${proposalCommit}\n`),
    result(0, approval),
    result(0, authority),
    result(0, `${remoteCommit}\trefs/heads/codex/serverless-v2-roadmap\n`),
    result(0),
    result(0, "ok\n"),
    result(0, `${authorityCommit}\trefs/heads/codex/serverless-v2-roadmap\n`),
  ];
  const calls = [];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  const published = await adapters["approval-commit-push"]({}, publicationState);
  assert.equal(published.commit, authorityCommit);
  assert.deepEqual(calls[5][1], ["merge-base", "--is-ancestor", remoteCommit, authorityCommit]);
  assert.equal(replies.length, 0);
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

test("trusted time uses credential-free bounded HTTPS and one exact Date header", () => {
  const trusted = readAuthenticatedGithubTime({
    run: (command, args) => {
      assert.equal(command, "curl");
      assert.deepEqual(args, [
        "--disable",
        "--silent",
        "--show-error",
        "--head",
        "--proto",
        "=https",
        "--tlsv1.2",
        "--connect-timeout",
        "5",
        "--max-time",
        "10",
        "https://api.github.com/rate_limit",
      ]);
      return result(0, "HTTP/2 200\r\ndate: Wed, 26 Aug 2026 12:00:00 GMT\r\n\r\n");
    },
  });
  assert.equal(trusted, "2026-08-26T12:00:00.000Z");
  closedTrustedTimeCommand("curl", ["--disable"], 12_000, (command, args, options) => {
    assert.equal(command, "curl");
    assert.deepEqual(args, ["--disable"]);
    assert.deepEqual(Object.keys(options.env).sort(), ["NO_PROXY", "PATH", "no_proxy"]);
    assert.equal(options.env.NO_PROXY, "*");
    assert.equal(options.env.no_proxy, "*");
    assert.equal(options.timeout, 12_000);
    return result(0);
  });
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
  const statuses = ["queued", "in_progress", "completed"];
  let viewCalls = 0;
  const adapters = createGithubVerificationAdapters({
    maximumPolls: 3,
    pollIntervalMs: 0,
    trustedTime: async () => "2026-08-26T12:00:00Z",
    run: (_command, args) => {
      if (args[1] === "view") {
        const status = statuses[viewCalls++];
        return result(
          0,
          JSON.stringify({
            databaseId: 11,
            headSha: sourceCommit,
            workflowName: "mage-image",
            status,
            conclusion: status === "completed" ? "success" : null,
          }),
        );
      }
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
  assert.equal(viewCalls, 3);
  assert.equal(verified.publicAllBlobsVerified, true);
  assert.match(verified.evidenceSha256, /^sha256:[0-9a-f]{64}$/u);
});

test("GitHub verification never redispatches and fails closed on bounded terminal timeout", async () => {
  let calls = 0;
  const adapters = createGithubVerificationAdapters({
    maximumPolls: 2,
    pollIntervalMs: 0,
    trustedTime: async () => "2026-08-26T12:00:00Z",
    run: (_command, args) => {
      calls += 1;
      assert.deepEqual(args.slice(0, 3), ["run", "view", "11"]);
      return result(
        0,
        JSON.stringify({
          databaseId: 11,
          headSha: sourceCommit,
          workflowName: "mage-image",
          status: "in_progress",
          conclusion: null,
        }),
      );
    },
  });
  const prior = new Map([["mage-image-workflow-dispatch", { runId: "11" }]]);
  await assert.rejects(
    adapters["mage-image-workflow-verification"]({}, state, prior),
    /WORKFLOW_RUN_TERMINAL_TIMEOUT/u,
  );
  assert.equal(calls, 2);
});

test("GitHub verification enforces one monotonic 1800000ms deadline across subprocess time", async () => {
  let clock = 0;
  let timeoutSeen = null;
  const adapters = createGithubVerificationAdapters({
    deadlineNow: () => clock,
    maximumPolls: 180,
    pollIntervalMs: 10_000,
    trustedTime: async (timeoutMs) => {
      assert.ok(timeoutMs <= 12_000);
      clock += 1_000;
      return "2026-08-26T12:00:00Z";
    },
    run: (_command, _args, timeoutMs) => {
      timeoutSeen = timeoutMs;
      clock = 1_800_001;
      return result(
        0,
        JSON.stringify({
          databaseId: 11,
          headSha: sourceCommit,
          workflowName: "mage-image",
          status: "in_progress",
          conclusion: null,
        }),
      );
    },
  });
  const prior = new Map([["mage-image-workflow-dispatch", { runId: "11" }]]);
  await assert.rejects(
    adapters["mage-image-workflow-verification"]({}, state, prior),
    /WORKFLOW_RUN_TERMINAL_TIMEOUT/u,
  );
  assert.ok(timeoutSeen > 0 && timeoutSeen <= 60_000);
});

test("guarded adapter calls the existing executor once and authenticates its durable evidence", async () => {
  const environment = Object.fromEntries(
    [
      "ACTIVATION_RECORD",
      "CONFIG_ACTIVATION_RECORD",
      "PROPOSAL_FILE",
      "RELEASE_MANIFEST_FILE",
      "USER_APPROVAL_FILE",
      "WRANGLER_OAUTH_CONFIG_FILE",
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
      disabled_version_id: "11111111-1111-4111-8111-111111111111",
      disabled_version_sha256: hash("11111111-1111-4111-8111-111111111111"),
      external_spend_cap_usd: 0,
      new_paid_retained_resources_authorized: false,
    })}\n`,
  );
  let calls = 0;
  const adapter = createGuardedActivationAdapter({
    environment,
    readEvidence: () => evidence,
    preflight: () => true,
    prepareSource: () => ({ root: "/isolated-release-source", cleanup: () => {} }),
    run: (command, args) => {
      calls += 1;
      assert.equal(command, process.execPath);
      assert.equal(args[0], "/isolated-release-source/deploy/v2-13/guarded-activation.mjs");
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
  const deployment = (lane, marker) => {
    const endpointId = `${lane}-endpoint`;
    return {
      lane,
      workersMin: 0,
      workersMax: 1,
      endpointId,
      endpointIdSha256: hash(endpointId),
      deploymentSha256: `sha256:${marker.repeat(64)}`,
    };
  };
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
          flexRateUsdPerGpuHour: 1.116,
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
  const maxOne = await adapters["create-exact-max-one-endpoints"]();
  assert.equal(maxOne.createdExactTwoEndpoints, true);
  assert.equal(maxOne.materialization.production.mage.endpointId, "mage-endpoint");
  assert.match(
    maxOne.materialization.production.mage.deploymentSnapshotSha256,
    /^sha256:[0-9a-f]{64}$/u,
  );
  assert.notEqual(
    maxOne.materialization.production.mage.deploymentSnapshotSha256,
    `sha256:${"a".repeat(64)}`,
  );
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
    "bootstrap-prequalification-database",
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
    "record-workflow-start-authority",
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

test("workflow-start authority adapter records one exact operator function call and returns no token", async () => {
  const input = {
    workflowAuthorityId: "11111111-1111-4111-8111-111111111111",
    authorityId: "22222222-2222-4222-8222-222222222222",
    tokenSha256: `sha256:${"a".repeat(64)}`,
    expiresAt: "2026-08-26T12:00:00.000Z",
  };
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.startsWith('SELECT id::text AS "workflowAuthorityId"')) {
        assert.deepEqual(parameters, [input.workflowAuthorityId]);
        return { rows: [] };
      }
      assert.equal(
        sql,
        "SELECT public.videoforge_record_v213_workflow_start_authority($1::uuid,$2::uuid,$3,$4::timestamptz) AS authority",
      );
      assert.deepEqual(parameters, [
        input.workflowAuthorityId,
        input.authorityId,
        input.tokenSha256,
        input.expiresAt,
      ]);
      return {
        rows: [
          {
            authority: {
              authorityId: input.workflowAuthorityId,
              tokenSha256: input.tokenSha256,
              expiresAt: input.expiresAt,
            },
          },
        ],
      };
    },
  };
  const adapter = createWorkflowStartAuthorityAdapter({ database, input });
  const resultValue = await adapter({}, {}, new Map());
  assert.equal(calls.length, 2);
  assert.match(
    calls[0].sql,
    /FROM public\.hosted_full_live_workflow_start_authorities WHERE id=\$1::uuid/u,
  );
  assert.deepEqual(resultValue, {
    actualUsd: 0,
    authorityId: input.workflowAuthorityId,
    tokenSha256: input.tokenSha256,
    expiresAt: input.expiresAt,
  });
});

test("workflow-start authority reconciles an ambiguous insert without redispatch", async () => {
  const input = {
    workflowAuthorityId: "11111111-1111-4111-8111-111111111111",
    authorityId: "22222222-2222-4222-8222-222222222222",
    tokenSha256: `sha256:${"a".repeat(64)}`,
    expiresAt: "2026-08-26T12:00:00.000Z",
  };
  let reads = 0;
  let inserts = 0;
  const database = {
    async query(sql) {
      if (sql.startsWith('SELECT id::text AS "workflowAuthorityId"')) {
        reads += 1;
        return reads === 1
          ? { rows: [] }
          : {
              rows: [
                {
                  workflowAuthorityId: input.workflowAuthorityId,
                  authorityId: input.authorityId,
                  tokenSha256: input.tokenSha256,
                  expiresAt: input.expiresAt,
                },
              ],
            };
      }
      inserts += 1;
      throw new Error("transport lost after commit");
    },
  };
  const adapter = createWorkflowStartAuthorityAdapter({ database, input });
  await assert.doesNotReject(adapter({}, {}, new Map()));
  assert.equal(reads, 2);
  assert.equal(inserts, 1);
});

test("workflow-start authority stops on an existing replay drift", async () => {
  const input = {
    workflowAuthorityId: "11111111-1111-4111-8111-111111111111",
    authorityId: "22222222-2222-4222-8222-222222222222",
    tokenSha256: `sha256:${"a".repeat(64)}`,
    expiresAt: "2026-08-26T12:00:00.000Z",
  };
  const database = {
    async query(sql) {
      if (sql.startsWith('SELECT id::text AS "workflowAuthorityId"'))
        return {
          rows: [
            {
              workflowAuthorityId: input.workflowAuthorityId,
              authorityId: "33333333-3333-4333-8333-333333333333",
              tokenSha256: input.tokenSha256,
              expiresAt: input.expiresAt,
            },
          ],
        };
      throw new Error("insert must not be attempted");
    },
  };
  const adapter = createWorkflowStartAuthorityAdapter({ database, input });
  await assert.rejects(adapter({}, {}, new Map()), /DATABASE_WORKFLOW_AUTHORITY_REPLAY_DRIFT/u);
});

test("prequalification bootstrap executes the exact manifest tail through a locked fake-psql seam", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-prequalification-test-"));
  chmodSync(directory, 0o700);
  const servicePath = resolve(directory, "owner.pg_service.conf");
  const passPath = resolve(directory, "owner.pgpass");
  const operatorPath = resolve(directory, "operator.database-url");
  writeFileSync(
    servicePath,
    "[videoforge_v2_13_owner]\nhost=example.neon.tech\ndbname=videoforge\nuser=videoforge_owner\nsslmode=require\nchannel_binding=require\n",
    { mode: 0o600 },
  );
  writeFileSync(passPath, "example.neon.tech:5432:videoforge:videoforge_owner:owner-password\n", {
    mode: 0o600,
  });
  writeFileSync(
    operatorPath,
    "postgresql://videoforge_hosted_operator:operator-password@example.neon.tech/videoforge?sslmode=require&channel_binding=require",
    { mode: 0o600 },
  );
  const manifest = JSON.parse(
    readFileSync("packages/control-plane/migrations/manifest.json", "utf8"),
  );
  const rows = (count) =>
    manifest.migrations
      .slice(0, count)
      .map(({ version, name, filename, sha256 }) => `${version}\t${name}\t${filename}\t${sha256}`)
      .join("\n");
  const role = {
    flags: {
      rolcanlogin: true,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconfig: null,
    },
    memberships: 0,
    ownership: 0,
    extension_ownership: 0,
    database_acl: 0,
    effective_database_dangerous_acl: 0,
    schema_acl: ["public:USAGE"],
    effective_schema_dangerous_acl: 0,
    table_acl: 0,
    effective_table_acl: 0,
    sequence_acl: 0,
    effective_sequence_acl: 0,
    default_acl: 0,
    function_acl: [...PREQUALIFICATION_OPERATOR_FUNCTIONS].sort(),
    public_function_acl: [],
    public_default_function_acl: 0,
  };
  const migrationSqls = [];
  const calls = [];
  let lockedLedgerReads = 0;
  const run = (command, args) => {
    calls.push([command, args]);
    assert.equal(command, "psql");
    const fileIndex = args.indexOf("--file");
    if (fileIndex >= 0) {
      const path = args[fileIndex + 1];
      if (path.endsWith("neon-full-live-operator-grants.sql")) return result();
      const sql = readFileSync(path, "utf8");
      migrationSqls.push(sql);
      return result();
    }
    const sql = args[args.indexOf("--command") + 1] ?? "";
    if (sql.includes("CREATE EXTENSION IF NOT EXISTS pgcrypto")) return result();
    if (sql.includes("CREATE ROLE")) return result();
    if (sql.includes("BEGIN;") && sql.includes("pg_advisory_xact_lock")) {
      lockedLedgerReads += 1;
      return result(0, `${rows(lockedLedgerReads === 1 ? 36 : 45)}\n`);
    }
    if (sql.includes("rolname IN")) return result(0, "0\n");
    if (sql.includes("count(*)::text FROM pg_roles")) return result(0, "0\n");
    if (sql.includes("FROM pg_extension WHERE extname='pgcrypto'"))
      return result(0, '{"name":"pgcrypto","version":"1.3","schema":"public"}\n');
    if (sql.includes("json_build_object('flags'")) return result(0, `${JSON.stringify(role)}\n`);
    throw new Error(`unexpected fake psql SQL: ${sql.slice(0, 120)}`);
  };
  try {
    const adapter = createPrequalificationDatabaseBootstrapAdapter({
      environment: { VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory },
      run,
    });
    const output = await adapter({}, state);
    assert.equal(output.actualUsd, 0);
    assert.equal(output.recovery_mode, "FRESH_36_TO_45");
    assert.equal(output.ledger_before_count, 36);
    assert.equal(output.runpod_calls, 0);
    assert.equal(output.cloudflare_calls, 0);
    assert.equal(output.application_secret_reads, 0);
    assert.equal(output.gpu_use, false);
    assert.equal(output.external_spend_usd, 0);
    assert.equal(lockedLedgerReads, 2);
    assert.equal(migrationSqls.length, 9);
    for (const [index, sql] of migrationSqls.entries()) {
      assert.match(sql, /BEGIN;/u);
      assert.match(sql, /pg_advisory_xact_lock\(1448494662,1\)/u);
      assert.match(sql, new RegExp(`version=${37 + index}`));
      assert.match(sql, /migration ledger prefix drift/u);
      assert.match(sql, /INSERT INTO public\.videoforge_schema_migrations/u);
    }
    const receiptPath = resolve(directory, "prequalification-database-bootstrap.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.recovery_mode, "FRESH_36_TO_45");
    assert.equal(receipt.ledger_before_count, 36);
    assert.equal(lstatSync(receiptPath).mode & 0o777, 0o600);
    const callsBeforeRejectedCas = calls.length;
    await assert.rejects(
      verifyPrequalificationDatabaseReceipt({
        environment: { VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory },
        priorResults: new Map([
          [
            "bootstrap-prequalification-database",
            { prequalification_database_bootstrap_sha256: `sha256:${"0".repeat(64)}` },
          ],
        ]),
        run,
      }),
      /PREQUALIFICATION_RECEIPT_OUTER_CAS/u,
    );
    assert.equal(calls.length, callsBeforeRejectedCas);
    const bridge = createTypeScriptBridgeAdapters({
      environment: { VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory },
      requirePrequalificationReceipt: true,
      spawnBridge: async () => {
        throw new Error("bridge must not start before receipt CAS");
      },
    });
    await assert.rejects(
      bridge["fresh-live-preflight"](
        {},
        state,
        new Map([
          [
            "bootstrap-prequalification-database",
            { prequalification_database_bootstrap_sha256: `sha256:${"0".repeat(64)}` },
          ],
        ]),
        `sha256:${"f".repeat(64)}`,
      ),
      /BRIDGE_PREQUALIFICATION_RECEIPT/u,
    );
    const originalReceiptBytes = readFileSync(receiptPath);
    const mismatchedReceipt = {
      ...receipt,
      ledger_before_sha256: `sha256:${"0".repeat(64)}`,
    };
    const { prequalification_database_bootstrap_sha256: _ignored, ...mismatchedBody } =
      mismatchedReceipt;
    mismatchedReceipt.prequalification_database_bootstrap_sha256 = hash(
      Buffer.from(`${canonicalJson(mismatchedBody)}\n`),
    );
    writeFileSync(receiptPath, `${canonicalJson(mismatchedReceipt)}\n`, { mode: 0o600 });
    await assert.rejects(
      verifyPrequalificationDatabaseReceipt({
        environment: { VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory },
        priorResults: new Map([
          ["bootstrap-prequalification-database", { ...output, ...mismatchedReceipt }],
        ]),
        run,
      }),
      /PREQUALIFICATION_VERIFY_LEDGER_BEFORE/u,
    );
    writeFileSync(receiptPath, originalReceiptBytes, { mode: 0o600 });
    const verified = await verifyPrequalificationDatabaseReceipt({
      environment: { VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory },
      priorResults: new Map([["bootstrap-prequalification-database", output]]),
      run,
    });
    assert.equal(verified.ledger.length, 45);
    assert.equal(lockedLedgerReads, 4);
    assert.equal(
      calls.every(([command]) => command === "psql"),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("global preflight excludes future artifacts and stage adapters validate them at first use", () => {
  const source = readFileSync("deploy/v2-13/full-live-adapters.mjs", "utf8");
  const global = source.slice(
    source.indexOf("function preflightConcreteFullLiveInputs"),
    source.indexOf("function preflightPromotionInputs"),
  );
  assert.doesNotMatch(global, /PROMOTION_RECORD_FILE|GUARDED_INPUTS/u);
  const guarded = source.slice(
    source.indexOf("function createGuardedActivationAdapter"),
    source.indexOf("function createStagedQualificationAdapters"),
  );
  assert.match(guarded, /preflight\(\{ environment, state \}\)/u);
  const promotion = source.slice(
    source.indexOf("function createProtectedPromotionAdapter"),
    source.indexOf("function createV213DurableStageStore"),
  );
  assert.match(promotion, /preflightPromotionInputs\(\{ environment, state, spawn \}\)/u);
  assert.doesNotMatch(promotion, /CLOUDFLARE_API_TOKEN_FILE|CLOUDFLARE_API_TOKEN:/u);
  assert.match(promotion, /wranglerOAuthConfigPath|refreshWranglerOAuthReadback/u);
  assert.match(promotion, /oauthEnvironment/u);
  assert.ok(promotion.indexOf("preflightPromotionInputs") < promotion.indexOf("const runWrangler"));
  assert.ok(
    promotion.indexOf("refreshWranglerOAuthReadback") <
      promotion.indexOf('spawn("pnpm", ["--filter", "@videoforge/web", "exec", "wrangler"'),
  );
});

test("canonical materializer derives all first-use artifacts, survives restart, and hash-chains mode-0600 bytes", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-materializer-test-"));
  chmodSync(directory, 0o700);
  const seedPath = resolve(directory, "seed.json");
  const outputPath = resolve(directory, "cleanup-input.json");
  const chainPath = resolve(directory, "chain.json");
  const manifestPath = resolve(directory, "release-manifest.json");
  const configPath = resolve(directory, "config-activation.json");
  const disabledPath = resolve(directory, "disabled-config.json");
  const activationPath = resolve(directory, "activation.json");
  const promotionPath = resolve(directory, "promotion.json");
  const productionSecretsPath = resolve(directory, "production-secrets.json");
  const secretInputDirectory = resolve(directory, "secret-input");
  mkdirSync(secretInputDirectory, { mode: 0o700 });
  const staticSecretNames = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "WORKFLOW_CALLBACK_SECRET",
    "MEDIA_WORKER_TOKEN_SECRET",
    "VIDEOFORGE_RECONCILER_DATABASE_URL",
    "VIDEOFORGE_DISPATCH_TOKEN_KEY",
    "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
    "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
    "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
    "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
    "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
    "RUNPOD_API_KEY",
    "RUNPOD_API_BASE_URL",
    "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
  ];
  for (const [index, name] of staticSecretNames.entries())
    writeFileSync(resolve(secretInputDirectory, name), `static-${index}`, { mode: 0o600 });
  const seed = materializationSeedFixture();
  writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
  const materializationSeedSha256 = hash(Buffer.from(`${canonicalJson(seed)}\n`));
  writeFileSync(productionSecretsPath, `${JSON.stringify(preEndpointSecrets())}\n`, {
    mode: 0o600,
  });
  const environment = {
    VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
    VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE: chainPath,
    VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: outputPath,
    VIDEOFORGE_V2_13_RELEASE_MANIFEST_FILE: manifestPath,
    VIDEOFORGE_V2_13_CONFIG_ACTIVATION_RECORD: configPath,
    VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE: disabledPath,
    VIDEOFORGE_V2_13_ACTIVATION_RECORD: activationPath,
    VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE: promotionPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE: productionSecretsPath,
    VIDEOFORGE_V2_13_SECRET_INPUT_DIR: secretInputDirectory,
  };
  const validated = { production: 0, guarded: 0, promotion: 0 };
  const factory = () =>
    createProtectedInputMaterializer({
      environment,
      validateProduction: () => {
        validated.production += 1;
        return JSON.parse(readFileSync(outputPath, "utf8"));
      },
      validateGuarded: () => {
        validated.guarded += 1;
      },
      validatePromotion: () => {
        validated.promotion += 1;
      },
      renderDisabledConfig: () =>
        Buffer.from(
          `${JSON.stringify({ vars: { VIDEOFORGE_GPU_TRANSPORT: "DISABLED_UNQUALIFIED" } })}\n`,
        ),
    });
  const materialize = factory();
  const materialState = {
    ...state,
    authority_id: "v2-13-materializer-test-0001",
    proposal_sha256: `sha256:${"1".repeat(64)}`,
    approval_sha256: `sha256:${"2".repeat(64)}`,
    proposal_record_commit: "3".repeat(40),
    full_live_executor_sha256: `sha256:${"4".repeat(64)}`,
    materialization_seed_sha256: materializationSeedSha256,
    approval_record_path: "evidence/user-approval.json",
  };
  const prior = new Map([
    [
      "mage-image-workflow-verification",
      { evidenceSha256: `sha256:${"5".repeat(64)}`, imageDigest: `sha256:${"6".repeat(64)}` },
    ],
    [
      "soulx-image-workflow-verification",
      { evidenceSha256: `sha256:${"7".repeat(64)}`, imageDigest: `sha256:${"8".repeat(64)}` },
    ],
  ]);
  try {
    await materialize({
      operationId: "fresh-live-preflight",
      state: materialState,
      priorResults: prior,
      outerStateSha256: `sha256:${"9".repeat(64)}`,
    });
    const output = JSON.parse(readFileSync(outputPath, "utf8"));
    const chain = JSON.parse(readFileSync(chainPath, "utf8"));
    assert.match(output.dualLaneInput.mage.publicImage, /@sha256:6{64}$/u);
    assert.equal(output.dualLaneInput.soulx.deploymentSha256, `sha256:${"7".repeat(64)}`);
    assert.equal(chain.entries.length, 1);
    assert.equal(chain.entries[0].kind, "production-input");
    assert.equal(lstatSync(outputPath).mode & 0o777, 0o600);
    const later = new Map(prior);
    later.set("mage-live-qualification", {
      evidenceSha256: `sha256:${"a".repeat(64)}`,
      deploymentSha256: `sha256:${"b".repeat(64)}`,
    });
    later.set("soulx-live-qualification", {
      evidenceSha256: `sha256:${"c".repeat(64)}`,
      deploymentSha256: `sha256:${"d".repeat(64)}`,
    });
    later.set("create-exact-max-one-endpoints", {
      evidenceSha256: `sha256:${"e".repeat(64)}`,
      materialization: {
        production: {
          mage: {
            endpointId: "mage-endpoint",
            endpointIdSha256: hash("mage-endpoint"),
            deploymentSnapshotSha256: `sha256:${"e".repeat(64)}`,
          },
          soulx: {
            endpointId: "soulx-endpoint",
            endpointIdSha256: hash("soulx-endpoint"),
            deploymentSnapshotSha256: `sha256:${"f".repeat(64)}`,
          },
        },
      },
    });
    await factory()({
      operationId: "guarded-activation-once",
      state: materialState,
      priorResults: later,
      outerStateSha256: `sha256:${"f".repeat(64)}`,
    });
    later.set("guarded-activation-once", {
      evidenceSha256: `sha256:${"0".repeat(64)}`,
      materialization: {
        disabledVersionId: "11111111-1111-4111-8111-111111111111",
        disabledVersionSha256: `sha256:${"1".repeat(64)}`,
      },
    });
    await factory()({
      operationId: "promote-qualified-production",
      state: materialState,
      priorResults: later,
      outerStateSha256: `sha256:${"2".repeat(64)}`,
    });
    const completeChain = JSON.parse(readFileSync(chainPath, "utf8"));
    assert.deepEqual(
      completeChain.entries.map((entry) => entry.kind),
      ["production-input", "max-one-endpoint-bindings", "activation-record", "promotion-record"],
    );
    assert.equal(
      completeChain.entries[1].prior_chain_sha256,
      completeChain.entries[0].entry_sha256,
    );
    assert.equal(
      completeChain.entries[2].prior_chain_sha256,
      completeChain.entries[1].entry_sha256,
    );
    assert.equal(
      completeChain.entries[3].prior_chain_sha256,
      completeChain.entries[2].entry_sha256,
    );
    for (const path of [manifestPath, configPath, disabledPath, activationPath, promotionPath])
      assert.equal(lstatSync(path).mode & 0o777, 0o600);
    const promotion = JSON.parse(readFileSync(promotionPath, "utf8"));
    assert.equal(
      promotion.lanes.mage_image.qualification_record_sha256,
      `sha256:${"a".repeat(64)}`,
    );
    assert.equal(promotion.cloudflare.disabled_version_sha256, `sha256:${"1".repeat(64)}`);
    const finalSecrets = JSON.parse(readFileSync(productionSecretsPath, "utf8"));
    assert.equal(finalSecrets.mageEndpointId, "mage-endpoint");
    assert.equal(finalSecrets.soulxEndpointId, "soulx-endpoint");
    assert.equal(
      promotion.lanes.soulx_avatar.deployment_snapshot_sha256,
      `sha256:${"f".repeat(64)}`,
    );
    const activation = JSON.parse(readFileSync(activationPath, "utf8"));
    assert.equal(Object.keys(activation.secret_sha256).length, 22);
    assert.equal(activation.secret_sha256.VIDEOFORGE_MAGE_ENDPOINT_ID, hash("mage-endpoint"));
    assert.deepEqual(validated, { production: 2, guarded: 1, promotion: 1 });
    await assert.rejects(
      factory()({
        operationId: "fresh-live-preflight",
        state: materialState,
        priorResults: prior,
        outerStateSha256: `sha256:${"a".repeat(64)}`,
      }),
      /MATERIALIZATION_CHAIN_STAGE_REPLAY/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("materializer rejects nested seed aliases, extra command payloads, and CAS replacement", async () => {
  const baseSeed = materializationSeedFixture();
  const runWith = async (seed, expectedHash, pattern) => {
    const directory = mkdtempSync(resolve(tmpdir(), "v213-materializer-seed-contract-test-"));
    const seedPath = resolve(directory, "seed.json");
    const chainPath = resolve(directory, "chain.json");
    const outputPath = resolve(directory, "production-input.json");
    writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
    const materialize = createProtectedInputMaterializer({
      environment: {
        VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
        VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE: chainPath,
        VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: outputPath,
      },
    });
    try {
      await assert.rejects(
        materialize({
          operationId: "fresh-live-preflight",
          state: {
            ...state,
            authority_id: "v2-13-seed-contract-0001",
            proposal_sha256: `sha256:${"1".repeat(64)}`,
            approval_sha256: `sha256:${"2".repeat(64)}`,
            proposal_record_commit: "3".repeat(40),
            full_live_executor_sha256: `sha256:${"4".repeat(64)}`,
            materialization_seed_sha256: expectedHash,
          },
          priorResults: new Map(),
          outerStateSha256: `sha256:${"5".repeat(64)}`,
        }),
        pattern,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  const alias = structuredClone(baseSeed);
  alias.production_input_base.dualLaneInput.mage.DeploymentSnapshotSha256 = null;
  await runWith(
    alias,
    hash(Buffer.from(`${canonicalJson(alias)}\n`)),
    /MATERIALIZATION_SEED_CONTRACT/u,
  );
  const extraCommand = structuredClone(baseSeed);
  extraCommand.production_input_base.commandPayloads.mage = {};
  await runWith(
    extraCommand,
    hash(Buffer.from(`${canonicalJson(extraCommand)}\n`)),
    /MATERIALIZATION_SEED_CONTRACT/u,
  );
  const nestedCredential = structuredClone(baseSeed);
  nestedCredential.promotion_record_base = {
    approval: { googleClientSecret: "forbidden" },
  };
  await runWith(
    nestedCredential,
    hash(Buffer.from(`${canonicalJson(nestedCredential)}\n`)),
    /MATERIALIZATION_SEED_CONTRACT/u,
  );
  const replacement = structuredClone(baseSeed);
  replacement.production_input_base.fullLiveAuthorityId = "22222222-2222-4222-8222-222222222222";
  await runWith(
    replacement,
    hash(Buffer.from(`${canonicalJson(baseSeed)}\n`)),
    /MATERIALIZATION_SEED_CONTRACT/u,
  );
});

test("cleanup-only materializes and chains an endpoint-free descriptor without future provider IDs", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-cleanup-descriptor-test-"));
  chmodSync(directory, 0o700);
  const seedPath = resolve(directory, "seed.json");
  const outputPath = resolve(directory, "production-input.json");
  const chainPath = resolve(directory, "chain.json");
  const seed = materializationSeedFixture();
  writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
  const materializationSeedSha256 = hash(Buffer.from(`${canonicalJson(seed)}\n`));
  const materialize = createProtectedInputMaterializer({
    environment: {
      VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
      VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE: chainPath,
      VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE: outputPath,
    },
    validateProduction: () => JSON.parse(readFileSync(outputPath, "utf8")),
  });
  const cleanupState = {
    ...state,
    authority_id: "v2-13-cleanup-descriptor-0001",
    proposal_sha256: `sha256:${"1".repeat(64)}`,
    approval_sha256: `sha256:${"2".repeat(64)}`,
    proposal_record_commit: "3".repeat(40),
    full_live_executor_sha256: `sha256:${"4".repeat(64)}`,
    materialization_seed_sha256: materializationSeedSha256,
  };
  try {
    await materialize({
      operationId: "prove-zero-workers",
      state: cleanupState,
      priorResults: new Map(),
      outerStateSha256: `sha256:${"5".repeat(64)}`,
    });
    assert.equal(lstatSync(outputPath).mode & 0o777, 0o600);
    const chain = JSON.parse(readFileSync(chainPath, "utf8"));
    assert.equal(chain.entries.length, 1);
    assert.equal(chain.entries[0].kind, "cleanup-pre-endpoint-descriptor");
    assert.deepEqual(
      chain.entries[0].ordered_output_sha256s.map(([name]) => name),
      ["cleanup_input_sha256"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
  const inputPath = resolve(directory, "cleanup-input.json");
  writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: "videoforge.v213-full-live-cleanup-input/v1",
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      billingBaselineMode: "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION",
      billingBaselineUsd: null,
      totalCapUsd: 17.5,
      retainedLanes: [
        {
          lane: "mage",
          volumeIdSha256: `sha256:${"1".repeat(64)}`,
          volumeManifestSha256: `sha256:${"2".repeat(64)}`,
        },
        {
          lane: "soulx",
          volumeIdSha256: `sha256:${"3".repeat(64)}`,
          volumeManifestSha256: `sha256:${"4".repeat(64)}`,
        },
      ],
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
      environment: { VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE: inputPath },
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
      requests.every(
        (request) =>
          request.input.schemaVersion === "videoforge.v213-full-live-cleanup-input/v1" &&
          !("dualLaneInput" in request.input),
      ),
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
