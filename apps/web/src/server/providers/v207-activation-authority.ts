const IMMUTABLE_IMAGE = /^ghcr\.io\/[a-z0-9][a-z0-9./_-]+@sha256:[a-f0-9]{64}$/u;

export const V207_REPAIRED_IMAGE_SOURCE_COMMIT = "b40af353a3e8630bc7f4bc2776ca9879e23ad542";

export interface V207ActivationAuthority {
  readonly image: string;
  readonly capUsd: number;
}

/** Require fresh, explicit authority for the repaired immutable image. */
export function parseV207ActivationAuthority(
  environment: Readonly<Record<string, string | undefined>>,
): V207ActivationAuthority {
  const image = environment.V207_IMAGE?.trim() ?? "";
  if (!IMMUTABLE_IMAGE.test(image)) throw new Error("V207_IMAGE_DIGEST_REQUIRED");
  if (environment.V207_IMAGE_SOURCE_COMMIT !== V207_REPAIRED_IMAGE_SOURCE_COMMIT) {
    throw new Error("V207_IMAGE_SOURCE_COMMIT_MISMATCH");
  }
  const capUsd = Number(environment.V207_FINITE_CAP_USD ?? "");
  if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 1_000) {
    throw new Error("V207_FINITE_CAP_REQUIRED");
  }
  return { image, capUsd };
}
