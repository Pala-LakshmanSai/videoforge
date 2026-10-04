/** A bounded scheduling hint only. It never establishes whether a paid request was accepted. */
export function providerRetryAfterMs(value: string | null, nowMs = Date.now()): number {
  const fallback = 30_000;
  if (!value?.trim()) return fallback;
  const text = value.trim();
  const delay = /^\d+$/u.test(text)
    ? Number(text) * 1000
    : /^[A-Za-z]{3}, /u.test(text)
      ? Date.parse(text) - nowMs
      : NaN;
  if (!Number.isFinite(delay)) return fallback;
  return Math.min(86_400_000, Math.max(1000, Math.ceil(delay)));
}

/** Fal explicitly identifies retryable capacity refusal with both this header and error type.
 * Unknown/untyped errors, or an accompanying paid request identity, remain ambiguous. */
export async function isFalCapacityRefusal(response: Response): Promise<boolean> {
  if (response.status !== 429 || response.headers.get("X-Fal-needs-retry") !== "1") return false;
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || body.request_id || body.data)
      return false;
    const details = Array.isArray(body.detail) ? body.detail : [body.detail ?? body];
    return (
      details.length > 0 &&
      details.every(
        (detail: unknown) =>
          detail !== null &&
          typeof detail === "object" &&
          !Array.isArray(detail) &&
          (detail as Record<string, unknown>).type === "concurrent_requests_limit",
      )
    );
  } catch {
    return false;
  }
}
