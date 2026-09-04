import { createHash } from "node:crypto";

export const V207_REPAIRED_IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a92e4345c111d60fc197cbc0fd3adf7d907a64d49547507fe68a089d5ed2247" as const;

export const V207_REPAIRED_IMAGE_SOURCE_COMMIT = "095e1642562e4370c89425292428eb474ba190f1";
export const V207_REPAIRED_IMAGE_CONFIG_DIGEST =
  "sha256:af05d38128fc75d14aefc4856e661e28e7369f7df90c90beb2875c569605c436" as const;
export const V207_REPAIRED_IMAGE_LAYER_DIGEST =
  "sha256:e28e45eee00f52ccd5d1d9ff8d5a432a757c91ad4fdd7687cd6defb9a62c9112" as const;
export const V207_REPAIRED_IMAGE_LAYER_DIFF_ID =
  "sha256:885b0adf0c57ab1e27553e58297a8f261dab8f60db668acb6376d12b2d5848e2" as const;
export const V207_REPAIRED_HANDLER_SHA256 =
  "sha256:e61786748d321124ab39267622ccb647f614e8fac0d560d2e72c6d2a158b528d" as const;
export const V207_EXECUTION_SUBSET_SCHEMA_SHA256 =
  "sha256:08fd73862b7d79f685dfaf1b72dd6b1e41468f3f581ad766ffea1f85c9dbf66f" as const;
export const V207_REPAIRED_IMAGE_PARENT =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;
export const V207_REPAIRED_IMAGE_BASE_DIGEST =
  "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" as const;
export const V207_REPAIRED_IMAGE_PARENT_CONFIG_DIGEST =
  "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2" as const;
export const V207_PENDING_PROPOSAL_SHA256 =
  "sha256:e1fd6996f4aa21c07b3b24e4db52683ebfb2999446d46066399b7b8cf0c7b1b9" as const;
export const V207_ANCHOR_REFRESH_SOURCE_COMMIT =
  "a6c7266e0c19fce07757c78fbd588dd442b7d24f" as const;
export const V207_TYPED_ACTIVATION_AUTHORITY_COMMIT =
  "e5571ed2478f0c526ebf508d0a4ce301bafa8203" as const;
export const V207_ORCHESTRATOR_MARKER_LIFECYCLE_COMMIT =
  "3dda73fed6d82dc7116b18a6b7cfbe4b262fc7bc" as const;
export const V207_FRESH_CATALOG_SUCCESS_RECONCILIATION_COMMIT =
  "5e1e5a067357a0df4a2fe1ea32412a4b6af33404" as const;
export const V207_ANCHOR_REFRESH_HELPER_COMMIT =
  "816d28699ab9ecad74c74f73bce984205b267ed5" as const;
export const V207_ANCHOR_REFRESH_HELPER_SHA256 =
  "sha256:8b059ade2b20ca3aea06a502af98858b6b5cce8e6e95f3008b45483712b28db8" as const;
export const V207_HOSTED_PNG_CRC32_REPAIR_COMMIT =
  "1960ea9307bb7fcb591c842b84fc1c622aec49eb" as const;
export const V207_PENDING_CONTROL_SOURCE_COMMIT =
  "42a5a522402e71aef1cee9b714e4cb54c571ceb3" as const;
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
// Attempts69 through 71 were consumed. Attempt72 is sealed and requires fresh
// exact approval before any provider call, mutation, or spend.
export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;
export const V207_APPROVED_FINITE_CAP_USD: number | null = null;
/**
 * Anchor refresh is an additional Worker mutation and must be opt-in at the
 * same compiled approval boundary as the proposal and finite cap. Any future
 * authority must bind its own decision in a separate immutable activation commit.
 */
export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;

const V207_PROPOSAL_POINTER_PATTERN =
  /^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/gmu;
const V207_APPROVED_AUTHORITY_PATTERN =
  /^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/gmu;
const V207_FINITE_CAP_PATTERN =
  /^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/gmu;
const V207_ANCHOR_REFRESH_PATTERN =
  /^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/gmu;

function replaceExactlyOneV207Binding(
  source: string,
  declarationName: string,
  pattern: RegExp,
  canonicalDeclaration: string,
  errorCode: string,
): string {
  const declarationCount =
    source.match(new RegExp(`^export\\s+const\\s+${declarationName}\\b`, "gmu"))?.length ?? 0;
  const bindingMatches = source.match(pattern)?.length ?? 0;
  if (declarationCount !== 1 || bindingMatches !== 1) throw new Error(errorCode);
  return source.replace(pattern, canonicalDeclaration);
}

/**
 * Canonicalize this module for approval lineage without creating a hash cycle. The exact
 * proposal pointer remains compiled into the parser and is still compared byte-for-byte at
 * execution; the proposal digest, approved authority digest, finite cap, and anchor-refresh
 * flag are replaced with neutral values when the source lineage hash is calculated. Any missing,
 * duplicate, or malformed binding fails closed rather than silently producing an unbound source hash.
 */
export function canonicalV207ActivationAuthoritySource(source: string): string {
  let canonical = replaceExactlyOneV207Binding(
    source,
    "V207_PENDING_PROPOSAL_SHA256",
    V207_PROPOSAL_POINTER_PATTERN,
    `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`,
    "V207_ACTIVATION_SOURCE_PROPOSAL_POINTER_INVALID",
  );
  canonical = replaceExactlyOneV207Binding(
    canonical,
    "V207_APPROVED_AUTHORITY_SHA256",
    V207_APPROVED_AUTHORITY_PATTERN,
    "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;",
    "V207_ACTIVATION_SOURCE_APPROVED_AUTHORITY_INVALID",
  );
  canonical = replaceExactlyOneV207Binding(
    canonical,
    "V207_APPROVED_FINITE_CAP_USD",
    V207_FINITE_CAP_PATTERN,
    "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;",
    "V207_ACTIVATION_SOURCE_FINITE_CAP_INVALID",
  );
  return replaceExactlyOneV207Binding(
    canonical,
    "V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED",
    V207_ANCHOR_REFRESH_PATTERN,
    "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
    "V207_ACTIVATION_SOURCE_ANCHOR_REFRESH_INVALID",
  );
}

/** Backward-compatible name for callers that only need the canonical source binding. */
export function normalizeV207ActivationAuthoritySource(source: string): string {
  return canonicalV207ActivationAuthoritySource(source);
}

/** Return the non-cyclic source binding consumed by the Attempt43 proposal lineage. */
export function hashV207ActivationAuthoritySource(source: string): string {
  return `sha256:${createHash("sha256")
    .update(canonicalV207ActivationAuthoritySource(source), "utf8")
    .digest("hex")}`;
}

export interface V207ActivationAuthority {
  readonly image: string;
  readonly proposalSha256: typeof V207_PENDING_PROPOSAL_SHA256;
  readonly capUsd: number;
  /**
   * Explicitly binds the optional rollback-anchor refresh capability.  The
   * current and historical authorities are refresh-disabled; a future
   * authority must opt in with the literal `true` through its own parser.
   */
  readonly anchorRefreshAuthorized: boolean;
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
  const approvedAuthoritySha256: string | null = V207_APPROVED_AUTHORITY_SHA256;
  const approvedCapUsd: number | null = V207_APPROVED_FINITE_CAP_USD;
  if (approvedAuthoritySha256 === null || approvedCapUsd === null) {
    throw new Error("V207_FRESH_AUTHORITY_REQUIRED");
  }
  const capUsd = Number(environment.V207_FINITE_CAP_USD ?? "");
  if (!Number.isFinite(capUsd) || capUsd <= 0) {
    throw new Error("V207_FINITE_CAP_REQUIRED");
  }
  if (capUsd !== approvedCapUsd) {
    throw new Error("V207_FINITE_CAP_MISMATCH");
  }
  return {
    image,
    proposalSha256,
    capUsd,
    anchorRefreshAuthorized: V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED === true,
  };
}
