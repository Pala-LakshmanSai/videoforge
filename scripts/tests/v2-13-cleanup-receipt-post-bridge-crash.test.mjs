import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createTypeScriptBridgeAdapters } from "../../deploy/v2-13/full-live-adapters.mjs";

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

const OPERATIONS = Object.freeze({
  "restore-endpoints-max-one": { bothEndpointsMaxWorkersOne: true },
  "prove-zero-workers": { zeroWorkers: true, reads: [{}, {}, {}] },
  "read-settled-billing": { withinCumulativeCap: true, cumulativeBillingUsd: 12 },
  "reconcile-exact-resources": { onlyApprovedRetainedVolumes: true },
});

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-cleanup-receipt-crash-"));
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
  return { directory, inputPath };
}

function adapterFactory(inputPath, { failReceiptOnce = new Set(), driftOnRecovery = false } = {}) {
  const providerAttempts = new Map();
  const providerMutations = new Map();
  const receiptAttempts = new Map();
  const durableProviderResults = new Map();
  const durableReceiptDocuments = new Map();
  const providerReadbacks = new Map();
  const adapters = createTypeScriptBridgeAdapters({
    environment: { VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE: inputPath },
    expectedCliSha256: hash(
      readFileSync(resolve("apps/web/src/server/providers/v213-full-live-cli.ts")),
    ),
    expectedTransportSha256: hash(
      readFileSync(resolve("apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts")),
    ),
    spawnBridge: async ({ request }) => {
      const operation = request.command;
      const reconciliationOnly =
        request.input.authorizedUnsettled === true &&
        request.input.reconciliationOnly === true &&
        request.input.providerDispatchForbidden === true;
      const initialExecution =
        request.input.authorizedUnsettled === false &&
        request.input.reconciliationOnly === false &&
        request.input.providerDispatchForbidden === false;
      assert.equal(initialExecution || reconciliationOnly, true);
      providerAttempts.set(operation, (providerAttempts.get(operation) ?? 0) + 1);
      let durable = durableProviderResults.get(operation);
      if (!durable) {
        const summary = OPERATIONS[operation];
        durable = {
          schemaVersion: "videoforge.v213-full-live-command-result/v1",
          commandId: request.commandId,
          command: operation,
          state: "TERMINAL",
          evidenceSha256: hash(Buffer.from(canonicalJson(summary))),
          summary,
        };
        durableProviderResults.set(operation, durable);
        if (!reconciliationOnly)
          providerMutations.set(operation, (providerMutations.get(operation) ?? 0) + 1);
      }
      const summary =
        driftOnRecovery && reconciliationOnly
          ? { ...durable.summary, checkedAt: "2026-08-29T00:00:01.000Z" }
          : durable.summary;
      const readback =
        summary === durable.summary
          ? durable
          : {
              ...durable,
              evidenceSha256: hash(Buffer.from(canonicalJson(summary))),
              summary,
            };
      providerReadbacks.set(operation, readback);
      return readback;
    },
    spawnCleanupReceipt: async ({ request }) => {
      const operation = request.operationId;
      receiptAttempts.set(operation, (receiptAttempts.get(operation) ?? 0) + 1);
      const currentReceiptDocument = {
        schemaVersion: "videoforge.v213-current-run-cleanup-receipt/v1",
        fullLiveAuthorityId: request.fullLiveAuthorityId,
        operationId: operation,
        outerStateSha256: request.outerStateSha256,
        providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
        summary: request.summary,
      };
      const receiptDocument = durableReceiptDocuments.get(operation) ?? currentReceiptDocument;
      durableReceiptDocuments.set(operation, receiptDocument);
      if (failReceiptOnce.delete(operation)) throw new Error(`POST_BRIDGE_CRASH:${operation}`);
      return {
        schemaVersion: "videoforge.v213-cleanup-receipt-finalization-result/v1",
        fullLiveAuthorityId: request.fullLiveAuthorityId,
        operationId: operation,
        providerCleanupEvidenceSha256: receiptDocument.providerCleanupEvidenceSha256,
        receiptArtifactSha256: hash(Buffer.from(canonicalJson(receiptDocument))),
        receiptDocument,
        releaseFactMaterializationSha256: request.failureCleanup
          ? null
          : hash(Buffer.from(canonicalJson({ operation, facts: true }))),
        readbackOnly: request.readbackOnly,
      };
    },
  });
  return {
    adapters,
    providerAttempts,
    providerMutations,
    receiptAttempts,
    providerReadbacks,
  };
}

const state = Object.freeze({ expires_at: "2099-01-01T00:00:00.000Z" });
const outer = `sha256:${"a".repeat(64)}`;
const recovery = Object.freeze({
  resumed: true,
  authorizedUnsettled: true,
  reconciliationOnly: true,
  providerDispatchForbidden: true,
});

test("all four cleanup operations recover a post-bridge crash without a second provider mutation", async () => {
  const files = fixture();
  try {
    const failReceiptOnce = new Set(Object.keys(OPERATIONS));
    const runtime = adapterFactory(files.inputPath, { failReceiptOnce });
    for (const operation of Object.keys(OPERATIONS)) {
      await assert.rejects(
        runtime.adapters[operation]({}, state, new Map(), outer),
        new RegExp(`POST_BRIDGE_CRASH:${operation}`, "u"),
      );
      await runtime.adapters[operation](recovery, state, new Map(), outer);
      assert.equal(runtime.providerAttempts.get(operation), 2);
      assert.equal(runtime.providerMutations.get(operation), 1);
      assert.equal(runtime.receiptAttempts.get(operation), 2);
    }
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("all four post-authorization recoveries can certify provider readback with zero new mutation", async () => {
  const files = fixture();
  try {
    const runtime = adapterFactory(files.inputPath);
    for (const operation of Object.keys(OPERATIONS)) {
      await runtime.adapters[operation](recovery, state, new Map(), outer);
      assert.equal(runtime.providerAttempts.get(operation), 1);
      assert.equal(runtime.providerMutations.get(operation) ?? 0, 0);
      assert.equal(runtime.receiptAttempts.get(operation), 1);
    }
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("receipt resume keeps the durable cleanup summary when provider checkedAt and hash drift", async () => {
  const files = fixture();
  const operation = "reconcile-exact-resources";
  try {
    const runtime = adapterFactory(files.inputPath, {
      failReceiptOnce: new Set([operation]),
      driftOnRecovery: true,
    });
    await assert.rejects(
      runtime.adapters[operation]({}, state, new Map(), outer),
      new RegExp(`POST_BRIDGE_CRASH:${operation}`, "u"),
    );
    const recovered = await runtime.adapters[operation](recovery, state, new Map(), outer);
    const currentProviderReadback = runtime.providerReadbacks.get(operation);
    assert.equal(currentProviderReadback.summary.checkedAt, "2026-08-29T00:00:01.000Z");
    assert.notEqual(
      currentProviderReadback.evidenceSha256,
      hash(Buffer.from(canonicalJson(OPERATIONS[operation]))),
    );
    assert.deepEqual(recovered.bridgeSummary, OPERATIONS[operation]);
    assert.equal(recovered.onlyApprovedRetainedVolumes, true);
    assert.equal(runtime.providerAttempts.get(operation), 2);
    assert.equal(runtime.providerMutations.get(operation), 1);
    assert.equal(runtime.receiptAttempts.get(operation), 2);
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});
