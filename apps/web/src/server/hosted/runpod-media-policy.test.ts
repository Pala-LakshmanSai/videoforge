import { describe, expect, it } from "vitest";
import type { HostedRuntimeEnvironment } from "./configuration";
import { cloudDiskGb, cloudGpuCandidates, cloudMediaConfiguration, GPU_PREFERENCE, isCapacityRefusal, type CloudGpu } from "./runpod-media-policy";
const hash = `sha256:${"a".repeat(64)}`;
function environment(overrides: Record<string, string | undefined> = {}): HostedRuntimeEnvironment {
  return {
    VIDEOFORGE_CLOUD_MEDIA_ENABLED: "true", VIDEOFORGE_CLOUD_MEDIA_IMAGE: `ghcr.io/example/media@${hash}`,
    VIDEOFORGE_CLOUD_MEDIA_SOURCE_SHA256: hash, RUNPOD_API_KEY: "fixture-provider-key",
    VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID: "99999999-9999-4999-8999-999999999999",
    VIDEOFORGE_CLOUD_MEDIA_MAX_HOURLY_USD: "1", VIDEOFORGE_CLOUD_MEDIA_BUDGET_USD: "2",
    VIDEOFORGE_CLOUD_MEDIA_MAX_RENTAL_SECONDS: "7200",
    VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON: JSON.stringify({ schema_version: "videoforge-runpod-media-release/v1",
      qualified: true, platform: "linux/amd64", source_sha256: hash, runtime_sha256: hash,
      tooling: { ffmpeg_sha256: hash, ffprobe_sha256: hash, whisper_sha256: hash,
        whisper_model_sha256: "sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        ffmpeg_version: "8.1.2", ffprobe_version: "8.1.2", whisper_version: "1.8.4" } }),
    ...overrides,
  } as HostedRuntimeEnvironment;
}
const gpu = (id: string, changes: Partial<CloudGpu> = {}): CloudGpu => ({ id, memory: 24, secure: true,
  manufacturer: "NVIDIA", availability: "HIGH", price: { secure: .4 }, ...changes });
describe("qualified optional cloud media policy", () => {
  it("disabled Cloud leaves Local ready without consulting a provider key", () => {
    expect(cloudMediaConfiguration({ get RUNPOD_API_KEY(): string { throw new Error("must remain inert"); } })).toBeUndefined();
  });
  it("accepts the immutable Linux release envelope and exact execution source", () => {
    const value = cloudMediaConfiguration(environment());
    expect(value?.executionBundleSha256).toBe(hash);
    expect(value?.tooling.ffprobe_version).toBe("8.1.2");
    expect(value?.imageDigest).toBe(hash);
  });
  it.each([{ VIDEOFORGE_CLOUD_MEDIA_IMAGE: "ghcr.io/example/media:latest" },
    { VIDEOFORGE_CLOUD_MEDIA_SOURCE_SHA256: `sha256:${"b".repeat(64)}` },
    { VIDEOFORGE_CLOUD_MEDIA_MAX_HOURLY_USD: "NaN" }, { VIDEOFORGE_CLOUD_MEDIA_MAX_RENTAL_SECONDS: "86400" }])("rejects unsafe release or paid bounds %j", changes => {
      expect(() => cloudMediaConfiguration(environment(changes))).toThrow("CLOUD_MEDIA_RUNTIME_UNQUALIFIED");
    });
  it("rejects an unqualified tool version", () => {
    const env = environment();
    const release = JSON.parse(env.VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON!);
    release.tooling.ffprobe_version = "8.1.1";
    expect(() => cloudMediaConfiguration({ ...env, VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON: JSON.stringify(release) })).toThrow("CLOUD_MEDIA_RUNTIME_UNQUALIFIED");
  });
  it("keeps known fallback order and excludes unknown capacity, MIG, memory and all-in price failures", () => {
    const rows = [gpu("NVIDIA future model"), gpu(GPU_PREFERENCE[4]), gpu(GPU_PREFERENCE[0]),
      gpu("MIG NVIDIA GPU"), gpu("unknown availability", { availability: undefined }),
      gpu("small", { memory: 8 }), gpu("unknown rate", { price: { secure: NaN } }),
      gpu("over budget", { price: { secure: .99 } })];
    expect(cloudGpuCandidates(rows, 100, 1, 2, 7200).map(row => row.id)).toEqual([
      GPU_PREFERENCE[0], GPU_PREFERENCE[4], "NVIDIA future model",
    ]);
    expect(cloudGpuCandidates(rows, 100, 1, .1, 7200)).toEqual([]);
  });
  it("retains the 100 GB floor and increases conservative disk for large committed inputs", () => {
    expect(cloudDiskGb(0, 1000)).toBe(100);
    expect(cloudDiskGb(50_000_000_000, 2_700_000)).toBeGreaterThan(100);
    expect(cloudDiskGb(50_000_000_000, 2_700_000) % 10).toBe(0);
    expect(() => cloudDiskGb(-1, 1000)).toThrow("CLOUD_MEDIA_INPUT_SIZE_INVALID");
    expect(() => cloudDiskGb(10, 3_600_001)).toThrow("CLOUD_MEDIA_INPUT_SIZE_INVALID");
  });
  it("fallback requires a positive capacity refusal rather than generic transient or auth failure", () => {
    expect(isCapacityRefusal(503, "insufficient capacity")).toBe(true);
    expect(isCapacityRefusal(503, "internal error")).toBe(false);
    expect(isCapacityRefusal(401, "no available GPU")).toBe(false);
    expect(isCapacityRefusal(422, "invalid image")).toBe(false);
  });
});

it("enables the stream only through a qualified exact release capability",()=>{
  const env=environment(),release=JSON.parse(env.VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON!);
  expect(cloudMediaConfiguration(env)?.spanBatchProtocol).toBe(1);
  for(const capability of [1,2]) expect(cloudMediaConfiguration({...env,VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON:
    JSON.stringify({...release,span_batch_protocol:capability})})?.spanBatchProtocol).toBe(capability);
  for(const capability of [null,true,"2",0,128]) expect(()=>cloudMediaConfiguration({...env,VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON:
    JSON.stringify({...release,span_batch_protocol:capability})})).toThrow("CLOUD_MEDIA_RUNTIME_UNQUALIFIED");
});
