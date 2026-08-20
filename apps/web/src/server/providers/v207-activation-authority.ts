const IMMUTABLE_IMAGE = /^ghcr\.io\/pala-lakshmansai\/videoforge-mage-v2-07@sha256:[a-f0-9]{64}$/u;

export const V207_REPAIRED_IMAGE_SOURCE_COMMIT = "d1d704c2f39581e745ba90151c7388673107de41";

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
