import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { HostedR2BucketBinding } from "./configuration";
import { verifyHostedObjectChecksum } from "./r2-checksum";

it("streams large objects without checksum headers and caches only verified ETags", async () => {
  const chunk = new Uint8Array(65_536).fill(7);
  const digest = createHash("sha256");
  for (let i = 0; i < 17; i++) digest.update(chunk);
  const checksum = `sha256:${digest.digest("hex")}`;
  const head = { size: chunk.length * 17, etag: "verified-large-v1" };
  const arrayBuffer = vi.fn(async () => {
    throw new Error("Must stream large media");
  });
  const get = vi.fn(async () => ({
    ...head,
    arrayBuffer,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 17; i++) controller.enqueue(chunk);
        controller.close();
      },
    }),
  }));
  const bucket = { get } as unknown as HostedR2BucketBinding;
  expect(await verifyHostedObjectChecksum(bucket, "tenant/large-video", head, checksum)).toBe(true);
  expect(await verifyHostedObjectChecksum(bucket, "tenant/large-video", head, checksum)).toBe(true);
  expect(get).toHaveBeenCalledTimes(1);
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(
    await verifyHostedObjectChecksum(
      bucket,
      "tenant/large-video",
      head,
      `sha256:${"0".repeat(64)}`,
    ),
  ).toBe(false);
  expect(
    await verifyHostedObjectChecksum(
      bucket,
      "tenant/large-video",
      { ...head, etag: "changed" },
      checksum,
    ),
  ).toBe(false);
});
