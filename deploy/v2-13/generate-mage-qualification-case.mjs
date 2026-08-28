const HASH = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export const MAGE_QUALIFICATION_MODEL_REVISION = "d8c99241f6fa80fbd453014234af2bf337ea21e6";
export const MAGE_QUALIFICATION_ITEM_COUNT = 32;

const promptSha = (text, sha256Utf8) => sha256Utf8(text);

export function generateMageQualificationCase(input) {
  const { attemptId, outputUrls, sha256Utf8 } = input;
  if (
    !ID.test(attemptId ?? "") ||
    !Array.isArray(outputUrls) ||
    outputUrls.length !== MAGE_QUALIFICATION_ITEM_COUNT ||
    outputUrls.some((url) => typeof url !== "string" || !url.startsWith("https://")) ||
    typeof sha256Utf8 !== "function"
  )
    throw new Error("V213_MAGE_QUALIFICATION_GENERATOR_INPUT_INVALID");
  const negative =
    "text, letters, logo, watermark, border, caption, lower third, title card, motion graphics, illustration, anatomy defect";
  const items = Array.from({ length: MAGE_QUALIFICATION_ITEM_COUNT }, (_, index) => {
    const sceneId = `mage-qualification-${String(index + 1).padStart(2, "0")}`;
    const positive =
      `Authentic documentary stock photograph ${index + 1}, grounded natural light, realistic materials, ` +
      "useful composition, no readable branding, landscape 16:9";
    return Object.freeze({
      scene_id: sceneId,
      positive_prompt: positive,
      positive_prompt_sha256: promptSha(positive, sha256Utf8),
      negative_prompt: negative,
      negative_prompt_sha256: promptSha(negative, sha256Utf8),
      seed: 2_130_000 + index,
      width: 1280,
      height: 720,
      output_put_url: outputUrls[index],
    });
  });
  return Object.freeze({
    attempt_id: attemptId,
    model_revision: MAGE_QUALIFICATION_MODEL_REVISION,
    items: Object.freeze(items),
  });
}

export function validateMageQualificationCase(value, sha256Utf8) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "attempt_id,items,model_revision" ||
    !ID.test(value.attempt_id ?? "") ||
    value.model_revision !== MAGE_QUALIFICATION_MODEL_REVISION ||
    !Array.isArray(value.items) ||
    value.items.length !== MAGE_QUALIFICATION_ITEM_COUNT
  )
    return false;
  return value.items.every(
    (item, index) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.keys(item).sort().join(",") ===
        "height,negative_prompt,negative_prompt_sha256,output_put_url,positive_prompt,positive_prompt_sha256,scene_id,seed,width" &&
      item.scene_id === `mage-qualification-${String(index + 1).padStart(2, "0")}` &&
      typeof item.positive_prompt === "string" &&
      HASH.test(item.positive_prompt_sha256 ?? "") &&
      typeof item.negative_prompt === "string" &&
      HASH.test(item.negative_prompt_sha256 ?? "") &&
      (typeof sha256Utf8 !== "function" ||
        (sha256Utf8(item.positive_prompt) === item.positive_prompt_sha256 &&
          sha256Utf8(item.negative_prompt) === item.negative_prompt_sha256)) &&
      item.seed === 2_130_000 + index &&
      item.width === 1280 &&
      item.height === 720 &&
      typeof item.output_put_url === "string" &&
      item.output_put_url.startsWith("https://"),
  );
}
