/** RFC 8785 JSON Canonicalization Scheme (JCS) primitives. */
export type JsonPrimitive = null | boolean | number | string;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [property: string]: JsonValue };

export type Sha256Digest = `sha256:${string}`;

export type JsonPathSegment = string | number;

export type JsonCanonicalizationErrorCode =
  | "ACCESSOR_PROPERTY"
  | "CYCLIC_REFERENCE"
  | "INVALID_TYPE"
  | "INVALID_UNICODE"
  | "NON_FINITE_NUMBER"
  | "NON_PLAIN_OBJECT"
  | "SPARSE_ARRAY"
  | "UNSUPPORTED_PROPERTY";

const formatPath = (path: readonly JsonPathSegment[]): string =>
  path.reduce<string>(
    (rendered, segment) =>
      typeof segment === "number"
        ? `${rendered}[${segment}]`
        : `${rendered}[${JSON.stringify(segment)}]`,
    "$",
  );

/** A precise runtime failure for data outside the RFC 8785/I-JSON value model. */
export class JsonCanonicalizationError extends TypeError {
  readonly code: JsonCanonicalizationErrorCode;
  readonly path: readonly JsonPathSegment[];

  constructor(
    code: JsonCanonicalizationErrorCode,
    path: readonly JsonPathSegment[],
    message: string,
  ) {
    const stablePath = Object.freeze([...path]);
    super(`${message} at ${formatPath(stablePath)}.`);
    this.name = "JsonCanonicalizationError";
    this.code = code;
    this.path = stablePath;
  }
}

const fail = (
  code: JsonCanonicalizationErrorCode,
  path: readonly JsonPathSegment[],
  message: string,
): never => {
  throw new JsonCanonicalizationError(code, path, message);
};

const assertValidUnicode = (value: string, path: readonly JsonPathSegment[]): void => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailingCodeUnit = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || trailingCodeUnit < 0xdc00 || trailingCodeUnit > 0xdfff) {
        fail("INVALID_UNICODE", path, "String contains an unpaired UTF-16 high surrogate");
      }
      index += 1;
      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail("INVALID_UNICODE", path, "String contains an unpaired UTF-16 low surrogate");
    }
  }
};

const compareUtf16 = (left: string, right: string): number => {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

const serializeString = (value: string, path: readonly JsonPathSegment[]): string => {
  assertValidUnicode(value, path);
  return JSON.stringify(value);
};

const isPlainRecord = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isCanonicalArrayIndex = (property: string, length: number): boolean => {
  const index = Number(property);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === property;
};

const serializeArray = (
  value: readonly unknown[],
  path: readonly JsonPathSegment[],
  ancestors: WeakSet<object>,
): string => {
  for (const property of Reflect.ownKeys(value)) {
    if (property === "length") continue;
    if (typeof property === "symbol") {
      return fail("UNSUPPORTED_PROPERTY", path, "JSON arrays cannot contain symbol properties");
    }
    if (!isCanonicalArrayIndex(property, value.length)) {
      fail(
        "UNSUPPORTED_PROPERTY",
        [...path, property],
        "JSON arrays cannot contain non-index properties",
      );
    }
  }

  const serialized: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) {
      return fail("SPARSE_ARRAY", [...path, index], "Sparse JSON arrays are not permitted");
    }
    if (!("value" in descriptor)) {
      return fail("ACCESSOR_PROPERTY", [...path, index], "JSON array elements must be data values");
    }
    serialized.push(serializeValue(descriptor.value, [...path, index], ancestors));
  }
  return `[${serialized.join(",")}]`;
};

const serializeRecord = (
  value: Record<string, unknown>,
  path: readonly JsonPathSegment[],
  ancestors: WeakSet<object>,
): string => {
  const properties: string[] = [];
  for (const property of Reflect.ownKeys(value)) {
    if (typeof property === "symbol") {
      return fail("UNSUPPORTED_PROPERTY", path, "JSON objects cannot contain symbol properties");
    }

    const propertyPath = [...path, property];
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    if (!descriptor || !descriptor.enumerable) {
      return fail(
        "UNSUPPORTED_PROPERTY",
        propertyPath,
        "JSON objects cannot contain hidden properties",
      );
    }
    if (!("value" in descriptor)) {
      return fail("ACCESSOR_PROPERTY", propertyPath, "JSON object properties must be data values");
    }
    assertValidUnicode(property, propertyPath);
    properties.push(property);
  }

  properties.sort(compareUtf16);
  return `{${properties
    .map((property) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, property);
      if (!descriptor || !("value" in descriptor)) {
        return fail(
          "ACCESSOR_PROPERTY",
          [...path, property],
          "JSON object properties must remain stable data values",
        );
      }
      return `${serializeString(property, [...path, property])}:${serializeValue(
        descriptor.value,
        [...path, property],
        ancestors,
      )}`;
    })
    .join(",")}}`;
};

const serializeValue = (
  value: unknown,
  path: readonly JsonPathSegment[],
  ancestors: WeakSet<object>,
): string => {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        return fail("NON_FINITE_NUMBER", path, "JSON numbers must be finite IEEE 754 values");
      }
      return JSON.stringify(value);
    }
    case "string":
      return serializeString(value, path);
    case "object":
      break;
    default:
      return fail(
        "INVALID_TYPE",
        path,
        `Values of type ${typeof value} are not part of the JSON data model`,
      );
  }

  if (ancestors.has(value)) {
    return fail("CYCLIC_REFERENCE", path, "Cyclic references are not valid JSON values");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return serializeArray(value, path, ancestors);
    if (!isPlainRecord(value)) {
      return fail(
        "NON_PLAIN_OBJECT",
        path,
        "Only plain objects and null-prototype records are valid JSON objects",
      );
    }
    return serializeRecord(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
};

/**
 * Serialize an already parsed/programmatically constructed value using RFC 8785 JCS.
 *
 * The runtime boundary is intentionally `unknown`: unsupported JavaScript values are
 * rejected instead of being silently omitted or converted like `JSON.stringify`. When
 * starting from JSON text, use a parser that rejects duplicate names before this step;
 * duplicate names cannot be recovered after ordinary `JSON.parse`.
 */
export function canonicalizeJson(value: unknown): string {
  return serializeValue(value, [], new WeakSet<object>());
}

/** Canonical RFC 8785 JSON encoded as UTF-8, ready for signing or hashing. */
export function canonicalizeJsonToUtf8(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalizeJson(value));
}

/** SHA-256 over canonical RFC 8785 UTF-8 bytes, using the standard Web Crypto API. */
export async function sha256CanonicalJson(value: unknown): Promise<Sha256Digest> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SHA-256 requires a runtime with the standard Web Crypto API.");
  }

  const digest = new Uint8Array(await subtle.digest("SHA-256", canonicalizeJsonToUtf8(value)));
  const hexadecimal = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hexadecimal}`;
}
