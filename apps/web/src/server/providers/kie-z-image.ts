const KIE_BASE_URL = "https://api.kie.ai";
const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;

export type KieAspectRatio = (typeof ASPECT_RATIOS)[number];
export type KieImageTask =
  | { readonly state: "waiting" | "queuing" | "generating"; readonly taskId: string }
  | { readonly state: "success"; readonly taskId: string; readonly imageUrl: string }
  | { readonly state: "fail"; readonly taskId: string; readonly failCode: string | null };

export class KieZImageError extends Error {
  constructor(
    readonly code:
      | "INPUT_INVALID"
      | "REQUEST_REJECTED"
      | "SUBMISSION_UNKNOWN"
      | "STATUS_UNKNOWN"
      | "RESPONSE_INVALID",
  ) {
    super(code);
    this.name = "KieZImageError";
  }
}

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function safeTaskId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function safeImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Kie Market z-image task API. Submission errors never trigger an automatic paid replay. */
export class KieZImageClient {
  private readonly fetchPort: FetchPort;

  constructor(
    private readonly apiKey: string,
    fetchPort: FetchPort = fetch,
  ) {
    if (!apiKey || apiKey.trim() !== apiKey) throw new KieZImageError("INPUT_INVALID");
    this.fetchPort = fetchPort;
  }

  async create(input: {
    readonly prompt: string;
    readonly aspectRatio: KieAspectRatio;
    readonly nsfwChecker?: boolean;
  }): Promise<string> {
    if (
      !input.prompt.trim() ||
      input.prompt.length > 1000 ||
      !ASPECT_RATIOS.includes(input.aspectRatio) ||
      (input.nsfwChecker !== undefined && typeof input.nsfwChecker !== "boolean")
    )
      throw new KieZImageError("INPUT_INVALID");
    let response: Response;
    try {
      response = await this.fetchPort(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "z-image",
          input: {
            prompt: input.prompt,
            aspect_ratio: input.aspectRatio,
            nsfw_checker: input.nsfwChecker ?? true,
          },
        }),
      });
    } catch {
      throw new KieZImageError("SUBMISSION_UNKNOWN");
    }
    if (!response.ok) {
      throw new KieZImageError(response.status >= 500 ? "SUBMISSION_UNKNOWN" : "REQUEST_REJECTED");
    }
    let payload: JsonRecord | null;
    try {
      payload = record(await response.json());
    } catch {
      throw new KieZImageError("SUBMISSION_UNKNOWN");
    }
    const taskId = record(payload?.data)?.taskId;
    if (payload?.code !== 200 || !safeTaskId(taskId))
      throw new KieZImageError("SUBMISSION_UNKNOWN");
    return taskId;
  }

  async get(taskId: string): Promise<KieImageTask> {
    if (!safeTaskId(taskId)) throw new KieZImageError("INPUT_INVALID");
    let response: Response;
    try {
      response = await this.fetchPort(
        `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
      );
    } catch {
      throw new KieZImageError("STATUS_UNKNOWN");
    }
    if (!response.ok) throw new KieZImageError("STATUS_UNKNOWN");
    let payload: JsonRecord | null;
    try {
      payload = record(await response.json());
    } catch {
      throw new KieZImageError("STATUS_UNKNOWN");
    }
    const data = record(payload?.data);
    if (!data || data.taskId !== taskId || data.model !== "z-image")
      throw new KieZImageError("RESPONSE_INVALID");
    if (["waiting", "queuing", "generating"].includes(String(data.state)))
      return { state: data.state as "waiting" | "queuing" | "generating", taskId };
    if (data.state === "fail")
      return {
        state: "fail",
        taskId,
        failCode: typeof data.failCode === "string" ? data.failCode.slice(0, 128) : null,
      };
    if (data.state !== "success") throw new KieZImageError("RESPONSE_INVALID");
    let result: JsonRecord | null;
    try {
      result = record(JSON.parse(String(data.resultJson)));
    } catch {
      throw new KieZImageError("RESPONSE_INVALID");
    }
    const urls = result?.resultUrls;
    if (!Array.isArray(urls) || urls.length !== 1 || !safeImageUrl(urls[0]))
      throw new KieZImageError("RESPONSE_INVALID");
    return { state: "success", taskId, imageUrl: urls[0] };
  }
}
