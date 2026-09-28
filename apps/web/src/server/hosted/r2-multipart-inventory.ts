import type { AwsClient } from "aws4fetch";

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

/** Internal lazy inventory; caller validates the exact hosted object key before import. */
export async function listMultipartUploadsExact(
  client: Pick<AwsClient, "sign">, endpoint: string, bucketName: string, objectKey: string,
): Promise<readonly string[]> {
  const ids = new Set<string>(), markers = new Set<string>();
  let keyMarker: string | undefined, uploadMarker: string | undefined;
  for (let page = 0; page < 100; page++) {
    const url = new URL(endpoint);
    url.searchParams.set("uploads", "");
    url.searchParams.set("prefix", objectKey);
    url.searchParams.set("max-uploads", "100");
    if (keyMarker !== undefined) url.searchParams.set("key-marker", keyMarker);
    if (uploadMarker !== undefined) url.searchParams.set("upload-id-marker", uploadMarker);
    const signed = await client.sign(url, {method: "GET"});
    const result = inventoryXml(await inventoryBody(await fetch(signed, {signal: AbortSignal.timeout(20_000)})));
    const fields = new Set(["Bucket", "KeyMarker", "UploadIdMarker", "NextKeyMarker", "NextUploadIdMarker",
      "Delimiter", "Prefix", "MaxUploads", "IsTruncated", "Upload", "EncodingType"]);
    if (result.children.some(node => !fields.has(node.name) ||
        node.name !== "Upload" && result.children.filter(child => child.name === node.name).length !== 1))
      throw new Error("CLOUD_MULTIPART_INVENTORY_PAGE_INVALID");
    const bucket = inventoryField(result, "Bucket", false);
    if (bucket !== undefined && bucket !== bucketName)
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

/** Cloud-only transport; the signer supplies its unchanged exact-key grammar. */
export async function multipartRequest(
  client: Pick<AwsClient, "sign">, endpoint: string, exactKey: RegExp,
  method: "POST" | "DELETE", objectKey: string, query: Readonly<Record<string, string>>,
  body?: string, contentType?: string,
): Promise<Response> {
  if (!exactKey.test(objectKey)) throw new Error("CLOUD_MULTIPART_KEY_INVALID");
  const url = new URL(`${endpoint}/${objectKey.split("/").map(encodeURIComponent).join("/")}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const signed = await client.sign(url, {method, body,
    headers: contentType ? {"content-type": contentType} : undefined});
  return fetch(signed, {signal: AbortSignal.timeout(20_000)});
}

export async function signMultipartPart(
  client: Pick<AwsClient, "sign">, endpoint: string, exactKey: RegExp,
  objectKey: string, uploadId: string, partNumber: number,
): Promise<string> {
  if (!exactKey.test(objectKey) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000)
    throw new Error("CLOUD_MULTIPART_PART_INVALID");
  const url = new URL(`${endpoint}/${objectKey.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("X-Amz-Expires", "300");
  return (await client.sign(url, {method: "PUT", aws: {signQuery: true}})).url;
}
