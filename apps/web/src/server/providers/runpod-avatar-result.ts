const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const errorCodePattern = /^AVATAR_[A-Z0-9_]{1,96}$/u;

export interface SafeAvatarFailureEvidence {
  readonly error_code: string;
  readonly diagnostic_sha256: string;
}

export const safeAvatarFailureEvidence = (value: unknown): SafeAvatarFailureEvidence | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.ok !== false ||
    typeof envelope.error_code !== "string" ||
    !errorCodePattern.test(envelope.error_code) ||
    typeof envelope.diagnostic_sha256 !== "string" ||
    !digestPattern.test(envelope.diagnostic_sha256)
  ) {
    return null;
  }
  return Object.freeze({
    error_code: envelope.error_code,
    diagnostic_sha256: envelope.diagnostic_sha256,
  });
};
