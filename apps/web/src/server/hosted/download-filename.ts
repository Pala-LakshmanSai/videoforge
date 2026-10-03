export function voiceoverVideoDownloadFilename(sourceFilename: unknown): string {
  const basename = typeof sourceFilename === "string" && sourceFilename.length <= 160
    ? sourceFilename.replace(/\.(mp3|wav)$/iu, "") : "";
  const stem = Array.from(basename, (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ||
      /[/\\\uD800-\uDFFF]/u.test(character) ? "_" : character,
  ).join("").trim();
  return `${stem || "videoforge-output"}.mp4`;
}

export function hostedDownloadDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/gu, "_");
  const disposition = `attachment; filename="${ascii}"`;
  if (ascii === filename) return disposition;
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename*=UTF-8''${encoded}`;
}

