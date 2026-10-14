import { generatedVoiceoverAudio } from "./generated-voiceover-audio";
import { createVoiceoverDecoder } from "./voiceover-decoder";
import { levelVoiceoverStream, measureVoiceoverLevels } from "./voiceover-levels";

/** Both narration paths inspect and level the same accepted job; downloads never regenerate it. */
export async function leveledVoiceover(download: () => Promise<Response>, minimumSeconds = 10) {
  const original = await download();
  if (!original.body) throw new Error("GENERATED_VOICEOVER_DOWNLOAD_PENDING");
  const measured = generatedVoiceoverAudio(minimumSeconds);
  const plan = await measureVoiceoverLevels(
    original.body.pipeThrough(measured.stream),
    createVoiceoverDecoder(),
  );
  const receipt = measured.receipt();
  if (
    receipt.content_length !== plan.contentLength ||
    receipt.checksum_sha256 !== `sha256:${plan.sourceChecksum}`
  )
    throw new Error("GENERATED_VOICEOVER_SOURCE_CHANGED");
  const audio = await download();
  if (!audio.body) throw new Error("GENERATED_VOICEOVER_DOWNLOAD_PENDING");
  return {
    body: audio.body.pipeThrough(levelVoiceoverStream(plan)),
    length: plan.contentLength,
    sourceChecksum: receipt.checksum_sha256,
  };
}
