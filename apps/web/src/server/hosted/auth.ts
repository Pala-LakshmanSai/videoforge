import { betterAuth } from "better-auth";

import type { HostedNeonPool, HostedRuntimeConfiguration } from "./configuration";

export interface HostedExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface HostedEmailMessage {
  readonly kind: "VERIFY_EMAIL" | "RESET_PASSWORD";
  readonly recipient: string;
  readonly actionUrl: string;
}

async function deliverEmail(
  config: HostedRuntimeConfiguration["email"],
  message: HostedEmailMessage,
): Promise<void> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`Email delivery returned HTTP ${response.status}.`);
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
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 900,
      sendResetPassword: async ({ user, url }) => {
        executionContext.waitUntil(
          deliverEmail(config.email, {
            kind: "RESET_PASSWORD",
            recipient: user.email,
            actionUrl: url,
          }),
        );
      },
    },
    emailVerification: {
      expiresIn: 900,
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        executionContext.waitUntil(
          deliverEmail(config.email, {
            kind: "VERIFY_EMAIL",
            recipient: user.email,
            actionUrl: url,
          }),
        );
      },
    },
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
