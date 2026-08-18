import { betterAuth } from "better-auth";

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
