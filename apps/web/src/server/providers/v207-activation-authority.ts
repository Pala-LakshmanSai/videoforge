export const V207_REPAIRED_IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5" as const;

export const V207_REPAIRED_IMAGE_SOURCE_COMMIT = "79f123268b6ade640c02dd20616a89d16b43a5e6";
export const V207_REPAIRED_IMAGE_CONFIG_DIGEST =
  "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de" as const;
export const V207_REPAIRED_IMAGE_LAYER_DIGEST =
  "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38" as const;
export const V207_REPAIRED_IMAGE_PARENT =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;
export const V207_REPAIRED_IMAGE_BASE_DIGEST =
  "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;
export const V207_REPAIRED_IMAGE_PARENT_CONFIG_DIGEST =
  "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2" as const;
export const V207_PENDING_PROPOSAL_SHA256 =
  "sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a" as const;
export const V207_HOSTED_PNG_CRC32_REPAIR_COMMIT =
  "1960ea9307bb7fcb591c842b84fc1c622aec49eb" as const;
export const V207_PENDING_CONTROL_SOURCE_COMMIT =
  "bf26c3a86ec6a48f619c39613d425da816eeae4d" as const;
export const V207_FINALIZE_REPLAY_FAST_PATH_COMMIT =
  "bf26c3a86ec6a48f619c39613d425da816eeae4d" as const;

// Historical validators bind these consumed immutable lineages while the active
// pointer advances. They are evidence markers only and are never dispatch authority:
// Attempt28 proposal sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf
// Attempt28 control 0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14
// Attempt29 proposal sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6
// Attempt29 control 7ba8e9181fe210858c23a3ba7c5c9aca768ac24b
// Attempt29 consumed authority sha256:46bf0ba614b4210f56fd745057e8ebc6f5be4c69c672fe885d6d36de185f1572
export const V207_APPROVED_AUTHORITY_SHA256: string | null =
  "sha256:6fd4560fcba507dbae51da056d09c309fe0c93ed65e713e3526ad3aa2f978131";
export const V207_APPROVED_FINITE_CAP_USD: number | null = 4;

export interface V207ActivationAuthority {
  readonly image: string;
  readonly proposalSha256: typeof V207_PENDING_PROPOSAL_SHA256;
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
  if (proposalSha256 !== V207_PENDING_PROPOSAL_SHA256) {
    throw new Error("V207_PROPOSAL_MISMATCH");
  }
  const approvedCapUsd: number | null = V207_APPROVED_FINITE_CAP_USD;
  if (approvedCapUsd === null) throw new Error("V207_FRESH_AUTHORITY_REQUIRED");
  const capUsd = Number(environment.V207_FINITE_CAP_USD ?? "");
  if (!Number.isFinite(capUsd) || capUsd <= 0) {
    throw new Error("V207_FINITE_CAP_REQUIRED");
  }
  if (capUsd !== approvedCapUsd) {
    throw new Error("V207_FINITE_CAP_MISMATCH");
  }
  return { image, proposalSha256, capUsd };
}
