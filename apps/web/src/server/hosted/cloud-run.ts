const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_RUN_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

interface ServiceAccountKey {
  readonly clientEmail: string;
  readonly privateKey: string;
  readonly privateKeyId: string;
  readonly tokenUri: string;
}

interface AccessToken {
  readonly value: string;
  readonly expiresAtMs: number;
}

/** Historical V2-06 adapter retained only for rollback/source evidence. */
export interface LegacyCloudRunConfiguration {
  readonly projectId: string;
  readonly region: string;
  readonly asrJobName: string;
  readonly renderJobName: string;
  readonly serviceAccountJson: string;
}

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function serviceAccount(value: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Cloud Run invoker credential is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Cloud Run invoker credential is malformed.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.type !== "service_account" ||
    typeof record.client_email !== "string" ||
    typeof record.private_key !== "string" ||
    typeof record.private_key_id !== "string" ||
    record.token_uri !== GOOGLE_TOKEN_URL
  ) {
    throw new TypeError("Cloud Run invoker credential has an unsupported shape.");
  }
  return Object.freeze({
    clientEmail: record.client_email,
    privateKey: record.private_key,
    privateKeyId: record.private_key_id,
    tokenUri: record.token_uri,
  });
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const privateKeyLabel = "PRIVATE KEY";
  const body = pem
    .replace(`-----BEGIN ${privateKeyLabel}-----`, "")
    .replace(`-----END ${privateKeyLabel}-----`, "")
    .replace(/\s/gu, "");
  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function executionNamesForAttempt(
  executions: unknown,
  attemptId: string,
): readonly string[] {
  if (!Array.isArray(executions)) throw new Error("Cloud Run execution list was malformed.");
  const matches = new Set<string>();
  for (const item of executions) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const execution = item as Record<string, unknown>;
    const template = execution.template;
    if (typeof template !== "object" || template === null || Array.isArray(template)) continue;
    const containers = (template as Record<string, unknown>).containers;
    if (!Array.isArray(containers)) continue;
    const ownsAttempt = containers.some((container) => {
      if (typeof container !== "object" || container === null || Array.isArray(container))
        return false;
      const env = (container as Record<string, unknown>).env;
      return (
        Array.isArray(env) &&
        env.some(
          (variable) =>
            typeof variable === "object" &&
            variable !== null &&
            !Array.isArray(variable) &&
            (variable as Record<string, unknown>).name === "VIDEOFORGE_ATTEMPT_ID" &&
            (variable as Record<string, unknown>).value === attemptId,
        )
      );
    });
    if (ownsAttempt && typeof execution.name === "string") matches.add(execution.name);
  }
  return [...matches].sort();
}

export class CloudRunJobsClient {
  readonly #key: ServiceAccountKey;
  readonly #config: LegacyCloudRunConfiguration;
  readonly #fetch: typeof fetch;
  #accessToken: AccessToken | null = null;

  constructor(config: LegacyCloudRunConfiguration, fetchImplementation: typeof fetch = fetch) {
    this.#config = config;
    this.#key = serviceAccount(config.serviceAccountJson);
    this.#fetch = fetchImplementation;
  }

  async #token(now = new Date()): Promise<string> {
    if (this.#accessToken && this.#accessToken.expiresAtMs - now.getTime() > 60_000)
      return this.#accessToken.value;
    const issuedAt = Math.floor(now.getTime() / 1_000);
    const header = base64Url(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: this.#key.privateKeyId }),
    );
    const payload = base64Url(
      JSON.stringify({
        iss: this.#key.clientEmail,
        scope: CLOUD_RUN_SCOPE,
        aud: this.#key.tokenUri,
        iat: issuedAt,
        exp: issuedAt + 3_600,
      }),
    );
    const unsigned = `${header}.${payload}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      await importPrivateKey(this.#key.privateKey),
      new TextEncoder().encode(unsigned),
    );
    const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
    const response = await this.#fetch(this.#key.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok)
      throw new Error(`Google OAuth token exchange returned HTTP ${response.status}.`);
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new Error("Google OAuth token response was malformed.");
    }
    this.#accessToken = {
      value: body.access_token,
      expiresAtMs: now.getTime() + body.expires_in * 1_000,
    };
    return body.access_token;
  }

  #jobName(kind: "ASR" | "RENDER"): string {
    return kind === "ASR" ? this.#config.asrJobName : this.#config.renderJobName;
  }

  async run(input: {
    readonly attemptId: string;
    readonly kind: "ASR" | "RENDER";
    readonly jobSpecUrl: string;
    readonly callbackUrl: string;
    readonly callbackToken: string;
    readonly taskTimeoutSeconds: number;
  }): Promise<{ readonly operationNameSha256: string; readonly providerOperationName: string }> {
    for (const value of [input.jobSpecUrl, input.callbackUrl]) {
      if (new URL(value).protocol !== "https:")
        throw new TypeError("Cloud Run ports must use HTTPS.");
    }
    if (
      !Number.isSafeInteger(input.taskTimeoutSeconds) ||
      input.taskTimeoutSeconds < 60 ||
      input.taskTimeoutSeconds > 86_400
    ) {
      throw new RangeError("Cloud Run task timeout is outside the V2-06 bound.");
    }
    const job = `projects/${this.#config.projectId}/locations/${this.#config.region}/jobs/${this.#jobName(input.kind)}`;
    const response = await this.#fetch(`https://run.googleapis.com/v2/${job}:run`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.#token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        overrides: {
          taskCount: 1,
          timeout: `${input.taskTimeoutSeconds}s`,
          containerOverrides: [
            {
              name: "media-job",
              env: [
                { name: "VIDEOFORGE_JOB_SPEC_URL", value: input.jobSpecUrl },
                { name: "VIDEOFORGE_JOB_CALLBACK_URL", value: input.callbackUrl },
                { name: "VIDEOFORGE_JOB_CALLBACK_TOKEN", value: input.callbackToken },
                { name: "VIDEOFORGE_ATTEMPT_ID", value: input.attemptId },
              ],
            },
          ],
        },
      }),
    });
    if (!response.ok) throw new Error(`Cloud Run jobs.run returned HTTP ${response.status}.`);
    const body = (await response.json()) as { name?: unknown };
    if (typeof body.name !== "string" || !body.name.startsWith("projects/")) {
      throw new Error("Cloud Run jobs.run returned no exact execution operation name.");
    }
    return Object.freeze({
      providerOperationName: body.name,
      operationNameSha256: await sha256(body.name),
    });
  }

  async findExecution(kind: "ASR" | "RENDER", attemptId: string): Promise<string | null> {
    const job = `projects/${this.#config.projectId}/locations/${this.#config.region}/jobs/${this.#jobName(kind)}`;
    const matches = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const url = new URL(`https://run.googleapis.com/v2/${job}/executions`);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.#fetch(url, {
        headers: { authorization: `Bearer ${await this.#token()}` },
      });
      if (!response.ok)
        throw new Error(`Cloud Run execution reconciliation returned HTTP ${response.status}.`);
      const body = (await response.json()) as { executions?: unknown; nextPageToken?: unknown };
      for (const name of executionNamesForAttempt(body.executions, attemptId)) matches.add(name);
      pageToken =
        typeof body.nextPageToken === "string" && body.nextPageToken
          ? body.nextPageToken
          : undefined;
      if (!pageToken) break;
    }
    if (matches.size > 1)
      throw new Error("Cloud Run reconciliation found conflicting executions for one attempt.");
    return [...matches][0] ?? null;
  }

  async observeOperation(providerOperationName: string): Promise<unknown> {
    const response = await this.#fetch(`https://run.googleapis.com/v2/${providerOperationName}`, {
      headers: { authorization: `Bearer ${await this.#token()}` },
    });
    if (!response.ok)
      throw new Error(`Cloud Run execution observation returned HTTP ${response.status}.`);
    return response.json();
  }

  async observeExecution(providerExecutionName: string): Promise<unknown> {
    const response = await this.#fetch(`https://run.googleapis.com/v2/${providerExecutionName}`, {
      headers: { authorization: `Bearer ${await this.#token()}` },
    });
    if (!response.ok)
      throw new Error(`Cloud Run execution observation returned HTTP ${response.status}.`);
    return response.json();
  }

  async cancelExecution(providerExecutionName: string): Promise<void> {
    const response = await this.#fetch(
      `https://run.googleapis.com/v2/${providerExecutionName}:cancel`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.#token()}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    if (!response.ok)
      throw new Error(`Cloud Run execution cancellation returned HTTP ${response.status}.`);
  }
}
