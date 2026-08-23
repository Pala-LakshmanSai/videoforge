export const V207_REPAIRED_IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59" as const;

export const V207_REPAIRED_IMAGE_SOURCE_COMMIT = "a7b7a937d08dc9032b8922cca71c602195f3094c";
export const V207_REPAIRED_IMAGE_CONFIG_DIGEST =
  "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6" as const;
export const V207_REPAIRED_IMAGE_LAYER_DIGEST =
  "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a" as const;
export const V207_REPAIRED_IMAGE_LAYER_DIFF_ID =
  "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1" as const;
export const V207_REPAIRED_HANDLER_SHA256 =
  "sha256:3a2559dd363bdf5032b019dab3cb8fe45cba6ed4308464f860a1965cfd18f1da" as const;
export const V207_EXECUTION_SUBSET_SCHEMA_SHA256 =
  "sha256:a94bf2c8c4175eef3f84ab719118c2b9b5b501ce8b2708c28713b25521b71c71" as const;
export const V207_REPAIRED_IMAGE_PARENT =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;
export const V207_REPAIRED_IMAGE_BASE_DIGEST =
  "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;
export const V207_REPAIRED_IMAGE_PARENT_CONFIG_DIGEST =
  "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2" as const;
export const V207_PENDING_PROPOSAL_SHA256 =
  "sha256:3ce00d81d161e43a2d6a1610b6f9a7c9b7ceaa1fcb3bbbe44339fa478605eb18" as const;
export const V207_HOSTED_PNG_CRC32_REPAIR_COMMIT =
  "1960ea9307bb7fcb591c842b84fc1c622aec49eb" as const;
export const V207_PENDING_CONTROL_SOURCE_COMMIT =
  "6a4053f6fdde6e906e10b7cb297d253a7b9af140" as const;
export const V207_FINALIZE_REPLAY_FAST_PATH_COMMIT =
  "bf26c3a86ec6a48f619c39613d425da816eeae4d" as const;
export const V207_TERMINAL_SNAPSHOT_STABILIZATION_COMMIT =
  "f513ac807c6d5e2298092a936495e3c4fc0e6a28" as const;

// Historical validators bind these consumed immutable lineages while the active
// pointer advances. They are evidence markers only and are never dispatch authority:
// Attempt28 proposal sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf
// Attempt28 control 0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14
// Attempt29 proposal sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6
// Attempt29 control 7ba8e9181fe210858c23a3ba7c5c9aca768ac24b
// Attempt29 consumed authority sha256:46bf0ba614b4210f56fd745057e8ebc6f5be4c69c672fe885d6d36de185f1572
// Attempt30 proposal sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a
// Attempt30 consumed authority sha256:6fd4560fcba507dbae51da056d09c309fe0c93ed65e713e3526ad3aa2f978131
// Attempt31 proposal sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea
// and its authority/cap were consumed by one bounded execution and cannot be reused.
// Attempt32 proposal sha256:7c5370668ae06487729775f082cd981164d3e4a1634f20a77beb08bba2ea6b6a
// and authority sha256:a2f2519e6cc5f00ec804adea07b431d155e9fc88a566d7f9ef05396beca99114
// were consumed by one bounded execution and cannot be reused.
// Attempt33 proposal sha256:0a417ca023895a02b8ce0e0f2e86b3f3e81b38624819a4abc473695602637925
// and authority sha256:002ee1529b7b2173a51bd7ccedec5bc25bd9945ea8d4f03be02f202c7462f328
// were consumed by one bounded execution and cannot be reused. Attempt34 authority
// sha256:3157147f85ecea86b6d01ce489dbfff2dc0d7bc51a833749d96a9cecd99314ff
// closed before mutation on MEDIUM-threshold capacity drift. Attempt35 authority
// sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37
// and proposal sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c
// were consumed by one bounded execution and cannot be reused. Attempt37 proposal
// sha256:6ff97af22dd025e9298a830a9bcd946f18fe376745f39ed6e5c15b791e3f390e
// and authority sha256:812899db3d2225224ea231112d2eba150ffbbd254148e71f94c81a44de32cadf
// were consumed by one bounded execution and cannot be reused. Attempt38 proposal
// sha256:8613f60fb65a3d7c254daeb42901b217d392566bef11dfaa864d7cbbe000378c
// was approved once by authority sha256:1933bf186c235089c13edfee0e68a28b2fa0ab2ebc89a25f81bb59a7eedd92b6
// with a fresh USD 4 cap, then consumed by its fail-closed execution. Attempt39 proposal
// sha256:11203e32aff804dd9f31c674cd3411c8a0efb2cdca7057e891543f30377f5e57 is approved once
// by authority sha256:a9d68f4125f58429699fe52e90ae238b72f0835b4627f9246be86b10e759352b with
// FlashBoot=true, LOW-or-better EU-RO-1, and a fresh USD 4 cap; it binds control repair
// 5aa2ccae639052fb61312a3b5a830402c275a2f8 and reuses the already-published image digest.
// Historical Attempt34/35 control:
// 96f5e16cf03be7e31049478ce7f6b0c134a8108c
export const V207_CONSUMED_ATTEMPT31_AUTHORITY_SHA256 =
  "sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5" as const;
export const V207_APPROVED_AUTHORITY_SHA256: string | null =
  "sha256:2aec5d4846bfe8d6d1e658af9db7cf354a25611838f725472477b443d6291f9d";
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
