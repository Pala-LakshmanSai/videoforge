import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AVATAR_PRIVATE_OUTPUT_MAX_BYTES,
  startLocalAvatarPrivateTransfer,
  type AvatarPrivateTransfer,
} from "./avatar-private-transfer";

const transfers: AvatarPrivateTransfer[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(transfers.splice(0).map((transfer) => transfer.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("avatar private transfer", () => {
  it("matches the native Echo sample result ceiling", () => {
    expect(AVATAR_PRIVATE_OUTPUT_MAX_BYTES).toBe(64 * 1024 * 1024);
  });

  it("serves exact private inputs and accepts one bounded output", async () => {
    const root = await mkdtemp(join(tmpdir(), "vf-avatar-transfer-"));
    roots.push(root);
    const outputPath = join(root, "output.mp4");
    const transfer = await startLocalAvatarPrivateTransfer({
      source: Buffer.from("jpeg"),
      audio: Buffer.from("wav"),
      outputPath,
    });
    transfers.push(transfer);

    expect(Buffer.from(await (await fetch(transfer.sourceUrl)).arrayBuffer()).toString()).toBe(
      "jpeg",
    );
    expect(Buffer.from(await (await fetch(transfer.audioUrl)).arrayBuffer()).toString()).toBe(
      "wav",
    );
    expect(await fetch(new URL("/wrong", transfer.sourceUrl))).toMatchObject({ status: 404 });
    expect(
      await fetch(transfer.outputPutUrl, { method: "PUT", body: Buffer.from("mp4") }),
    ).toMatchObject({ status: 201 });
    await transfer.waitForOutput();
    expect((await readFile(outputPath)).toString()).toBe("mp4");
    expect(
      await fetch(transfer.outputPutUrl, { method: "PUT", body: Buffer.from("again") }),
    ).toMatchObject({ status: 409 });
  });
});
