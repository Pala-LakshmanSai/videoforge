const HASH = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const ALLOWED_SECONDS = new Set([2, 4, 6, 10]);

export function generateSoulXQualificationCase(input) {
  const {
    attemptId,
    seconds,
    sourceAssetId,
    sourceSha256,
    sourceReservationId,
    audioAssetId,
    audioSha256,
    audioReservationId,
    outputReservationId,
  } = input;
  if (
    ![
      attemptId,
      sourceAssetId,
      sourceReservationId,
      audioAssetId,
      audioReservationId,
      outputReservationId,
    ].every((value) => ID.test(value ?? "")) ||
    !HASH.test(sourceSha256 ?? "") ||
    !HASH.test(audioSha256 ?? "") ||
    !ALLOWED_SECONDS.has(seconds)
  )
    throw new Error("V213_SOULX_QUALIFICATION_GENERATOR_INPUT_INVALID");
  const selectedSamples = seconds * 48_000;
  const paddedSamples = Math.max(144_000, selectedSamples);
  return Object.freeze({
    schema_version: "videoforge-soulx-span-batch/v1",
    attempt_id: attemptId,
    avatar_source: Object.freeze({
      asset_id: sourceAssetId,
      sha256: sourceSha256,
      port_reservation_id: sourceReservationId,
    }),
    spans: Object.freeze([
      Object.freeze({
        item_id: `soulx-${seconds}s`,
        audio_asset_id: audioAssetId,
        audio_sha256: audioSha256,
        audio_port_reservation_id: audioReservationId,
        output_reservation_id: outputReservationId,
        padded_samples_48k: paddedSamples,
        trim_start_sample_48k: 0,
        trim_end_sample_exclusive_48k: selectedSamples,
      }),
    ]),
  });
}

export function validateSoulXQualificationCase(value, seconds) {
  if (
    !ALLOWED_SECONDS.has(seconds) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "attempt_id,avatar_source,schema_version,spans" ||
    value.schema_version !== "videoforge-soulx-span-batch/v1" ||
    !ID.test(value.attempt_id ?? "") ||
    !value.avatar_source ||
    typeof value.avatar_source !== "object" ||
    Array.isArray(value.avatar_source) ||
    Object.keys(value.avatar_source).sort().join(",") !== "asset_id,port_reservation_id,sha256" ||
    !ID.test(value.avatar_source.asset_id ?? "") ||
    !ID.test(value.avatar_source.port_reservation_id ?? "") ||
    !HASH.test(value.avatar_source.sha256 ?? "") ||
    !Array.isArray(value.spans) ||
    value.spans.length !== 1
  )
    return false;
  const span = value.spans[0];
  const selected = seconds * 48_000;
  return Boolean(
    span &&
      typeof span === "object" &&
      !Array.isArray(span) &&
      Object.keys(span).sort().join(",") ===
        "audio_asset_id,audio_port_reservation_id,audio_sha256,item_id,output_reservation_id,padded_samples_48k,trim_end_sample_exclusive_48k,trim_start_sample_48k" &&
      span.item_id === `soulx-${seconds}s` &&
      ID.test(span.audio_asset_id ?? "") &&
      ID.test(span.audio_port_reservation_id ?? "") &&
      ID.test(span.output_reservation_id ?? "") &&
      HASH.test(span.audio_sha256 ?? "") &&
      span.padded_samples_48k === Math.max(144_000, selected) &&
      span.trim_start_sample_48k === 0 &&
      span.trim_end_sample_exclusive_48k === selected,
  );
}
