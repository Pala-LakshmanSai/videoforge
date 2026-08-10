export interface ProductionGoogleAuthBindingSource {
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly BETTER_AUTH_SECRET?: string;
}

export interface BetterAuthGoogleServerOptions {
  readonly baseURL: string;
  readonly secret: string;
  readonly emailAndPassword: { readonly enabled: false };
  readonly socialProviders: {
    readonly google: {
      readonly clientId: string;
      readonly clientSecret: string;
    };
  };
}

export interface BetterAuthGoogleRedactedDescriptor {
  readonly implementation: "better-auth";
  readonly provider: "google";
  readonly baseURL: string;
  readonly credentials: "REDACTED";
  readonly publicSignup: false;
  readonly invitationRequired: true;
  readonly signInPolicy: "INVITED_VERIFIED_GOOGLE_EMAIL";
  readonly reviewerIdentitySource: "SERVER_SESSION";
}

export interface BetterAuthGoogleConfiguration
  extends Omit<BetterAuthGoogleRedactedDescriptor, "credentials"> {
  materializeServerOptions(): BetterAuthGoogleServerOptions;
  toJSON(): BetterAuthGoogleRedactedDescriptor;
}

export type ProductionAuthBindingErrorCode =
  | "PRODUCTION_AUTH_BINDINGS_MISSING"
  | "PRODUCTION_AUTH_BINDING_INVALID";

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

function requiredBindings(source: ProductionGoogleAuthBindingSource): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authSecret: string;
} {
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "BETTER_AUTH_SECRET"] as const;
  const missing = names.filter((name) => !source[name]?.trim());
  if (missing.length > 0) {
    throw new ProductionAuthBindingError(
      "PRODUCTION_AUTH_BINDINGS_MISSING",
      `Production Google authentication requires explicit bindings: ${missing.join(", ")}.`,
      missing,
    );
  }

  const clientId = source.GOOGLE_CLIENT_ID!;
  const clientSecret = source.GOOGLE_CLIENT_SECRET!;
  const authSecret = source.BETTER_AUTH_SECRET!;
  for (const [name, value, minimum] of [
    ["GOOGLE_CLIENT_ID", clientId, 3],
    ["GOOGLE_CLIENT_SECRET", clientSecret, 8],
    ["BETTER_AUTH_SECRET", authSecret, 32],
  ] as const) {
    const hasControlCharacter = [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
    if (
      value !== value.trim() ||
      value.length < minimum ||
      value.length > 2_048 ||
      hasControlCharacter
    ) {
      throw new ProductionAuthBindingError(
        "PRODUCTION_AUTH_BINDING_INVALID",
        `${name} has an invalid server-binding shape.`,
        [name],
      );
    }
  }
  return { clientId, clientSecret, authSecret };
}

function productionBaseUrl(value: string): string {
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

export function createBetterAuthGoogleConfiguration(input: {
  readonly baseURL: string;
  readonly bindings: ProductionGoogleAuthBindingSource;
}): BetterAuthGoogleConfiguration {
  const baseURL = productionBaseUrl(input.baseURL);
  const bindings = requiredBindings(input.bindings);
  const descriptor = Object.freeze({
    implementation: "better-auth",
    provider: "google",
    baseURL,
    publicSignup: false,
    invitationRequired: true,
    signInPolicy: "INVITED_VERIFIED_GOOGLE_EMAIL",
    reviewerIdentitySource: "SERVER_SESSION",
  } as const);
  const redacted = Object.freeze({
    ...descriptor,
    credentials: "REDACTED",
  } as const);

  return Object.freeze({
    ...descriptor,
    materializeServerOptions(): BetterAuthGoogleServerOptions {
      return Object.freeze({
        baseURL,
        secret: bindings.authSecret,
        emailAndPassword: Object.freeze({ enabled: false }),
        socialProviders: Object.freeze({
          google: Object.freeze({
            clientId: bindings.clientId,
            clientSecret: bindings.clientSecret,
          }),
        }),
      });
    },
    toJSON(): BetterAuthGoogleRedactedDescriptor {
      return redacted;
    },
  });
}
