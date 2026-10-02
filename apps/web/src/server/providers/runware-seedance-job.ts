import type { HostedR2BucketBinding } from "../hosted/configuration";
import { sha256Bytes } from "../hosted/crypto";
import { inspectMp4 } from "./fal-avatar-job";

const ENDPOINT = "https://api.runware.ai/v1";
export const SEEDANCE_MODEL = "bytedance:2@2";
const GEOMETRY = { width: 1248, height: 704 };
const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OBJECT_KEY = /^tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/project\/[A-Za-z0-9._:-]+\/revision\/[A-Za-z0-9._:-]+\/lane\/scene-video\/job\/[A-Za-z0-9._:-]+\/artifact\/[A-Za-z0-9._:-]+$/u;
type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;
export interface RunwareSeedanceSubmissionDiagnostic {
  readonly kind: "HTTP_ERROR" | "INVALID_JSON" | "RESPONSE_SHAPE" | "ACK_IDENTITY" | "TRANSPORT_ERROR";
  readonly httpStatus?: number;
}

export class RunwareSeedanceJobError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "SUBMIT_REJECTED" | "SUBMIT_UNKNOWN" |
    "POLL_UNAVAILABLE" | "RESPONSE_INVALID" | "OUTPUT_KEY_INVALID" | "RESULT_DOWNLOAD_FAILED" |
    "RESULT_MP4_INVALID" | "RESULT_STORAGE_UNKNOWN" | "RESULT_PRICE_CHANGED",
    readonly submissionDiagnostic?: RunwareSeedanceSubmissionDiagnostic) {
    super(code);
    this.name = "RunwareSeedanceJobError";
  }
}

export interface RunwareSeedanceArtifact {
  readonly objectKey: string;
  readonly sha256: `sha256:${string}`;
  readonly byteSize: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly videoCodec: "h264";
  readonly contentType: "video/mp4";
}

function row(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null;
}

function validDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 1.2 && value <= 12;
}

function validHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

async function request(apiKey: string, task: Row, fetchPort: FetchPort): Promise<{ response: Response; body: Row }> {
  const response = await fetchPort(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify([task]),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  let decoded: unknown;
  try { decoded = JSON.parse(await response.text()); }
  catch {
    throw new RunwareSeedanceJobError("RESPONSE_INVALID", { kind: "INVALID_JSON", httpStatus: response.status });
  }
  const body = row(decoded);
  if (!body) throw new RunwareSeedanceJobError("RESPONSE_INVALID", { kind: "RESPONSE_SHAPE", httpStatus: response.status });
  return { response, body };
}

function resultRows(body: Row, field: "data" | "errors"): Row[] {
  if (body[field] === undefined) return [];
  if (!Array.isArray(body[field])) throw new RunwareSeedanceJobError("RESPONSE_INVALID");
  return body[field].map((value: unknown) => {
    const item = row(value);
    if (!item) throw new RunwareSeedanceJobError("RESPONSE_INVALID");
    return item;
  });
}

function isExplicitValidationRefusal(error: Row, taskUUID: string): boolean {
  return error.taskUUID === taskUUID && error.taskType === "videoInference" &&
    (error.status === undefined || error.status === "error") && (error.cost === undefined || error.cost === 0) &&
    ["invalidParameter", "invalidDuration", "invalidWidth", "invalidHeight", "invalidModel",
      "invalidPrompt", "invalidPositivePrompt", "unsupportedParameter", "validationError"].includes(String(error.code)) &&
    ["duration", "width", "height", "model", "positivePrompt", "inputs", "inputs.frameImages",
      "numberResults", "outputType", "outputFormat", "deliveryMethod", "taskUUID",
      "providerSettings.bytedance.cameraFixed"].includes(String(error.parameter));
}

/** The claim must durably save taskUUID before the single paid POST. */
export async function submitRunwareSeedanceJob(input: {
  readonly taskUUID: string;
  readonly apiKey: string;
  readonly imageUrl: string;
  readonly prompt: string;
  readonly durationSeconds: number;
  readonly claimSubmission: () => Promise<boolean>;
  readonly persistRequestId: (requestId: string) => Promise<void>;
  readonly markSubmissionFailed: () => Promise<void>;
  readonly markSubmissionUnknown: () => Promise<void>;
  readonly fetchPort?: FetchPort;
}): Promise<{ readonly state: "NOT_CLAIMED" | "SUBMITTED"; readonly requestId?: string }> {
  if (!UUID.test(input.taskUUID) || input.apiKey.trim().length < 20 || !validHttps(input.imageUrl) ||
      input.prompt.trim().length < 2 || input.prompt.length > 3000 || !validDuration(input.durationSeconds))
    throw new RunwareSeedanceJobError("INPUT_INVALID");
  if (!(await input.claimSubmission())) return { state: "NOT_CLAIMED" };
  try {
    const { response, body } = await request(input.apiKey, {
      taskType: "videoInference", taskUUID: input.taskUUID, model: SEEDANCE_MODEL,
      deliveryMethod: "async", outputType: "URL", outputFormat: "MP4", numberResults: 1,
      includeCost: true, width: GEOMETRY.width, height: GEOMETRY.height,
      duration: input.durationSeconds, positivePrompt: input.prompt,
      inputs: { frameImages: [input.imageUrl] }, providerSettings: { bytedance: { cameraFixed: true } },
    }, input.fetchPort ?? fetch);
    let errors: Row[], data: Row[];
    try { errors = resultRows(body, "errors"); data = resultRows(body, "data"); }
    catch {
      throw new RunwareSeedanceJobError("SUBMIT_UNKNOWN", { kind: "RESPONSE_SHAPE", httpStatus: response.status });
    }
    // 5xx, rate limits, malformed acknowledgments and lost replies never authorize another POST.
    if (errors.length > 0 && data.length === 0 && [400, 401, 402, 403, 404].includes(response.status) &&
        errors.every((error) => error.taskUUID === input.taskUUID || error.taskType === "authentication"))
      throw new RunwareSeedanceJobError("SUBMIT_REJECTED");
    if (response.status === 200 && data.length === 0 && errors.length === 1 &&
        isExplicitValidationRefusal(errors[0]!, input.taskUUID))
      throw new RunwareSeedanceJobError("SUBMIT_REJECTED");
    if (!response.ok || errors.length)
      throw new RunwareSeedanceJobError("SUBMIT_UNKNOWN", { kind: "HTTP_ERROR", httpStatus: response.status });
    if (data.length !== 1 || data[0]?.taskUUID !== input.taskUUID ||
        data[0]?.taskType !== "videoInference" ||
        (data[0]?.model !== undefined && data[0]?.model !== SEEDANCE_MODEL))
      throw new RunwareSeedanceJobError("SUBMIT_UNKNOWN", { kind: "ACK_IDENTITY", httpStatus: response.status });
  } catch (error) {
    if (error instanceof RunwareSeedanceJobError && error.code === "SUBMIT_REJECTED") {
      await input.markSubmissionFailed();
      throw error;
    }
    await input.markSubmissionUnknown();
    throw new RunwareSeedanceJobError("SUBMIT_UNKNOWN", error instanceof RunwareSeedanceJobError
      ? error.submissionDiagnostic : { kind: "TRANSPORT_ERROR" });
  }
  // Failed persistence retains SUBMITTING and its known UUID; polling is safe, resubmission is forbidden.
  await input.persistRequestId(input.taskUUID);
  return { state: "SUBMITTED", requestId: input.taskUUID };
}

function inspect(bytes: Uint8Array, requiredSeconds: number): ReturnType<typeof inspectMp4> {
  try {
    const metadata = inspectMp4(bytes, GEOMETRY);
    // Frame quantization can shorten the requested clip by at most one 24 fps frame.
    if (metadata.durationSeconds + 1 / 24 < requiredSeconds || metadata.durationSeconds > 12.1)
      throw new Error("duration");
    return metadata;
  } catch { throw new RunwareSeedanceJobError("RESULT_MP4_INVALID"); }
}

async function readStored(input: {
  bucket: HostedR2BucketBinding; objectKey: string; requestId: string; durationSeconds: number; costUsd: number;
}): Promise<RunwareSeedanceArtifact | null> {
  const stored = await input.bucket.get(input.objectKey);
  if (!stored) return null;
  const receipt = (stored as typeof stored & { customMetadata?: Record<string, string> }).customMetadata;
  if (stored.size > MAX_VIDEO_BYTES || stored.httpMetadata?.contentType !== "video/mp4" ||
      receipt?.taskUUID !== input.requestId || receipt?.model !== SEEDANCE_MODEL ||
      receipt?.costUsd !== String(input.costUsd)) throw new RunwareSeedanceJobError("RESULT_STORAGE_UNKNOWN");
  const bytes = new Uint8Array(await stored.arrayBuffer());
  const sha256 = await sha256Bytes(bytes);
  if (bytes.byteLength !== stored.size || receipt.sha256 !== sha256)
    throw new RunwareSeedanceJobError("RESULT_STORAGE_UNKNOWN");
  return { objectKey: input.objectKey, sha256, byteSize: bytes.byteLength,
    ...inspect(bytes, input.durationSeconds), videoCodec: "h264", contentType: "video/mp4" };
}

async function download(urlString: string, fetchPort: FetchPort): Promise<Uint8Array<ArrayBuffer>> {
  if (!validHttps(urlString)) throw new RunwareSeedanceJobError("RESULT_MP4_INVALID");
  const url = new URL(urlString);
  // Official polling examples return vm.runware.ai; never fetch a provider-controlled arbitrary host.
  if (!validHttps(urlString) || url.hostname !== "vm.runware.ai" || url.port || !url.pathname.startsWith("/video/"))
    throw new RunwareSeedanceJobError("RESULT_MP4_INVALID");
  let response: Response;
  try { response = await fetchPort(urlString, { redirect: "manual", signal: AbortSignal.timeout(30_000) }); }
  catch { throw new RunwareSeedanceJobError("RESULT_DOWNLOAD_FAILED"); }
  if (!response.ok || !response.body) throw new RunwareSeedanceJobError("RESULT_DOWNLOAD_FAILED");
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const header = response.headers.get("content-length");
  const declared = header === null ? null : Number(header);
  if ((type !== "video/mp4" && type !== "application/octet-stream") ||
      (declared !== null && (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_VIDEO_BYTES)))
    throw new RunwareSeedanceJobError("RESULT_MP4_INVALID");
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel();
        throw new RunwareSeedanceJobError("RESULT_MP4_INVALID");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof RunwareSeedanceJobError) throw error;
    throw new RunwareSeedanceJobError("RESULT_DOWNLOAD_FAILED");
  } finally { reader.releaseLock(); }
  if (declared !== null && declared !== total) throw new RunwareSeedanceJobError("RESULT_MP4_INVALID");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Poll only the saved UUID, then accept an immutable private object with an exact cost receipt. */
export async function observeRunwareSeedanceJob(input: {
  readonly requestId: string;
  readonly apiKey: string;
  readonly objectKey: string;
  readonly durationSeconds: number;
  readonly bucket: HostedR2BucketBinding;
  readonly recordProviderCost?: (costUsd: number) => Promise<void>;
  readonly fetchPort?: FetchPort;
}): Promise<{ readonly state: "PENDING"; readonly submissionConfirmed: boolean } | { readonly state: "FAILED" } |
  { readonly state: "SUCCEEDED"; readonly artifact: RunwareSeedanceArtifact; readonly costUsd: number }> {
  if (!UUID.test(input.requestId) || input.apiKey.trim().length < 20 || !validDuration(input.durationSeconds))
    throw new RunwareSeedanceJobError("INPUT_INVALID");
  if (!OBJECT_KEY.test(input.objectKey) || input.objectKey.includes(".."))
    throw new RunwareSeedanceJobError("OUTPUT_KEY_INVALID");
  let reply: Awaited<ReturnType<typeof request>>;
  try { reply = await request(input.apiKey, { taskType: "getResponse", taskUUID: input.requestId }, input.fetchPort ?? fetch); }
  catch { throw new RunwareSeedanceJobError("POLL_UNAVAILABLE"); }
  const errors = resultRows(reply.body, "errors");
  const data = resultRows(reply.body, "data");
  if (errors.length) {
    if (errors.length !== 1 || errors[0]?.taskUUID !== input.requestId || data.length)
      throw new RunwareSeedanceJobError("RESPONSE_INVALID");
    // An explicit processing-task failure is terminal. Missing records/auth/transport are reconcilable.
    if (reply.response.ok && errors[0]?.status === "error" && typeof errors[0]?.code === "string" &&
        !/invalid|notfound|notready|notavailable|unauthor|auth|balance/iu.test(errors[0].code) &&
        (errors[0]?.taskType === undefined || errors[0].taskType === "videoInference"))
      return { state: "FAILED" };
    throw new RunwareSeedanceJobError("POLL_UNAVAILABLE");
  }
  if (!reply.response.ok) throw new RunwareSeedanceJobError("POLL_UNAVAILABLE");
  if (data.length !== 1 || data[0]?.taskUUID !== input.requestId ||
      (data[0]?.model !== undefined && data[0]?.model !== SEEDANCE_MODEL))
    throw new RunwareSeedanceJobError("RESPONSE_INVALID");
  const result = data[0];
  if (result.status === "processing") {
    // getResponse returns this generic envelope even for never-submitted UUIDs: it proves no admission.
    if (reply.response.status !== 200 || !["getResponse", "videoInference"].includes(String(result.taskType)))
      throw new RunwareSeedanceJobError("RESPONSE_INVALID");
    return { state: "PENDING", submissionConfirmed: result.taskType === "videoInference" };
  }
  // Published videoInference receipts omit status; require the complete media identity in that shape.
  const completeReceipt = result.status === "success" || (result.status === undefined &&
    UUID.test(String(result.videoUUID)) && typeof result.videoURL === "string" && validHttps(result.videoURL));
  if (!completeReceipt || result.taskType !== "videoInference" || typeof result.cost !== "number" ||
      !Number.isFinite(result.cost) || result.cost < 0)
    throw new RunwareSeedanceJobError("RESPONSE_INVALID");
  const costUsd = result.cost;
  // A charged generation remains charged even if the artifact cannot be accepted.
  await input.recordProviderCost?.(costUsd);
  if (costUsd > input.durationSeconds * 0.01336 * 1.10)
    throw new RunwareSeedanceJobError("RESULT_PRICE_CHANGED");
  if (!UUID.test(String(result.videoUUID)) || typeof result.videoURL !== "string" || result.NSFWContent === true)
    throw new RunwareSeedanceJobError("RESULT_MP4_INVALID");
  const storedInput = { ...input, costUsd };
  const previous = await readStored(storedInput);
  if (previous) return { state: "SUCCEEDED", artifact: previous, costUsd };
  const bytes = await download(result.videoURL, input.fetchPort ?? fetch);
  inspect(bytes, input.durationSeconds);
  const sha256 = await sha256Bytes(bytes);
  try {
    await input.bucket.put(input.objectKey, bytes.buffer as ArrayBuffer, {
      onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "video/mp4" },
      customMetadata: { taskUUID: input.requestId, model: SEEDANCE_MODEL, costUsd: String(costUsd), sha256 },
    });
  } catch { /* Exact readback reconciles a possibly completed write; never overwrite an existing object. */ }
  const stored = await readStored(storedInput);
  if (!stored || stored.sha256 !== sha256 || stored.byteSize !== bytes.byteLength)
    throw new RunwareSeedanceJobError("RESULT_STORAGE_UNKNOWN");
  return { state: "SUCCEEDED", artifact: stored, costUsd };
}
