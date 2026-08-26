import type { Pool } from "@neondatabase/serverless";
import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

import {
  evaluateHostedPairProductionGate,
  hostedPairProductionBindingState,
  type HostedPairProductionGateInput,
} from "./hosted-pair-production-composition";

export interface HostedWorkflowBinding {
  create(options?: { id?: string; params?: unknown }): Promise<{ id: string }>;
  get(
    id: string,
  ): Promise<{ status(): Promise<unknown>; sendEvent(event: unknown): Promise<void> }>;
}

export interface HostedR2BucketBinding {
  head(key: string): Promise<{
    readonly size: number;
    readonly httpMetadata?: { readonly contentType?: string };
    readonly checksums?: { readonly sha256?: ArrayBuffer };
  } | null>;
  get(key: string): Promise<{
    readonly size: number;
    readonly httpMetadata?: { readonly contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: unknown,
  ): Promise<unknown>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{
    readonly objects: readonly { readonly key: string }[];
    readonly truncated: boolean;
    readonly cursor?: string;
  }>;
  delete(key: string | readonly string[]): Promise<void>;
}

export interface HostedRuntimeEnvironment {
  readonly ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  /** Cloudflare's immutable version identity; exposed only for the V2-07 route fingerprint. */
  readonly CF_VERSION_METADATA?: {
    readonly id: string;
    readonly tag: string;
    readonly timestamp: string;
  };
  readonly PRIVATE_ARTIFACTS?: HostedR2BucketBinding;
  readonly VIDEO_WORKFLOW?: HostedWorkflowBinding;
  readonly HOSTED_PAIR_WORKFLOW?: HostedWorkflowBinding;
  readonly VIDEOFORGE_COMMIT?: string;
  readonly VIDEOFORGE_ENVIRONMENT?: string;
  readonly VIDEOFORGE_PROVIDER_MODE?: string;
  readonly VIDEOFORGE_PUBLIC_ORIGIN?: string;
  readonly VIDEOFORGE_R2_BUCKET_NAME?: string;
  readonly VIDEOFORGE_R2_REGION?: string;
  readonly MEDIA_WORKER_RELEASE_MANIFEST_JSON?: string;
  readonly DATABASE_URL?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly R2_ACCOUNT_ID?: string;
  readonly R2_ACCESS_KEY_ID?: string;
  readonly R2_SECRET_ACCESS_KEY?: string;
  readonly WORKFLOW_CALLBACK_SECRET?: string;
  readonly MEDIA_WORKER_TOKEN_SECRET?: string;
  readonly VIDEOFORGE_V207_AUTHORITY_NONCE?: string;
  /** Paid pair bindings remain optional while production is DISABLED_UNQUALIFIED. They must be
   * configured as secret bindings, never Wrangler vars, before the qualified composition exists. */
  readonly VIDEOFORGE_GPU_TRANSPORT?: string;
  readonly VIDEOFORGE_RECONCILER_DATABASE_URL?: string;
  readonly VIDEOFORGE_DISPATCH_TOKEN_KEY?: string;
  readonly VIDEOFORGE_DISPATCH_TOKEN_KEY_ID?: string;
  readonly VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX?: string;
  readonly VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID?: string;
  readonly VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY?: string;
  readonly VIDEOFORGE_PROVIDER_PROOF_KEY_ID?: string;
  readonly VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN?: string;
  readonly RUNPOD_API_KEY?: string;
  readonly RUNPOD_API_BASE_URL?: string;
  readonly VIDEOFORGE_MAGE_ENDPOINT_ID?: string;
  readonly VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256?: string;
  readonly VIDEOFORGE_SOULX_ENDPOINT_ID?: string;
  readonly VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256?: string;
}

export interface HostedRuntimeConfiguration {
  readonly commit: string;
  readonly environment: "staging" | "production";
  readonly gpuTransport: "DISABLED_UNQUALIFIED" | "QUALIFIED_EXACT";
  readonly gpuActivation: HostedQualifiedGpuActivationSummary | null;
  readonly publicOrigin: string;
  readonly r2: {
    readonly accountId: string;
    readonly bucketName: string;
    readonly region: "auto";
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly neon: { readonly databaseUrl: string };
  readonly auth: {
    readonly secret: string;
    readonly googleClientId: string;
    readonly googleClientSecret: string;
  };
  readonly mediaWorkerRelease: {
    readonly version: string;
    readonly minimumProtocolVersion: number;
    readonly executionBundleSha256: string;
    readonly whisperModelSha256: string;
    readonly windows: {
      readonly url: string;
      readonly sha256: string;
      readonly sizeBytes: number;
      readonly trust: "UNSIGNED_BETA" | "AUTHENTICODE_SIGNED";
    };
    readonly macos: {
      readonly url: string;
      readonly sha256: string;
      readonly sizeBytes: number;
      readonly trust: "AD_HOC_BETA" | "DEVELOPER_ID_NOTARIZED";
    };
  };
  readonly workflowCallbackSecret: string;
  readonly mediaWorkerTokenSecret: string;
  toJSON(): {
    readonly schemaVersion: "videoforge-hosted-configuration/v1";
    readonly credentials: "REDACTED";
    readonly commit: string;
    readonly environment: "staging" | "production";
    readonly gpuTransport: "DISABLED_UNQUALIFIED" | "QUALIFIED_EXACT";
    readonly publicOrigin: string;
  };
}

export interface HostedQualifiedGpuActivationSummary {
  readonly evidenceSha256: Sha256;
  readonly activationSnapshotSha256: Sha256;
  readonly paidApprovalLedgerSha256: Sha256;
  readonly migrationLedgerSha256: Sha256;
  readonly qualificationRecordSha256s: Readonly<{
    mage_image: Sha256;
    soulx_avatar: Sha256;
  }>;
  readonly deploymentSnapshotSha256s: Readonly<{
    mage_image: Sha256;
    soulx_avatar: Sha256;
  }>;
}

export interface HostedVerifiedQualifiedGpuActivation {
  readonly verifierId: "videoforge-hosted-qualified-gpu-activation-verifier-v1";
  readonly accepted: true;
  readonly signatureVerified: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly sourceCommit: string;
  readonly databaseObservedAt: string;
  readonly expiresAt: string;
  readonly activationSnapshotSha256: Sha256;
  readonly paidApprovalLedgerSha256: Sha256;
  readonly gate: HostedPairProductionGateInput;
}

export interface HostedQualifiedGpuActivationVerifier {
  /** Verifies the opaque database-backed activation snapshot and its independent signature. */
  verify(
    evidence: Readonly<Record<string, unknown>>,
  ): Promise<HostedVerifiedQualifiedGpuActivation>;
}

export interface HostedQualifiedGpuActivationDatabaseSource {
  /** Reads one SECURITY DEFINER snapshot from the runtime database. No caller evidence is trusted. */
  load(): Promise<{
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly verification: HostedVerifiedQualifiedGpuActivation;
  }>;
}

export class HostedConfigurationError extends Error {
  readonly code = "HOSTED_CONFIGURATION_INVALID";
  readonly missing: readonly string[];

  constructor(message: string, missing: readonly string[] = []) {
    super(message);
    this.name = "HostedConfigurationError";
    this.missing = Object.freeze([...missing]);
  }
}

async function rawSha256(value: string): Promise<Sha256> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as Sha256;
}

const REQUIRED = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "VIDEOFORGE_PUBLIC_ORIGIN",
  "VIDEOFORGE_R2_BUCKET_NAME",
  "MEDIA_WORKER_RELEASE_MANIFEST_JSON",
] as const;

function required(source: HostedRuntimeEnvironment, key: (typeof REQUIRED)[number]): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new HostedConfigurationError(`Hosted binding ${key} is missing or malformed.`, [key]);
  }
  return value;
}

function httpsOrigin(value: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HostedConfigurationError(`${key} must be an absolute HTTPS URL.`, [key]);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new HostedConfigurationError(`${key} must be a credential-free HTTPS URL.`, [key]);
  }
  return parsed.pathname === "/" ? parsed.origin : parsed.toString().replace(/\/$/u, "");
}

function protectedDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HostedConfigurationError(
      "DATABASE_URL must be a valid PostgreSQL URL with TLS and channel binding.",
      ["DATABASE_URL"],
    );
  }
  const sslModes = parsed.searchParams.getAll("sslmode");
  const channelBindings = parsed.searchParams.getAll("channel_binding");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.hash !== "" ||
    sslModes.length !== 1 ||
    sslModes[0] !== "require" ||
    channelBindings.length !== 1 ||
    channelBindings[0] !== "require"
  ) {
    throw new HostedConfigurationError(
      "DATABASE_URL must require PostgreSQL TLS and channel binding.",
      ["DATABASE_URL"],
    );
  }
  return value;
}

function releaseFile(
  value: unknown,
  platform: "windows",
): Readonly<{
  url: string;
  sha256: string;
  sizeBytes: number;
  trust: "UNSIGNED_BETA" | "AUTHENTICODE_SIGNED";
}>;
function releaseFile(
  value: unknown,
  platform: "macos",
): Readonly<{
  url: string;
  sha256: string;
  sizeBytes: number;
  trust: "AD_HOC_BETA" | "DEVELOPER_ID_NOTARIZED";
}>;
function releaseFile(value: unknown, platform: "windows" | "macos") {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostedConfigurationError(`Media worker ${platform} release is malformed.`, [
      "MEDIA_WORKER_RELEASE_MANIFEST_JSON",
    ]);
  }
  const file = value as Record<string, unknown>;
  if (
    Object.keys(file).sort().join(",") !== "sha256,size_bytes,trust,url" ||
    typeof file.url !== "string" ||
    typeof file.sha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(file.sha256) ||
    !Number.isSafeInteger(file.size_bytes) ||
    Number(file.size_bytes) < 1 ||
    (platform === "windows" &&
      !["UNSIGNED_BETA", "AUTHENTICODE_SIGNED"].includes(String(file.trust))) ||
    (platform === "macos" &&
      !["AD_HOC_BETA", "DEVELOPER_ID_NOTARIZED"].includes(String(file.trust)))
  ) {
    throw new HostedConfigurationError(`Media worker ${platform} release is malformed.`, [
      "MEDIA_WORKER_RELEASE_MANIFEST_JSON",
    ]);
  }
  return Object.freeze({
    url: httpsOrigin(file.url, `media worker ${platform} URL`),
    sha256: file.sha256,
    sizeBytes: Number(file.size_bytes),
    trust: file.trust,
  });
}

function mediaWorkerRelease(value: string): HostedRuntimeConfiguration["mediaWorkerRelease"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HostedConfigurationError("Media worker release manifest is not valid JSON.", [
      "MEDIA_WORKER_RELEASE_MANIFEST_JSON",
    ]);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HostedConfigurationError("Media worker release manifest is malformed.", [
      "MEDIA_WORKER_RELEASE_MANIFEST_JSON",
    ]);
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "execution_bundle_sha256,macos,minimum_protocol_version,schema_version,version,whisper_model_sha256,windows" ||
    record.schema_version !== "videoforge-media-worker-release/v1" ||
    typeof record.version !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(record.version) ||
    !Number.isSafeInteger(record.minimum_protocol_version) ||
    Number(record.minimum_protocol_version) < 1 ||
    typeof record.execution_bundle_sha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(record.execution_bundle_sha256) ||
    typeof record.whisper_model_sha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(record.whisper_model_sha256)
  ) {
    throw new HostedConfigurationError("Media worker release manifest is malformed.", [
      "MEDIA_WORKER_RELEASE_MANIFEST_JSON",
    ]);
  }
  return Object.freeze({
    version: record.version,
    minimumProtocolVersion: Number(record.minimum_protocol_version),
    executionBundleSha256: record.execution_bundle_sha256,
    whisperModelSha256: record.whisper_model_sha256,
    windows: releaseFile(record.windows, "windows"),
    macos: releaseFile(record.macos, "macos"),
  });
}

export function hostedRuntimeConfiguration(
  source: HostedRuntimeEnvironment,
): HostedRuntimeConfiguration {
  const missing = REQUIRED.filter((key) => {
    const value = source[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (!source.PRIVATE_ARTIFACTS) missing.push("PRIVATE_ARTIFACTS" as never);
  if (!source.VIDEO_WORKFLOW) missing.push("VIDEO_WORKFLOW" as never);
  if (missing.length > 0) {
    throw new HostedConfigurationError(
      `Hosted runtime requires bindings: ${missing.join(", ")}.`,
      missing,
    );
  }
  if (
    source.VIDEOFORGE_PROVIDER_MODE !== "staging" &&
    source.VIDEOFORGE_PROVIDER_MODE !== "production"
  ) {
    throw new HostedConfigurationError(
      "The hosted runtime requires an exact staging or production provider mode.",
      ["VIDEOFORGE_PROVIDER_MODE"],
    );
  }
  const environment = source.VIDEOFORGE_PROVIDER_MODE;
  const publicOrigin = httpsOrigin(
    required(source, "VIDEOFORGE_PUBLIC_ORIGIN"),
    "VIDEOFORGE_PUBLIC_ORIGIN",
  );
  const databaseUrl = protectedDatabaseUrl(required(source, "DATABASE_URL"));
  const secret = required(source, "BETTER_AUTH_SECRET");
  if (secret.length < 32) {
    throw new HostedConfigurationError("BETTER_AUTH_SECRET must contain at least 32 characters.", [
      "BETTER_AUTH_SECRET",
    ]);
  }
  const workflowCallbackSecret = required(source, "WORKFLOW_CALLBACK_SECRET");
  if (workflowCallbackSecret.length < 32) {
    throw new HostedConfigurationError(
      "WORKFLOW_CALLBACK_SECRET must contain at least 32 characters.",
      ["WORKFLOW_CALLBACK_SECRET"],
    );
  }
  const mediaWorkerTokenSecret = required(source, "MEDIA_WORKER_TOKEN_SECRET");
  if (mediaWorkerTokenSecret.length < 32 || mediaWorkerTokenSecret === workflowCallbackSecret) {
    throw new HostedConfigurationError(
      "MEDIA_WORKER_TOKEN_SECRET must contain at least 32 characters and differ from callback authority.",
      ["MEDIA_WORKER_TOKEN_SECRET"],
    );
  }
  const redacted = Object.freeze({
    schemaVersion: "videoforge-hosted-configuration/v1" as const,
    credentials: "REDACTED" as const,
    commit: source.VIDEOFORGE_COMMIT ?? "uncommitted",
    environment,
    gpuTransport: "DISABLED_UNQUALIFIED" as const,
    publicOrigin,
  });
  return Object.freeze({
    commit: source.VIDEOFORGE_COMMIT ?? "uncommitted",
    environment,
    // V2-09 production-mode truth does not imply a qualified GPU lane. A later exact composition
    // must replace this fail-closed value only after both live lane gates pass.
    gpuTransport: "DISABLED_UNQUALIFIED" as const,
    gpuActivation: null,
    publicOrigin,
    neon: Object.freeze({ databaseUrl }),
    auth: Object.freeze({
      secret,
      googleClientId: required(source, "GOOGLE_CLIENT_ID"),
      googleClientSecret: required(source, "GOOGLE_CLIENT_SECRET"),
    }),
    r2: Object.freeze({
      accountId: required(source, "R2_ACCOUNT_ID"),
      bucketName: required(source, "VIDEOFORGE_R2_BUCKET_NAME"),
      region: "auto" as const,
      accessKeyId: required(source, "R2_ACCESS_KEY_ID"),
      secretAccessKey: required(source, "R2_SECRET_ACCESS_KEY"),
    }),
    mediaWorkerRelease: mediaWorkerRelease(required(source, "MEDIA_WORKER_RELEASE_MANIFEST_JSON")),
    workflowCallbackSecret,
    mediaWorkerTokenSecret,
    toJSON: () => redacted,
  });
}

const GPU_ACTIVATION_MAX_AGE_MS = 5 * 60 * 1_000;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/** Resolves the enabled transport only from a freshly verified DB-backed activation snapshot.
 * The environment flag is necessary but never sufficient. The default configuration above stays
 * disabled for every caller that does not cross this verifier boundary. */
export async function qualifiedHostedRuntimeConfiguration(input: {
  readonly source: HostedRuntimeEnvironment;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly verifier: HostedQualifiedGpuActivationVerifier;
  readonly now?: () => Date;
}): Promise<HostedRuntimeConfiguration> {
  const disabled = hostedRuntimeConfiguration(input.source);
  if (
    disabled.environment !== "production" ||
    input.source.VIDEOFORGE_GPU_TRANSPORT !== "QUALIFIED_EXACT"
  )
    return disabled;
  try {
    if (hostedPairProductionBindingState(input.source).state !== "BINDINGS_PRESENT")
      return disabled;
  } catch {
    return disabled;
  }

  let verified: HostedVerifiedQualifiedGpuActivation;
  try {
    verified = await input.verifier.verify(structuredClone(input.evidence));
  } catch {
    return disabled;
  }
  const now = (input.now ?? (() => new Date()))().getTime();
  const observedAt = Date.parse(verified.databaseObservedAt);
  const expiresAt = Date.parse(verified.expiresAt);
  const activationSnapshotSha256 = canonicalSha256(verified.gate);
  const deployedVersionId = input.source.CF_VERSION_METADATA?.id;
  const deployedVersionIdSha256 =
    typeof deployedVersionId === "string" ? await rawSha256(deployedVersionId) : null;
  const enabledConfigSha256 = (input.evidence as Record<string, unknown>).enabledConfigSha256;
  if (
    verified.verifierId !== "videoforge-hosted-qualified-gpu-activation-verifier-v1" ||
    verified.accepted !== true ||
    verified.signatureVerified !== true ||
    verified.canonicalEvidenceSha256 !== canonicalSha256(input.evidence) ||
    !SHA256_PATTERN.test(verified.verifierSignatureSha256) ||
    !/^[0-9a-f]{40}$/u.test(verified.sourceCommit) ||
    verified.sourceCommit !== disabled.commit ||
    !Number.isFinite(now) ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(expiresAt) ||
    observedAt > now ||
    now - observedAt > GPU_ACTIVATION_MAX_AGE_MS ||
    expiresAt <= now ||
    expiresAt - observedAt > GPU_ACTIVATION_MAX_AGE_MS ||
    verified.databaseObservedAt !== verified.gate.now ||
    verified.activationSnapshotSha256 !== activationSnapshotSha256 ||
    !SHA256_PATTERN.test(verified.paidApprovalLedgerSha256) ||
    verified.gate.gpuTransport !== "QUALIFIED_EXACT" ||
    deployedVersionIdSha256 === null ||
    verified.gate.cloudflare.versionIdSha256 !== deployedVersionIdSha256 ||
    verified.gate.cloudflare.sourceCommit !== disabled.commit ||
    verified.gate.cloudflare.deployedConfigSha256 !== enabledConfigSha256 ||
    verified.gate.bindings.runtimeDatabase !== "VIDEOFORGE_RUNTIME_DATABASE" ||
    verified.gate.bindings.reconcilerDatabase !== "VIDEOFORGE_RECONCILER_DATABASE" ||
    verified.gate.bindings.dispatchTokenKey !== "VIDEOFORGE_DISPATCH_TOKEN_KEY" ||
    verified.gate.bindings.envelopeSignerKey !== "VIDEOFORGE_ENVELOPE_SIGNING_KEY" ||
    verified.gate.bindings.providerProofVerifierKey !== "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY" ||
    verified.gate.bindings.workflowOperatorToken !== "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN" ||
    evaluateHostedPairProductionGate(verified.gate).state !== "READY"
  ) {
    return disabled;
  }

  const summary: HostedQualifiedGpuActivationSummary = Object.freeze({
    evidenceSha256: verified.canonicalEvidenceSha256,
    activationSnapshotSha256,
    paidApprovalLedgerSha256: verified.paidApprovalLedgerSha256,
    migrationLedgerSha256: canonicalSha256(verified.gate.migrationLedger),
    qualificationRecordSha256s: Object.freeze({
      mage_image: verified.gate.qualifications.mage_image.qualificationRecordSha256 as Sha256,
      soulx_avatar: verified.gate.qualifications.soulx_avatar.qualificationRecordSha256 as Sha256,
    }),
    deploymentSnapshotSha256s: Object.freeze({
      mage_image: verified.gate.deployments.mage_image.deploymentSnapshotSha256 as Sha256,
      soulx_avatar: verified.gate.deployments.soulx_avatar.deploymentSnapshotSha256 as Sha256,
    }),
  });
  const redacted = Object.freeze({
    schemaVersion: "videoforge-hosted-configuration/v1" as const,
    credentials: "REDACTED" as const,
    commit: disabled.commit,
    environment: disabled.environment,
    gpuTransport: "QUALIFIED_EXACT" as const,
    publicOrigin: disabled.publicOrigin,
  });
  return Object.freeze({
    ...disabled,
    gpuTransport: "QUALIFIED_EXACT" as const,
    gpuActivation: summary,
    toJSON: () => redacted,
  });
}

/** Production request resolver. An absent, failing, or drifted database seam stays disabled. */
export async function configuredHostedRuntimeConfiguration(input: {
  readonly source: HostedRuntimeEnvironment;
  readonly databaseSource?: HostedQualifiedGpuActivationDatabaseSource;
  readonly now?: () => Date;
}): Promise<HostedRuntimeConfiguration> {
  const disabled = hostedRuntimeConfiguration(input.source);
  if (
    disabled.environment !== "production" ||
    input.source.VIDEOFORGE_GPU_TRANSPORT !== "QUALIFIED_EXACT" ||
    !input.databaseSource
  )
    return disabled;
  let loaded: Awaited<ReturnType<HostedQualifiedGpuActivationDatabaseSource["load"]>>;
  try {
    loaded = await input.databaseSource.load();
  } catch {
    return disabled;
  }
  return qualifiedHostedRuntimeConfiguration({
    source: input.source,
    evidence: loaded.evidence,
    verifier: { verify: async () => loaded.verification },
    now: input.now,
  });
}

export type HostedNeonPool = Pick<Pool, "query" | "connect" | "end">;
