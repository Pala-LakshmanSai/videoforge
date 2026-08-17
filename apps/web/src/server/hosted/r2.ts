import { AwsClient } from "aws4fetch";

import type { HostedRuntimeConfiguration } from "./configuration";

const EXACT_KEY =
  /^tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/project\/[A-Za-z0-9._:-]+\/revision\/[A-Za-z0-9._:-]+\/lane\/(?:input|mage-image|soulx-avatar|render|provenance)\/job\/[A-Za-z0-9._:-]+\/artifact\/[A-Za-z0-9._:-]+$/u;

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
      input.contentLength < 0 ||
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
}
