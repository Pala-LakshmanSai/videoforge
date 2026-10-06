import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { multiSession } from "better-auth/plugins";
import { expireCookie, parseCookies } from "better-auth/cookies";

import type { HostedNeonPool, HostedRuntimeConfiguration } from "./configuration";

export interface HostedExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function createHostedAuth(input: {
  readonly config: HostedRuntimeConfiguration;
  readonly pool: HostedNeonPool;
  readonly executionContext: HostedExecutionContext;
}) {
  const { config, executionContext, pool } = input;
  return betterAuth({
    appName: "VideoForge",
    baseURL: config.publicOrigin,
    basePath: "/api/auth",
    secret: config.auth.secret,
    database: pool,
    trustedOrigins: [config.publicOrigin],
    emailAndPassword: { enabled: false },
    plugins: [
      multiSession(),
      {
        id: "remember-existing-browser-session",
        hooks: {
          before: [
            {
              matcher: (context) =>
                !!context.request &&
                ["/multi-session/set-active", "/multi-session/revoke"].includes(context.path ?? ""),
              handler: createAuthMiddleware(async (context) => {
                if (context.headers?.get("origin") !== new URL(config.publicOrigin).origin) {
                  throw new APIError("FORBIDDEN", {
                    message: "Account changes require the VideoForge origin.",
                  });
                }
              }),
            },
          ],
          after: [
            {
              matcher: (context) => context.path === "/get-session" && !!context.request,
              handler: createAuthMiddleware(async (context) => {
                // Adopt pre-release sessions without signing out or creating a new session.
                const active = context.context.session;
                if (!active || active.session.expiresAt <= new Date()) return;
                const cookie = context.context.authCookies.sessionToken;
                // Expired/revoked cookies must not consume the native five-session limit.
                const remembered = await Promise.all(
                  [...parseCookies(context.headers?.get("cookie") ?? "").keys()]
                    .filter((name) => name.startsWith(`${cookie.name}_multi-`))
                    .map(async (name) => ({
                      name,
                      token: await context.getSignedCookie(name, context.context.secret),
                    })),
                );
                const tokens = remembered
                  .map(({ token }) => token)
                  .filter((token): token is string => typeof token === "string");
                // Use the native batch lookup rather than one database round trip per account.
                const saved = tokens.length
                  ? await context.context.internalAdapter.findSessions(tokens, {
                      onlyActiveSessions: true,
                    })
                  : [];
                const valid = new Set(
                  saved
                    .filter((item) => item.session.expiresAt > new Date())
                    .map((item) => item.session.token),
                );
                for (const { name, token } of remembered) {
                  if (!token || !valid.has(token))
                    expireCookie(context, { name, attributes: cookie.attributes });
                }
                await context.setSignedCookie(
                  `${cookie.name}_multi-${active.session.token.toLowerCase()}`,
                  active.session.token,
                  context.context.secret,
                  {
                    ...cookie.attributes,
                    maxAge: Math.floor((active.session.expiresAt.getTime() - Date.now()) / 1000),
                  },
                );
              }),
            },
          ],
        },
      },
    ],
    socialProviders: {
      google: {
        clientId: config.auth.googleClientId,
        clientSecret: config.auth.googleClientSecret,
        disableSignUp: false,
        prompt: "select_account",
      },
    },
    account: {
      modelName: "hosted_auth_accounts",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
        requireLocalEmailVerified: true,
        trustedProviders: ["google"],
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
      fields: {
        accountId: "provider_account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    user: {
      modelName: "hosted_auth_users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      modelName: "hosted_auth_sessions",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 12,
      freshAge: 60 * 15,
      cookieCache: { enabled: false },
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    },
    verification: {
      modelName: "hosted_auth_verifications",
      storeIdentifier: "hashed",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 300, max: 5 },
        "/request-password-reset": { window: 300, max: 5 },
      },
    },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      backgroundTasks: { handler: (promise) => executionContext.waitUntil(promise) },
      useSecureCookies: true,
      cookiePrefix: "videoforge",
    },
  });
}
