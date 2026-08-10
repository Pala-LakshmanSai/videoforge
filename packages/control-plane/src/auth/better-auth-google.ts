import { snapshotExactPlainRecord, snapshotPlainRecord } from "./plain-data.js";
import type {
  AuthFailure,
  GoogleSignInAdmissionHook,
  GoogleSignInAuthorizationRequest,
  GrantedGoogleSignInAuthorization,
} from "./types.js";
import { authIdentifier, isNormalizedAuthEmail, normalizedAuthEmailValue } from "./validation.js";

export interface ProductionGoogleAuthBindingSource {
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly BETTER_AUTH_SECRET?: string;
}

export interface BetterAuthGoogleSecretAccess {
  /** Explicit trusted-SDK handoff only. Returned values must never be logged or serialized. */
  readBetterAuthSecret(): string;
  readGoogleClientId(): string;
  readGoogleClientSecret(): string;
  toJSON(): { readonly credentials: "REDACTED" };
}

export type AuthorizedGoogleIdentityMaterializationResult<T> =
  | AuthFailure
  | {
      readonly ok: true;
      readonly value: {
        readonly authorization: GrantedGoogleSignInAuthorization["value"];
        readonly materialized: T;
      };
    };

export interface InvitedGoogleIdentityMaterializationGate {
  authorizeThenMaterialize<T>(
    request: GoogleSignInAuthorizationRequest,
    materialize: (authorization: GrantedGoogleSignInAuthorization["value"]) => Promise<T>,
  ): Promise<AuthorizedGoogleIdentityMaterializationResult<T>>;
}

/**
 * Provider-free composition contract for the future staging SDK adapter. It is deliberately not
 * shaped like Better Auth options, so secret-bearing options cannot be accidentally serialized.
 */
export interface PendingBetterAuthGoogleSdkContract {
  readonly schemaVersion: "pending-better-auth-google-sdk-contract/v1";
  readonly baseURL: string;
  readonly emailAndPassword: { readonly enabled: false };
  readonly publicSignup: false;
  readonly secrets: BetterAuthGoogleSecretAccess;
  readonly identityMaterialization: InvitedGoogleIdentityMaterializationGate;
  toJSON(): BetterAuthGoogleRedactedDescriptor;
}

export interface BetterAuthGoogleRedactedDescriptor {
  readonly implementation: "better-auth-sdk-wiring-pending-staging";
  readonly sdkWiringStatus: "PENDING_STAGING";
  readonly provider: "google";
  readonly baseURL: string;
  readonly credentials: "REDACTED";
  readonly publicSignup: false;
  readonly invitationRequired: true;
  readonly admissionHook: "REQUIRED_BEFORE_IDENTITY_MATERIALIZATION";
  readonly signInPolicy: "INVITED_VERIFIED_GOOGLE_EMAIL";
  readonly reviewerIdentitySource: "SERVER_SESSION";
}

export interface PendingBetterAuthGoogleConfiguration
  extends Omit<BetterAuthGoogleRedactedDescriptor, "credentials"> {
  installSdk<T>(installer: (contract: PendingBetterAuthGoogleSdkContract) => T): T;
  toJSON(): BetterAuthGoogleRedactedDescriptor;
}

export type ProductionAuthBindingErrorCode =
  | "PRODUCTION_AUTH_BINDINGS_MISSING"
  | "PRODUCTION_AUTH_BINDING_INVALID"
  | "PRODUCTION_AUTH_ADMISSION_REQUIRED"
  | "PRODUCTION_AUTH_COMPOSITION_INVALID";

export class ProductionAuthBindingError extends Error {
  readonly code: ProductionAuthBindingErrorCode;
  readonly bindingNames: readonly string[];

  constructor(
    code: ProductionAuthBindingErrorCode,
    message: string,
    bindingNames: readonly string[],
  ) {
    super(message);
    this.name = "ProductionAuthBindingError";
    this.code = code;
    this.bindingNames = Object.freeze([...bindingNames]);
  }
}

const WORKSPACE_ACCESS_REQUIRED = Object.freeze({
  ok: false,
  problem: Object.freeze({
    code: "WORKSPACE_ACCESS_REQUIRED",
    status: 403,
    title: "Workspace access is required",
    detail: "This account is not authorized for the requested workspace.",
    retryable: false,
  }),
} satisfies AuthFailure);

function requiredBindings(value: unknown): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authSecret: string;
} {
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "BETTER_AUTH_SECRET"] as const;
  const source = snapshotPlainRecord(value, names, []);
  if (source === null) {
    throw new ProductionAuthBindingError(
      "PRODUCTION_AUTH_BINDING_INVALID",
      "Production Google authentication bindings must be exact plain data.",
      names,
    );
  }
  const missing = names.filter(
    (name) => typeof source[name] !== "string" || source[name].trim().length === 0,
  );
  if (missing.length > 0) {
    throw new ProductionAuthBindingError(
      "PRODUCTION_AUTH_BINDINGS_MISSING",
      `Production Google authentication requires explicit bindings: ${missing.join(", ")}.`,
      missing,
    );
  }

  const clientId = source.GOOGLE_CLIENT_ID as string;
  const clientSecret = source.GOOGLE_CLIENT_SECRET as string;
  const authSecret = source.BETTER_AUTH_SECRET as string;
  for (const [name, binding, minimum] of [
    ["GOOGLE_CLIENT_ID", clientId, 3],
    ["GOOGLE_CLIENT_SECRET", clientSecret, 8],
    ["BETTER_AUTH_SECRET", authSecret, 32],
  ] as const) {
    const hasControlCharacter = [...binding].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
    if (
      binding !== binding.trim() ||
      binding.length < minimum ||
      binding.length > 2_048 ||
      hasControlCharacter
    ) {
      throw new ProductionAuthBindingError(
        "PRODUCTION_AUTH_BINDING_INVALID",
        `${name} has an invalid server-binding shape.`,
        [name],
      );
    }
  }
  return Object.freeze({ clientId, clientSecret, authSecret });
}

function productionBaseUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProductionAuthBindingError(
      "PRODUCTION_AUTH_BINDING_INVALID",
      "The production auth base URL must be an absolute HTTPS origin.",
      ["baseURL"],
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProductionAuthBindingError(
      "PRODUCTION_AUTH_BINDING_INVALID",
      "The production auth base URL must be an absolute HTTPS origin.",
      ["baseURL"],
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new ProductionAuthBindingError(
      "PRODUCTION_AUTH_BINDING_INVALID",
      "The production auth base URL must be a credential-free HTTPS origin.",
      ["baseURL"],
    );
  }
  return parsed.origin;
}

function snapshotAdmissionGrant(value: unknown): GrantedGoogleSignInAuthorization | null {
  const result = snapshotExactPlainRecord(value, ["ok", "value"]);
  if (result === null || result.ok !== true) return null;
  const grant = snapshotExactPlainRecord(result.value, [
    "allowed",
    "reason",
    "workspaceId",
    "normalizedEmail",
    "materialization",
  ]);
  if (
    grant === null ||
    grant.allowed !== true ||
    grant.reason !== "INVITED_VERIFIED_GOOGLE_EMAIL" ||
    !authIdentifier(grant.workspaceId) ||
    !isNormalizedAuthEmail(grant.normalizedEmail)
  ) {
    return null;
  }
  const materialization = snapshotExactPlainRecord(grant.materialization, [
    "mode",
    "expectedIdentityStatus",
    "expectedInvitationStatus",
    "expectedMembershipStatus",
    "resultingInvitationStatus",
    "resultingMembershipStatus",
    "transactionRequired",
  ]);
  if (materialization === null) return null;
  const activation =
    materialization.mode === "ACTIVATE_INVITATION" &&
    materialization.expectedInvitationStatus === "PENDING" &&
    materialization.expectedMembershipStatus === "INVITED";
  const alreadyActive =
    materialization.mode === "ALREADY_ACTIVE" &&
    materialization.expectedInvitationStatus === "ACCEPTED" &&
    materialization.expectedMembershipStatus === "ACTIVE";
  if (
    (!activation && !alreadyActive) ||
    materialization.expectedIdentityStatus !== "ACTIVE" ||
    materialization.resultingInvitationStatus !== "ACCEPTED" ||
    materialization.resultingMembershipStatus !== "ACTIVE" ||
    materialization.transactionRequired !== true
  ) {
    return null;
  }
  const frozenMaterialization = Object.freeze({
    mode: materialization.mode,
    expectedIdentityStatus: "ACTIVE",
    expectedInvitationStatus: materialization.expectedInvitationStatus,
    expectedMembershipStatus: materialization.expectedMembershipStatus,
    resultingInvitationStatus: "ACCEPTED",
    resultingMembershipStatus: "ACTIVE",
    transactionRequired: true,
  }) as GrantedGoogleSignInAuthorization["value"]["materialization"];
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      allowed: true,
      reason: "INVITED_VERIFIED_GOOGLE_EMAIL",
      workspaceId: grant.workspaceId,
      normalizedEmail: grant.normalizedEmail,
      materialization: frozenMaterialization,
    }),
  });
}

function secretAccess(bindings: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authSecret: string;
}): BetterAuthGoogleSecretAccess {
  return Object.freeze({
    readBetterAuthSecret: () => bindings.authSecret,
    readGoogleClientId: () => bindings.clientId,
    readGoogleClientSecret: () => bindings.clientSecret,
    toJSON: () => Object.freeze({ credentials: "REDACTED" as const }),
  });
}

export function createPendingBetterAuthGoogleConfiguration(input: {
  readonly baseURL: string;
  readonly bindings: ProductionGoogleAuthBindingSource;
  readonly admissionHook: GoogleSignInAdmissionHook;
}): PendingBetterAuthGoogleConfiguration {
  const candidate = snapshotPlainRecord(
    input,
    ["baseURL", "bindings", "admissionHook"],
    ["baseURL", "bindings"],
  );
  if (candidate === null) {
    throw new ProductionAuthBindingError(
      "PRODUCTION_AUTH_COMPOSITION_INVALID",
      "The pending production auth composition must be exact plain data.",
      ["composition"],
    );
  }
  if (typeof candidate.admissionHook !== "function") {
    throw new ProductionAuthBindingError(
      "PRODUCTION_AUTH_ADMISSION_REQUIRED",
      "Production identity materialization requires an explicit invitation admission hook.",
      ["admissionHook"],
    );
  }
  const baseURL = productionBaseUrl(candidate.baseURL);
  const bindings = requiredBindings(candidate.bindings);
  const admissionHook = candidate.admissionHook as GoogleSignInAdmissionHook;
  const descriptor = Object.freeze({
    implementation: "better-auth-sdk-wiring-pending-staging",
    sdkWiringStatus: "PENDING_STAGING",
    provider: "google",
    baseURL,
    publicSignup: false,
    invitationRequired: true,
    admissionHook: "REQUIRED_BEFORE_IDENTITY_MATERIALIZATION",
    signInPolicy: "INVITED_VERIFIED_GOOGLE_EMAIL",
    reviewerIdentitySource: "SERVER_SESSION",
  } as const);
  const redacted = Object.freeze({
    ...descriptor,
    credentials: "REDACTED",
  } as const);

  return Object.freeze({
    ...descriptor,
    installSdk<T>(installer: (contract: PendingBetterAuthGoogleSdkContract) => T): T {
      if (typeof installer !== "function") {
        throw new ProductionAuthBindingError(
          "PRODUCTION_AUTH_COMPOSITION_INVALID",
          "A trusted Better Auth SDK installer is required at the staging integration boundary.",
          ["installer"],
        );
      }
      const identityMaterialization = Object.freeze({
        async authorizeThenMaterialize<TMaterialized>(
          request: GoogleSignInAuthorizationRequest,
          materialize: (
            authorization: GrantedGoogleSignInAuthorization["value"],
          ) => Promise<TMaterialized>,
        ): Promise<AuthorizedGoogleIdentityMaterializationResult<TMaterialized>> {
          if (typeof materialize !== "function") {
            throw new ProductionAuthBindingError(
              "PRODUCTION_AUTH_COMPOSITION_INVALID",
              "Identity materialization requires an authorized transaction callback.",
              ["materialize"],
            );
          }
          const requestRecord = snapshotExactPlainRecord(request, [
            "workspaceId",
            "email",
            "emailVerified",
          ]);
          const normalizedEmail =
            requestRecord === null ? null : normalizedAuthEmailValue(requestRecord.email);
          if (
            requestRecord === null ||
            !authIdentifier(requestRecord.workspaceId) ||
            requestRecord.emailVerified !== true ||
            typeof requestRecord.email !== "string" ||
            normalizedEmail === null
          ) {
            return WORKSPACE_ACCESS_REQUIRED;
          }
          const sanitizedRequest = Object.freeze({
            workspaceId: requestRecord.workspaceId,
            email: requestRecord.email,
            emailVerified: true,
          });
          const authorized = snapshotAdmissionGrant(await admissionHook(sanitizedRequest));
          if (
            authorized === null ||
            authorized.value.workspaceId !== requestRecord.workspaceId ||
            authorized.value.normalizedEmail !== normalizedEmail
          ) {
            return WORKSPACE_ACCESS_REQUIRED;
          }
          const materialized = await materialize(authorized.value);
          return Object.freeze({
            ok: true,
            value: Object.freeze({ authorization: authorized.value, materialized }),
          });
        },
      });
      const contract = Object.freeze({
        schemaVersion: "pending-better-auth-google-sdk-contract/v1",
        baseURL,
        emailAndPassword: Object.freeze({ enabled: false }),
        publicSignup: false,
        secrets: secretAccess(bindings),
        identityMaterialization,
        toJSON: () => redacted,
      } satisfies PendingBetterAuthGoogleSdkContract);
      return installer(contract);
    },
    toJSON(): BetterAuthGoogleRedactedDescriptor {
      return redacted;
    },
  });
}
