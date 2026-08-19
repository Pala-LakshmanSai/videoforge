const MAX_OBJECTS = 10_000;
const PAGE_LIMIT = 1_000;

const hex = (bytes) =>
  [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");

const sha256 = async (value) =>
  `sha256:${hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))}`;

const sha256Bytes = async (value) => `sha256:${hex(await crypto.subtle.digest("SHA-256", value))}`;

const checksumMetadata = (checksums) => {
  if (!checksums || typeof checksums !== "object") return null;
  const values = {};
  for (const name of ["md5", "sha1", "sha256", "sha384", "sha512"]) {
    const value = checksums[name];
    if (value instanceof ArrayBuffer) values[name] = hex(value);
    else if (ArrayBuffer.isView(value))
      values[name] = hex(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return Object.keys(values).length > 0 ? values : null;
};

export async function inventoryBucket(bucket) {
  if (!bucket || typeof bucket.list !== "function") {
    throw new TypeError("PRIVATE_ARTIFACTS must be an R2 bucket binding.");
  }
  const rows = [];
  const seenCursors = new Set();
  let cursor;
  let pageCount = 0;
  do {
    const page = await bucket.list({ cursor, limit: PAGE_LIMIT });
    pageCount += 1;
    for (const object of page.objects ?? []) {
      rows.push({
        key_sha256: await sha256(object.key),
        size_bytes: Number(object.size),
        etag: object.etag ?? null,
        uploaded_at: object.uploaded instanceof Date ? object.uploaded.toISOString() : null,
        storage_class: object.storageClass ?? null,
        checksums: checksumMetadata(object.checksums),
      });
      if (rows.length > MAX_OBJECTS)
        throw new Error("R2 inventory exceeds the bounded object cap.");
    }
    if (!page.truncated) {
      cursor = undefined;
      break;
    }
    if (!page.cursor || seenCursors.has(page.cursor)) {
      throw new Error("R2 inventory pagination lost or repeated its cursor.");
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);

  rows.sort((left, right) => left.key_sha256.localeCompare(right.key_sha256));
  const canonicalRows = JSON.stringify(rows);
  return {
    schema_version: "videoforge.v2-06-r2-read-only-inventory/v1",
    page_count: pageCount,
    object_count: rows.length,
    total_size_bytes: rows.reduce((total, row) => total + row.size_bytes, 0),
    inventory_sha256: await sha256(canonicalRows),
    objects: rows,
    read_operations: pageCount,
    write_operations: 0,
  };
}

export async function readObject(bucket, key) {
  if (!bucket || typeof bucket.get !== "function") {
    throw new TypeError("PRIVATE_ARTIFACTS must be an R2 bucket binding.");
  }
  if (typeof key !== "string" || key.length < 1 || key.length > 1_400 || !key.startsWith("tenant/"))
    throw new TypeError("R2 read-back key is outside the bounded tenant scope.");
  const object = await bucket.get(key);
  if (!object) return null;
  if (Number(object.size) > 10_000_000) throw new Error("R2 read-back exceeds the byte cap.");
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== Number(object.size)) throw new Error("R2 read-back length drifted.");
  return {
    schema_version: "videoforge.v2-06-r2-read-only-object/v1",
    key_sha256: await sha256(key),
    checksum_sha256: await sha256Bytes(bytes),
    size_bytes: bytes.byteLength,
    content_type: object.httpMetadata?.contentType ?? null,
    etag: object.etag ?? null,
    read_operations: 1,
    write_operations: 0,
  };
}

export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    if (request.method !== "GET" || !["/", "/object"].includes(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const result =
        url.pathname === "/object"
          ? await readObject(environment.PRIVATE_ARTIFACTS, url.searchParams.get("key"))
          : await inventoryBucket(environment.PRIVATE_ARTIFACTS);
      if (result === null) return new Response("Not found", { status: 404 });
      return Response.json(result, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      return Response.json(
        {
          error: "R2_READ_ONLY_INVENTORY_FAILED",
          message: error instanceof Error ? error.message : "Unknown inventory failure.",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};
