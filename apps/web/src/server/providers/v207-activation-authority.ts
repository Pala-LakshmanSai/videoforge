export const V207_REPAIRED_IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:6318edbc73b59d1a495566a765515831b3ff28302a4dc33c5e09ba52352215e3" as const;

export const V207_REPAIRED_IMAGE_SOURCE_COMMIT = "a52e7e49b8e9cb945e6c5df5412b3f08fa5fff1c";
export const V207_REPAIRED_IMAGE_CONFIG_DIGEST =
  "sha256:38b7633f199017ea66d39cc5b10d4d5a86ae34885f9e23e20fc20ea0be90cf5e" as const;
export const V207_REPAIRED_IMAGE_LAYER_DIGEST =
  "sha256:7dc5be30ec2116ff0729b524b1e5bea5e54c38f7e86132a95518fcda0e53470e" as const;
export const V207_REPAIRED_IMAGE_PARENT =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;
export const V207_REPAIRED_IMAGE_BASE_DIGEST =
  "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;
export const V207_REPAIRED_IMAGE_PARENT_CONFIG_DIGEST =
  "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2" as const;
export const V207_AMENDED_PROPOSAL_SHA256 =
  "sha256:56f82ee2c32df36e1db3693c12002b008e17b34fed1998863a0ec020be6aac55" as const;
export const V207_APPROVED_FINITE_CAP_USD = 4 as const;

export interface V207ActivationAuthority {
  readonly image: string;
  readonly proposalSha256: typeof V207_AMENDED_PROPOSAL_SHA256;
  readonly capUsd: number;
}

/** Require the exact approved changed-image proposal before any dispatch. */
export function parseV207ActivationAuthority(
  environment: Readonly<Record<string, string | undefined>>,
): V207ActivationAuthority {
  const image = environment.V207_IMAGE?.trim() ?? "";
  if (image !== V207_REPAIRED_IMAGE) throw new Error("V207_IMAGE_DIGEST_REQUIRED");
  if (environment.V207_IMAGE_SOURCE_COMMIT !== V207_REPAIRED_IMAGE_SOURCE_COMMIT) {
    throw new Error("V207_IMAGE_SOURCE_COMMIT_MISMATCH");
  }
  const proposalSha256 = environment.V207_PROPOSAL_SHA256?.trim() ?? "";
  if (!proposalSha256) throw new Error("V207_PROPOSAL_REQUIRED");
  if (proposalSha256 !== V207_AMENDED_PROPOSAL_SHA256) {
    throw new Error("V207_PROPOSAL_MISMATCH");
  }
  const capUsd = Number(environment.V207_FINITE_CAP_USD ?? "");
  if (!Number.isFinite(capUsd) || capUsd <= 0) {
    throw new Error("V207_FINITE_CAP_REQUIRED");
  }
  if (capUsd !== V207_APPROVED_FINITE_CAP_USD) {
    throw new Error("V207_FINITE_CAP_MISMATCH");
  }
  return { image, proposalSha256, capUsd };
}
