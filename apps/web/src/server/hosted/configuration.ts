import type { Pool } from "@neondatabase/serverless";

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
  readonly PRIVATE_ARTIFACTS?: HostedR2BucketBinding;
  readonly VIDEO_WORKFLOW?: HostedWorkflowBinding;
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
}

export interface HostedRuntimeConfiguration {
  readonly commit: string;
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
    readonly publicOrigin: string;
  };
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
      `Hosted staging requires bindings: ${missing.join(", ")}.`,
      missing,
    );
  }
  if (source.VIDEOFORGE_PROVIDER_MODE !== "staging") {
    throw new HostedConfigurationError("The hosted V2-06 worker must run only in staging mode.");
  }
  const publicOrigin = httpsOrigin(
    required(source, "VIDEOFORGE_PUBLIC_ORIGIN"),
    "VIDEOFORGE_PUBLIC_ORIGIN",
  );
  const databaseUrl = required(source, "DATABASE_URL");
  if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    throw new HostedConfigurationError("DATABASE_URL must be a PostgreSQL URL.", ["DATABASE_URL"]);
  }
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
    publicOrigin,
  });
  return Object.freeze({
    commit: source.VIDEOFORGE_COMMIT ?? "uncommitted",
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

export type HostedNeonPool = Pick<Pool, "query" | "connect" | "end">;
