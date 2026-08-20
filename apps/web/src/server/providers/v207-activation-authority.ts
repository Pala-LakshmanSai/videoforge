export const V207_REPAIRED_IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;

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
  if (image !== V207_REPAIRED_IMAGE) throw new Error("V207_IMAGE_DIGEST_REQUIRED");
  if (environment.V207_IMAGE_SOURCE_COMMIT !== V207_REPAIRED_IMAGE_SOURCE_COMMIT) {
    throw new Error("V207_IMAGE_SOURCE_COMMIT_MISMATCH");
  }
  const capUsd = Number(environment.V207_FINITE_CAP_USD ?? "");
  if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 1_000) {
    throw new Error("V207_FINITE_CAP_REQUIRED");
  }
  return { image, capUsd };
}
