export { cloudMediaConfiguration, MULTIPART_PART_BYTES, SHA256, SINGLE_PUT_MAX_BYTES } from "./cloud-media-configuration";
export type { CloudMediaConfiguration } from "./cloud-media-configuration";

export const GPU_PREFERENCE = [
  "NVIDIA RTX PRO 4500 Blackwell Server Edition", "NVIDIA RTX PRO 4000 Blackwell",
  "NVIDIA RTX PRO 4500 Blackwell", "NVIDIA GeForce RTX 4090", "NVIDIA L40S",
  "NVIDIA RTX A6000", "NVIDIA A40", "NVIDIA L4", "NVIDIA GeForce RTX 3090",
  "NVIDIA L40", "NVIDIA RTX 6000 Ada Generation", "NVIDIA RTX PRO 5000 Blackwell",
  "NVIDIA GeForce RTX 5090", "NVIDIA RTX A5000", "NVIDIA RTX 4000 Ada Generation",
  "NVIDIA RTX A4500", "NVIDIA RTX A4000", "NVIDIA RTX 2000 Ada Generation",
] as const;
/** Conservative unqualified allowance; replace only after measured VideoForge long-render peaks. */
export function cloudDiskGb(inputBytes: number, durationMs: number): number {
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 0 || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 3_600_000)
    throw new Error("CLOUD_MEDIA_INPUT_SIZE_INVALID");
  // Input copy + concurrent composition/chunks + final export; 32 GiB runtime/safety reserve.
  const bytes = inputBytes * 3 + durationMs / 1000 * (32_000_000 / 8) * 3 + 32 * 1024 ** 3;
  return Math.max(100, Math.ceil(bytes / 1_000_000_000 / 10) * 10);
}

export interface CloudGpu { id: string; memory: number; secure: boolean; manufacturer: string;
  price: {secure: number}; availability?: string; }
export function cloudGpuCandidates(rows: readonly CloudGpu[], diskGb: number, maxHourlyUsd: number,
  budgetUsd: number, rentalSeconds: number): readonly CloudGpu[] {
  const limit = Math.min(maxHourlyUsd, budgetUsd * 3600 / rentalSeconds);
  const rank = (id: string) => { const r = GPU_PREFERENCE.findIndex(g => g === id); return r < 0 ? GPU_PREFERENCE.length : r; };
  return rows.filter(g => g.secure === true && g.manufacturer === "NVIDIA" && g.memory >= 16 &&
    !/MIG/iu.test(g.id) && ["HIGH", "MEDIUM", "LOW"].includes(g.availability ?? "") &&
    Number.isFinite(g.price?.secure) && g.price.secure > 0 && g.price.secure + diskGb * .10 / 720 <= limit)
    .sort((a,b) => rank(a.id) - rank(b.id) || a.price.secure - b.price.secure || a.id.localeCompare(b.id));
}
export class RunPodMediaError extends Error {
  constructor(readonly status: number, readonly capacityRejected = false) { super(`RUNPOD_HTTP_${status}`); }
}

/** Only this positive refusal classification permits another create after complete empty inventory. */
export function isCapacityRefusal(status: number, detail: string): boolean {
  return [400,409,503].includes(status) && /insufficient capacity|no longer any instances available|no available (?:gpu|instance)|out of (?:stock|capacity)|no capacity/iu.test(detail);
}
