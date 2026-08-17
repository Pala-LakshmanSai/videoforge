import type { Pool } from "@neondatabase/serverless";

export interface HostedWorkflowBinding {
  create(options?: { id?: string; params?: unknown }): Promise<{ id: string }>;
  get(
    id: string,
  ): Promise<{ status(): Promise<unknown>; sendEvent(event: unknown): Promise<void> }>;
}

export interface HostedR2BucketBinding {
  head(key: string): Promise<unknown | null>;
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
  readonly GCP_PROJECT_ID?: string;
  readonly GCP_REGION?: string;
  readonly GCP_ASR_JOB_NAME?: string;
  readonly GCP_RENDER_JOB_NAME?: string;
  readonly DATABASE_URL?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly R2_ACCOUNT_ID?: string;
  readonly R2_ACCESS_KEY_ID?: string;
  readonly R2_SECRET_ACCESS_KEY?: string;
  readonly GCP_RUN_INVOKER_SERVICE_ACCOUNT_JSON?: string;
  readonly EMAIL_DELIVERY_ENDPOINT?: string;
  readonly EMAIL_DELIVERY_API_KEY?: string;
  readonly WORKFLOW_CALLBACK_SECRET?: string;
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
  readonly cloudRun: {
    readonly projectId: string;
    readonly region: string;
    readonly asrJobName: string;
    readonly renderJobName: string;
    readonly serviceAccountJson: string;
  };
  readonly email: {
    readonly endpoint: string;
    readonly apiKey: string;
  };
  readonly workflowCallbackSecret: string;
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
  "GCP_RUN_INVOKER_SERVICE_ACCOUNT_JSON",
  "EMAIL_DELIVERY_ENDPOINT",
  "EMAIL_DELIVERY_API_KEY",
  "WORKFLOW_CALLBACK_SECRET",
  "VIDEOFORGE_PUBLIC_ORIGIN",
  "VIDEOFORGE_R2_BUCKET_NAME",
  "GCP_PROJECT_ID",
  "GCP_REGION",
  "GCP_ASR_JOB_NAME",
  "GCP_RENDER_JOB_NAME",
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
  const emailEndpoint = httpsOrigin(
    required(source, "EMAIL_DELIVERY_ENDPOINT"),
    "EMAIL_DELIVERY_ENDPOINT",
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
    cloudRun: Object.freeze({
      projectId: required(source, "GCP_PROJECT_ID"),
      region: required(source, "GCP_REGION"),
      asrJobName: required(source, "GCP_ASR_JOB_NAME"),
      renderJobName: required(source, "GCP_RENDER_JOB_NAME"),
      serviceAccountJson: required(source, "GCP_RUN_INVOKER_SERVICE_ACCOUNT_JSON"),
    }),
    email: Object.freeze({
      endpoint: emailEndpoint,
      apiKey: required(source, "EMAIL_DELIVERY_API_KEY"),
    }),
    workflowCallbackSecret,
    toJSON: () => redacted,
  });
}

export type HostedNeonPool = Pick<Pool, "query" | "connect" | "end">;
