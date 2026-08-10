import { canonicalizeJson } from "@videoforge/contracts";

import { PipelineDomainError } from "../errors.js";
import type { StyleAnalyzerRequest, StyleReferenceBinding } from "./types.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const fail = (message: string, path: readonly (string | number)[]): never => {
  throw new PipelineDomainError({ code: "STYLE_REFERENCE_INVALID", message, path });
};

export function buildStyleAnalyzerRequest(
  references: readonly StyleReferenceBinding[],
): StyleAnalyzerRequest {
  let plain: readonly StyleReferenceBinding[];
  try {
    plain = JSON.parse(canonicalizeJson(references)) as readonly StyleReferenceBinding[];
  } catch {
    return fail("Reference bindings must be plain canonical JSON.", ["references"]);
  }
  if (plain.length < 3 || plain.length > 8)
    fail("Style analysis requires 3-8 normalized references.", ["references"]);
  const hashes = new Set<string>();
  const normalized = plain.map((reference, index) => {
    const actualKeys = Object.keys(reference).sort();
    const expectedKeys = ["alias", "bytes", "derivativeSha256", "height", "mimeType", "width"];
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, keyIndex) => key !== expectedKeys[keyIndex])
    )
      fail("Reference binding contains missing or unknown fields.", ["references", index]);
    const alias = `ref_${String(index + 1).padStart(2, "0")}`;
    if (reference.alias !== alias)
      fail("Reference aliases must exactly follow ordered ref_01...ref_N binding.", [
        "references",
        index,
        "alias",
      ]);
    if (!SHA256.test(reference.derivativeSha256) || hashes.has(reference.derivativeSha256))
      fail("Reference derivative hashes must be valid and unique.", [
        "references",
        index,
        "derivativeSha256",
      ]);
    hashes.add(reference.derivativeSha256);
    if (!(["image/jpeg", "image/png", "image/webp"] as const).includes(reference.mimeType))
      fail("Reference media type is invalid.", ["references", index, "mimeType"]);
    if (
      !Number.isSafeInteger(reference.width) ||
      !Number.isSafeInteger(reference.height) ||
      !Number.isSafeInteger(reference.bytes) ||
      reference.width < 1 ||
      reference.height < 1 ||
      reference.width > 16_384 ||
      reference.height > 16_384 ||
      reference.bytes < 1 ||
      reference.bytes > 20 * 1024 * 1024
    )
      fail("Reference dimensions or bytes are invalid.", ["references", index]);
    return Object.freeze({
      alias: reference.alias,
      derivativeSha256: reference.derivativeSha256,
      mimeType: reference.mimeType,
      width: reference.width,
      height: reference.height,
      bytes: reference.bytes,
    });
  });
  return Object.freeze({
    analyzerVersion: "style-analyzer-v1",
    references: Object.freeze(normalized),
  });
}
