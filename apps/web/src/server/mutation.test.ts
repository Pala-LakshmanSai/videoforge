// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { idempotentMutation, type IdempotencyLedger } from "./mutation";

describe("runtime-neutral idempotency snapshots", () => {
  it("stores plain replay bytes and makes an in-flight duplicate retry explicitly", async () => {
    const ledger: IdempotencyLedger = new Map();
    const app = new Hono();
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });

    app.post("/mutation", (context) =>
      idempotentMutation(context, ledger, false, async () => {
        started();
        await releasePromise;
        return context.json({ ok: true, value: "stable" }, 201, {
          etag: '"runtime-neutral-v1"',
        });
      }),
    );

    const request = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "runtime-neutral-idempotency",
      },
      body: JSON.stringify({ stable: true }),
    } satisfies RequestInit;

    const firstPromise = app.request("/mutation", request);
    await startedPromise;

    const inFlight = await app.request("/mutation", request);
    expect(inFlight.status).toBe(409);
    await expect(inFlight.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_REQUEST_IN_PROGRESS", retryable: true },
    });

    release();
    const first = await firstPromise;
    expect(first.status).toBe(201);
    expect(first.headers.get("etag")).toBe('"runtime-neutral-v1"');
    expect(first.headers.get("x-videoforge-idempotent-replay")).toBeNull();
    await expect(first.json()).resolves.toEqual({ ok: true, value: "stable" });

    const replay = await app.request("/mutation", request);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("etag")).toBe('"runtime-neutral-v1"');
    expect(replay.headers.get("x-videoforge-idempotent-replay")).toBe("true");
    await expect(replay.json()).resolves.toEqual({ ok: true, value: "stable" });
  });

  it("preserves a null response body across the original response and replay", async () => {
    const ledger: IdempotencyLedger = new Map();
    const app = new Hono();
    app.post("/no-content", (context) =>
      idempotentMutation(context, ledger, false, () =>
        Promise.resolve(new Response(null, { status: 204, headers: { etag: '"empty-v1"' } })),
      ),
    );
    const request = {
      method: "POST",
      headers: { "idempotency-key": "null-body-idempotency" },
    } satisfies RequestInit;

    const first = await app.request("/no-content", request);
    expect(first.status).toBe(204);
    expect(first.body).toBeNull();
    expect(first.headers.get("etag")).toBe('"empty-v1"');

    const replay = await app.request("/no-content", request);
    expect(replay.status).toBe(204);
    expect(replay.body).toBeNull();
    expect(replay.headers.get("etag")).toBe('"empty-v1"');
    expect(replay.headers.get("x-videoforge-idempotent-replay")).toBe("true");
  });
});
