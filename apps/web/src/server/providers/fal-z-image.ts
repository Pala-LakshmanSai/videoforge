import { KieZImageError, type KieImageTask } from "./kie-z-image";

export const FAL_Z_IMAGE_MODEL = "fal-ai/z-image/turbo";
const MODEL_URL = `https://queue.fal.run/${FAL_Z_IMAGE_MODEL}`;
const JOB_URL = "https://queue.fal.run/fal-ai/z-image/requests";
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid provider JSON");
  return value as Record<string, unknown>;
}

/** Fal adapter to the existing Z-Image task/media contract; errors never contain credentials. */
export class FalZImageClient {
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    if (!key || key.trim() !== key) throw new KieZImageError("INPUT_INVALID");
  }

  private headers(): HeadersInit {
    return { Authorization: `Key ${this.key}`, "Content-Type": "application/json" };
  }

  async create(input: { readonly prompt: string; readonly aspectRatio: string }): Promise<string> {
    if (!input.prompt.trim() || input.prompt.length > 1000 || input.aspectRatio !== "16:9")
      throw new KieZImageError("INPUT_INVALID");
    let response: Response;
    try {
      response = await this.fetcher(MODEL_URL, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          prompt: input.prompt,
          image_size: { width: 1280, height: 720 },
          num_images: 1,
          num_inference_steps: 8,
          enable_safety_checker: true,
          enable_prompt_expansion: false,
          output_format: "png",
        }),
      });
    } catch {
      throw new KieZImageError("SUBMISSION_UNKNOWN");
    }
    if ([400, 401, 402, 403, 422].includes(response.status))
      throw new KieZImageError("REQUEST_REJECTED");
    if (!response.ok) throw new KieZImageError("SUBMISSION_UNKNOWN");
    try {
      const body = record(await response.json());
      if (
        typeof body.request_id !== "string" ||
        !REQUEST_ID.test(body.request_id) ||
        body.status_url !== `${JOB_URL}/${body.request_id}/status` ||
        body.response_url !== `${JOB_URL}/${body.request_id}`
      )
        throw new Error("provider identity invalid");
      return body.request_id;
    } catch {
      throw new KieZImageError("SUBMISSION_UNKNOWN");
    }
  }

  async get(taskId: string): Promise<KieImageTask> {
    if (!REQUEST_ID.test(taskId)) throw new KieZImageError("INPUT_INVALID");
    let status: Record<string, unknown>;
    try {
      const response = await this.fetcher(`${JOB_URL}/${taskId}/status`, {
        headers: this.headers(),
      });
      if (!response.ok) throw new Error("status unavailable");
      status = record(await response.json());
    } catch {
      throw new KieZImageError("STATUS_UNKNOWN");
    }
    if (status.request_id !== taskId) throw new KieZImageError("RESPONSE_INVALID");
    if (["IN_QUEUE", "IN_PROGRESS"].includes(String(status.status)))
      return { state: "generating", taskId };
    if (["FAILED", "CANCELLED", "CANCELED"].includes(String(status.status)))
      return { state: "fail", taskId, failCode: "PROVIDER_TASK_FAILED" };
    if (status.status !== "COMPLETED") throw new KieZImageError("RESPONSE_INVALID");
    if (status.error || status.error_type)
      return { state: "fail", taskId, failCode: "PROVIDER_TASK_FAILED" };
    let response: Response;
    try {
      response = await this.fetcher(`${JOB_URL}/${taskId}`, { headers: this.headers() });
    } catch {
      throw new KieZImageError("STATUS_UNKNOWN");
    }
    // Fal returns completed model errors through the result endpoint.
    if (response.status === 422) return { state: "fail", taskId, failCode: "PROVIDER_TASK_FAILED" };
    if (!response.ok) throw new KieZImageError("STATUS_UNKNOWN");
    try {
      const body = record(await response.json());
      if (body.request_id !== undefined && body.request_id !== taskId)
        throw new Error("provider identity mismatch");
      if (
        !Array.isArray(body.images) ||
        body.images.length !== 1 ||
        !Array.isArray(body.has_nsfw_concepts) ||
        body.has_nsfw_concepts.length !== 1 ||
        body.has_nsfw_concepts[0] !== false
      )
        throw new Error("image output invalid");
      const image = record(body.images[0]);
      const url = new URL(String(image.url));
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !(
          url.hostname === "fal.media" ||
          url.hostname.endsWith(".fal.media") ||
          url.hostname === "storage.googleapis.com"
        )
      )
        throw new Error("image URL invalid");
      return { state: "success", taskId, imageUrl: url.href };
    } catch {
      throw new KieZImageError("RESPONSE_INVALID");
    }
  }
}
