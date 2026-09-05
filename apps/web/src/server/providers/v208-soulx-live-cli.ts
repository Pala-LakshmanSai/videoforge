import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { ProvenanceReceiptSigner, type TransactionalSqlExecutor } from "@videoforge/control-plane";
import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import { createNeonExecutor, createNeonPool } from "../hosted/neon.js";
import { loadSujalRunPodApiKeyFromKeychain } from "./keychain.js";
import { assertSujalRunPodAccount } from "./runpod-account.js";
import { RunPodControlClient, RunPodDrainGuard, RunPodServerlessJobClient } from "./runpod-control.js";
import { fetchCp07Catalog, findCp07Offering } from "./runpod-echo-cp07-preflight.js";
import { runV208SoulXWithV213Transport } from "./v208-soulx-orchestrator.js";
import type { V208SoulXQualificationResult } from "./v208-soulx-qualification.js";
import { createV208SoulXReceiptVerifier, probeV208Mp4Bytes } from "./v208-soulx-receipt-verifier.js";
import {
  V213_SERVERLESS_FLEX_RATE_SOURCE,
  createV213SqlDurableStageStore,
  readEndpointBilling,
  readV213ProtectedInputs,
  v213WorkerEnvironmentSecrets,
  validateV213ProductionInputShape,
  type V213ProtectedInputs,
} from "./v213-full-live-cli.js";
import { createV208DirectWholeSpanQualificationAdapter } from "./v213-direct-qualification-materializer.js";
import type { V213DualLaneInput } from "./v213-dual-lane-live.js";
import {
  createV213RunPodDualLaneTransport,
  type V213RunPodDualLaneTransport,
} from "./v213-runpod-dual-lane-transport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
export const V208_SOULX_LIVE_CLI_CONFIRMATION = "EXECUTE_EXACT_V2_08_SOULX_QUALIFICATION";

type ProductionInput = Readonly<{
  outerStateSha256: `sha256:${string}`;
  fullLiveAuthorityId: string;
  dualLaneInput: Omit<V213DualLaneInput, "receiptSigner" | "stageAuthorityPublicKeyPem">;
}>;

function productionInput(inputs: V213ProtectedInputs): ProductionInput {
  if (inputs.request.command !== "soulx-live-qualification")
    throw new Error("V208_V213_COMMAND_INVALID");
  validateV213ProductionInputShape(inputs.request.input);
  const value = inputs.request.input as unknown as ProductionInput;
  if (!UUID.test(value.fullLiveAuthorityId) || !SHA256.test(value.outerStateSha256))
    throw new Error("V208_PRODUCTION_INPUT_INVALID");
  return value;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Loads only the consumed SoulX authority that owns the exact V2-08 resource key. */
export function createV208CleanupAttributableResource(input: {
  readonly database: TransactionalSqlExecutor;
  readonly fullLiveAuthorityId: string;
  readonly transport: Pick<V213RunPodDualLaneTransport, "cleanupAttributableResources">;
}) {
  return async (resourceKey: string): Promise<true> => {
    const match = /^v213-([A-Za-z0-9][A-Za-z0-9_.:-]{0,190})-soulx-qualification$/u.exec(resourceKey);
    if (!match) throw new Error("V208_CLEANUP_RESOURCE_KEY_INVALID");
    const result = await input.database.query<{ value: unknown }>(
      "SELECT public.videoforge_load_v213_cleanup_scope($1::uuid) value",
      [input.fullLiveAuthorityId],
    );
    const scope = object(result.rows.length === 1 ? result.rows[0]?.value : null);
    const stages = scope?.stages;
    if (
      scope?.schemaVersion !== "videoforge.v213-cleanup-scope/v1" ||
      scope.fullLiveAuthorityId !== input.fullLiveAuthorityId ||
      !Array.isArray(stages)
    )
      throw new Error("V208_CLEANUP_SCOPE_INVALID");
    const exact = stages.filter((stage) => {
      const value = object(stage);
      return value?.stage === "soulx" && value.stageAuthorityId === match[1];
    });
    if (exact.length !== 1) throw new Error("V208_CLEANUP_STAGE_SCOPE_INVALID");
    const stage = object(exact[0]);
    const operations = stage?.operations;
    if (
      !Array.isArray(operations) ||
      operations.some((operation) => {
        const value = object(operation);
        const kind = value?.kind;
        const key = value?.resourceKey;
        if (typeof key !== "string" || key.length < 1 || key.length > 512) return true;
        if (kind === "create" || kind === "readback" || kind === "delete")
          return key !== resourceKey;
        if (kind === "dispatch") return !/^v208-[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u.test(key);
        if (kind === "status" || kind === "cancel")
          return !/^sha256:[a-f0-9]{64}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}(?::-?[0-9]+)?$/u.test(
            key,
          );
        return true;
      })
    )
      throw new Error("V208_CLEANUP_OPERATION_SCOPE_INVALID");
    await input.transport.cleanupAttributableResources(exact as never);
    return true;
  };
}

export function createV208SoulXLiveComposition(input: {
  readonly protectedInputs: V213ProtectedInputs;
  readonly database?: TransactionalSqlExecutor;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly serializeEvidence?: (result: V208SoulXQualificationResult) => Promise<void>;
}) {
  const protectedInputs = input.protectedInputs;
  const production = productionInput(protectedInputs);
  if (!protectedInputs.qualification?.sourceBytes)
    throw new Error("V208_QUALIFICATION_PROTECTED_INPUT_UNAVAILABLE");
  const fetchPort = input.fetch ?? globalThis.fetch;
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const database =
    input.database ?? createNeonExecutor(createNeonPool(protectedInputs.operatorDatabaseUrl));
  const secrets = protectedInputs.productionSecrets;
  const signer = new ProvenanceReceiptSigner(
    secrets.provenanceReceiptKeyId,
    Buffer.from(secrets.provenanceReceiptHmacKeyBase64, "base64"),
  );
  const stagePrivateKey = createPrivateKey({
    key: Buffer.from(secrets.stageAuthoritySigningKeyBase64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const dualLaneInput = Object.freeze({
    ...production.dualLaneInput,
    receiptSigner: signer,
    stageAuthorityPublicKeyPem: createPublicKey(stagePrivateKey)
      .export({ type: "spki", format: "pem" })
      .toString(),
  }) as V213DualLaneInput;
  const adapter = createV208DirectWholeSpanQualificationAdapter({
    fullLiveAuthorityId: production.fullLiveAuthorityId,
    operationId: "soulx-live-qualification",
    outerStateSha256: production.outerStateSha256,
    sourceCommit: dualLaneInput.soulx.sourceCommit,
    sourceRefs: dualLaneInput.qualificationSourceRefs,
    protectedInputDescriptors: dualLaneInput.qualificationProtectedInputDescriptors,
    protectedSourceBytes: protectedInputs.qualification.sourceBytes,
    r2: protectedInputs.qualification.r2,
    signing: {
      secretHex: secrets.pairEnvelopeSigningKeyHex,
      keyId: secrets.pairEnvelopeSigningKeyId,
    },
    database,
    fetch: fetchPort,
    now,
  });
  const durable = createV213SqlDurableStageStore({
    database,
    fullLiveAuthorityId: production.fullLiveAuthorityId,
    signingKey: Buffer.from(secrets.stageAuthoritySigningKeyBase64, "base64"),
  });
  const control = new RunPodControlClient({ apiKey: protectedInputs.runpodApiKey });
  const transport = createV213RunPodDualLaneTransport({
    durable,
    input: dualLaneInput,
    workerEnvironment: v213WorkerEnvironmentSecrets(secrets),
    control,
    accountPreflight: () => assertSujalRunPodAccount(protectedInputs.runpodApiKey),
    readAdmissionFacts: async () => {
      const candidates = await fetchCp07Catalog(protectedInputs.runpodApiKey, fetchPort);
      const exact = findCp07Offering(candidates, "NVIDIA GeForce RTX 4090", "EU-RO-1");
      if (!exact) throw new Error("V208_RUNPOD_EXACT_OFFERING_UNAVAILABLE");
      return {
        checkedAt: now().toISOString(),
        availability: exact.availability,
        flexRateUsdPerGpuHour: V213_SERVERLESS_FLEX_RATE_SOURCE.rateUsdPerGpuHour,
        cumulativeBillingUsd: await readEndpointBilling(protectedInputs.runpodApiKey, fetchPort),
      };
    },
    createJobClient: (endpointId) =>
      new RunPodServerlessJobClient({
        apiKey: protectedInputs.runpodApiKey,
        endpointId,
        guard: new RunPodDrainGuard(),
      }),
    materializeQualificationCase: adapter.materializeQualificationCase,
    sleep,
    now,
  });
  return Object.freeze({
    dependencies: Object.freeze({
      transport,
      soulx: dualLaneInput.soulx,
      materializeWholeSpan: adapter.materializeWholeSpan,
      verifySuccess: createV208SoulXReceiptVerifier({
        signer,
        readOutput: adapter.readOutput,
        probeMp4: probeV208Mp4Bytes,
      }),
      cleanupOutputKeys: adapter.cleanupOutputKeys,
      cleanupMaterializedInputs: adapter.cleanupMaterializedInputs,
      cleanupAmbiguousMaterializedInputs: adapter.cleanupAmbiguousMaterializedInputs,
      reconstructDeterministicQualificationKeys:
        adapter.reconstructDeterministicQualificationKeys,
      cleanupDeterministicQualificationKeys: adapter.cleanupDeterministicQualificationKeys,
      cleanupAttributableResource: createV208CleanupAttributableResource({
        database,
        fullLiveAuthorityId: production.fullLiveAuthorityId,
        transport,
      }),
      serializeEvidence: async (result: V208SoulXQualificationResult) => {
        await input.serializeEvidence?.(result);
      },
      minimumStableReadSpacingMs: dualLaneInput.minimumStableReadSpacingMs,
      maxStatusReads: dualLaneInput.maxStatusReads,
      pollIntervalMs: dualLaneInput.pollIntervalMs,
    }),
  });
}

function readFd(value: string | undefined, code: string): Buffer {
  if (!/^[0-9]{1,3}$/u.test(value ?? "")) throw new Error(code);
  const fd = Number(value);
  if (!Number.isSafeInteger(fd) || fd < 3 || fd > 255) throw new Error(code);
  const bytes = readFileSync(fd);
  if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024 || bytes.includes(0))
    throw new Error(code);
  return bytes;
}

export async function runV208SoulXLiveCli(
  environment: NodeJS.ProcessEnv = process.env,
  ports: Readonly<{
    loadRunPodKey?: () => Promise<string>;
    readInputs?: (environment: NodeJS.ProcessEnv, runpodKey: string) => V213ProtectedInputs;
    createComposition?: typeof createV208SoulXLiveComposition;
    writeOutput?: (value: string) => void;
  }> = {},
) {
  const key = await (ports.loadRunPodKey ?? loadSujalRunPodApiKeyFromKeychain)();
  const inputs = (ports.readInputs ?? ((source, runpodKey) =>
    readV213ProtectedInputs(
      source,
      (value, code) => (code === "RUNPOD_KEY_FD_INVALID" ? runpodKey : readFd(value, code).toString("utf8")),
      (value, code) => Uint8Array.from(readFd(value, code)),
    )))(environment, key);
  const composition = (ports.createComposition ?? createV208SoulXLiveComposition)({
    protectedInputs: inputs,
  });
  const result = await runV208SoulXWithV213Transport(composition.dependencies, environment);
  (ports.writeOutput ?? ((value) => process.stdout.write(`${value}\n`)))(
    canonicalizeJson(result as unknown as JsonValue),
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== V208_SOULX_LIVE_CLI_CONFIRMATION)
    throw new Error("V208_CLI_CONFIRMATION_REQUIRED");
  await runV208SoulXLiveCli();
}
