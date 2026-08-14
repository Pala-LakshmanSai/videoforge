import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ProviderFreeLaneOutputReceipt,
  ProviderFreeRenderReceipt,
} from "@videoforge/control-plane/provider-free-orchestration";
import { validateAndHashContractDocument } from "@videoforge/contracts";
import { compileCompleteWorkPlan } from "@videoforge/pipeline/scheduler";

import type { ProviderFreeArtifactRuntime } from "../provider-free-artifact-runtime";
import type {
  ProviderFreeArtifactBlob,
  ProviderFreeProjectBundle,
  ProviderFreeRenderSegment,
} from "../provider-free-foundations";

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safeId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/gu, "-");
}

function objectPath(root: string, sha256: string, extension: string): string {
  const hex = sha256.slice("sha256:".length);
  return path.join(root, "objects", hex.slice(0, 2), `${hex}.${extension}`);
}

async function run(executable: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        TMPDIR: process.env.TMPDIR,
      },
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${String(code)}: ${stderr.trim()}`));
    });
  });
}

function inputArtifacts(bundle: ProviderFreeProjectBundle): Map<string, ProviderFreeArtifactBlob> {
  return new Map(
    [...bundle.mage.artifacts, ...bundle.echo.artifacts].map((artifact) => [
      artifact.sha256,
      artifact,
    ]),
  );
}

function segmentFilter(
  segment: ProviderFreeRenderSegment,
  inputIndexes: readonly number[],
  output: string,
): string {
  const frames = Math.round((segment.durationMs * 30) / 1_000);
  if (segment.composition === "AVATAR_SPLIT_IMAGE") {
    return (
      `[${String(inputIndexes[0])}:v]scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080,setsar=1,fps=30,trim=end_frame=${String(frames)},setpts=PTS-STARTPTS[a];` +
      `[${String(inputIndexes[1])}:v]scale=1000:1125:force_original_aspect_ratio=increase,zoompan=z='min(zoom+0.0003,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${String(frames)}:s=960x1080:fps=30,trim=end_frame=${String(frames)},setpts=PTS-STARTPTS[i];` +
      `[a][i]hstack=inputs=2,format=yuv420p[${output}]`
    );
  }
  if (segment.composition === "IMAGE_FULL") {
    return `[${String(inputIndexes[0])}:v]scale=2000:1125:force_original_aspect_ratio=increase,zoompan=z='min(zoom+0.0003,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${String(frames)}:s=1920x1080:fps=30,trim=end_frame=${String(frames)},setpts=PTS-STARTPTS,format=yuv420p[${output}]`;
  }
  return `[${String(inputIndexes[0])}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30,trim=end_frame=${String(frames)},setpts=PTS-STARTPTS,format=yuv420p[${output}]`;
}

export function createNodeProviderFreeArtifactRuntime(root: string): ProviderFreeArtifactRuntime {
  const verifiedFoundations = new Set<string>();
  async function persist(artifacts: readonly ProviderFreeArtifactBlob[]): Promise<void> {
    for (const artifact of artifacts) {
      if (digest(artifact.bytes) !== artifact.sha256)
        throw new Error(`Artifact ${artifact.artifactId} failed SHA-256 verification.`);
      const target = objectPath(root, artifact.sha256, artifact.extension);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      try {
        const existing = await readFile(target);
        if (digest(existing) !== artifact.sha256)
          throw new Error(`Durable object ${artifact.sha256} is corrupt.`);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        const temporary = `${target}.${process.pid}.next`;
        await writeFile(temporary, artifact.bytes, { mode: 0o600 });
        await rename(temporary, target);
      }
    }
  }

  return {
    persist,
    async persistFoundations(bundle) {
      if (!verifiedFoundations.has(bundle.projectId)) {
        const authority = bundle.workPlanAuthority;
        const [transcript, timeline] = await Promise.all([
          validateAndHashContractDocument("transcriptTiming", authority.transcript),
          validateAndHashContractDocument("timelinePlan", authority.timeline),
        ]);
        const compiled = await compileCompleteWorkPlan({
          revision: {
            sha256: authority.revisionConfigHash,
            value: {
              project_revision_id: bundle.revisionId,
              scheduler_version: "scheduler-v2",
              scheduler_seed: 982_341,
              voiceover_asset_id: transcript.value.source.asset_id,
              voiceover_sha256: transcript.value.source.sha256,
            },
          } as Parameters<typeof compileCompleteWorkPlan>[0]["revision"],
          transcript,
          timeline,
          schedulerConfigHash: authority.schedulerConfigHash as `sha256:${string}`,
          selectedSpanAudio: authority.selectedSpanAudio as Parameters<
            typeof compileCompleteWorkPlan
          >[0]["selectedSpanAudio"],
        });
        if (!compiled.ok)
          throw new Error(`CP-04 work-plan compile failed: ${compiled.error.message}`);
        if (
          compiled.value.generationWorkManifest.sha256 !==
            bundle.receipts.generationWorkManifestSha256 ||
          compiled.value.renderWorkManifest.sha256 !== bundle.receipts.renderWorkManifestSha256
        )
          throw new Error("Workerd-safe work manifests differ from proven CP-04 compiler output.");
        verifiedFoundations.add(bundle.projectId);
      }
      await persist(bundle.foundationArtifacts);
    },
    async laneReceipt(bundle, lane): Promise<ProviderFreeLaneOutputReceipt> {
      const output = lane === "mage_image" ? bundle.mage : bundle.echo;
      await persist(output.artifacts);
      return {
        projectId: bundle.projectId,
        lane,
        manifestSha256: output.manifest.sha256,
        artifactCount: output.artifacts.length,
        durable: true,
      };
    },
    async render(bundle): Promise<ProviderFreeRenderReceipt> {
      await persist([bundle.renderManifest]);
      const artifacts = inputArtifacts(bundle);
      const args = ["-hide_banner", "-loglevel", "error", "-y"];
      const segmentInputs: number[][] = [];
      let inputIndex = 0;
      for (const segment of bundle.renderSegments) {
        const hashes =
          segment.composition === "AVATAR_SPLIT_IMAGE"
            ? [segment.avatarSha256, segment.imageSha256]
            : [segment.composition === "IMAGE_FULL" ? segment.imageSha256 : segment.avatarSha256];
        const indexes: number[] = [];
        for (const sha256 of hashes) {
          if (sha256 === null) throw new Error(`Segment ${segment.segmentId} lacks exact asset.`);
          const artifact = artifacts.get(sha256);
          if (artifact === undefined) throw new Error(`Render asset ${sha256} is unavailable.`);
          args.push("-loop", "1", "-i", objectPath(root, sha256, artifact.extension));
          indexes.push(inputIndex++);
        }
        segmentInputs.push(indexes);
      }
      const durationMs = Math.round((bundle.totalFrames * 1_000) / 30);
      const frequency = 300 + Number.parseInt(bundle.renderManifest.sha256.slice(7, 9), 16);
      args.push(
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${String(frequency)}:sample_rate=48000:duration=${String(durationMs / 1_000)}`,
      );
      const filters = bundle.renderSegments.map((segment, index) =>
        segmentFilter(segment, segmentInputs[index]!, `v${String(index)}`),
      );
      filters.push(
        `${bundle.renderSegments.map((_, index) => `[v${String(index)}]`).join("")}concat=n=${String(bundle.renderSegments.length)}:v=1:a=0[vout]`,
      );
      const projectDirectory = path.join(root, "projects", safeId(bundle.projectId));
      await mkdir(projectDirectory, { recursive: true, mode: 0o700 });
      const temporary = path.join(projectDirectory, `final-${process.pid}.next.mp4`);
      args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[vout]",
        "-map",
        `${String(inputIndex)}:a`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "30",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        "-metadata",
        `comment=VideoForge ${bundle.projectId} ${bundle.renderManifest.sha256}`,
        "-shortest",
        temporary,
      );
      try {
        await run("ffmpeg", args);
        const bytes = await readFile(temporary);
        const finalMp4Sha256 = digest(bytes);
        const target = objectPath(root, finalMp4Sha256, "mp4");
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await rename(temporary, target);
        return {
          projectId: bundle.projectId,
          renderManifestSha256: bundle.renderManifest.sha256,
          artifactId: `fixture-final-mp4-${safeId(bundle.projectId)}`,
          finalMp4Sha256,
          byteSize: bytes.length,
          durationMs,
          totalFrames: bundle.totalFrames,
          width: 1920,
          height: 1080,
          audioCodec: "aac",
          videoCodec: "h264",
          durable: true,
          renderer: "DIRECT_FFMPEG",
        };
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async read(sha256) {
      try {
        return new Uint8Array(await readFile(objectPath(root, sha256, "mp4")));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async reset() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
