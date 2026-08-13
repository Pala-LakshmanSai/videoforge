import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SharedAppFixtureStore } from "../shared-app-fixture";
import { createNodeSharedAppPersistence } from "./node-shared-app-persistence";

const ownedDirectories: string[] = [];

afterEach(() => {
  for (const directory of ownedDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe("Node shared-app persistence", () => {
  it("survives a runtime reconstruction without persisting raw credentials", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "videoforge-cp02-"));
    ownedDirectories.push(directory);
    const filePath = path.join(directory, "shared-app.json");
    const first = new SharedAppFixtureStore(createNodeSharedAppPersistence(filePath));
    const issued = await first.issueInvite("restart@example.test");
    await first.authenticate({
      sessionId: "before-restart",
      method: "EMAIL_PASSWORD",
      email: "restart@example.test",
      emailPassword: issued.emailPassword,
      inviteCode: issued.code,
    });
    const inventory = first.view("before-restart").inventory;
    first.startOrEnqueue({
      sessionId: "before-restart",
      projectId: "restart-project",
      title: "Restart project",
      imageReceiptId: inventory.find((offer) => offer.lane === "image_media")!.receiptId,
      avatarReceiptId: inventory.find((offer) => offer.lane === "avatar_primary")!.receiptId,
    });

    const bytes = readFileSync(filePath, "utf8");
    expect(bytes).not.toContain(issued.code);
    expect(bytes).not.toContain(issued.emailPassword);
    expect(bytes).not.toContain(issued.googleAssertion);

    const restored = new SharedAppFixtureStore(createNodeSharedAppPersistence(filePath));
    expect(restored.view("before-restart").queue).toMatchObject([
      { projectId: "restart-project", state: "ACTIVE" },
    ]);
    expect(restored.view("before-restart").session?.gpuPair).toEqual(
      first.view("before-restart").session?.gpuPair,
    );
  });
});
