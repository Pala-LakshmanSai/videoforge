/** Historical V2-06 Cloud Run callback parsers retained for rollback evidence only. */

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export function hasExactResultObjectMetadata(
  object: { readonly size: number; readonly httpMetadata?: { readonly contentType?: string } },
  expectedLength: number,
): boolean {
  return object.size === expectedLength && object.httpMetadata?.contentType === "application/json";
}

interface CpuUploadAuthorityRequest {
  readonly source: "PRIMARY_RESULT_OUTPUT" | "RESULT_DOCUMENT";
  readonly objectKey: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: string;
}

export function exactCpuUploadAuthorityRequest(value: unknown): CpuUploadAuthorityRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "checksum_sha256,content_length,content_type,object_key,schema_version,source" ||
    record.schema_version !== "videoforge-cloud-run-upload-authority/v1" ||
    !["PRIMARY_RESULT_OUTPUT", "RESULT_DOCUMENT"].includes(String(record.source)) ||
    typeof record.object_key !== "string" ||
    typeof record.content_type !== "string" ||
    !Number.isSafeInteger(record.content_length) ||
    (record.content_length as number) < 1 ||
    typeof record.checksum_sha256 !== "string" ||
    !SHA256.test(record.checksum_sha256)
  ) {
    return null;
  }
  return {
    source: record.source as CpuUploadAuthorityRequest["source"],
    objectKey: record.object_key,
    contentType: record.content_type,
    contentLength: record.content_length as number,
    checksumSha256: record.checksum_sha256,
  };
}
