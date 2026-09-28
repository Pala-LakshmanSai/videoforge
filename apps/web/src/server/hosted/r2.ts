import { AwsClient } from "aws4fetch";
import { quoteOrdinaryVideoBudget } from "../runtime/ordinary-video-budget";
import { SINGLE_PUT_MAX_BYTES } from "./cloud-media-configuration";

import type { HostedR2BucketBinding, HostedRuntimeConfiguration } from "./configuration";

const EXACT_KEY =
  /^(?:tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/project\/[A-Za-z0-9._:-]+\/revision\/[A-Za-z0-9._:-]+\/lane\/(?:input|mage-image|soulx-avatar|render|provenance)\/job\/[A-Za-z0-9._:-]+\/artifact\/[A-Za-z0-9._:-]+|tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/avatar-profile\/[A-Za-z0-9._:-]+\/version\/[A-Za-z0-9._:-]+\/(?:original|canonical|thumbnail)\/[A-Za-z0-9._:-]+|tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/style-profile\/[A-Za-z0-9._:-]+\/version\/[A-Za-z0-9._:-]+\/(?:original|normalized|thumbnail)\/[A-Za-z0-9._:-]+)$/u;
const HOSTED_JOB_ARTIFACT_PREFIX =
  /^tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/project\/[A-Za-z0-9._:-]+\/revision\/[A-Za-z0-9._:-]+\/lane\/(?:input|render)\/job\/[A-Za-z0-9._:-]+\/artifact\/$/u;
const MAX_GENERATED_OUTPUT_LIFETIME_SECONDS = 7_200;
const MULTIPART_INVENTORY_PAGE_BYTES = 1_048_576;

interface InventoryXmlNode {
  readonly name: string;
  text: string;
  readonly children: InventoryXmlNode[];
}

function inventoryXmlCodePoint(code: number): boolean {
  return [9, 10, 13].includes(code) || code >= 0x20 && code <= 0xd7ff ||
    code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;
}

function inventoryXmlText(value: string): string {
  if ([...value].some(character => !inventoryXmlCodePoint(character.codePointAt(0)!)) ||
      value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/giu, "").includes("&"))
    throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
  return value.replace(/&([^;]+);/gu, (_match, entity: string) => {
    const named: Record<string, string> = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'"};
    if (named[entity] !== undefined) return named[entity]!;
    const code = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(code) || !inventoryXmlCodePoint(code))
      throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
    return String.fromCodePoint(code);
  });
}

/** Small strict XML reader for S3 inventory; no DOM, DTD, external entity or dependency. */
function inventoryXml(source: string): InventoryXmlNode {
  const input = source.trim().replace(
    /^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?(?:\s+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>\s*/u,
    "",
  );
  const stack: InventoryXmlNode[] = [];
  let root: InventoryXmlNode | undefined, offset = 0, count = 0;
  for (const token of input.matchAll(/<[^>]*>|[^<]+/gu)) {
    if (token.index !== offset) throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
    offset += token[0].length;
    const text = token[0];
    if (!text.startsWith("<")) {
      if (stack.length) stack[stack.length - 1]!.text += inventoryXmlText(text);
      else if (text.trim()) throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
      continue;
    }
    const closing = /^<\/([A-Za-z_][A-Za-z0-9_.:-]*)\s*>$/u.exec(text);
    if (closing) {
      const node = stack.pop();
      if (!node || node.name !== closing[1] || node.children.length && node.text.trim())
        throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
      continue;
    }
    const opening = /^<([A-Za-z_][A-Za-z0-9_.:-]*)((?:\s+[A-Za-z_][A-Za-z0-9_.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>$/u.exec(text);
    if (!opening || opening[1]!.split(":").at(-1) === "Error" || ++count > 20_000 || stack.length >= 16)
      throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
    inventoryXmlText(opening[2]!);
    const node: InventoryXmlNode = {name: opening[1]!, text: "", children: []};
    if (stack.length) stack[stack.length - 1]!.children.push(node);
    else if (root) throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
    else root = node;
    if (!opening[3]) stack.push(node);
  }
  if (offset !== input.length || stack.length || root?.name !== "ListMultipartUploadsResult")
    throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
  return root;
}

function inventoryField(node: InventoryXmlNode, name: string, required = true): string | undefined {
  const fields = node.children.filter(child => child.name === name);
  if (fields.length > 1 || required && fields.length !== 1 || fields[0]?.children.length)
    throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
  return fields[0]?.text;
}

function validInventoryUploadId(value: string): boolean {
  return value.length > 0 && value.length <= 4096 &&
    [...value].every(character => character.codePointAt(0)! >= 32 && character.codePointAt(0) !== 127);
}

async function inventoryBody(response: Response): Promise<string> {
  if (!response.ok || Number(response.headers.get("content-length")) > MULTIPART_INVENTORY_PAGE_BYTES) {
    await response.body?.cancel();
    throw new Error("CLOUD_MULTIPART_INVENTORY_HTTP_FAILED");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("CLOUD_MULTIPART_INVENTORY_XML_INVALID");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MULTIPART_INVENTORY_PAGE_BYTES) {
        await reader.cancel();
        throw new Error("CLOUD_MULTIPART_INVENTORY_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", {fatal: true, ignoreBOM: false}).decode(bytes);
}

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

  /** Exact attempt object only; controller retains reusable storage credentials. */
  async multipartRequest(method: "POST" | "DELETE", objectKey: string,
    query: Readonly<Record<string, string>>, body?: string, contentType?: string): Promise<Response> {
    if (!EXACT_KEY.test(objectKey)) throw new Error("CLOUD_MULTIPART_KEY_INVALID");
    const url = new URL(`${this.#endpoint}/${objectKey.split("/").map(encodeURIComponent).join("/")}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const signed = await this.#client.sign(url, {method, body,
      headers: contentType ? {"content-type": contentType} : undefined});
    return fetch(signed, {signal: AbortSignal.timeout(20_000)});
  }

  /** Complete inventory of only this exact object; prefix neighbors are never owned. */
  async listMultipartUploadsExact(objectKey: string): Promise<readonly string[]> {
    if (!EXACT_KEY.test(objectKey)) throw new Error("CLOUD_MULTIPART_KEY_INVALID");
    const ids = new Set<string>(), markers = new Set<string>();
    let keyMarker: string | undefined, uploadMarker: string | undefined;
    for (let page = 0; page < 100; page++) {
      const url = new URL(this.#endpoint);
      url.searchParams.set("uploads", "");
      url.searchParams.set("prefix", objectKey);
      url.searchParams.set("max-uploads", "100");
      if (keyMarker !== undefined) url.searchParams.set("key-marker", keyMarker);
      if (uploadMarker !== undefined) url.searchParams.set("upload-id-marker", uploadMarker);
      const signed = await this.#client.sign(url, {method: "GET"});
      const result = inventoryXml(await inventoryBody(await fetch(signed, {signal: AbortSignal.timeout(20_000)})));
      const fields = new Set(["Bucket", "KeyMarker", "UploadIdMarker", "NextKeyMarker", "NextUploadIdMarker",
        "Delimiter", "Prefix", "MaxUploads", "IsTruncated", "Upload", "EncodingType"]);
      if (result.children.some(node => !fields.has(node.name) ||
          node.name !== "Upload" && result.children.filter(child => child.name === node.name).length !== 1))
        throw new Error("CLOUD_MULTIPART_INVENTORY_PAGE_INVALID");
      const bucket = inventoryField(result, "Bucket", false);
      if (bucket !== undefined && bucket !== this.config.bucketName)
        throw new Error("CLOUD_MULTIPART_INVENTORY_BUCKET_INVALID");
      const encoding = inventoryField(result, "EncodingType", false);
      if (encoding !== undefined && encoding !== "url") throw new Error("CLOUD_MULTIPART_INVENTORY_ENCODING_INVALID");
      const keyValue = (value: string) => encoding === "url" ? decodeURIComponent(value) : value;
      const delimiter = inventoryField(result, "Delimiter", false);
      if (delimiter !== undefined && delimiter !== "") throw new Error("CLOUD_MULTIPART_INVENTORY_PAGE_INVALID");
      const echoedKey = inventoryField(result, "KeyMarker", false);
      const echoedUpload = inventoryField(result, "UploadIdMarker", false);
      if (echoedKey !== undefined && keyValue(echoedKey) !== (keyMarker ?? "") ||
          echoedUpload !== undefined && echoedUpload !== (uploadMarker ?? ""))
        throw new Error("CLOUD_MULTIPART_INVENTORY_MARKER_INVALID");
      const prefix = inventoryField(result, "Prefix", false);
      if (prefix !== undefined && keyValue(prefix) !== objectKey) throw new Error("CLOUD_MULTIPART_INVENTORY_PREFIX_INVALID");
      const uploads = result.children.filter(node => node.name === "Upload");
      if (uploads.length > 100) throw new Error("CLOUD_MULTIPART_INVENTORY_PAGE_INVALID");
      for (const upload of uploads) {
        const key = keyValue(inventoryField(upload, "Key")!);
        const id = inventoryField(upload, "UploadId")!;
        if (!key.startsWith(objectKey) || !validInventoryUploadId(id))
          throw new Error("CLOUD_MULTIPART_INVENTORY_UPLOAD_INVALID");
        if (key === objectKey) ids.add(id);
      }
      const truncated = inventoryField(result, "IsTruncated")!.trim();
      if (truncated === "false") return Object.freeze([...ids].sort());
      if (truncated !== "true") throw new Error("CLOUD_MULTIPART_INVENTORY_PAGE_INVALID");
      keyMarker = keyValue(inventoryField(result, "NextKeyMarker")!);
      uploadMarker = inventoryField(result, "NextUploadIdMarker")!;
      if (!keyMarker.startsWith(objectKey) || !validInventoryUploadId(uploadMarker))
        throw new Error("CLOUD_MULTIPART_INVENTORY_MARKER_INVALID");
      const marker = JSON.stringify([keyMarker, uploadMarker]);
      if (markers.has(marker)) throw new Error("CLOUD_MULTIPART_INVENTORY_MARKER_CYCLE");
      markers.add(marker);
    }
    throw new Error("CLOUD_MULTIPART_INVENTORY_PAGE_LIMIT");
  }

  async signMultipartPart(objectKey: string, uploadId: string, partNumber: number): Promise<string> {
    if (!EXACT_KEY.test(objectKey) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000)
      throw new Error("CLOUD_MULTIPART_PART_INVALID");
    const url = new URL(`${this.#endpoint}/${objectKey.split("/").map(encodeURIComponent).join("/")}`);
    url.searchParams.set("uploadId", uploadId);
    url.searchParams.set("partNumber", String(partNumber));
    url.searchParams.set("X-Amz-Expires", "300");
    return (await this.#client.sign(url, {method: "PUT", aws: {signQuery: true}})).url;
  }

  async sign(input: {
    method: "GET" | "PUT";
    objectKey: string;
    contentType: string;
    contentLength: number;
    checksumSha256: string;
    lifetimeSeconds: number;
    downloadFilename?: string;
    ordinaryVideoBudget?: Readonly<{ version: "ordinary-video-budget/v1"; durationMs: number }>;
    now?: Date;
  }): Promise<HostedSignedArtifactPort> {
    if (input.method === "PUT" && input.contentLength > SINGLE_PUT_MAX_BYTES)
      throw new RangeError("R2 single PUT exceeds 5 GB; a scoped multipart upload is required.");
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
    if (
      input.ordinaryVideoBudget &&
      (input.method !== "GET" || input.ordinaryVideoBudget.version !== "ordinary-video-budget/v1")
    )
      throw new TypeError("Duration-budget authority applies only to ordinary video GET ports.");
    const ordinaryBudget = input.ordinaryVideoBudget
      ? quoteOrdinaryVideoBudget(input.ordinaryVideoBudget.durationMs)
      : null;
    const maximumLifetimeSeconds =
      input.method === "GET"
        ? Math.max(3_600, ordinaryBudget ? ordinaryBudget.soulxAvatarTimeoutSeconds + 600 : 3_600)
        : 900;
    if (
      !Number.isSafeInteger(input.lifetimeSeconds) ||
      input.lifetimeSeconds < 1 ||
      input.lifetimeSeconds > maximumLifetimeSeconds ||
      maximumLifetimeSeconds > 7_200
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
