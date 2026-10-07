export function imageTextQaMessage(code: unknown): string | null {
  if (code === "IMAGE_TEXT_QA_REJECTED")
    return "An image contained text and was blocked. No automatic regeneration was charged.";
  if (code === "IMAGE_TEXT_QA_UNCERTAIN")
    return "An image could not be confirmed text-free and was blocked. No automatic regeneration was charged.";
  return null;
}
