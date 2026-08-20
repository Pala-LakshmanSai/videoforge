import { AwsClient } from "aws4fetch";

import type { HostedR2BucketBinding, HostedRuntimeConfiguration } from "./configuration";

const EXACT_KEY =
  /^(?:tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/project\/[A-Za-z0-9._:-]+\/revision\/[A-Za-z0-9._:-]+\/lane\/(?:input|mage-image|soulx-avatar|render|provenance)\/job\/[A-Za-z0-9._:-]+\/artifact\/[A-Za-z0-9._:-]+|tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/avatar-profile\/[A-Za-z0-9._:-]+\/version\/[A-Za-z0-9._:-]+\/(?:original|canonical|thumbnail)\/[A-Za-z0-9._:-]+)$/u;
const HOSTED_JOB_ARTIFACT_PREFIX =
  /^tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/project\/[A-Za-z0-9._:-]+\/revision\/[A-Za-z0-9._:-]+\/lane\/(?:input|render)\/job\/[A-Za-z0-9._:-]+\/artifact\/$/u;
const MAX_GENERATED_OUTPUT_LIFETIME_SECONDS = 7_200;

/** Exact single-artifact key grammar shared by signed ports and rollback operations. */
export function isExactHostedR2ObjectKey(value: string): boolean {
  return EXACT_KEY.test(value);
}

export interface HostedR2DeletionVerification {
  readonly schemaVersion: "videoforge-r2-post-delete-verification/v1";
  readonly objectPrefix: string;
  readonly expectedAbsentKeys: readonly string[];
  readonly remainingKeys: readonly string[];
  readonly verified: true;
}

export function hostedCompleteAttemptArtifactKeys(
  jobSpecObjectKey: string | null | undefined,
  outputObjectKeys: readonly (string | null)[],
): readonly string[] {
  return [...new Set([jobSpecObjectKey, ...outputObjectKeys])]
    .filter((key): key is string => typeof key === "string")
    .sort();
}

/**
 * Delete only one exact personal-worker attempt prefix and prove the prefix is empty before the
 * database is allowed to record durable retention deletion. R2 head checks catch an object that
 * a paginated list could miss; the final list catches unexpected keys under the same attempt.
 */
export async function deleteHostedR2ObjectsAndVerify(
  bucket: HostedR2BucketBinding,
  objectPrefix: string,
  keys: readonly string[],
): Promise<HostedR2DeletionVerification> {
  if (!HOSTED_JOB_ARTIFACT_PREFIX.test(objectPrefix)) {
    throw new TypeError("Hosted R2 deletion requires one exact personal-worker artifact prefix.");
  }
  const expectedAbsentKeys = [...new Set(keys)].sort();
  if (
    expectedAbsentKeys.some(
      (key) =>
        !EXACT_KEY.test(key) ||
        !key.startsWith(objectPrefix) ||
        key.slice(objectPrefix.length).includes("/"),
    )
  ) {
    throw new TypeError("Hosted R2 deletion keys must remain inside one exact attempt prefix.");
  }

  for (let offset = 0; offset < expectedAbsentKeys.length; offset += 1_000) {
    await bucket.delete(expectedAbsentKeys.slice(offset, offset + 1_000));
  }

  const stillPresentByHead: string[] = [];
  for (const key of expectedAbsentKeys) {
    if ((await bucket.head(key)) !== null) stillPresentByHead.push(key);
  }

  const listed: string[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await bucket.list({ prefix: objectPrefix, cursor, limit: 1_000 });
    listed.push(...page.objects.map((object) => object.key));
    if (!page.truncated) {
      cursor = undefined;
      break;
    }
    if (!page.cursor || cursors.has(page.cursor)) {
      throw new Error("Hosted R2 post-delete verification lost pagination state.");
    }
    cursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);

  const remainingKeys = [...new Set([...stillPresentByHead, ...listed])].sort();
  if (remainingKeys.length > 0) {
    throw new Error("Hosted R2 post-delete verification found retained objects.");
  }
  return {
    schemaVersion: "videoforge-r2-post-delete-verification/v1",
    objectPrefix,
    expectedAbsentKeys,
    remainingKeys,
    verified: true,
  };
}

export function hostedJobArtifactPrefix(objectKey: string): string {
  if (!EXACT_KEY.test(objectKey)) {
    throw new TypeError("Hosted R2 object key is not exact worker artifact lineage.");
  }
  const marker = "/artifact/";
  const markerIndex = objectKey.indexOf(marker);
  if (markerIndex < 0) throw new TypeError("Hosted R2 object key has no artifact prefix.");
  const prefix = `${objectKey.slice(0, markerIndex)}${marker}`;
  if (!HOSTED_JOB_ARTIFACT_PREFIX.test(prefix)) {
    throw new TypeError("Hosted R2 object key is not a personal-worker artifact.");
  }
  return prefix;
}

function checksumHeader(value: string): string {
  const bytes = value
    .slice("sha256:".length)
    .match(/.{2}/gu)!
    .map((hex) => Number.parseInt(hex, 16));
  return btoa(String.fromCharCode(...bytes));
}

export interface HostedSignedArtifactPort {
  readonly method: "GET" | "PUT";
  readonly url: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
  readonly expiresAt: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: string;
}

/**
 * A bounded PUT URL for bytes produced after dispatch.  It intentionally omits
 * length and checksum: those facts are measured by the worker and committed
 * through the additive generated-output authority before an exact v3 receipt.
 */
export interface HostedSignedGeneratedArtifactPort {
  readonly method: "PUT";
  readonly url: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
  readonly expiresAt: string;
  readonly contentType: string;
  readonly maxContentLength: number;
}

export class HostedR2Signer {
  readonly #client: AwsClient;
  readonly #endpoint: string;

  constructor(private readonly config: HostedRuntimeConfiguration["r2"]) {
    this.#client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: config.region,
      retries: 0,
    });
    this.#endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucketName)}`;
  }

  async sign(input: {
    method: "GET" | "PUT";
    objectKey: string;
    contentType: string;
    contentLength: number;
    checksumSha256: string;
    lifetimeSeconds: number;
    downloadFilename?: string;
    now?: Date;
  }): Promise<HostedSignedArtifactPort> {
    if (!EXACT_KEY.test(input.objectKey))
      throw new TypeError("R2 object key is not exact tenant lineage.");
    if (
      !Number.isSafeInteger(input.contentLength) ||
      input.contentLength < 1 ||
      input.contentLength > 10 * 1024 ** 3
    ) {
      throw new RangeError("R2 content length is outside the bounded artifact contract.");
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(input.checksumSha256))
      throw new TypeError("R2 checksum is invalid.");
    if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(input.contentType))
      throw new TypeError("R2 content type is invalid.");
    if (
      input.downloadFilename !== undefined &&
      (input.method !== "GET" ||
        !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/u.test(input.downloadFilename))
    ) {
      throw new TypeError("R2 download filename is invalid.");
    }
    const maximumLifetimeSeconds = input.method === "GET" ? 3_600 : 900;
    if (
      !Number.isSafeInteger(input.lifetimeSeconds) ||
      input.lifetimeSeconds < 1 ||
      input.lifetimeSeconds > maximumLifetimeSeconds
    ) {
      throw new RangeError(
        `R2 ${input.method} port lifetime must be between 1 and ${maximumLifetimeSeconds} seconds.`,
      );
    }
    const now = input.now ?? new Date();
    const target = new URL(
      `${this.#endpoint}/${input.objectKey.split("/").map(encodeURIComponent).join("/")}`,
    );
    target.searchParams.set("X-Amz-Expires", String(input.lifetimeSeconds));
    if (input.downloadFilename) {
      target.searchParams.set(
        "response-content-disposition",
        `attachment; filename="${input.downloadFilename}"`,
      );
    }
    // Hosted CPU uploads are not browser uploads. Bind length, type, and checksum into the query
    // signature so R2 rejects any drift from the durable upload authority.
    const headers =
      input.method === "PUT"
        ? {
            "content-length": String(input.contentLength),
            "content-type": input.contentType,
            "x-amz-checksum-sha256": checksumHeader(input.checksumSha256),
          }
        : undefined;
    const signed = await this.#client.sign(target, {
      method: input.method,
      headers,
      aws: {
        signQuery: true,
        allHeaders: input.method === "PUT",
        datetime: now.toISOString().replace(/[-:]|\.\d{3}/gu, ""),
      },
    });
    return Object.freeze({
      method: input.method,
      url: signed.url,
      requiredHeaders: Object.freeze(headers ?? {}),
      expiresAt: new Date(now.getTime() + input.lifetimeSeconds * 1_000).toISOString(),
      contentType: input.contentType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
    });
  }

  async signGenerated(input: {
    objectKey: string;
    contentType: string;
    maxContentLength: number;
    lifetimeSeconds: number;
    now?: Date;
  }): Promise<HostedSignedGeneratedArtifactPort> {
    if (!EXACT_KEY.test(input.objectKey))
      throw new TypeError("R2 object key is not exact tenant lineage.");
    if (
      !Number.isSafeInteger(input.maxContentLength) ||
      input.maxContentLength < 1 ||
      input.maxContentLength > 10 * 1024 ** 3
    ) {
      throw new RangeError("R2 generated output ceiling is outside the bounded artifact contract.");
    }
    if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(input.contentType))
      throw new TypeError("R2 content type is invalid.");
    if (
      !Number.isSafeInteger(input.lifetimeSeconds) ||
      input.lifetimeSeconds < 1 ||
      input.lifetimeSeconds > MAX_GENERATED_OUTPUT_LIFETIME_SECONDS
    ) {
      throw new RangeError(
        `R2 generated PUT port lifetime must be between 1 and ${MAX_GENERATED_OUTPUT_LIFETIME_SECONDS} seconds.`,
      );
    }
    const now = input.now ?? new Date();
    const target = new URL(
      `${this.#endpoint}/${input.objectKey.split("/").map(encodeURIComponent).join("/")}`,
    );
    target.searchParams.set("X-Amz-Expires", String(input.lifetimeSeconds));
    const headers = { "content-type": input.contentType };
    const signed = await this.#client.sign(target, {
      method: "PUT",
      headers,
      aws: {
        signQuery: true,
        allHeaders: true,
        datetime: now.toISOString().replace(/[-:]|\.\d{3}/gu, ""),
      },
    });
    return Object.freeze({
      method: "PUT",
      url: signed.url,
      requiredHeaders: Object.freeze(headers),
      expiresAt: new Date(now.getTime() + input.lifetimeSeconds * 1_000).toISOString(),
      contentType: input.contentType,
      maxContentLength: input.maxContentLength,
    });
  }
}
