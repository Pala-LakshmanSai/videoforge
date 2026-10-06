// @vitest-environment node
import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration } from "./configuration";

vi.mock("better-auth", async (original) => {
  const actual = await original<typeof import("better-auth")>();
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return {
    ...actual,
    betterAuth: (options: Parameters<typeof actual.betterAuth>[0]) =>
      actual.betterAuth({
        ...options,
        database: memoryAdapter({
          hosted_auth_users: [],
          hosted_auth_accounts: [],
          hosted_auth_sessions: [],
          hosted_auth_verifications: [],
        }),
      }),
  };
});
import { createHostedAuth } from "./auth";
const origin = "https://videoforge.example.test";
const secret = "test-secret-for-multi-session-verification-only-000000";
const primary = "__Secure-videoforge.session_token";
const signed = (token: string) =>
  encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`);

it("uses the real configured plugin to adopt, switch, expire, revoke and sign out secure browser sessions", async () => {
  const auth = createHostedAuth({
    config: {
      publicOrigin: origin,
      auth: { secret, googleClientId: "google-fixture", googleClientSecret: "fixture" },
    } as HostedRuntimeConfiguration,
    pool: {} as Parameters<typeof createHostedAuth>[0]["pool"],
    executionContext: { waitUntil: () => {} },
  });
  const context = await auth.$context;
  expect(context.options.emailAndPassword?.enabled).toBe(false);
  expect(context.options.socialProviders?.google).toMatchObject({ prompt: "select_account" });
  const owner = await context.internalAdapter.createUser({
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true,
  });
  const other = await context.internalAdapter.createUser({
    name: "Other",
    email: "other@example.test",
    emailVerified: true,
  });
  const a = await context.internalAdapter.createSession(owner.id);
  const b = await context.internalAdapter.createSession(other.id);
  const cookies = new Map([[primary, signed(a.token)]]);
  const request = async (path: string, body?: unknown, requestOrigin = origin) => {
    const response = await auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          origin: requestOrigin,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0] ?? "";
      const index = pair.indexOf("=");
      const key = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (/max-age=0/i.test(cookie)) cookies.delete(key);
      else cookies.set(key, value);
    }
    return response;
  };
  const adopted = await request("/get-session");
  expect(adopted.status).toBe(200);
  expect(adopted.headers.getSetCookie().find((value) => value.includes("_multi-"))).toMatch(
    /HttpOnly.*Secure|Secure.*HttpOnly/,
  );
  expect(adopted.headers.getSetCookie().find((value) => value.includes("_multi-"))).toContain(
    "SameSite=Lax",
  );
  cookies.set(`${primary}_multi-${b.token.toLowerCase()}`, signed(b.token));
  expect(
    (
      (await (await request("/multi-session/list-device-sessions")).json()) as Array<{
        user: { id: string };
      }>
    )
      .map((s: { user: { id: string } }) => s.user.id)
      .sort(),
  ).toEqual([owner.id, other.id].sort());
  expect(
    (
      await request(
        "/multi-session/set-active",
        { sessionToken: b.token },
        "https://foreign.example.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (await request("/multi-session/set-active", { sessionToken: "unowned-token" })).status,
  ).toBe(401);
  expect((await request("/multi-session/set-active", { sessionToken: b.token })).status).toBe(200);
  expect(((await (await request("/get-session")).json()) as { user: { id: string } }).user.id).toBe(
    other.id,
  );
  expect((await request("/multi-session/set-active", { sessionToken: a.token })).status).toBe(200);
  await context.internalAdapter.updateSession(b.token, { expiresAt: new Date(Date.now() - 1000) });
  expect((await request("/multi-session/set-active", { sessionToken: b.token })).status).toBe(401);
  expect(
    (
      (await (await request("/multi-session/list-device-sessions")).json()) as Array<{
        user: { id: string };
      }>
    ).map((s: { user: { id: string } }) => s.user.id),
  ).toEqual([owner.id]);
  const c = await context.internalAdapter.createSession(other.id);
  cookies.set(`${primary}_multi-${c.token.toLowerCase()}`, signed(c.token));
  expect((await request("/multi-session/revoke", { sessionToken: c.token })).status).toBe(200);
  expect(await context.internalAdapter.findSession(c.token)).toBeNull();
  expect((await request("/multi-session/set-active", { sessionToken: c.token })).status).toBe(401);
  // Administrator revocation deletes the same session rows; saved cookies cannot restore them.
  const d = await context.internalAdapter.createSession(other.id);
  cookies.set(`${primary}_multi-${d.token.toLowerCase()}`, signed(d.token));
  await context.internalAdapter.deleteSession(d.token);
  expect((await request("/multi-session/set-active", { sessionToken: d.token })).status).toBe(401);
  await request("/get-session");
  expect(cookies.has(`${primary}_multi-${d.token.toLowerCase()}`)).toBe(false);
  cookies.set(`${primary}_multi-forged`, "invalid-signature");
  await request("/get-session");
  expect(cookies.has(`${primary}_multi-forged`)).toBe(false);
  const e = await context.internalAdapter.createSession(other.id);
  cookies.set(`${primary}_multi-${e.token.toLowerCase()}`, signed(e.token));
  expect((await request("/sign-out", {})).status).toBe(200);
  expect(await context.internalAdapter.findSession(a.token)).toBeNull();
  expect(await context.internalAdapter.findSession(e.token)).toBeNull();
  expect(await (await request("/multi-session/list-device-sessions")).json()).toEqual([]);
});
