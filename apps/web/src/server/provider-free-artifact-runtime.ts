import type {
  ProviderFreeLaneOutputReceipt,
  ProviderFreeRenderReceipt,
} from "@videoforge/control-plane/provider-free-orchestration";

import { providerFreeFixtureMp4Bytes } from "./provider-free-fixture-mp4";
import type {
  ProviderFreeArtifactBlob,
  ProviderFreeProjectBundle,
} from "./provider-free-foundations";

export interface ProviderFreeArtifactRuntime {
  persist(artifacts: readonly ProviderFreeArtifactBlob[]): Promise<void>;
  laneReceipt(
    bundle: ProviderFreeProjectBundle,
    lane: "mage_image" | "echo_avatar",
  ): Promise<ProviderFreeLaneOutputReceipt>;
  render(bundle: ProviderFreeProjectBundle): Promise<ProviderFreeRenderReceipt>;
  read(sha256: string): Promise<Uint8Array | null>;
  reset(): Promise<void>;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function distinctFixtureMp4(projectId: string): Uint8Array {
  const original = providerFreeFixtureMp4Bytes();
  const marker = new TextEncoder().encode(`videoforge:${projectId}`);
  const box = new Uint8Array(8 + marker.length);
  const view = new DataView(box.buffer);
  view.setUint32(0, box.length, false);
  box.set(new TextEncoder().encode("free"), 4);
  box.set(marker, 8);
  const result = new Uint8Array(original.length + box.length);
  result.set(original);
  result.set(box, original.length);
  return result;
}

export class MemoryProviderFreeArtifactRuntime implements ProviderFreeArtifactRuntime {
  readonly #artifacts = new Map<string, Uint8Array>();

  async persist(artifacts: readonly ProviderFreeArtifactBlob[]): Promise<void> {
    for (const artifact of artifacts) {
      if ((await sha256(artifact.bytes)) !== artifact.sha256)
        throw new Error(`Artifact ${artifact.artifactId} failed SHA-256 verification.`);
      const existing = this.#artifacts.get(artifact.sha256);
      if (existing !== undefined && (await sha256(existing)) !== artifact.sha256)
        throw new Error(`Content-addressed artifact collision for ${artifact.sha256}.`);
      this.#artifacts.set(artifact.sha256, artifact.bytes.slice());
    }
  }

  async laneReceipt(
    bundle: ProviderFreeProjectBundle,
    lane: "mage_image" | "echo_avatar",
  ): Promise<ProviderFreeLaneOutputReceipt> {
    const output = lane === "mage_image" ? bundle.mage : bundle.echo;
    await this.persist(output.artifacts);
    return Object.freeze({
      projectId: bundle.projectId,
      lane,
      manifestSha256: output.manifest.sha256,
      artifactCount: output.artifacts.length,
      durable: true as const,
    });
  }

  async render(bundle: ProviderFreeProjectBundle): Promise<ProviderFreeRenderReceipt> {
    await this.persist([bundle.renderManifest]);
    const bytes = distinctFixtureMp4(bundle.projectId);
    const finalMp4Sha256 = await sha256(bytes);
    this.#artifacts.set(finalMp4Sha256, bytes);
    return Object.freeze({
      projectId: bundle.projectId,
      renderManifestSha256: bundle.renderManifest.sha256,
      artifactId: `fixture-final-mp4-${bundle.projectId}`,
      finalMp4Sha256,
      byteSize: bytes.length,
      durationMs: 1_000,
      totalFrames: 30,
      width: 1920 as const,
      height: 1080 as const,
      audioCodec: "aac" as const,
      videoCodec: "h264" as const,
      durable: true as const,
      renderer: "WORKERD_SAFE_FIXTURE" as const,
    });
  }

  async read(sha256Digest: string): Promise<Uint8Array | null> {
    return this.#artifacts.get(sha256Digest)?.slice() ?? null;
  }

  async reset(): Promise<void> {
    this.#artifacts.clear();
  }
}
