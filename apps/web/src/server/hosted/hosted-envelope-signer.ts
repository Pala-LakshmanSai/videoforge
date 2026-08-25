import { canonicalizeJsonToUtf8, sha256CanonicalJson, type JsonValue } from "@videoforge/contracts";

export const HOSTED_ENVELOPE_SIGNING_ALGORITHM = "HMAC-SHA256" as const;

export class HostedEnvelopeSigningError extends Error {
  readonly code = "HOSTED_ENVELOPE_SIGNING_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "HostedEnvelopeSigningError";
  }
}

export interface HostedEnvelopeSigningBinding {
  /** Dedicated envelope authority key. It must never reuse a receipt or callback key. */
  readonly secretHex: string;
  readonly keyId: string;
}

export interface HostedEnvelopeSignatureResult {
  readonly authoritySha256: `sha256:${string}`;
  readonly keyId: string;
  /** Safe deployment-lineage fingerprint of the raw signing key. */
  readonly keyHash: `sha256:${string}`;
  readonly signature: {
    readonly algorithm: typeof HOSTED_ENVELOPE_SIGNING_ALGORITHM;
    readonly key_id: string;
    readonly value: string;
  };
}

export interface HostedEnvelopePairSignature extends HostedEnvelopeSignatureResult {
  readonly lane: "mage_image" | "soulx_avatar";
}

export interface HostedEnvelopePairSigner {
  signPair(
    bodies: readonly {
      readonly lane: "mage_image" | "soulx_avatar";
      readonly body: JsonValue;
    }[],
  ): Promise<readonly HostedEnvelopePairSignature[]>;
  verifyPair(
    bodies: readonly {
      readonly lane: "mage_image" | "soulx_avatar";
      readonly body: JsonValue;
    }[],
    signatures: readonly HostedEnvelopePairSignature[],
  ): Promise<boolean>;
}

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const ASCII_PROPERTY = /^[\u0021-\u007e]+$/u;
const HEX = /^[0-9a-f]{64}$/u;
const SECRET_HEX = /^(?:[0-9a-f]{2}){32,}$/u;

function assertRestrictedIJson(
  value: unknown,
  path = "$",
  ancestors = new WeakSet<object>(),
): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const trailing = value.charCodeAt(index + 1);
        if (index + 1 >= value.length || trailing < 0xdc00 || trailing > 0xdfff) {
          throw new HostedEnvelopeSigningError(`${path} contains an unpaired high surrogate.`);
        }
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        throw new HostedEnvelopeSigningError(`${path} contains an unpaired low surrogate.`);
      }
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new HostedEnvelopeSigningError(`${path} must be a safe integer.`);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    throw new HostedEnvelopeSigningError(`${path} is outside the restricted I-JSON model.`);
  }
  if (ancestors.has(value)) {
    throw new HostedEnvelopeSigningError(`${path} contains a cycle.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new HostedEnvelopeSigningError(`${path} contains a sparse array.`);
        }
        assertRestrictedIJson(value[index], `${path}[${index}]`, ancestors);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new HostedEnvelopeSigningError(`${path} must be a plain object.`);
    }
    for (const key of Object.keys(value)) {
      if (!ASCII_PROPERTY.test(key)) {
        throw new HostedEnvelopeSigningError(`${path}.${key} has a non-ASCII property name.`);
      }
      assertRestrictedIJson((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function hexadecimal(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeHex(value: string): Uint8Array<ArrayBuffer> {
  if (!SECRET_HEX.test(value)) {
    throw new HostedEnvelopeSigningError(
      "Envelope signing key must be lowercase hex encoding at least 32 bytes.",
    );
  }
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function decodeSignature(value: string): Uint8Array<ArrayBuffer> | null {
  if (!HEX.test(value)) return null;
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

async function importSigningKey(secretBytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * Signs an unsigned final v3 envelope body. The returned object contains only public signer
 * identity/fingerprint, the body authority hash, and signature; the raw binding never escapes.
 */
export async function signHostedEnvelopeBody(
  body: JsonValue,
  binding: HostedEnvelopeSigningBinding,
): Promise<HostedEnvelopeSignatureResult> {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.hasOwn(body, "authority_sha256") ||
    Object.hasOwn(body, "signature")
  ) {
    throw new HostedEnvelopeSigningError("Envelope body must be an unsigned object.");
  }
  if (!KEY_ID.test(binding.keyId)) {
    throw new HostedEnvelopeSigningError("Envelope key ID is malformed.");
  }
  const secretBytes = decodeHex(binding.secretHex);
  assertRestrictedIJson(body);

  const authoritySha256 = await sha256CanonicalJson(body);
  const keyHash = await crypto.subtle.digest("SHA-256", secretBytes);
  const key = await importSigningKey(secretBytes);
  const preimage = canonicalizeJsonToUtf8({
    authority_sha256: authoritySha256,
    key_id: binding.keyId,
  });
  const signature = hexadecimal(await crypto.subtle.sign("HMAC", key, preimage));
  if (!HEX.test(signature)) {
    throw new HostedEnvelopeSigningError("Envelope signature generation failed.");
  }
  return Object.freeze({
    authoritySha256,
    keyId: binding.keyId,
    keyHash: `sha256:${hexadecimal(keyHash)}`,
    signature: Object.freeze({
      algorithm: HOSTED_ENVELOPE_SIGNING_ALGORITHM,
      key_id: binding.keyId,
      value: signature,
    }),
  });
}

export function createHostedEnvelopePairSigner(
  binding: HostedEnvelopeSigningBinding,
): HostedEnvelopePairSigner {
  return Object.freeze({
    async signPair(
      bodies: readonly {
        readonly lane: "mage_image" | "soulx_avatar";
        readonly body: JsonValue;
      }[],
    ) {
      if (
        bodies.length !== 2 ||
        new Set(bodies.map(({ lane }) => lane)).size !== 2 ||
        !bodies.some(({ lane }) => lane === "mage_image") ||
        !bodies.some(({ lane }) => lane === "soulx_avatar")
      ) {
        throw new HostedEnvelopeSigningError(
          "Both exact lane bodies are required for pair signing.",
        );
      }
      return Promise.all(
        bodies.map(async ({ lane, body }) =>
          Object.freeze({ lane, ...(await signHostedEnvelopeBody(body, binding)) }),
        ),
      );
    },
    async verifyPair(
      bodies: readonly {
        readonly lane: "mage_image" | "soulx_avatar";
        readonly body: JsonValue;
      }[],
      signatures: readonly HostedEnvelopePairSignature[],
    ) {
      if (
        bodies.length !== 2 ||
        signatures.length !== 2 ||
        new Set(bodies.map(({ lane }) => lane)).size !== 2 ||
        new Set(signatures.map(({ lane }) => lane)).size !== 2
      ) {
        return false;
      }
      const secretBytes = decodeHex(binding.secretHex);
      const keyHash = `sha256:${hexadecimal(await crypto.subtle.digest("SHA-256", secretBytes))}`;
      const key = await importSigningKey(secretBytes);
      for (const { lane, body } of bodies) {
        const signed = signatures.find((candidate) => candidate.lane === lane);
        if (signed === undefined) return false;
        assertRestrictedIJson(body);
        const authoritySha256 = await sha256CanonicalJson(body);
        const signatureBytes = decodeSignature(signed.signature.value);
        if (
          signed.authoritySha256 !== authoritySha256 ||
          signed.keyId !== binding.keyId ||
          signed.keyHash !== keyHash ||
          signed.signature.algorithm !== HOSTED_ENVELOPE_SIGNING_ALGORITHM ||
          signed.signature.key_id !== binding.keyId ||
          signatureBytes === null
        ) {
          return false;
        }
        const preimage = canonicalizeJsonToUtf8({
          authority_sha256: authoritySha256,
          key_id: binding.keyId,
        });
        if (!(await crypto.subtle.verify("HMAC", key, signatureBytes, preimage))) return false;
      }
      return true;
    },
  });
}
