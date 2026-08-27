import { createHash, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ProvenanceReceiptSigner, type TransactionalSqlExecutor } from "@videoforge/control-plane";
import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import type { HostedWorkflowBinding } from "../hosted/configuration.js";
import { createNeonExecutor, createNeonPool } from "../hosted/neon.js";
import {
  createV213AcceptanceBridgeHandlers,
  createV213SqlBridgeCallLoader,
  v213EvidenceKeyId,
  type V213DatabaseOwnedAcceptanceCall,
} from "../hosted/v213-live-production-adapters.js";
import { assertSujalRunPodAccount } from "./runpod-account.js";
import {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
} from "./runpod-control.js";
import {
  createV213Max1Deployments,
  issueV213StageAuthority,
  readV213DualLaneAdmission,
  runV213MageQualification,
  runV213SoulXQualification,
} from "./v213-dual-lane-live.js";
import type {
  V213AdmissionHandoff,
  V213DualLaneInput,
  V213LaneDeployment,
  V213MageQualificationHandoff,
  V213SoulXQualificationHandoff,
} from "./v213-dual-lane-live.js";
import { fetchCp07Catalog } from "./runpod-echo-cp07-preflight.js";
import {
  createV213RunPodDualLaneTransport,
  type V213AttributableCleanupResult,
  type V213RunPodDualLaneTransport,
} from "./v213-runpod-dual-lane-transport.js";
import {
  awaitV209TerminalAcceptance,
  commitAndScheduleV209ShortPair,
} from "../hosted/hosted-pair-live-wiring.js";
import {
  executeV210LivePilot,
  executeV211LiveConcurrency,
  executeV212LiveProductionLength,
  executeV213FinalLiveAcceptance,
} from "../runtime/v213-live-acceptance.js";

const CONFIRMATION = "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND";
const PREFIX = "VIDEOFORGE_V213_BRIDGE_";
const MAX_PROTECTED_BYTES = 2 * 1024 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u;
const OPERATOR_DATABASE_ROLE = "videoforge_hosted_operator";

// RunPod's CP-07 catalog lookup is still authoritative for exact 4090 EU-RO-1 availability,
// but its `price.secure` field is a Secure Pod price rather than Serverless Flex billing. Keep the
// current official Serverless Flex snapshot explicit and semantically separate from that lookup.
export const V213_SERVERLESS_FLEX_RATE_SOURCE = Object.freeze({
  provider: "RunPod",
  product: "SERVERLESS_FLEX",
  gpu: "NVIDIA GeForce RTX 4090",
  region: "EU-RO-1",
  billingUnit: "USD_PER_GPU_SECOND",
  rateUsdPerSecond: 0.00031,
  rateUsdPerGpuHour: 1.116,
  source: "OFFICIAL_CURRENT_RUNPOD_SERVERLESS_FLEX_PRICING_SNAPSHOT",
} as const);

export function summarizeV213EndpointRestoration(result: V213AttributableCleanupResult): JsonValue {
  return {
    restored: true,
    bothEndpointsMaxWorkersOne: result.production.length === 2,
    retainedProductionEndpoints: result.production.length,
    deletedEndpointIdSha256s: [...result.deletedEndpointIdSha256s],
    deletedTemplateIdSha256s: [...result.deletedTemplateIdSha256s],
  };
}

export const V213_FULL_LIVE_COMMANDS = Object.freeze([
  "fresh-live-preflight",
  "mage-live-qualification",
  "soulx-live-qualification",
  "create-exact-max-one-endpoints",
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
] as const);

export const V213_FULL_LIVE_PRODUCTION_GAPS = Object.freeze([] as const);

const WORKFLOW_ROUTE_SOURCE = new URL("../hosted/v213-operator-workflow.ts", import.meta.url);
const WORKFLOW_ROUTE_NEEDLES = Object.freeze([
  "export async function handleV213OperatorWorkflowStart(",
  'const base = "/api/operator/v2-13/pair-workflows";',
  '"videoforge.v213-pair-workflow-start/v1"',
  '"videoforge.v213-pair-workflow-start-result/v1"',
  'request.headers.get("x-videoforge-signature")',
  "videoforge_claim_v213_workflow_start",
  "videoforge_complete_v213_workflow_start",
]);

export function verifyV213WorkflowOperatorRouteSource(readSource?: () => string): boolean {
  try {
    const source = readSource
      ? readSource()
      : (() => {
          for (const candidate of [
            WORKFLOW_ROUTE_SOURCE,
            resolve(process.cwd(), "src/server/hosted/v213-operator-workflow.ts"),
            resolve(process.cwd(), "apps/web/src/server/hosted/v213-operator-workflow.ts"),
          ]) {
            try {
              return readFileSync(candidate, "utf8");
            } catch {
              // Try the next exact repository/source-relative location.
            }
          }
          throw new Error("route source unavailable");
        })();
    return WORKFLOW_ROUTE_NEEDLES.every((needle) => source.includes(needle));
  } catch {
    return false;
  }
}

export type V213FullLiveCommand = (typeof V213_FULL_LIVE_COMMANDS)[number];

const COMMANDS = new Set<string>(V213_FULL_LIVE_COMMANDS);
const CLEANUP_COMMANDS = new Set<V213FullLiveCommand>([
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
]);

export class V213FullLiveBridgeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V213FullLiveBridgeError";
  }
}

export interface V213FullLiveCommandRequest {
  readonly schemaVersion: "videoforge.v213-full-live-command/v1";
  readonly commandId: string;
  readonly stageAuthorityId: string;
  readonly command: V213FullLiveCommand;
  readonly input: JsonValue;
}

export interface V213FullLiveCommandResult {
  readonly schemaVersion: "videoforge.v213-full-live-command-result/v1";
  readonly commandId: string;
  readonly command: V213FullLiveCommand;
  readonly state: "TERMINAL";
  readonly evidenceSha256: `sha256:${string}`;
  readonly summary: JsonValue;
}

export interface V213FullLiveJournal {
  claim(input: {
    readonly operationId: string;
    readonly stageAuthorityId: string;
    readonly kind: "create" | "readback" | "dispatch" | "status" | "cancel" | "delete";
    readonly requestSha256: `sha256:${string}`;
    readonly resourceKey: string;
  }): Promise<
    | { readonly action: "EXECUTE" }
    | { readonly action: "RECONCILE" }
    | { readonly action: "DONE"; readonly result: V213FullLiveCommandResult }
  >;
  ambiguous(operationId: string): Promise<void>;
  complete(operationId: string, result: V213FullLiveCommandResult): Promise<void>;
}

export type V213FullLiveCommandHandler = (
  request: V213FullLiveCommandRequest,
) => Promise<
  Readonly<{ readonly evidenceSha256: `sha256:${string}`; readonly summary: JsonValue }>
>;

export type V213FullLiveCommandHandlers = Readonly<
  Record<V213FullLiveCommand, V213FullLiveCommandHandler>
>;

export interface V213FullLiveBridgeRuntime {
  readonly journal: V213FullLiveJournal;
  readonly handlers: V213FullLiveCommandHandlers;
  /** Exact protected values are scrubbed even if a handler places one under an innocuous key. */
  readonly protectedValues: readonly string[];
}

type QualificationCommand =
  | "fresh-live-preflight"
  | "mage-live-qualification"
  | "soulx-live-qualification"
  | "create-exact-max-one-endpoints";
type CleanupCommand =
  | "restore-endpoints-max-one"
  | "prove-zero-workers"
  | "read-settled-billing"
  | "reconcile-exact-resources";

/** Closed production catalog. Inputs are concrete production primitives, never result fixtures:
 * staged qualification owns RunPod/0045, V2-09 owns atomic pair+Workflow, acceptance owns the
 * DB-loaded production factory, and cleanup owns exact control/readback ports. */
export function createV213FullLiveProductionRuntime(input: {
  readonly journal: V213FullLiveJournal;
  readonly protectedValues: readonly string[];
  readonly qualification: Readonly<Record<QualificationCommand, V213FullLiveCommandHandler>>;
  readonly v209: V213FullLiveCommandHandler;
  readonly acceptanceFactory: Parameters<typeof createV213AcceptanceBridgeHandlers>[0]["factory"];
  readonly loadDatabaseAcceptanceCall: (
    request: V213FullLiveCommandRequest,
  ) => Promise<V213DatabaseOwnedAcceptanceCall>;
  readonly cleanup: Readonly<Record<CleanupCommand, V213FullLiveCommandHandler>>;
}): V213FullLiveBridgeRuntime {
  const acceptance = createV213AcceptanceBridgeHandlers({
    factory: input.acceptanceFactory,
    loadDatabaseCall: input.loadDatabaseAcceptanceCall,
  });
  const handlers = Object.freeze({
    ...input.qualification,
    "v2-09-short-hosted-project": input.v209,
    ...acceptance,
    ...input.cleanup,
  }) as V213FullLiveCommandHandlers;
  for (const command of V213_FULL_LIVE_COMMANDS)
    if (typeof handlers[command] !== "function") fail("PRODUCTION_HANDLER_CATALOG_INCOMPLETE");
  return Object.freeze({
    journal: input.journal,
    handlers,
    protectedValues: Object.freeze([...input.protectedValues]),
  });
}

export interface V213ProtectedInputs {
  readonly request: V213FullLiveCommandRequest;
  readonly runpodApiKey: string;
  readonly operatorDatabaseUrl: string;
  readonly runtimeDatabaseUrl: string;
  readonly reconcilerDatabaseUrl: string;
  readonly workerOrigin: string;
  readonly workerOperatorBearer: string;
  readonly productionSecrets: V213ProductionSecrets;
  readonly productionSecretsRaw: string;
}

/**
 * The only protected inputs that may cross the prequalification boundary.  The database
 * bootstrap creates the operator role before the runtime and reconciler roles exist, so the
 * read-only admission bridge deliberately has no fields for those DSNs, Worker credentials, or
 * production secret material.  Keeping this as a separate type also prevents a caller from
 * accidentally constructing the full runtime for fresh-live-preflight.
 */
export interface V213PrequalificationProtectedInputs {
  readonly request: V213FullLiveCommandRequest;
  readonly runpodApiKey: string;
  readonly operatorDatabaseUrl: string;
}

export interface V213CleanupProtectedInputs {
  readonly request: V213FullLiveCommandRequest;
  readonly runpodApiKey: string;
  readonly operatorDatabaseUrl: string;
  readonly cleanupInput: V213CleanupInput;
}

export const V213_EARLY_CLEANUP_INPUT_SCHEMA =
  "videoforge.v213-full-live-early-cleanup-input/v1" as const;

/**
 * The first cleanup branch is entered when the owner/operator bootstrap has not settled.  It
 * intentionally carries only the command request and RunPod key: there is no database principal,
 * cleanup descriptor, production secret, or database-cleanup claim available at this boundary.
 */
export interface V213EarlyCleanupProtectedInputs {
  readonly request: V213FullLiveCommandRequest;
  readonly runpodApiKey: string;
  readonly earlyCleanupInput: {
    readonly schemaVersion: typeof V213_EARLY_CLEANUP_INPUT_SCHEMA;
    readonly fullLiveAuthorityId: string;
  };
}

interface V213CleanupInput {
  readonly schemaVersion: "videoforge.v213-full-live-cleanup-input/v1";
  readonly fullLiveAuthorityId: string;
  readonly billingBaselineMode: "PRIOR_FRESH_PREFLIGHT" | "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION";
  readonly billingBaselineUsd: number | null;
  readonly totalCapUsd: 17.5;
  readonly retainedLanes: readonly Readonly<{
    lane: "mage" | "soulx";
    volumeIdSha256: `sha256:${string}`;
    volumeManifestSha256: `sha256:${string}`;
  }>[];
}

export interface V213ProductionSecrets {
  readonly schemaVersion:
    | "videoforge.v213-full-live-pre-endpoint-secrets/v1"
    | "videoforge.v213-full-live-production-secrets/v1";
  readonly stageAuthoritySigningKeyBase64: string;
  readonly provenanceReceiptHmacKeyBase64: string;
  readonly provenanceReceiptKeyId: string;
  readonly acceptanceEvidenceSigningKeyBase64: string;
  readonly pairDispatchTokenKeyBase64: string;
  readonly pairDispatchTokenKeyId: string;
  readonly pairEnvelopeSigningKeyHex: string;
  readonly pairEnvelopeSigningKeyId: string;
  readonly pairProviderProofKeyHex: string;
  readonly pairProviderProofKeyId: string;
  readonly mageEndpointId?: string;
  readonly soulxEndpointId?: string;
}

export const V213_BRIDGE_ENVIRONMENT = Object.freeze({
  command: `${PREFIX}COMMAND`,
  requestFd: `${PREFIX}REQUEST_FD`,
  runpodApiKeyFd: `${PREFIX}RUNPOD_API_KEY_FD`,
  operatorDatabaseUrlFd: `${PREFIX}OPERATOR_DATABASE_URL_FD`,
  runtimeDatabaseUrlFd: `${PREFIX}RUNTIME_DATABASE_URL_FD`,
  reconcilerDatabaseUrlFd: `${PREFIX}RECONCILER_DATABASE_URL_FD`,
  workerOriginFd: `${PREFIX}WORKER_ORIGIN_FD`,
  workerOperatorBearerFd: `${PREFIX}WORKER_OPERATOR_BEARER_FD`,
  productionSecretsFd: `${PREFIX}PRODUCTION_SECRETS_FD`,
} as const);

const ALLOWED_ENVIRONMENT = new Set<string>(Object.values(V213_BRIDGE_ENVIRONMENT));
const CLEANUP_ALLOWED_ENVIRONMENT = new Set<string>([
  V213_BRIDGE_ENVIRONMENT.command,
  V213_BRIDGE_ENVIRONMENT.requestFd,
  V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd,
  V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd,
]);
const PREQUALIFICATION_ALLOWED_ENVIRONMENT = new Set<string>([
  V213_BRIDGE_ENVIRONMENT.command,
  V213_BRIDGE_ENVIRONMENT.requestFd,
  V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd,
  V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd,
]);
const EARLY_CLEANUP_ALLOWED_ENVIRONMENT = new Set<string>([
  V213_BRIDGE_ENVIRONMENT.command,
  V213_BRIDGE_ENVIRONMENT.requestFd,
  V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd,
]);

function fail(code: string): never {
  throw new V213FullLiveBridgeError(code);
}

function sha256(value: JsonValue): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}`;
}

function deterministicUuid(value: string): string {
  const hex = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactRequest(value: unknown): V213FullLiveCommandRequest {
  const item = object(value);
  if (
    item?.schemaVersion !== "videoforge.v213-full-live-command/v1" ||
    typeof item.commandId !== "string" ||
    !COMMAND_ID.test(item.commandId) ||
    typeof item.stageAuthorityId !== "string" ||
    !COMMAND_ID.test(item.stageAuthorityId) ||
    typeof item.command !== "string" ||
    !COMMANDS.has(item.command) ||
    !("input" in item) ||
    Object.keys(item).sort().join(",") !== "command,commandId,input,schemaVersion,stageAuthorityId"
  )
    fail("REQUEST_INVALID");
  return value as V213FullLiveCommandRequest;
}

function readProtectedFd(value: string | undefined, code: string): string {
  if (!/^[0-9]{1,3}$/u.test(value ?? "")) fail(code);
  const fd = Number(value);
  if (!Number.isSafeInteger(fd) || fd < 3 || fd > 255) fail(code);
  let bytes: Buffer;
  try {
    bytes = readFileSync(fd);
  } catch {
    fail(code);
  }
  if (bytes.length === 0 || bytes.length > MAX_PROTECTED_BYTES || bytes.includes(0)) fail(code);
  return bytes.toString("utf8");
}

function operatorDatabaseUrlSha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/**
 * Parse the only database URL allowed across a cleanup/prequalification process boundary. The
 * URL is deliberately checked here, before a pool/client can be constructed: a postgres-looking
 * string is not enough because a runtime/reconciler principal, an unencrypted connection, or a
 * different host/database would widen the cleanup authority. The returned fingerprint is the
 * exact protected-file byte identity and is safe to carry as evidence.
 */
function exactOperatorDatabaseUrl(
  value: string,
  expected: Readonly<{
    host?: string;
    database?: string;
    sha256?: string;
  }> = {},
): Readonly<{ url: string; host: string; database: string; sha256: `sha256:${string}` }> {
  if (value.trim() !== value || value.length === 0 || value.includes("\0"))
    fail("OPERATOR_DATABASE_URL_INVALID");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("OPERATOR_DATABASE_URL_INVALID");
  }
  const sslModes = parsed.searchParams.getAll("sslmode");
  const channelBindings = parsed.searchParams.getAll("channel_binding");
  let username: string;
  let database: string;
  try {
    username = decodeURIComponent(parsed.username);
    database = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    fail("OPERATOR_DATABASE_URL_INVALID");
  }
  const fingerprint = operatorDatabaseUrlSha256(value);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname === "" ||
    parsed.port !== "" ||
    username !== OPERATOR_DATABASE_ROLE ||
    parsed.password === "" ||
    parsed.hash !== "" ||
    parsed.pathname === "/" ||
    database === "" ||
    database.includes("/") ||
    parsed.searchParams.size !== 2 ||
    sslModes.length !== 1 ||
    sslModes[0] !== "require" ||
    channelBindings.length !== 1 ||
    channelBindings[0] !== "require" ||
    (expected.host !== undefined && parsed.hostname !== expected.host) ||
    (expected.database !== undefined && database !== expected.database) ||
    (expected.sha256 !== undefined && fingerprint !== expected.sha256)
  )
    fail("OPERATOR_DATABASE_URL_BINDING");
  return Object.freeze({ url: value, host: parsed.hostname, database, sha256: fingerprint });
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function productionSecrets(
  raw: string,
  endpointMode: "pre-endpoint" | "final" | "either",
): V213ProductionSecrets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("PRODUCTION_SECRETS_JSON_INVALID");
  }
  const value = object(parsed);
  if (value === null) fail("PRODUCTION_SECRETS_INVALID");
  const baseKeys = [
    "acceptanceEvidenceSigningKeyBase64",
    "pairDispatchTokenKeyBase64",
    "pairDispatchTokenKeyId",
    "pairEnvelopeSigningKeyHex",
    "pairEnvelopeSigningKeyId",
    "pairProviderProofKeyHex",
    "pairProviderProofKeyId",
    "provenanceReceiptHmacKeyBase64",
    "provenanceReceiptKeyId",
    "schemaVersion",
    "stageAuthoritySigningKeyBase64",
  ];
  const hasEndpoints = value?.schemaVersion === "videoforge.v213-full-live-production-secrets/v1";
  const keys = hasEndpoints ? [...baseKeys, "mageEndpointId", "soulxEndpointId"].sort() : baseKeys;
  if (
    ![
      "videoforge.v213-full-live-pre-endpoint-secrets/v1",
      "videoforge.v213-full-live-production-secrets/v1",
    ].includes(value?.schemaVersion as string) ||
    (endpointMode === "pre-endpoint" && hasEndpoints) ||
    (endpointMode === "final" && !hasEndpoints) ||
    Object.keys(value).sort().join(",") !== keys.join(",") ||
    typeof value.stageAuthoritySigningKeyBase64 !== "string" ||
    typeof value.provenanceReceiptHmacKeyBase64 !== "string" ||
    typeof value.acceptanceEvidenceSigningKeyBase64 !== "string" ||
    typeof value.pairDispatchTokenKeyBase64 !== "string" ||
    typeof value.pairDispatchTokenKeyId !== "string" ||
    typeof value.pairEnvelopeSigningKeyHex !== "string" ||
    typeof value.pairEnvelopeSigningKeyId !== "string" ||
    typeof value.pairProviderProofKeyHex !== "string" ||
    typeof value.pairProviderProofKeyId !== "string" ||
    typeof value.provenanceReceiptKeyId !== "string" ||
    ![
      value.provenanceReceiptKeyId,
      value.pairDispatchTokenKeyId,
      value.pairEnvelopeSigningKeyId,
      value.pairProviderProofKeyId,
    ].every((item) => COMMAND_ID.test(item)) ||
    new Set([
      value.provenanceReceiptKeyId,
      value.pairDispatchTokenKeyId,
      value.pairEnvelopeSigningKeyId,
      value.pairProviderProofKeyId,
    ]).size !== 4 ||
    (hasEndpoints &&
      (!ENDPOINT_ID.test(value.mageEndpointId as string) ||
        !ENDPOINT_ID.test(value.soulxEndpointId as string) ||
        value.mageEndpointId === value.soulxEndpointId)) ||
    !/^(?:[0-9a-f]{2}){32,}$/u.test(value.pairEnvelopeSigningKeyHex) ||
    !/^(?:[0-9a-f]{2}){32,}$/u.test(value.pairProviderProofKeyHex)
  )
    fail("PRODUCTION_SECRETS_INVALID");
  const encoded = [
    value.stageAuthoritySigningKeyBase64,
    value.provenanceReceiptHmacKeyBase64,
    value.acceptanceEvidenceSigningKeyBase64,
    value.pairDispatchTokenKeyBase64,
  ];
  const decoded = encoded.map((item) => {
    if (!BASE64.test(item)) fail("PRODUCTION_SECRETS_INVALID");
    const bytes = Buffer.from(item, "base64");
    if (bytes.length < 32 || bytes.toString("base64") !== item) fail("PRODUCTION_SECRETS_INVALID");
    return bytes;
  });
  const allKeyBytes = [
    ...decoded,
    Buffer.from(value.pairEnvelopeSigningKeyHex as string, "hex"),
    Buffer.from(value.pairProviderProofKeyHex as string, "hex"),
  ];
  if (
    new Set(allKeyBytes.map((bytes) => createHash("sha256").update(bytes).digest("hex"))).size !==
    allKeyBytes.length
  )
    fail("PRODUCTION_SECRET_REUSE_FORBIDDEN");
  return Object.freeze(value as unknown as V213ProductionSecrets);
}

export function readV213ProtectedInputs(
  environment: NodeJS.ProcessEnv,
  readFd: (value: string | undefined, code: string) => string = readProtectedFd,
): V213ProtectedInputs {
  const extras = Object.keys(environment).filter(
    (name) => name.startsWith(PREFIX) && !ALLOWED_ENVIRONMENT.has(name),
  );
  if (extras.length > 0) fail("AMBIENT_BINDING_REJECTED");
  const command = environment[V213_BRIDGE_ENVIRONMENT.command];
  if (!COMMANDS.has(command ?? "")) fail("COMMAND_INVALID");
  if (command === "fresh-live-preflight") fail("PREQUALIFICATION_INPUTS_REQUIRED");
  let request: V213FullLiveCommandRequest;
  try {
    request = exactRequest(
      JSON.parse(readFd(environment[V213_BRIDGE_ENVIRONMENT.requestFd], "REQUEST_FD_INVALID")),
    );
  } catch (error) {
    if (error instanceof V213FullLiveBridgeError) throw error;
    fail("REQUEST_JSON_INVALID");
  }
  if (request.command !== command) fail("COMMAND_MISMATCH");
  const runpodApiKey = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd],
    "RUNPOD_KEY_FD_INVALID",
  );
  const runtimeDatabaseUrl = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.runtimeDatabaseUrlFd],
    "RUNTIME_DATABASE_FD_INVALID",
  );
  const reconcilerDatabaseUrl = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.reconcilerDatabaseUrlFd],
    "RECONCILER_DATABASE_FD_INVALID",
  );
  const operatorDatabaseUrl = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd],
    "OPERATOR_DATABASE_FD_INVALID",
  );
  const workerOrigin = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.workerOriginFd],
    "WORKER_ORIGIN_FD_INVALID",
  );
  const workerOperatorBearer = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.workerOperatorBearerFd],
    "WORKER_OPERATOR_BEARER_FD_INVALID",
  );
  const productionSecretsRaw = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.productionSecretsFd],
    "PRODUCTION_SECRETS_FD_INVALID",
  );
  const secrets = productionSecrets(
    productionSecretsRaw,
    CLEANUP_COMMANDS.has(command) ? "either" : command.startsWith("v2-") ? "final" : "pre-endpoint",
  );
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(workerOrigin);
  } catch {
    fail("WORKER_ORIGIN_INVALID");
  }
  if (
    runpodApiKey.trim() !== runpodApiKey ||
    runpodApiKey.length < 20 ||
    operatorDatabaseUrl.trim() !== operatorDatabaseUrl ||
    runtimeDatabaseUrl.trim() !== runtimeDatabaseUrl ||
    reconcilerDatabaseUrl.trim() !== reconcilerDatabaseUrl ||
    !operatorDatabaseUrl.startsWith("postgres") ||
    !runtimeDatabaseUrl.startsWith("postgres") ||
    !reconcilerDatabaseUrl.startsWith("postgres") ||
    new Set([operatorDatabaseUrl, runtimeDatabaseUrl, reconcilerDatabaseUrl]).size !== 3 ||
    workerOrigin.trim() !== workerOrigin ||
    parsedOrigin.protocol !== "https:" ||
    parsedOrigin.origin !== workerOrigin ||
    parsedOrigin.username !== "" ||
    parsedOrigin.password !== "" ||
    workerOperatorBearer.trim() !== workerOperatorBearer ||
    workerOperatorBearer.length < 32
  )
    fail("PROTECTED_INPUT_INVALID");
  return Object.freeze({
    request,
    runpodApiKey,
    operatorDatabaseUrl,
    runtimeDatabaseUrl,
    reconcilerDatabaseUrl,
    workerOrigin,
    workerOperatorBearer,
    productionSecrets: secrets,
    productionSecretsRaw,
  });
}

/**
 * Read the deliberately smaller protected-input surface used by fresh-live-preflight.  This
 * command runs after the owner-only database bootstrap and before guarded activation has created
 * the runtime/reconciler roles or materialized production secrets.  Rejecting those bindings at
 * the process boundary makes accidental FD inheritance observable instead of silently widening
 * the prequalification authority.
 */
export function readV213PrequalificationProtectedInputs(
  environment: NodeJS.ProcessEnv,
  readFd: (value: string | undefined, code: string) => string = readProtectedFd,
): V213PrequalificationProtectedInputs {
  const extras = Object.keys(environment).filter(
    (name) => name.startsWith(PREFIX) && !PREQUALIFICATION_ALLOWED_ENVIRONMENT.has(name),
  );
  if (extras.length > 0) fail("PREQUALIFICATION_AMBIENT_BINDING_REJECTED");
  const command = environment[V213_BRIDGE_ENVIRONMENT.command];
  if (command !== "fresh-live-preflight") fail("PREQUALIFICATION_COMMAND_INVALID");
  let request: V213FullLiveCommandRequest;
  try {
    request = exactRequest(
      JSON.parse(readFd(environment[V213_BRIDGE_ENVIRONMENT.requestFd], "REQUEST_FD_INVALID")),
    );
  } catch (error) {
    if (error instanceof V213FullLiveBridgeError) throw error;
    fail("REQUEST_JSON_INVALID");
  }
  if (request.command !== command) fail("COMMAND_MISMATCH");
  const runpodApiKey = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd],
    "RUNPOD_KEY_FD_INVALID",
  );
  const operatorDatabaseUrl = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd],
    "OPERATOR_DATABASE_FD_INVALID",
  );
  if (runpodApiKey.trim() !== runpodApiKey || runpodApiKey.length < 20)
    fail("PREQUALIFICATION_PROTECTED_INPUT_INVALID");
  try {
    exactOperatorDatabaseUrl(operatorDatabaseUrl);
  } catch (error) {
    if (error instanceof V213FullLiveBridgeError) {
      if (error.code === "OPERATOR_DATABASE_URL_INVALID")
        fail("PREQUALIFICATION_OPERATOR_DATABASE_INVALID");
      if (error.code === "OPERATOR_DATABASE_URL_BINDING")
        fail("PREQUALIFICATION_OPERATOR_DATABASE_INVALID");
    }
    throw error;
  }
  return Object.freeze({ request, runpodApiKey, operatorDatabaseUrl });
}

function exactCleanupInput(value: unknown): V213CleanupInput {
  const item = object(value);
  const lanes = Array.isArray(item?.retainedLanes) ? item.retainedLanes : [];
  if (
    item?.schemaVersion !== "videoforge.v213-full-live-cleanup-input/v1" ||
    typeof item.fullLiveAuthorityId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      item.fullLiveAuthorityId,
    ) ||
    !["PRIOR_FRESH_PREFLIGHT", "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION"].includes(
      item.billingBaselineMode as string,
    ) ||
    (item.billingBaselineMode === "PRIOR_FRESH_PREFLIGHT" &&
      (typeof item.billingBaselineUsd !== "number" ||
        !Number.isFinite(item.billingBaselineUsd) ||
        item.billingBaselineUsd < 0)) ||
    (item.billingBaselineMode === "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION" &&
      item.billingBaselineUsd !== null) ||
    item.totalCapUsd !== 17.5 ||
    lanes.length !== 2 ||
    lanes.some((value) => {
      const lane = object(value);
      return (
        !lane ||
        !["mage", "soulx"].includes(lane.lane as string) ||
        typeof lane.volumeIdSha256 !== "string" ||
        !SHA256.test(lane.volumeIdSha256) ||
        typeof lane.volumeManifestSha256 !== "string" ||
        !SHA256.test(lane.volumeManifestSha256) ||
        Object.keys(lane).sort().join(",") !== "lane,volumeIdSha256,volumeManifestSha256"
      );
    }) ||
    new Set(lanes.map((value) => object(value)?.lane)).size !== 2 ||
    Object.keys(item).sort().join(",") !==
      "billingBaselineMode,billingBaselineUsd,fullLiveAuthorityId,retainedLanes,schemaVersion,totalCapUsd"
  )
    fail("CLEANUP_INPUT_INVALID");
  return value as V213CleanupInput;
}

export function readV213CleanupProtectedInputs(
  environment: NodeJS.ProcessEnv,
  readFd: (value: string | undefined, code: string) => string = readProtectedFd,
): V213CleanupProtectedInputs {
  const keys = Object.keys(environment).filter((key) => key.startsWith(PREFIX));
  if (
    keys.length !== CLEANUP_ALLOWED_ENVIRONMENT.size ||
    keys.some((key) => !CLEANUP_ALLOWED_ENVIRONMENT.has(key))
  )
    fail("CLEANUP_AMBIENT_BINDING_REJECTED");
  const command = environment[V213_BRIDGE_ENVIRONMENT.command];
  if (!CLEANUP_COMMANDS.has(command as V213FullLiveCommand)) fail("CLEANUP_COMMAND_INVALID");
  let request: V213FullLiveCommandRequest;
  try {
    request = exactRequest(
      JSON.parse(readFd(environment[V213_BRIDGE_ENVIRONMENT.requestFd], "REQUEST_FD_INVALID")),
    );
  } catch (error) {
    if (error instanceof V213FullLiveBridgeError) throw error;
    fail("REQUEST_JSON_INVALID");
  }
  if (request.command !== command) fail("COMMAND_MISMATCH");
  const cleanupInput = exactCleanupInput(request.input);
  if (cleanupInput.fullLiveAuthorityId !== request.stageAuthorityId)
    fail("CLEANUP_AUTHORITY_DRIFT");
  const runpodApiKey = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd],
    "RUNPOD_KEY_FD_INVALID",
  );
  const operatorDatabaseUrl = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd],
    "OPERATOR_DATABASE_FD_INVALID",
  );
  if (runpodApiKey.trim() !== runpodApiKey || runpodApiKey.length < 20)
    fail("CLEANUP_PROTECTED_INPUT_INVALID");
  try {
    exactOperatorDatabaseUrl(operatorDatabaseUrl);
  } catch (error) {
    if (error instanceof V213FullLiveBridgeError) {
      if (
        error.code === "OPERATOR_DATABASE_URL_INVALID" ||
        error.code === "OPERATOR_DATABASE_URL_BINDING"
      )
        fail("CLEANUP_OPERATOR_DATABASE_INVALID");
    }
    throw error;
  }
  return Object.freeze({ request, runpodApiKey, operatorDatabaseUrl, cleanupInput });
}

function exactEarlyCleanupInput(
  value: unknown,
): V213EarlyCleanupProtectedInputs["earlyCleanupInput"] {
  const item = object(value);
  if (
    item?.schemaVersion !== V213_EARLY_CLEANUP_INPUT_SCHEMA ||
    typeof item.fullLiveAuthorityId !== "string" ||
    !COMMAND_ID.test(item.fullLiveAuthorityId) ||
    Object.keys(item).sort().join(",") !== "fullLiveAuthorityId,schemaVersion"
  )
    fail("EARLY_CLEANUP_INPUT_INVALID");
  return value as V213EarlyCleanupProtectedInputs["earlyCleanupInput"];
}

export function readV213EarlyCleanupProtectedInputs(
  environment: NodeJS.ProcessEnv,
  readFd: (value: string | undefined, code: string) => string = readProtectedFd,
): V213EarlyCleanupProtectedInputs {
  const keys = Object.keys(environment).filter((key) => key.startsWith(PREFIX));
  if (
    keys.length !== EARLY_CLEANUP_ALLOWED_ENVIRONMENT.size ||
    keys.some((key) => !EARLY_CLEANUP_ALLOWED_ENVIRONMENT.has(key))
  )
    fail("EARLY_CLEANUP_AMBIENT_BINDING_REJECTED");
  const command = environment[V213_BRIDGE_ENVIRONMENT.command];
  if (!CLEANUP_COMMANDS.has(command as V213FullLiveCommand)) fail("EARLY_CLEANUP_COMMAND_INVALID");
  let request: V213FullLiveCommandRequest;
  try {
    request = exactRequest(
      JSON.parse(readFd(environment[V213_BRIDGE_ENVIRONMENT.requestFd], "REQUEST_FD_INVALID")),
    );
  } catch (error) {
    if (error instanceof V213FullLiveBridgeError) throw error;
    fail("REQUEST_JSON_INVALID");
  }
  if (request.command !== command) fail("COMMAND_MISMATCH");
  const earlyCleanupInput = exactEarlyCleanupInput(request.input);
  if (earlyCleanupInput.fullLiveAuthorityId !== request.stageAuthorityId)
    fail("EARLY_CLEANUP_AUTHORITY_DRIFT");
  const runpodApiKey = readFd(
    environment[V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd],
    "RUNPOD_KEY_FD_INVALID",
  );
  if (runpodApiKey.trim() !== runpodApiKey || runpodApiKey.length < 20)
    fail("EARLY_CLEANUP_PROTECTED_INPUT_INVALID");
  return Object.freeze({ request, runpodApiKey, earlyCleanupInput });
}

type WorkflowFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const WORKFLOW_PATH = "/api/operator/v2-13/pair-workflows";

function exactWorkflowResult(
  value: unknown,
  workflowId: string,
  requestSha256: string,
  outerStateSha256: string,
): "STARTED" | "EXISTING" {
  const result = object(value);
  if (
    result?.schemaVersion !== "videoforge.v213-pair-workflow-start-result/v1" ||
    result.workflowId !== workflowId ||
    result.requestSha256 !== requestSha256 ||
    result.outerStateSha256 !== outerStateSha256 ||
    (result.state !== "STARTED" && result.state !== "EXISTING") ||
    Object.keys(result).sort().join(",") !==
      "outerStateSha256,requestSha256,schemaVersion,state,workflowId"
  )
    fail("WORKFLOW_RESULT_INVALID");
  return result.state;
}

/** Operator-only HTTPS projection of Cloudflare's in-Worker Workflow binding. POST is one-shot;
 * any ambiguous acknowledgement is followed by one exact GET and never by a second POST. */
export function createV213WorkflowHttpBinding(input: {
  readonly origin: string;
  readonly token: string;
  readonly outerStateSha256: `sha256:${string}`;
  readonly fetch?: WorkflowFetch;
}): HostedWorkflowBinding {
  const fetchPort = input.fetch ?? fetch;
  if (!SHA256.test(input.outerStateSha256)) fail("WORKFLOW_OUTER_STATE_INVALID");
  const signature = (bytes: string) =>
    createHmac("sha256", input.token).update(bytes, "utf8").digest("hex");
  const getStatus = async (workflowId: string, requestSha256: string) => {
    const signatureBytes = `${workflowId}\n${requestSha256}\n${input.outerStateSha256}`;
    let response: Response;
    try {
      response = await fetchPort(`${input.origin}${WORKFLOW_PATH}/${workflowId}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${input.token}`,
          "x-videoforge-outer-state-sha256": input.outerStateSha256,
          "x-videoforge-request-sha256": requestSha256,
          "x-videoforge-signature": signature(signatureBytes),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      fail("WORKFLOW_READBACK_AMBIGUOUS");
    }
    if (!response.ok) fail("WORKFLOW_READBACK_FAILED");
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      fail("WORKFLOW_RESULT_INVALID");
    }
    return exactWorkflowResult(value, workflowId, requestSha256, input.outerStateSha256);
  };
  const requestHashes = new Map<string, string>();
  const completed = new Set<string>();
  return Object.freeze({
    async create(options?: { id?: string; params?: unknown }) {
      const workflowId = options?.id;
      const params = options?.params;
      if (!workflowId || !/^hosted-pair-[A-Za-z0-9][A-Za-z0-9._:-]{0,150}$/u.test(workflowId))
        fail("WORKFLOW_ID_INVALID");
      const requestSha256 = sha256({
        workflowId,
        outerStateSha256: input.outerStateSha256,
        params,
      } as JsonValue);
      const previous = requestHashes.get(workflowId);
      if (previous && previous !== requestSha256) fail("WORKFLOW_REPLAY_DRIFT");
      if (previous === requestSha256 && completed.has(workflowId))
        return Object.freeze({ id: workflowId });
      requestHashes.set(workflowId, requestSha256);
      const body = canonicalizeJson({
        schemaVersion: "videoforge.v213-pair-workflow-start/v1",
        workflowId,
        requestSha256,
        outerStateSha256: input.outerStateSha256,
        params: params as JsonValue,
      });
      try {
        const response = await fetchPort(`${input.origin}${WORKFLOW_PATH}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.token}`,
            "content-type": "application/json",
            "x-videoforge-request-sha256": requestSha256,
            "x-videoforge-signature": signature(body),
          },
          body,
          signal: AbortSignal.timeout(30_000),
        });
        if (response.status >= 400 && response.status < 500) fail("WORKFLOW_START_REJECTED");
        if (!response.ok) throw new Error("ambiguous");
        exactWorkflowResult(
          await response.json(),
          workflowId,
          requestSha256,
          input.outerStateSha256,
        );
      } catch (error) {
        if (error instanceof V213FullLiveBridgeError) throw error;
        await getStatus(workflowId, requestSha256);
      }
      completed.add(workflowId);
      return Object.freeze({ id: workflowId });
    },
    async get(workflowId: string) {
      const requestSha256 = requestHashes.get(workflowId);
      if (!requestSha256) fail("WORKFLOW_REQUEST_IDENTITY_MISSING");
      return Object.freeze({
        status: () => getStatus(workflowId, requestSha256),
        async sendEvent() {
          fail("WORKFLOW_EVENT_UNSUPPORTED");
        },
      });
    },
  });
}

const kindFor = (
  command: V213FullLiveCommand,
): "create" | "readback" | "dispatch" | "status" | "cancel" | "delete" => {
  if (command === "fresh-live-preflight" || command === "read-settled-billing") return "readback";
  if (command === "create-exact-max-one-endpoints") return "create";
  if (command === "restore-endpoints-max-one") return "cancel";
  if (command === "reconcile-exact-resources" || command === "prove-zero-workers") return "status";
  return "dispatch";
};

export async function executeV213FullLiveCommand(
  requestValue: unknown,
  runtime: V213FullLiveBridgeRuntime,
): Promise<V213FullLiveCommandResult> {
  const request = exactRequest(requestValue);
  const requestSha256 = sha256(request as unknown as JsonValue);
  const claim = await runtime.journal.claim({
    operationId: request.commandId,
    stageAuthorityId: request.stageAuthorityId,
    kind: kindFor(request.command),
    requestSha256,
    resourceKey: `v213:${request.command}:${request.commandId}`,
  });
  if (claim.action === "DONE") return claim.result;
  if (claim.action === "RECONCILE" && !CLEANUP_COMMANDS.has(request.command))
    fail("AMBIGUOUS_REDISPATCH_FORBIDDEN");
  try {
    const handled = await runtime.handlers[request.command](request);
    if (!SHA256.test(handled.evidenceSha256) || handled.summary === undefined)
      fail("HANDLER_RESULT_INVALID");
    const result = Object.freeze({
      schemaVersion: "videoforge.v213-full-live-command-result/v1" as const,
      commandId: request.commandId,
      command: request.command,
      state: "TERMINAL" as const,
      evidenceSha256: handled.evidenceSha256,
      summary: redactV213Output(handled.summary, runtime.protectedValues),
    });
    await runtime.journal.complete(request.commandId, result);
    return result;
  } catch (error) {
    if (claim.action === "EXECUTE") {
      try {
        await runtime.journal.ambiguous(request.commandId);
      } catch {
        // A transport-ambiguous transition may already be durable. Never retry the command here.
      }
    }
    if (error instanceof V213FullLiveBridgeError) throw error;
    fail("COMMAND_FAILED");
  }
}

const SECRET_KEY = /(secret|token|password|authorization|cookie|api.?key|database.?url|nonce)/iu;

export function redactV213Output(
  value: JsonValue,
  protectedValues: readonly string[] = [],
): JsonValue {
  if (Array.isArray(value)) return value.map((child) => redactV213Output(child, protectedValues));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        // Counters such as applicationSecretReads are public evidence, not secret material.  Only
        // redact a secret-shaped field when its value could actually carry protected bytes; this
        // preserves the zero-read proof needed by the early cleanup contract.
        SECRET_KEY.test(key) &&
        (typeof child === "string" || (child !== null && typeof child === "object"))
          ? "REDACTED"
          : redactV213Output(child, protectedValues),
      ]),
    ) as JsonValue;
  if (
    typeof value === "string" &&
    protectedValues.some((protectedValue) =>
      protectedValue.length >= 8 ? value.includes(protectedValue) : value === protectedValue,
    )
  )
    return "REDACTED";
  return value;
}

/** Production SQL journal backed by migration 0045. It records IN_FLIGHT before a handler can
 * touch a provider. RECONCILE is never converted into another dispatch by this bridge. */
export function createV213SqlCommandJournal(
  database: TransactionalSqlExecutor,
): V213FullLiveJournal {
  const journal: V213FullLiveJournal = {
    async claim(input: {
      readonly operationId: string;
      readonly stageAuthorityId: string;
      readonly kind: "create" | "readback" | "dispatch" | "status" | "cancel" | "delete";
      readonly requestSha256: `sha256:${string}`;
      readonly resourceKey: string;
    }) {
      const result = await database.query<{ value: unknown }>(
        "SELECT public.videoforge_claim_v213_bridge_command($1::jsonb) value",
        [
          JSON.stringify({
            operationId: input.operationId,
            stageAuthorityId: input.stageAuthorityId,
            kind: input.kind,
            requestSha256: input.requestSha256,
            resourceKey: input.resourceKey,
          }),
        ],
      );
      const value = object(result.rows[0]?.value);
      if (
        result.rows.length !== 1 ||
        !["EXECUTE", "RECONCILE", "DONE"].includes(String(value?.action))
      )
        fail("JOURNAL_CLAIM_INVALID");
      if (value?.action === "DONE") {
        const prior = object(value.result);
        if (
          prior?.schemaVersion !== "videoforge.v213-full-live-command-result/v1" ||
          prior.commandId !== input.operationId ||
          !COMMANDS.has(String(prior.command)) ||
          prior.state !== "TERMINAL" ||
          !SHA256.test(String(prior.evidenceSha256))
        )
          fail("JOURNAL_DONE_RESULT_UNAVAILABLE");
        return {
          action: "DONE" as const,
          result: prior as unknown as V213FullLiveCommandResult,
        };
      }
      return { action: value?.action as "EXECUTE" | "RECONCILE" };
    },
    async ambiguous(operationId: string) {
      await database.query("SELECT public.videoforge_transition_v213_bridge_command($1::jsonb)", [
        JSON.stringify({ operationId, to: "ACK_UNKNOWN" }),
      ]);
    },
    async complete(operationId: string, result: V213FullLiveCommandResult) {
      await database.query("SELECT public.videoforge_transition_v213_bridge_command($1::jsonb)", [
        JSON.stringify({
          operationId,
          to: "TERMINAL",
          result,
        }),
      ]);
    },
  };
  return Object.freeze(journal);
}

/** Concrete constructors used by the production composition. Creating these objects performs no
 * network request. The returned clients are the real Neon, RunPod and Cloudflare binding types. */
export function createV213ProductionPrimitives(input: {
  readonly protectedInputs: V213ProtectedInputs;
  readonly dualLaneInput: Parameters<typeof createV213RunPodDualLaneTransport>[0]["input"];
  readonly durableStageStore: Parameters<typeof createV213RunPodDualLaneTransport>[0]["durable"];
  readonly readAdmissionFacts: Parameters<
    typeof createV213RunPodDualLaneTransport
  >[0]["readAdmissionFacts"];
  readonly verifyOutputReadback: Parameters<
    typeof createV213RunPodDualLaneTransport
  >[0]["verifyOutputReadback"];
}) {
  const commandInput = object(input.protectedInputs.request.input);
  const outerStateSha256 = commandInput?.outerStateSha256;
  if (typeof outerStateSha256 !== "string" || !SHA256.test(outerStateSha256))
    fail("WORKFLOW_OUTER_STATE_INVALID");
  const runtimePool = createNeonPool(input.protectedInputs.runtimeDatabaseUrl);
  const reconcilerPool = createNeonPool(input.protectedInputs.reconcilerDatabaseUrl);
  const operatorPool = createNeonPool(input.protectedInputs.operatorDatabaseUrl);
  const runtimeDatabase = createNeonExecutor(runtimePool);
  const reconcilerDatabase = createNeonExecutor(reconcilerPool);
  const operatorDatabase = createNeonExecutor(operatorPool);
  const control = new RunPodControlClient({ apiKey: input.protectedInputs.runpodApiKey });
  const dualLaneTransport = createV213RunPodDualLaneTransport({
    durable: input.durableStageStore,
    input: input.dualLaneInput,
    control,
    accountPreflight: () => assertSujalRunPodAccount(input.protectedInputs.runpodApiKey),
    readAdmissionFacts: input.readAdmissionFacts,
    verifyOutputReadback: input.verifyOutputReadback,
    createJobClient: (endpointId) =>
      new RunPodServerlessJobClient({
        apiKey: input.protectedInputs.runpodApiKey,
        endpointId,
        guard: new RunPodDrainGuard(),
      }),
  });
  return Object.freeze({
    runtimePool,
    reconcilerPool,
    operatorPool,
    runtimeDatabase,
    reconcilerDatabase,
    operatorDatabase,
    journal: createV213SqlCommandJournal(operatorDatabase),
    control,
    accountPreflight: () => assertSujalRunPodAccount(input.protectedInputs.runpodApiKey),
    dualLaneTransport,
    pairWorkflow: createV213WorkflowHttpBinding({
      origin: input.protectedInputs.workerOrigin,
      token: input.protectedInputs.workerOperatorBearer,
      outerStateSha256: outerStateSha256 as `sha256:${string}`,
    }),
    qualificationApi: Object.freeze({
      readV213DualLaneAdmission,
      runV213MageQualification,
      runV213SoulXQualification,
      createV213Max1Deployments,
    }),
    commitAndScheduleV209ShortPair,
    acceptanceApi: Object.freeze({
      executeV210LivePilot,
      executeV211LiveConcurrency,
      executeV212LiveProductionLength,
      executeV213FinalLiveAcceptance,
    }),
  });
}

interface V213ProductionInput {
  readonly schemaVersion: "videoforge.v213-full-live-production-input/v1";
  readonly outerStateSha256: `sha256:${string}`;
  readonly fullLiveAuthorityId: string;
  readonly dualLaneInput: Omit<V213DualLaneInput, "receiptSigner">;
  readonly commandPayload: Readonly<Record<string, unknown>>;
}

function validSealedLane(value: unknown, lane: "mage" | "soulx"): boolean {
  const item = object(value);
  return Boolean(
    item &&
      Object.keys(item).sort().join(",") ===
        "deploymentSha256,lane,publicImage,receiptKeyId,sourceCommit,volumeId,volumeIdSha256,volumeManifestSha256" &&
      item.lane === lane &&
      typeof item.publicImage === "string" &&
      /^ghcr\.io\/.+@sha256:[0-9a-f]{64}$/u.test(item.publicImage) &&
      typeof item.sourceCommit === "string" &&
      /^[0-9a-f]{40}$/u.test(item.sourceCommit) &&
      typeof item.deploymentSha256 === "string" &&
      SHA256.test(item.deploymentSha256) &&
      typeof item.volumeId === "string" &&
      COMMAND_ID.test(item.volumeId) &&
      typeof item.volumeIdSha256 === "string" &&
      SHA256.test(item.volumeIdSha256) &&
      typeof item.volumeManifestSha256 === "string" &&
      SHA256.test(item.volumeManifestSha256) &&
      typeof item.receiptKeyId === "string" &&
      COMMAND_ID.test(item.receiptKeyId),
  );
}

function validDualLaneInput(value: unknown): value is Omit<V213DualLaneInput, "receiptSigner"> {
  const item = object(value);
  const envelopeKeys = [
    "mage",
    "soulx10s",
    "soulx2s",
    "soulx4s",
    "soulx6s",
    "soulxCancel",
    "soulxInvalidOutput",
    "soulxTimeout",
  ];
  const required = [
    "accountIdSha256",
    "billingBaselineUsd",
    "envelopes",
    "mage",
    "mageQualificationCapUsd",
    "soulx",
    "soulxQualificationCapUsd",
    "stageAuthorityPublicKeyPem",
    "totalCapUsd",
  ];
  const allowed = [...required, "maxStatusReads", "minimumStableReadSpacingMs", "pollIntervalMs"];
  const envelopes = object(item?.envelopes);
  return Boolean(
    item &&
      Object.keys(item).every((key) => allowed.includes(key)) &&
      required.every((key) => key in item) &&
      typeof item.accountIdSha256 === "string" &&
      SHA256.test(item.accountIdSha256) &&
      validSealedLane(item.mage, "mage") &&
      validSealedLane(item.soulx, "soulx") &&
      typeof item.billingBaselineUsd === "number" &&
      Number.isFinite(item.billingBaselineUsd) &&
      item.billingBaselineUsd >= 0 &&
      item.totalCapUsd === 17.5 &&
      item.mageQualificationCapUsd === 4.5 &&
      item.soulxQualificationCapUsd === 1 &&
      typeof item.stageAuthorityPublicKeyPem === "string" &&
      item.stageAuthorityPublicKeyPem.includes("PUBLIC KEY") &&
      envelopes &&
      Object.keys(envelopes).sort().join(",") === envelopeKeys.sort().join(","),
  );
}

function exactProductionInput(value: JsonValue): V213ProductionInput {
  const item = object(value);
  if (
    item?.schemaVersion !== "videoforge.v213-full-live-production-input/v1" ||
    typeof item.outerStateSha256 !== "string" ||
    !SHA256.test(item.outerStateSha256) ||
    typeof item.fullLiveAuthorityId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      item.fullLiveAuthorityId,
    ) ||
    !validDualLaneInput(item.dualLaneInput) ||
    !object(item.commandPayload) ||
    Object.keys(item).sort().join(",") !==
      "commandPayload,dualLaneInput,fullLiveAuthorityId,outerStateSha256,schemaVersion"
  )
    fail("PRODUCTION_INPUT_INVALID");
  return value as unknown as V213ProductionInput;
}

async function oneDatabaseValue(
  database: TransactionalSqlExecutor,
  sql: string,
  parameters: readonly (string | number | boolean | null)[],
  code: string,
): Promise<unknown> {
  const result = await database.query<{ value: unknown }>(sql, parameters);
  if (result.rows.length !== 1) fail(code);
  return result.rows[0]?.value;
}

function createV213SqlDurableStageStore(input: {
  readonly database: TransactionalSqlExecutor;
  readonly fullLiveAuthorityId: string;
  readonly signingKey: Buffer;
}): Parameters<typeof createV213RunPodDualLaneTransport>[0]["durable"] {
  const signAuthority = (unsigned: Readonly<Record<string, unknown>>) => {
    try {
      const privateKey = createPrivateKey({ key: input.signingKey, format: "der", type: "pkcs8" });
      return sign(null, Buffer.from(canonicalizeJson(unsigned as JsonValue)), privateKey).toString(
        "base64",
      );
    } catch {
      fail("STAGE_AUTHORITY_SIGNING_KEY_INVALID");
    }
  };
  const store: Parameters<typeof createV213RunPodDualLaneTransport>[0]["durable"] = {
    async issueStageAuthority(stageInput) {
      const now = await oneDatabaseValue(
        input.database,
        "SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') value",
        [],
        "DURABLE_TIME_INVALID",
      );
      const issuedAt = new Date(String(now)).toISOString();
      const nonce = randomBytes(24).toString("base64url");
      const unsigned = {
        schemaVersion: "videoforge.v213-stage-authority/v1" as const,
        authorityId: `v213-${stageInput.stage}-${createHash("sha256").update(`${stageInput.inputSha256}:${stageInput.predecessorHandoffSha256}:${nonce}`).digest("hex").slice(0, 32)}`,
        stage: stageInput.stage,
        inputSha256: stageInput.inputSha256,
        predecessorHandoffSha256: stageInput.predecessorHandoffSha256,
        nonce,
        issuedAt,
        expiresAt: new Date(Date.parse(issuedAt) + 10 * 60_000).toISOString(),
        singleUse: true as const,
      };
      return (await oneDatabaseValue(
        input.database,
        "SELECT public.videoforge_record_v213_stage_authority($1::uuid,$2::jsonb) value",
        [
          input.fullLiveAuthorityId,
          JSON.stringify({ ...unsigned, signatureBase64: signAuthority(unsigned) }),
        ],
        "DURABLE_STAGE_ISSUE_INVALID",
      )) as never;
    },
    claimStageAuthority: (authority) =>
      oneDatabaseValue(
        input.database,
        "SELECT public.videoforge_claim_v213_stage_authority($1::jsonb) value",
        [JSON.stringify(authority)],
        "DURABLE_STAGE_CLAIM_INVALID",
      ) as never,
    async completeStageAuthority(authorityId, handoffSha256, handoff) {
      await input.database.transaction(async (transaction) => {
        await transaction.query("SELECT set_config('videoforge.v213_handoff_key',$1,true)", [
          input.signingKey.toString("base64"),
        ]);
        await transaction.query(
          "SELECT public.videoforge_complete_v213_stage_authority($1,$2,$3::jsonb)",
          [authorityId, handoffSha256, JSON.stringify(handoff)],
        );
      });
    },
    claimOperation: (operation) =>
      oneDatabaseValue(
        input.database,
        "SELECT public.videoforge_claim_v213_operation($1::jsonb) value",
        [JSON.stringify(operation)],
        "DURABLE_OPERATION_CLAIM_INVALID",
      ) as never,
    transitionOperation: (transition) =>
      oneDatabaseValue(
        input.database,
        "SELECT public.videoforge_transition_v213_operation($1::jsonb) value",
        [JSON.stringify(transition)],
        "DURABLE_OPERATION_TRANSITION_INVALID",
      ) as never,
  };
  return Object.freeze(store);
}

type V213ProductionFactoryPorts = Readonly<{
  fetch: WorkflowFetch;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  createDatabases: (inputs: V213ProtectedInputs) => Readonly<{
    operator: TransactionalSqlExecutor;
    runtime: TransactionalSqlExecutor;
    reconciler: TransactionalSqlExecutor;
  }>;
}>;

const defaultProductionPorts: V213ProductionFactoryPorts = Object.freeze({
  fetch: globalThis.fetch,
  now: () => new Date(),
  sleep: (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  createDatabases: (inputs) => ({
    operator: createNeonExecutor(createNeonPool(inputs.operatorDatabaseUrl)),
    runtime: createNeonExecutor(createNeonPool(inputs.runtimeDatabaseUrl)),
    reconciler: createNeonExecutor(createNeonPool(inputs.reconcilerDatabaseUrl)),
  }),
});

type V213PrequalificationFactoryPorts = Readonly<{
  fetch: WorkflowFetch;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  createOperatorDatabase: (inputs: V213PrequalificationProtectedInputs) => TransactionalSqlExecutor;
}>;

const defaultPrequalificationPorts: V213PrequalificationFactoryPorts = Object.freeze({
  fetch: globalThis.fetch,
  now: () => new Date(),
  sleep: (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  createOperatorDatabase: (inputs) =>
    createNeonExecutor(createNeonPool(inputs.operatorDatabaseUrl)),
});

async function readEndpointBilling(apiKey: string, fetchPort: WorkflowFetch): Promise<number> {
  const query = new URLSearchParams({
    bucketSize: "hour",
    grouping: "endpointId",
    startTime: "2026-08-20T00:00:00.000Z",
    endTime: new Date().toISOString(),
  });
  const response = await fetchPort(`https://rest.runpod.io/v1/billing/endpoints?${query}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) fail("RUNPOD_BILLING_READ_FAILED");
  const value = await response.json();
  if (!Array.isArray(value)) fail("RUNPOD_BILLING_READ_INVALID");
  return value.reduce((sum, row) => {
    const amount = Number(object(row)?.amount);
    if (!Number.isFinite(amount) || amount < 0) fail("RUNPOD_BILLING_READ_INVALID");
    return sum + amount;
  }, 0);
}

function evidence(value: JsonValue) {
  return Object.freeze({ evidenceSha256: sha256(value), summary: value });
}

const BILLING_STABLE_READ_COUNT = 3;
const BILLING_STABLE_READ_SPACING_MS = 2_000;

async function readStableBillingEvidence(input: {
  readonly read: () => Promise<number>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly baselineMode: "PRIOR_FRESH_PREFLIGHT" | "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION";
  readonly baselineUsd: number | null;
  readonly totalCapUsd: number;
}): Promise<JsonValue> {
  const readFinite = async () => {
    const amount = await input.read();
    if (!Number.isFinite(amount) || amount < 0) fail("CLEANUP_BILLING_READ_INVALID");
    return amount;
  };
  let baseline = input.baselineUsd;
  if (input.baselineMode === "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION") {
    baseline = await readFinite();
    // Keep the baseline and final proof distinct even when the endpoint has no activity.
    await input.sleep(BILLING_STABLE_READ_SPACING_MS);
  }
  if (baseline === null || !Number.isFinite(baseline) || baseline < 0)
    fail("CLEANUP_BILLING_BASELINE_INVALID");
  const reads: number[] = [];
  for (let index = 0; index < BILLING_STABLE_READ_COUNT; index += 1) {
    if (index > 0) await input.sleep(BILLING_STABLE_READ_SPACING_MS);
    reads.push(await readFinite());
  }
  const cumulativeBillingUsd = reads[reads.length - 1]!;
  if (
    reads.some((amount) => amount !== cumulativeBillingUsd) ||
    cumulativeBillingUsd < baseline ||
    cumulativeBillingUsd - baseline > input.totalCapUsd
  )
    fail("CLEANUP_BILLING_NOT_STABLE");
  return {
    cumulativeBillingUsd,
    billingReads: reads,
    billingReadCount: BILLING_STABLE_READ_COUNT,
    billingReadSpacingMs: BILLING_STABLE_READ_SPACING_MS,
    billingStable: true,
    withinCumulativeCap: true,
  };
}

function exactPayload<T extends object>(
  value: Readonly<Record<string, unknown>>,
  keys: string[],
): T {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(","))
    fail("COMMAND_PAYLOAD_INVALID");
  return value as T;
}

async function postAcceptance(
  inputs: V213ProtectedInputs,
  production: V213ProductionInput,
  request: V213FullLiveCommandRequest,
  fetchPort: WorkflowFetch,
  loadDatabaseCall: ReturnType<typeof createV213SqlBridgeCallLoader>,
) {
  const checkpoint =
    request.command === "v2-10-operator-free-ranga-pilot"
      ? "V2-10"
      : request.command === "v2-11-two-concurrent-owned-projects"
        ? "V2-11"
        : request.command === "v2-12-long-output"
          ? "V2-12"
          : "V2-13";
  const identity = exactPayload<{
    accountId: string;
    workspaceId: string;
    projectId: string;
    projectRevisionId: string;
  }>(production.commandPayload, ["accountId", "workspaceId", "projectId", "projectRevisionId"]);
  const workflowId = `v213-${checkpoint.toLowerCase()}-${request.commandId}`;
  const attemptId = `${workflowId}-attempt`;
  const requestSha256 = sha256({
    command: request.command,
    checkpoint,
    workflowId,
    attemptId,
    ...identity,
    outerStateSha256: production.outerStateSha256,
  });
  const document = {
    schemaVersion: "videoforge.v213-hosted-acceptance-command/v1",
    commandId: request.commandId,
    stageAuthorityId: request.stageAuthorityId,
    command: request.command,
    checkpoint,
    workflowId,
    attemptId,
    ...identity,
    requestSha256,
    outerStateSha256: production.outerStateSha256,
  };
  await loadDatabaseCall({
    ...request,
    input: { requestSha256, outerStateSha256: production.outerStateSha256 },
  });
  const raw = canonicalizeJson(document as JsonValue);
  const response = await fetchPort(`${inputs.workerOrigin}/api/operator/v2-13/live-acceptance`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${inputs.workerOperatorBearer}`,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(raw)),
      "x-videoforge-signature": createHmac("sha256", inputs.workerOperatorBearer)
        .update(raw)
        .digest("hex"),
    },
    body: raw,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) fail("ACCEPTANCE_OPERATOR_REJECTED");
  const value = object(await response.json());
  if (
    typeof value?.evidenceSha256 !== "string" ||
    !SHA256.test(value.evidenceSha256) ||
    !object(value.summary) ||
    Object.keys(value).sort().join(",") !== "evidenceSha256,summary"
  )
    fail("ACCEPTANCE_OPERATOR_RESULT_INVALID");
  return {
    evidenceSha256: value.evidenceSha256 as `sha256:${string}`,
    summary: value.summary as JsonValue,
  };
}

type V213CleanupTransport = Pick<
  V213RunPodDualLaneTransport,
  "cleanupAttributableResources" | "inventory" | "billingAmount"
>;

export async function createV213CleanupRuntime(
  inputs: V213CleanupProtectedInputs,
  ports: {
    readonly createOperatorDatabase?: (url: string) => TransactionalSqlExecutor;
    readonly createTransport?: (inputs: V213CleanupProtectedInputs) => V213CleanupTransport;
    readonly sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<V213FullLiveBridgeRuntime> {
  const operator = (
    ports.createOperatorDatabase ?? ((url) => createNeonExecutor(createNeonPool(url)))
  )(inputs.operatorDatabaseUrl);
  const descriptor = inputs.cleanupInput;
  const transport = (
    ports.createTransport ??
    ((cleanupInputs) => {
      const control = new RunPodControlClient({ apiKey: cleanupInputs.runpodApiKey });
      const lanes = Object.fromEntries(
        descriptor.retainedLanes.map((lane) => [
          lane.lane,
          {
            lane: lane.lane,
            volumeIdSha256: lane.volumeIdSha256,
            volumeManifestSha256: lane.volumeManifestSha256,
          },
        ]),
      );
      return createV213RunPodDualLaneTransport({
        durable: {} as never,
        input: lanes as never,
        control,
        accountPreflight: async () => ({}) as never,
        readAdmissionFacts: async () => ({
          checkedAt: new Date().toISOString(),
          availability: "LOW",
          flexRateUsdPerGpuHour: 0,
          cumulativeBillingUsd: await readEndpointBilling(
            cleanupInputs.runpodApiKey,
            globalThis.fetch,
          ),
        }),
        verifyOutputReadback: async () => true,
        createJobClient: (endpointId) =>
          new RunPodServerlessJobClient({
            apiKey: cleanupInputs.runpodApiKey,
            endpointId,
            guard: new RunPodDrainGuard(),
          }),
        sleep: ports.sleep,
      });
    })
  )(inputs);
  const loadCleanupScope = async () => {
    const value = object(
      await oneDatabaseValue(
        operator,
        "SELECT public.videoforge_load_v213_cleanup_scope($1::uuid) value",
        [descriptor.fullLiveAuthorityId],
        "CLEANUP_SCOPE_UNAVAILABLE",
      ),
    );
    if (
      value?.schemaVersion !== "videoforge.v213-cleanup-scope/v1" ||
      value.fullLiveAuthorityId !== descriptor.fullLiveAuthorityId ||
      !Array.isArray(value.stages)
    )
      fail("CLEANUP_SCOPE_INVALID");
    return value.stages as Parameters<V213CleanupTransport["cleanupAttributableResources"]>[0];
  };
  const sleep =
    ports.sleep ?? ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)));
  const cleanup: Readonly<Record<CleanupCommand, V213FullLiveCommandHandler>> = Object.freeze({
    "restore-endpoints-max-one": async () =>
      evidence(
        summarizeV213EndpointRestoration(
          await transport.cleanupAttributableResources(await loadCleanupScope()),
        ),
      ),
    "prove-zero-workers": async () => {
      const reads = [];
      for (let index = 0; index < 3; index += 1) {
        const inventory = await transport.inventory();
        if (
          inventory.runningPods !== 0 ||
          inventory.activeWorkers !== 0 ||
          inventory.queuedJobs !== 0
        )
          fail("ZERO_WORKERS_NOT_PROVEN");
        reads.push(inventory);
        if (index < 2) await sleep(2_000);
      }
      return evidence({ zeroWorkers: true, reads } as never);
    },
    "read-settled-billing": async () => {
      return evidence(
        await readStableBillingEvidence({
          read: () => transport.billingAmount(),
          sleep,
          baselineMode: descriptor.billingBaselineMode,
          baselineUsd: descriptor.billingBaselineUsd,
          totalCapUsd: descriptor.totalCapUsd,
        }),
      );
    },
    "reconcile-exact-resources": async () => {
      const inventory = await transport.inventory();
      const expected = descriptor.retainedLanes.map((lane) => lane.volumeIdSha256).sort();
      const actual = inventory.volumes.map((volume) => volume.idSha256).sort();
      if (canonicalizeJson(actual as never) !== canonicalizeJson(expected as never))
        fail("CLEANUP_RETAINED_VOLUME_DRIFT");
      return evidence({ ...inventory, onlyApprovedRetainedVolumes: true } as never);
    },
  });
  return Object.freeze({
    journal: createV213SqlCommandJournal(operator),
    handlers: cleanup as unknown as V213FullLiveCommandHandlers,
    protectedValues: Object.freeze([inputs.runpodApiKey, inputs.operatorDatabaseUrl]),
  });
}

/**
 * Construct the cleanup runtime used when failure occurs before the operator role/ACL is
 * durably verified.  This is deliberately a no-op proof runtime: no SQL executor, connection,
 * cleanup-scope claim, endpoint mutation, billing request, or production secret is constructed.
 * The RunPod key remains part of the protected boundary so a caller cannot widen the child
 * process's environment, but the early proof itself performs zero provider calls.
 */
export async function createV213EarlyCleanupRuntime(
  inputs: V213EarlyCleanupProtectedInputs,
): Promise<V213FullLiveBridgeRuntime> {
  if (!CLEANUP_COMMANDS.has(inputs.request.command)) fail("EARLY_CLEANUP_COMMAND_INVALID");
  if (inputs.earlyCleanupInput.fullLiveAuthorityId !== inputs.request.stageAuthorityId)
    fail("EARLY_CLEANUP_AUTHORITY_DRIFT");
  const completed = new Map<string, V213FullLiveCommandResult>();
  const journal: V213FullLiveJournal = {
    async claim(input) {
      const prior = completed.get(input.operationId);
      return prior === undefined ? { action: "EXECUTE" } : { action: "DONE", result: prior };
    },
    async ambiguous() {
      // There is no durable side effect to reconcile in this branch.  The outer executor keeps
      // the cleanup work terminal and never redispatches it.
    },
    async complete(operationId, result) {
      const prior = completed.get(operationId);
      if (prior !== undefined && canonicalizeJson(prior) !== canonicalizeJson(result))
        fail("EARLY_CLEANUP_REPLAY_DRIFT");
      completed.set(operationId, result);
    },
  };
  const common = {
    databaseCleanupClaimed: false,
    databaseCalls: 0,
    providerCalls: 0,
    runpodCalls: 0,
    cloudflareCalls: 0,
    applicationSecretReads: 0,
    externalSpendUsd: 0,
    gpuUse: false,
  } as const;
  const handlers = Object.fromEntries(
    V213_FULL_LIVE_COMMANDS.map((command) => {
      if (command === "restore-endpoints-max-one")
        return [
          command,
          async () =>
            evidence({
              ...common,
              restorationPerformed: false,
              bothEndpointsMaxWorkersOne: true,
            }),
        ];
      if (command === "prove-zero-workers")
        return [
          command,
          async () =>
            evidence({
              ...common,
              zeroWorkers: true,
              reads: [],
              stableReads: 0,
            }),
        ];
      if (command === "read-settled-billing")
        return [
          command,
          async () =>
            evidence({
              ...common,
              cumulativeBillingUsd: 0,
              billingReads: [],
              billingReadCount: 0,
              billingStable: true,
              withinCumulativeCap: true,
            }),
        ];
      if (command === "reconcile-exact-resources")
        return [
          command,
          async () =>
            evidence({
              ...common,
              reconciliationPerformed: false,
              resourceReads: 0,
              onlyApprovedRetainedVolumes: true,
            }),
        ];
      return [command, async () => fail("EARLY_CLEANUP_COMMAND_NOT_ALLOWED")];
    }),
  ) as unknown as V213FullLiveCommandHandlers;
  return Object.freeze({
    journal,
    handlers,
    protectedValues: Object.freeze([inputs.runpodApiKey]),
  });
}

/**
 * Build the prequalification bridge with only the operator database and RunPod read seams.  The
 * operator role is the sole database principal available at this point in the execution graph;
 * runtime/reconciler roles and production secret material are intentionally not represented in
 * this factory's inputs or ports.  The temporary receipt signer exists only to satisfy the
 * read-only admission input contract; it is never registered in the database and is not exposed
 * in the returned protected values.
 */
export async function createV213PrequalificationRuntime(
  inputs: V213PrequalificationProtectedInputs,
  ports: V213PrequalificationFactoryPorts = defaultPrequalificationPorts,
): Promise<V213FullLiveBridgeRuntime> {
  if (inputs.request.command !== "fresh-live-preflight") fail("PREQUALIFICATION_COMMAND_INVALID");
  const production = exactProductionInput(inputs.request.input);
  const receiptKeyId = production.dualLaneInput.mage.receiptKeyId;
  if (receiptKeyId !== production.dualLaneInput.soulx.receiptKeyId) fail("RECEIPT_KEY_ID_DRIFT");
  const dualLaneInput = Object.freeze({
    ...production.dualLaneInput,
    // Admission validates the key id but does not sign a receipt.  Do not read or register the
    // production HMAC key before guarded activation has provisioned the full secret set.
    receiptSigner: new ProvenanceReceiptSigner(receiptKeyId, Buffer.alloc(32)),
  }) as V213DualLaneInput;
  const operatorDatabase = ports.createOperatorDatabase(inputs);
  const control = new RunPodControlClient({ apiKey: inputs.runpodApiKey });
  const transport = createV213RunPodDualLaneTransport({
    // The admission operation is read-only and cannot reach durable stage mutation methods.
    durable: {} as never,
    input: dualLaneInput,
    control,
    accountPreflight: () => assertSujalRunPodAccount(inputs.runpodApiKey),
    readAdmissionFacts: async () => {
      const candidates = await fetchCp07Catalog(inputs.runpodApiKey, ports.fetch);
      const exact = candidates.find(
        (candidate) =>
          candidate.displayName === "NVIDIA GeForce RTX 4090" && candidate.region === "EU-RO-1",
      );
      if (!exact) fail("RUNPOD_EXACT_OFFERING_UNAVAILABLE");
      return {
        checkedAt: ports.now().toISOString(),
        availability: exact.availability,
        // `exact.rateUsdPerHour` is the Secure Pod catalog rate. Do not label it Serverless Flex.
        flexRateUsdPerGpuHour: V213_SERVERLESS_FLEX_RATE_SOURCE.rateUsdPerGpuHour,
        cumulativeBillingUsd: await readEndpointBilling(inputs.runpodApiKey, ports.fetch),
      };
    },
    // This port is unreachable from readV213DualLaneAdmission. Keep it fail-closed if the
    // prequalification handler is ever widened accidentally.
    verifyOutputReadback: async () => fail("PREQUALIFICATION_OUTPUT_READBACK_FORBIDDEN"),
    createJobClient: () => {
      fail("PREQUALIFICATION_JOB_CLIENT_FORBIDDEN");
    },
    sleep: ports.sleep,
    now: ports.now,
  });
  const payload = production.commandPayload;
  const preflight: V213FullLiveCommandHandler = async () => {
    const { authorityDocument } = exactPayload<{ authorityDocument: Record<string, unknown> }>(
      payload,
      ["authorityDocument"],
    );
    if (
      authorityDocument.sourceCommit !== dualLaneInput.mage.sourceCommit ||
      authorityDocument.sourceCommit !== dualLaneInput.soulx.sourceCommit ||
      authorityDocument.maximumCumulativeSpendUsd !== 17.5 ||
      authorityDocument.singleUse !== true
    )
      fail("FULL_LIVE_AUTHORITY_INPUT_DRIFT");
    const registered = object(
      await oneDatabaseValue(
        operatorDatabase,
        "SELECT to_jsonb(recorded) value FROM public.videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb) recorded",
        [production.fullLiveAuthorityId, JSON.stringify(authorityDocument)],
        "FULL_LIVE_AUTHORITY_REGISTRATION_FAILED",
      ),
    );
    if (
      registered?.authority_id !== production.fullLiveAuthorityId ||
      typeof registered.authority_document_sha256 !== "string" ||
      !SHA256.test(registered.authority_document_sha256)
    )
      fail("FULL_LIVE_AUTHORITY_REGISTRATION_FAILED");
    return evidence((await readV213DualLaneAdmission(transport, dualLaneInput)) as never);
  };
  const forbidden: V213FullLiveCommandHandler = async () => {
    fail("PREQUALIFICATION_COMMAND_NOT_ALLOWED");
  };
  const handlers = Object.freeze(
    Object.fromEntries(
      V213_FULL_LIVE_COMMANDS.map((command) => [
        command,
        command === "fresh-live-preflight" ? preflight : forbidden,
      ]),
    ),
  ) as unknown as V213FullLiveCommandHandlers;
  return Object.freeze({
    journal: createV213SqlCommandJournal(operatorDatabase),
    handlers,
    protectedValues: Object.freeze([inputs.runpodApiKey, inputs.operatorDatabaseUrl]),
  });
}

/** The direct-process production factory. It constructs all concrete clients and every command
 * handler solely from protected descriptors. Optional ports exist only for provider-free tests;
 * the executable entrypoint never accepts or consults them. */
export async function createV213ProductionRuntime(
  inputs: V213ProtectedInputs,
  ports: V213ProductionFactoryPorts = defaultProductionPorts,
): Promise<V213FullLiveBridgeRuntime> {
  const production = exactProductionInput(inputs.request.input);
  const secrets = inputs.productionSecrets;
  const receiptSecret = Buffer.from(secrets.provenanceReceiptHmacKeyBase64, "base64");
  const receiptSigner = new ProvenanceReceiptSigner(secrets.provenanceReceiptKeyId, receiptSecret);
  const dualLaneInput = Object.freeze({
    ...production.dualLaneInput,
    receiptSigner,
  }) as V213DualLaneInput;
  if (
    dualLaneInput.mage?.receiptKeyId !== secrets.provenanceReceiptKeyId ||
    dualLaneInput.soulx?.receiptKeyId !== secrets.provenanceReceiptKeyId
  )
    fail("RECEIPT_KEY_ID_DRIFT");
  const databases = ports.createDatabases(inputs);
  const acceptanceEvidenceKey = Buffer.from(secrets.acceptanceEvidenceSigningKeyBase64, "base64");
  for (const [keyId, secretBase64] of [
    [secrets.provenanceReceiptKeyId, secrets.provenanceReceiptHmacKeyBase64],
    [v213EvidenceKeyId(acceptanceEvidenceKey), secrets.acceptanceEvidenceSigningKeyBase64],
  ] as const) {
    const registered = await oneDatabaseValue(
      databases.operator,
      "SELECT public.videoforge_record_v213_receipt_verification_key($1,$2) value",
      [keyId, secretBase64],
      "PRODUCTION_VERIFICATION_KEY_REGISTRATION_FAILED",
    );
    if (registered !== keyId) fail("PRODUCTION_VERIFICATION_KEY_REGISTRATION_FAILED");
  }
  const durable = createV213SqlDurableStageStore({
    database: databases.operator,
    fullLiveAuthorityId: production.fullLiveAuthorityId,
    signingKey: Buffer.from(secrets.stageAuthoritySigningKeyBase64, "base64"),
  });
  const control = new RunPodControlClient({ apiKey: inputs.runpodApiKey });
  const transport = createV213RunPodDualLaneTransport({
    durable,
    input: dualLaneInput,
    control,
    accountPreflight: () => assertSujalRunPodAccount(inputs.runpodApiKey),
    readAdmissionFacts: async () => {
      const candidates = await fetchCp07Catalog(inputs.runpodApiKey, ports.fetch);
      const exact = candidates.find(
        (candidate) =>
          candidate.displayName === "NVIDIA GeForce RTX 4090" && candidate.region === "EU-RO-1",
      );
      if (!exact) fail("RUNPOD_EXACT_OFFERING_UNAVAILABLE");
      return {
        checkedAt: ports.now().toISOString(),
        availability: exact.availability,
        // `exact.rateUsdPerHour` is the Secure Pod catalog rate. Do not label it Serverless Flex.
        flexRateUsdPerGpuHour: V213_SERVERLESS_FLEX_RATE_SOURCE.rateUsdPerGpuHour,
        cumulativeBillingUsd: await readEndpointBilling(inputs.runpodApiKey, ports.fetch),
      };
    },
    verifyOutputReadback: async (result, delivery) => {
      const output = object(result.output);
      const proof = object(output?.output_readback_proof);
      if (
        proof?.verified !== true ||
        typeof proof.outputSha256 !== "string" ||
        !SHA256.test(proof.outputSha256) ||
        proof.receiptSha256 !== delivery.receipt.receipt_sha256
      )
        fail("OUTPUT_READBACK_PROOF_INVALID");
      return true;
    },
    createJobClient: (endpointId) =>
      new RunPodServerlessJobClient({
        apiKey: inputs.runpodApiKey,
        endpointId,
        guard: new RunPodDrainGuard(),
      }),
    sleep: ports.sleep,
    now: ports.now,
  });
  const loadStageHandoff = async <T>(stage: "mage" | "soulx", handoffSha256: string) => {
    if (!SHA256.test(handoffSha256)) fail("STAGE_HANDOFF_HASH_INVALID");
    return databases.operator.transaction(async (transaction) => {
      await transaction.query("SELECT set_config('videoforge.v213_handoff_key',$1,true)", [
        secrets.stageAuthoritySigningKeyBase64,
      ]);
      const result = await transaction.query<{ value: unknown }>(
        "SELECT public.videoforge_load_v213_stage_handoff($1::uuid,$2,$3) value",
        [production.fullLiveAuthorityId, stage, handoffSha256],
      );
      if (result.rows.length !== 1 || !result.rows[0]?.value) fail("STAGE_HANDOFF_UNAVAILABLE");
      return result.rows[0].value as T;
    });
  };
  const payload = production.commandPayload;
  const qualification: Record<QualificationCommand, V213FullLiveCommandHandler> = {
    "fresh-live-preflight": async () => {
      const { authorityDocument } = exactPayload<{ authorityDocument: Record<string, unknown> }>(
        payload,
        ["authorityDocument"],
      );
      if (
        authorityDocument.sourceCommit !== dualLaneInput.mage.sourceCommit ||
        authorityDocument.sourceCommit !== dualLaneInput.soulx.sourceCommit ||
        authorityDocument.maximumCumulativeSpendUsd !== 17.5 ||
        authorityDocument.singleUse !== true
      )
        fail("FULL_LIVE_AUTHORITY_INPUT_DRIFT");
      const registered = object(
        await oneDatabaseValue(
          databases.operator,
          "SELECT to_jsonb(recorded) value FROM public.videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb) recorded",
          [production.fullLiveAuthorityId, JSON.stringify(authorityDocument)],
          "FULL_LIVE_AUTHORITY_REGISTRATION_FAILED",
        ),
      );
      if (
        registered?.authority_id !== production.fullLiveAuthorityId ||
        typeof registered.authority_document_sha256 !== "string" ||
        !SHA256.test(registered.authority_document_sha256)
      )
        fail("FULL_LIVE_AUTHORITY_REGISTRATION_FAILED");
      return evidence((await readV213DualLaneAdmission(transport, dualLaneInput)) as never);
    },
    "mage-live-qualification": async () => {
      const { admission } = exactPayload<{ admission: V213AdmissionHandoff }>(payload, [
        "admission",
      ]);
      const authority = await issueV213StageAuthority(
        transport,
        dualLaneInput,
        "mage",
        admission.handoffSha256,
      );
      const handoff = await runV213MageQualification(
        transport,
        dualLaneInput,
        admission,
        authority,
      );
      return {
        evidenceSha256: handoff.handoffSha256 as `sha256:${string}`,
        summary: {
          handoffSha256: handoff.handoffSha256,
          qualified: true,
          zeroWorkersAfter: handoff.zeroWorkersAfter,
          threeStableZeroWorkerReads: handoff.threeStableZeroWorkerReads,
          billingAfterUsd: handoff.billingAfterUsd,
        },
      };
    },
    "soulx-live-qualification": async () => {
      const { mageHandoffSha256 } = exactPayload<{ mageHandoffSha256: string }>(payload, [
        "mageHandoffSha256",
      ]);
      const mage = await loadStageHandoff<V213MageQualificationHandoff>("mage", mageHandoffSha256);
      const authority = await issueV213StageAuthority(
        transport,
        dualLaneInput,
        "soulx",
        mage.handoffSha256,
      );
      const handoff = await runV213SoulXQualification(transport, dualLaneInput, mage, authority);
      return {
        evidenceSha256: handoff.handoffSha256 as `sha256:${string}`,
        summary: {
          handoffSha256: handoff.handoffSha256,
          qualified: true,
          zeroWorkersAfter: handoff.zeroWorkersAfter,
          threeStableZeroWorkerReads: handoff.threeStableZeroWorkerReads,
          billingAfterUsd: handoff.billingAfterUsd,
        },
      };
    },
    "create-exact-max-one-endpoints": async () => {
      const prior = exactPayload<{
        mageHandoffSha256: string;
        soulxHandoffSha256: string;
      }>(payload, ["mageHandoffSha256", "soulxHandoffSha256"]);
      const mage = await loadStageHandoff<V213MageQualificationHandoff>(
        "mage",
        prior.mageHandoffSha256,
      );
      const soulx = await loadStageHandoff<V213SoulXQualificationHandoff>(
        "soulx",
        prior.soulxHandoffSha256,
      );
      const authority = await issueV213StageAuthority(
        transport,
        dualLaneInput,
        "production",
        soulx.handoffSha256,
      );
      const result = await createV213Max1Deployments(
        transport,
        dualLaneInput,
        mage,
        soulx,
        authority,
      );
      const publicationDocument = {
        schemaVersion: "videoforge.v213-qualified-deployment-publication/v1",
        fullLiveAuthorityId: production.fullLiveAuthorityId,
        mageDeploymentId: deterministicUuid(`${production.fullLiveAuthorityId}:mage:deployment`),
        mageQualificationId: deterministicUuid(
          `${production.fullLiveAuthorityId}:mage:qualification`,
        ),
        mageStageAuthorityId: mage.authorityConsumption.authorityId,
        soulxDeploymentId: deterministicUuid(`${production.fullLiveAuthorityId}:soulx:deployment`),
        soulxQualificationId: deterministicUuid(
          `${production.fullLiveAuthorityId}:soulx:qualification`,
        ),
        soulxStageAuthorityId: soulx.authorityConsumption.authorityId,
        productionStageAuthorityId: authority.authorityId,
        receiptKeyId: secrets.provenanceReceiptKeyId,
      };
      const publication = await databases.operator.transaction(async (transaction) => {
        await transaction.query("SELECT set_config('videoforge.v213_handoff_key',$1,true)", [
          secrets.stageAuthoritySigningKeyBase64,
        ]);
        const published = await transaction.query<{ value: unknown }>(
          "SELECT public.videoforge_publish_v213_qualified_deployments($1::jsonb) value",
          [JSON.stringify(publicationDocument)],
        );
        if (published.rows.length !== 1 || !published.rows[0]?.value)
          fail("QUALIFIED_DEPLOYMENT_PUBLICATION_FAILED");
        return published.rows[0].value;
      });
      return evidence({ result, publication } as never);
    },
  };
  const v209: V213FullLiveCommandHandler = async () => {
    const call = exactPayload<{
      pairInput: Parameters<typeof commitAndScheduleV209ShortPair>[3];
      admission: Parameters<typeof commitAndScheduleV209ShortPair>[4];
      laneItemIds: Parameters<typeof commitAndScheduleV209ShortPair>[5];
      chromeEvidenceSha256: string;
    }>(payload, ["admission", "chromeEvidenceSha256", "laneItemIds", "pairInput"]);
    if (!SHA256.test(call.chromeEvidenceSha256)) fail("V209_CHROME_EVIDENCE_REFERENCE_INVALID");
    const workflow = createV213WorkflowHttpBinding({
      origin: inputs.workerOrigin,
      token: inputs.workerOperatorBearer,
      outerStateSha256: production.outerStateSha256,
      fetch: ports.fetch,
    });
    const mageEndpointId = secrets.mageEndpointId;
    const soulxEndpointId = secrets.soulxEndpointId;
    if (!mageEndpointId || !soulxEndpointId) fail("PRODUCTION_ENDPOINT_BINDINGS_REQUIRED");
    const mageEndpointIdSha256 = `sha256:${createHash("sha256")
      .update(mageEndpointId, "utf8")
      .digest("hex")}`;
    const soulxEndpointIdSha256 = `sha256:${createHash("sha256")
      .update(soulxEndpointId, "utf8")
      .digest("hex")}`;
    const scheduled = await commitAndScheduleV209ShortPair(
      {
        VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
        DATABASE_URL: inputs.runtimeDatabaseUrl,
        VIDEOFORGE_RECONCILER_DATABASE_URL: inputs.reconcilerDatabaseUrl,
        RUNPOD_API_KEY: inputs.runpodApiKey,
        RUNPOD_API_BASE_URL: "https://api.runpod.ai/v2",
        VIDEOFORGE_DISPATCH_TOKEN_KEY: secrets.pairDispatchTokenKeyBase64,
        VIDEOFORGE_DISPATCH_TOKEN_KEY_ID: secrets.pairDispatchTokenKeyId,
        VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: secrets.pairEnvelopeSigningKeyHex,
        VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: secrets.pairEnvelopeSigningKeyId,
        VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: secrets.pairProviderProofKeyHex,
        VIDEOFORGE_PROVIDER_PROOF_KEY_ID: secrets.pairProviderProofKeyId,
        VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: inputs.workerOperatorBearer,
        VIDEOFORGE_MAGE_ENDPOINT_ID: mageEndpointId,
        VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256: mageEndpointIdSha256,
        VIDEOFORGE_SOULX_ENDPOINT_ID: soulxEndpointId,
        VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256: soulxEndpointIdSha256,
        HOSTED_PAIR_WORKFLOW: workflow,
      } as never,
      databases.runtime,
      databases.reconciler,
      call.pairInput,
      call.admission,
      call.laneItemIds,
    );
    const terminal = await awaitV209TerminalAcceptance({
      workflow,
      database: databases.reconciler,
      scope: {
        accountId: call.pairInput.accountId,
        workspaceId: call.pairInput.workspaceId,
        generationRequestId: call.pairInput.generationRequestId,
      },
      workflowId: scheduled.id,
      chromeEvidenceSha256: call.chromeEvidenceSha256,
      deadlineAt: call.admission.stopAt,
      now: () => ports.now().getTime(),
      sleep: ports.sleep,
    });
    return {
      evidenceSha256: terminal.resultSha256 as `sha256:${string}`,
      summary: terminal as JsonValue,
    };
  };
  const acceptance = Object.fromEntries(
    V213_FULL_LIVE_COMMANDS.slice(5, 9).map((command) => [
      command,
      (request: V213FullLiveCommandRequest) =>
        postAcceptance(
          inputs,
          production,
          request,
          ports.fetch,
          createV213SqlBridgeCallLoader(databases.operator),
        ),
    ]),
  ) as unknown as Pick<
    V213FullLiveCommandHandlers,
    (typeof V213_FULL_LIVE_COMMANDS)[5 | 6 | 7 | 8]
  >;
  const loadCleanupScope = async () => {
    exactPayload<Record<string, never>>(payload, []);
    const value = object(
      await oneDatabaseValue(
        databases.operator,
        "SELECT public.videoforge_load_v213_cleanup_scope($1::uuid) value",
        [production.fullLiveAuthorityId],
        "CLEANUP_SCOPE_UNAVAILABLE",
      ),
    );
    if (
      value?.schemaVersion !== "videoforge.v213-cleanup-scope/v1" ||
      value.fullLiveAuthorityId !== production.fullLiveAuthorityId ||
      !Array.isArray(value.stages)
    )
      fail("CLEANUP_SCOPE_INVALID");
    return value.stages as Parameters<typeof transport.cleanupAttributableResources>[0];
  };
  const cleanup: Record<CleanupCommand, V213FullLiveCommandHandler> = {
    "restore-endpoints-max-one": async () => {
      const result = await transport.cleanupAttributableResources(await loadCleanupScope());
      return evidence(summarizeV213EndpointRestoration(result));
    },
    "prove-zero-workers": async () => {
      const reads = [];
      for (let index = 0; index < 3; index += 1) {
        const inventory = await transport.inventory();
        if (
          inventory.runningPods !== 0 ||
          inventory.activeWorkers !== 0 ||
          inventory.queuedJobs !== 0
        )
          fail("ZERO_WORKERS_NOT_PROVEN");
        reads.push(inventory);
        if (index < 2) await ports.sleep(2_000);
      }
      return evidence({ zeroWorkers: true, reads } as never);
    },
    "read-settled-billing": async () => {
      exactPayload<Record<string, never>>(payload, []);
      return evidence(
        await readStableBillingEvidence({
          read: () => transport.billingAmount(),
          sleep: ports.sleep,
          baselineMode: "PRIOR_FRESH_PREFLIGHT",
          baselineUsd: dualLaneInput.billingBaselineUsd,
          totalCapUsd: dualLaneInput.totalCapUsd,
        }),
      );
    },
    "reconcile-exact-resources": async () => {
      exactPayload<Record<string, never>>(payload, []);
      const inventory = await transport.inventory();
      const expected = [dualLaneInput.mage, dualLaneInput.soulx]
        .map((lane) => lane.volumeIdSha256)
        .sort();
      const actual = inventory.volumes.map((volume) => volume.idSha256).sort();
      if (canonicalizeJson(actual as never) !== canonicalizeJson(expected as never))
        fail("CLEANUP_RETAINED_VOLUME_DRIFT");
      return evidence({ ...inventory, onlyApprovedRetainedVolumes: true } as never);
    },
  };
  const handlers = Object.freeze({
    ...qualification,
    "v2-09-short-hosted-project": v209,
    ...acceptance,
    ...cleanup,
  }) as V213FullLiveCommandHandlers;
  for (const command of V213_FULL_LIVE_COMMANDS)
    if (typeof handlers[command] !== "function") fail("PRODUCTION_HANDLER_CATALOG_INCOMPLETE");
  const encodedSecrets = [
    secrets.stageAuthoritySigningKeyBase64,
    secrets.provenanceReceiptHmacKeyBase64,
    secrets.acceptanceEvidenceSigningKeyBase64,
    secrets.pairDispatchTokenKeyBase64,
  ];
  return Object.freeze({
    journal: createV213SqlCommandJournal(databases.operator),
    handlers,
    protectedValues: Object.freeze([
      inputs.productionSecretsRaw,
      ...encodedSecrets,
      ...encodedSecrets.map((value) => Buffer.from(value, "base64").toString("utf8")),
      secrets.pairEnvelopeSigningKeyHex,
      secrets.pairProviderProofKeyHex,
      Buffer.from(secrets.pairEnvelopeSigningKeyHex, "hex").toString("utf8"),
      Buffer.from(secrets.pairProviderProofKeyHex, "hex").toString("utf8"),
      ...(secrets.mageEndpointId ? [secrets.mageEndpointId] : []),
      ...(secrets.soulxEndpointId ? [secrets.soulxEndpointId] : []),
    ]),
  });
}

function noAction() {
  const productionGaps = [
    ...V213_FULL_LIVE_PRODUCTION_GAPS,
    ...(verifyV213WorkflowOperatorRouteSource()
      ? []
      : ["CLOUDFLARE_WORKFLOW_OPERATOR_ROUTE_UNVERIFIED"]),
  ];
  return Object.freeze({
    schema_version: "videoforge.v213-full-live-cli/v1",
    state: "NO_ACTION",
    external_calls: 0,
    mutations: 0,
    gpu_use: 0,
    spend_usd: 0,
    commands: V213_FULL_LIVE_COMMANDS,
    production_gaps: productionGaps,
  });
}

export async function runV213FullLiveCli(
  argv: readonly string[],
  options: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly createRuntime?: (inputs: V213ProtectedInputs) => Promise<V213FullLiveBridgeRuntime>;
    readonly createPrequalificationRuntime?: (
      inputs: V213PrequalificationProtectedInputs,
    ) => Promise<V213FullLiveBridgeRuntime>;
    readonly createCleanupRuntime?: (
      inputs: V213CleanupProtectedInputs,
    ) => Promise<V213FullLiveBridgeRuntime>;
    readonly createEarlyCleanupRuntime?: (
      inputs: V213EarlyCleanupProtectedInputs,
    ) => Promise<V213FullLiveBridgeRuntime>;
    readonly write?: (value: string) => void;
    readonly readFd?: (value: string | undefined, code: string) => string;
  } = {},
): Promise<void> {
  const write = options.write ?? ((value) => process.stdout.write(value));
  if (argv.length === 0) {
    write(`${JSON.stringify(noAction())}\n`);
    return;
  }
  if (argv.length !== 2 || argv[0] !== "--execute" || argv[1] !== CONFIRMATION)
    fail("ARGUMENTS_INVALID");
  const environment = options.environment ?? process.env;
  const command = environment[V213_BRIDGE_ENVIRONMENT.command];
  const readFd = options.readFd ?? readProtectedFd;
  let result: V213FullLiveCommandResult;
  try {
    if (command === "fresh-live-preflight") {
      const inputs = readV213PrequalificationProtectedInputs(environment, readFd);
      const runtime = await (
        options.createPrequalificationRuntime ?? createV213PrequalificationRuntime
      )(inputs);
      result = await executeV213FullLiveCommand(inputs.request, runtime);
    } else if (
      CLEANUP_COMMANDS.has(command as V213FullLiveCommand) &&
      environment[V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd] === undefined
    ) {
      const inputs = readV213EarlyCleanupProtectedInputs(environment, readFd);
      const runtime = await (options.createEarlyCleanupRuntime ?? createV213EarlyCleanupRuntime)(
        inputs,
      );
      result = await executeV213FullLiveCommand(inputs.request, runtime);
    } else if (CLEANUP_COMMANDS.has(command as V213FullLiveCommand)) {
      const inputs = readV213CleanupProtectedInputs(environment, readFd);
      const runtime = await (options.createCleanupRuntime ?? createV213CleanupRuntime)(inputs);
      result = await executeV213FullLiveCommand(inputs.request, runtime);
    } else {
      const inputs = readV213ProtectedInputs(environment, readFd);
      const runtime = await (options.createRuntime ?? createV213ProductionRuntime)(inputs);
      result = await executeV213FullLiveCommand(inputs.request, {
        ...runtime,
        protectedValues: Object.freeze([
          ...runtime.protectedValues,
          inputs.runpodApiKey,
          inputs.operatorDatabaseUrl,
          inputs.runtimeDatabaseUrl,
          inputs.reconcilerDatabaseUrl,
          inputs.workerOrigin,
          inputs.workerOperatorBearer,
        ]),
      });
    }
  } catch (error) {
    if (error instanceof V213FullLiveBridgeError) throw error;
    fail("EXECUTION_FAILED");
  }
  write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runV213FullLiveCli(process.argv.slice(2));

export const V213_FULL_LIVE_CLI_CONFIRMATION = CONFIRMATION;
