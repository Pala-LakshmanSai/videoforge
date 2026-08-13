import { describe, expect, it } from "vitest";

import { SharedAppFixtureStore, SharedFixtureError } from "./shared-app-fixture";
import { MemorySharedAppPersistence } from "./shared-app-persistence";

async function admit(
  store: SharedAppFixtureStore,
  serial: number,
  method: "EMAIL_PASSWORD" | "GOOGLE" = "EMAIL_PASSWORD",
) {
  const email = `user-${serial}@example.test`;
  const issued = await store.issueInvite(email);
  return store.authenticate({
    sessionId: `browser-${serial}`,
    method,
    email,
    emailPassword: method === "EMAIL_PASSWORD" ? issued.emailPassword : undefined,
    googleAccountEmail: method === "GOOGLE" ? email : undefined,
    googleAssertion: method === "GOOGLE" ? issued.googleAssertion : undefined,
    inviteCode: issued.code,
  });
}

function selectedPair(store: SharedAppFixtureStore) {
  const offers = store.view("browser-1").inventory;
  return {
    imageReceiptId: offers.find((offer) => offer.lane === "image_media")!.receiptId,
    avatarReceiptId: offers.find((offer) => offer.lane === "avatar_primary")!.receiptId,
  };
}

describe("shared fixture admission", () => {
  it("atomically binds one verified email and lets a returning user skip the invite", async () => {
    const store = new SharedAppFixtureStore();
    const email = "owner@example.test";
    const issued = await store.issueInvite(email);
    expect(
      (
        await store.authenticate({
          sessionId: "first-browser",
          method: "EMAIL_PASSWORD",
          email,
          emailPassword: issued.emailPassword,
          inviteCode: issued.code,
        })
      ).outcome,
    ).toBe("ADMITTED");
    expect(
      (
        await store.authenticate({
          sessionId: "returning-browser",
          method: "EMAIL_PASSWORD",
          email,
          emailPassword: issued.emailPassword,
        })
      ).outcome,
    ).toBe("RETURNING");
    expect(store.view("returning-browser").admission.admitted).toBe(true);
    await expect(
      store.authenticate({
        sessionId: "collision",
        method: "GOOGLE",
        email,
        googleAccountEmail: email,
        googleAssertion: issued.googleAssertion,
      }),
    ).rejects.toThrowError(SharedFixtureError);
  });

  it("rejects unverified identities, Google mismatch, invite mismatch, and replay", async () => {
    const store = new SharedAppFixtureStore();
    const issued = await store.issueInvite("intended@example.test");
    await expect(
      store.authenticate({
        sessionId: "bad-1",
        method: "EMAIL_PASSWORD",
        email: "intended@example.test",
        emailPassword: "wrong-fixture-password",
        inviteCode: issued.code,
      }),
    ).rejects.toThrowError(/invalid/);
    await expect(
      store.authenticate({
        sessionId: "bad-2",
        method: "GOOGLE",
        email: "intended@example.test",
        googleAccountEmail: "different@example.test",
        googleAssertion: issued.googleAssertion,
        inviteCode: issued.code,
      }),
    ).rejects.toThrowError(/must equal/);
    await expect(
      store.authenticate({
        sessionId: "bad-3",
        method: "EMAIL_PASSWORD",
        email: "different@example.test",
        emailPassword: issued.emailPassword,
        inviteCode: issued.code,
      }),
    ).rejects.toThrowError(/another verified email/);
    await store.authenticate({
      sessionId: "good",
      method: "EMAIL_PASSWORD",
      email: "intended@example.test",
      emailPassword: issued.emailPassword,
      inviteCode: issued.code,
    });
    await expect(
      store.authenticate({
        sessionId: "replay",
        method: "EMAIL_PASSWORD",
        email: "new@example.test",
        emailPassword: issued.emailPassword,
        inviteCode: issued.code,
      }),
    ).rejects.toThrowError(/already used/);
  });
});

describe("shared fixture singleton queue", () => {
  it("admits 10 equal users and permits only one concurrent idle start", async () => {
    const store = new SharedAppFixtureStore();
    for (let serial = 1; serial <= 10; serial += 1)
      await admit(store, serial, serial === 10 ? "GOOGLE" : "EMAIL_PASSWORD");
    const pair = selectedPair(store);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        Promise.resolve().then(() =>
          store.startOrEnqueue({
            sessionId: `browser-${index + 1}`,
            projectId: `project-${index + 1}`,
            title: `Project ${index + 1}`,
            ...pair,
          }),
        ),
      ),
    );
    expect(outcomes.filter((result) => result.outcome === "STARTED")).toHaveLength(1);
    expect(outcomes.filter((result) => result.outcome === "QUEUED")).toHaveLength(9);
    const view = store.view("browser-10");
    expect(view.rights).toBe("EQUAL");
    expect(view.queue).toHaveLength(10);
    expect(view.queue[0]?.state).toBe("ACTIVE");
    expect(view.canSelectGpuPair).toBe(false);
    expect(view.session?.gpuPair.image.receiptId).toBe(pair.imageReceiptId);
  });

  it("guards queue versions and active entries, audits old/new order, and recovers after restart", async () => {
    const persistence = new MemorySharedAppPersistence();
    const store = new SharedAppFixtureStore(persistence);
    await admit(store, 1);
    await admit(store, 2);
    const pair = selectedPair(store);
    store.startOrEnqueue({ sessionId: "browser-1", projectId: "active", title: "Active", ...pair });
    store.startOrEnqueue({ sessionId: "browser-2", projectId: "waiting-a", title: "Waiting A" });
    store.startOrEnqueue({ sessionId: "browser-1", projectId: "waiting-b", title: "Waiting B" });
    const before = store.view("browser-2");
    const active = before.queue[0]!;
    const waitingB = before.queue[2]!;
    expect(() =>
      store.reorder({ sessionId: "browser-2", entryId: waitingB.id, toPosition: 2, ifMatch: 1 }),
    ).toThrowError(/Queue changed/);
    expect(() =>
      store.remove({
        sessionId: "browser-2",
        entryId: active.id,
        ifMatch: before.session!.queueVersion,
      }),
    ).toThrowError(/Active entries/);
    store.reorder({
      sessionId: "browser-2",
      entryId: waitingB.id,
      toPosition: 2,
      ifMatch: before.session!.queueVersion,
    });
    const moved = store.view("browser-1");
    const moveAudit = moved.audits.at(-1)!;
    expect(moveAudit.actor).toBe("user-2@example.test");
    expect(moveAudit.oldOrder).not.toEqual(moveAudit.newOrder);
    const waitingA = moved.queue.find((entry) => entry.projectId === "waiting-a")!;
    store.remove({
      sessionId: "browser-1",
      entryId: waitingA.id,
      ifMatch: moved.session!.queueVersion,
    });
    const restored = new SharedAppFixtureStore(persistence).view("browser-2");
    expect(restored.queue.map((entry) => entry.projectId)).toEqual(["active", "waiting-b"]);
    expect(restored.session?.gpuPair).toEqual(moved.session?.gpuPair);
    expect(restored.audits.at(-1)?.operation).toBe("REMOVE");
  });
});
