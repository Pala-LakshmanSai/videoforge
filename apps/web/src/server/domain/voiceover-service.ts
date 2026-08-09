import { z } from "zod";

import type { RegisteredVoiceover } from "./models";
import { SHA256 } from "../mutation";

export const VERIFIED_FIXTURE_VOICEOVER_HANDLE = /^fixture_voiceover_sha256_[a-f0-9]{64}$/u;
const VOICEOVER_FILENAME = /^[^/\\\0]{1,255}\.(?:aac|flac|m4a|mp3|wav)$/iu;

export const voiceoverRegistrationSchema = z
  .object({
    asset_id: z.string().regex(VERIFIED_FIXTURE_VOICEOVER_HANDLE),
    checksum: z.string().regex(SHA256),
    filename: z.string().regex(VOICEOVER_FILENAME),
    duration_seconds: z.number().min(10).max(3_600),
    sample_rate: z.number().int().min(8_000).max(192_000),
    channels: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

export type VoiceoverRegistration = z.infer<typeof voiceoverRegistrationSchema>;

export function registeredVoiceoverFrom(metadata: VoiceoverRegistration): RegisteredVoiceover {
  return {
    assetId: metadata.asset_id,
    checksum: metadata.checksum,
    filename: metadata.filename,
    durationSeconds: metadata.duration_seconds,
    sampleRate: metadata.sample_rate,
    channels: metadata.channels,
    verificationState: "VERIFIED",
    persistedBytes: false,
    providerCallsAuthorized: false,
  };
}
