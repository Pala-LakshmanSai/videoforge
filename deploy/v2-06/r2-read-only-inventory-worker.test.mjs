import assert from "node:assert/strict";
import test from "node:test";

import worker, { inventoryBucket, readObject } from "./r2-read-only-inventory-worker.mjs";

test("paginates a bucket and emits only redacted object identity", async () => {
  const calls = [];
  const pages = [
    {
      objects: [
        {
          key: "tenant/secret-a",
          size: 5,
          etag: "etag-a",
          uploaded: new Date("2026-08-19T00:00:00Z"),
          storageClass: "Standard",
        },
      ],
      truncated: true,
      cursor: "page-2",
    },
    {
      objects: [{ key: "tenant/secret-b", size: 7, etag: "etag-b" }],
      truncated: false,
    },
  ];
  const bucket = {
    async list(options) {
      calls.push(options);
      return pages[calls.length - 1];
    },
  };

  const result = await inventoryBucket(bucket);
  assert.equal(result.page_count, 2);
  assert.equal(result.object_count, 2);
  assert.equal(result.total_size_bytes, 12);
  assert.equal(result.read_operations, 2);
  assert.equal(result.write_operations, 0);
  assert.match(result.inventory_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(calls, [
    { cursor: undefined, limit: 1_000 },
    { cursor: "page-2", limit: 1_000 },
  ]);
  assert.equal(JSON.stringify(result).includes("tenant/secret"), false);
  assert.ok(result.objects.every((row) => /^sha256:[0-9a-f]{64}$/u.test(row.key_sha256)));
});

test("fails closed on a repeated pagination cursor", async () => {
  const bucket = {
    async list() {
      return { objects: [], truncated: true, cursor: "repeat" };
    },
  };
  await assert.rejects(inventoryBucket(bucket), /repeated its cursor/u);
});

test("HTTP surface accepts only GET slash and never calls a write binding", async () => {
  let listCalls = 0;
  const environment = {
    PRIVATE_ARTIFACTS: {
      async list() {
        listCalls += 1;
        return { objects: [], truncated: false };
      },
      async put() {
        throw new Error("write must never be called");
      },
      async delete() {
        throw new Error("write must never be called");
      },
    },
  };
  const rejected = await worker.fetch(new Request("https://example.test/nope"), environment);
  assert.equal(rejected.status, 404);
  const accepted = await worker.fetch(new Request("https://example.test/"), environment);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.equal(listCalls, 1);
  assert.deepEqual(await accepted.json(), {
    schema_version: "videoforge.v2-06-r2-read-only-inventory/v1",
    page_count: 1,
    object_count: 0,
    total_size_bytes: 0,
    inventory_sha256: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    objects: [],
    read_operations: 1,
    write_operations: 0,
  });
});

test("reads one exact tenant object without exposing its raw key or using writes", async () => {
  const key = "tenant/account/workspace/workspace/project/project/object.bin";
  const bytes = new TextEncoder().encode("exact bytes");
  const result = await readObject(
    {
      async get(requested) {
        assert.equal(requested, key);
        return {
          size: bytes.byteLength,
          etag: "etag-exact",
          httpMetadata: { contentType: "application/octet-stream" },
          async arrayBuffer() {
            return bytes.buffer;
          },
        };
      },
    },
    key,
  );
  assert.equal(result.size_bytes, bytes.byteLength);
  assert.equal(result.content_type, "application/octet-stream");
  assert.match(result.key_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.checksum_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(result.write_operations, 0);
});
