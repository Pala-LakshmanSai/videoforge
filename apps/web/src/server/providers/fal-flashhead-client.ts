/** Server-only queue client for the audio-driven FlashHead endpoint. */
const MODEL_URL = "https://queue.fal.run/fal-ai/flashhead/audio-to-video";
const REQUEST_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

export class FalFlashheadError extends Error {
  constructor(
    readonly code:
      | "INPUT_INVALID"
      | "SUBMIT_REJECTED"
      | "SUBMIT_UNKNOWN"
      | "STATUS_UNKNOWN"
      | "RESULT_UNKNOWN"
      | "RESULT_INVALID"
      | "CANCEL_UNKNOWN",
  ) {
    super(code);
    this.name = "FalFlashheadError";
  }
}

function requestId(value: string): string {
  if (!REQUEST_ID.test(value)) throw new FalFlashheadError("INPUT_INVALID");
  return value;
}

function inputUrl(value: string): string {
  try {
    if (new URL(value).protocol === "https:") return value;
  } catch {
    // Invalid URLs are rejected below without including a signed URL in an error.
  }
  throw new FalFlashheadError("INPUT_INVALID");
}

function mediaUrl(value: unknown): string {
  if (typeof value !== "string") throw new FalFlashheadError("RESULT_INVALID");
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))
    )
      return value;
  } catch {
    // Invalid provider output.
  }
  throw new FalFlashheadError("RESULT_INVALID");
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid JSON");
  return value as Record<string, unknown>;
}

export class FalFlashheadClient {
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!key || key.trim() !== key) throw new FalFlashheadError("INPUT_INVALID");
  }

  private headers(): HeadersInit {
    return { Authorization: `Key ${this.key}`, "Content-Type": "application/json" };
  }

  /** Call once per persisted attempt. A lost response may represent a paid accepted request. */
  async submit(input: { readonly imageUrl: string; readonly audioUrl: string }): Promise<string> {
    const imageUrl = inputUrl(input.imageUrl);
    const audioUrl = inputUrl(input.audioUrl);
    let response: Response;
    try {
      response = await this.fetcher(MODEL_URL, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ image_url: imageUrl, audio_url: audioUrl }),
      });
    } catch {
      throw new FalFlashheadError("SUBMIT_UNKNOWN");
    }
    if ([400, 401, 402, 403, 422].includes(response.status))
      throw new FalFlashheadError("SUBMIT_REJECTED");
    if (!response.ok) throw new FalFlashheadError("SUBMIT_UNKNOWN");
    try {
      const body = await json(response);
      if (typeof body.request_id !== "string" || !REQUEST_ID.test(body.request_id))
        throw new Error("request ID missing");
      return body.request_id;
    } catch {
      throw new FalFlashheadError("SUBMIT_UNKNOWN");
    }
  }

  /** Read-only poll. The request ID is persisted by the caller before any polling. */
  async status(
    id: string,
  ): Promise<"IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED"> {
    let response: Response;
    try {
      response = await this.fetcher(`${MODEL_URL}/requests/${requestId(id)}/status`, {
        headers: this.headers(),
      });
      if (!response.ok) throw new Error("status read failed");
      const body = await json(response);
      if (body.request_id !== id) throw new Error("request ID mismatch");
      if (body.status === "CANCELED") return "CANCELLED";
      if (
        ["IN_QUEUE", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"].includes(
          String(body.status),
        )
      )
        return body.status as "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
    } catch (error) {
      if (error instanceof FalFlashheadError) throw error;
    }
    throw new FalFlashheadError("STATUS_UNKNOWN");
  }

  async result(
    id: string,
  ): Promise<{ readonly videoUrl: string; readonly durationSeconds: number }> {
    let response: Response;
    try {
      response = await this.fetcher(`${MODEL_URL}/requests/${requestId(id)}`, {
        headers: this.headers(),
      });
    } catch (error) {
      if (error instanceof FalFlashheadError) throw error;
      throw new FalFlashheadError("RESULT_UNKNOWN");
    }
    if (!response.ok) throw new FalFlashheadError("RESULT_UNKNOWN");
    try {
      const body = await json(response);
      const video = body.video;
      if (!video || typeof video !== "object" || Array.isArray(video))
        throw new Error("video missing");
      const duration = body.duration;
      if (
        typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > 3600
      )
        throw new Error("duration invalid");
      return {
        videoUrl: mediaUrl((video as Record<string, unknown>).url),
        durationSeconds: duration,
      };
    } catch (error) {
      if (error instanceof FalFlashheadError && error.code === "INPUT_INVALID") throw error;
      throw new FalFlashheadError("RESULT_INVALID");
    }
  }

  async cancel(id: string): Promise<boolean> {
    try {
      const response = await this.fetcher(`${MODEL_URL}/requests/${requestId(id)}/cancel`, {
        method: "PUT",
        headers: this.headers(),
      });
      if (!response.ok) throw new Error("cancel failed");
      const body = await json(response);
      if (typeof body.success === "boolean") return body.success;
    } catch (error) {
      if (error instanceof FalFlashheadError) throw error;
    }
    throw new FalFlashheadError("CANCEL_UNKNOWN");
  }
}
