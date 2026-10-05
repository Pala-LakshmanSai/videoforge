import type { HostedR2BucketBinding } from "./configuration";
import { response } from "./hosted-product-route-common";
import { hostedDownloadDisposition, voiceoverVideoDownloadFilename } from "./download-filename";
import { verifyHostedObjectChecksum as verifyHostedPreviewChecksum } from "./r2-checksum";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

/** Serve an already authorized output; callers must resolve its exact retained render first. */
export async function serveHostedVideo(
  request: Request,
  bucket: HostedR2BucketBinding,
  artifact:
    | {
        object_key: string;
        content_length: number | string;
        checksum_sha256: string;
        voiceover_filename: string | null;
      }
    | undefined,
  inline: boolean,
): Promise<Response> {
  const size = Number(artifact?.content_length);
  if (
    !artifact ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 10 * 1024 ** 3 ||
    !SHA256.test(artifact.checksum_sha256)
  )
    return response({ error: { code: "COMPLETED_RENDER_NOT_FOUND" } }, 404);
  const head = await bucket.head(artifact.object_key);
  if (
    !head ||
    head.size !== size ||
    head.httpMetadata?.contentType !== "video/mp4" ||
    !(await verifyHostedPreviewChecksum(
      bucket,
      artifact.object_key,
      head,
      artifact.checksum_sha256,
    ))
  )
    return response({ error: { code: "COMPLETED_RENDER_UNAVAILABLE" } }, 503);
  const rangeHeader = request.headers.get("range");
  let range: { offset: number; length: number } | undefined;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader);
    const start = match?.[1] ? Number(match[1]) : null;
    const end = match?.[2] ? Number(match[2]) : null;
    const offset = start ?? Math.max(0, size - (end ?? 0));
    const last = start === null ? size - 1 : Math.min(end ?? size - 1, size - 1);
    if (
      !match ||
      (start === null && end === null) ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(last) ||
      offset >= size ||
      offset < 0 ||
      last < offset ||
      (start === null && end === 0)
    )
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    range = { offset, length: last - offset + 1 };
  }
  const object = await bucket.get(artifact.object_key, range ? { range } : undefined);
  if (
    !object?.body ||
    object.size !== size ||
    object.httpMetadata?.contentType !== "video/mp4" ||
    (head.etag && object.etag !== head.etag)
  )
    return response({ error: { code: "COMPLETED_RENDER_UNAVAILABLE" } }, 503);
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers: {
      "accept-ranges": "bytes",
      ...(range
        ? { "content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` }
        : {}),
      "content-type": "video/mp4",
      "content-length": String(range?.length ?? size),
      "content-disposition": inline
        ? 'inline; filename="videoforge-output.mp4"'
        : hostedDownloadDisposition(voiceoverVideoDownloadFilename(artifact.voiceover_filename)),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-videoforge-artifact-sha256": artifact.checksum_sha256,
    },
  });
}
