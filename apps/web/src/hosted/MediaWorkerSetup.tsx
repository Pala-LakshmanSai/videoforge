import { useCallback, useEffect, useMemo, useState } from "react";

type WorkerStatus = "ONLINE" | "BUSY" | "OFFLINE" | "REVOKED" | "UPDATE_REQUIRED";

interface WorkerDevice {
  readonly id: string;
  readonly display_name: string;
  readonly platform: "WINDOWS" | "MACOS";
  readonly architecture: "X86_64" | "AARCH64";
  readonly worker_version: string;
  readonly protocol_version: number;
  readonly status: WorkerStatus;
  readonly last_seen_at: string | null;
  readonly current_attempt_id: string | null;
}

interface ReleaseFile {
  readonly url: string;
  readonly sha256: string;
  readonly size_bytes: number;
}

interface WorkerList {
  readonly schema_version: "videoforge-media-worker-list/v1";
  readonly devices: readonly WorkerDevice[];
  readonly release: {
    readonly version: string;
    readonly minimum_protocol_version: number;
    readonly windows: ReleaseFile;
    readonly macos: ReleaseFile;
  };
}

interface Enrollment {
  readonly id: string;
  readonly display_name: string;
  readonly platform: "WINDOWS" | "MACOS";
  readonly architecture: "X86_64" | "AARCH64";
  readonly worker_version: string;
  readonly protocol_version: number;
  readonly state: "PENDING" | "APPROVED" | "CONSUMED" | "EXPIRED";
  readonly expires_at: string;
}

function recommendedPlatform(): "WINDOWS" | "MACOS" | null {
  const value = navigator.userAgent.toLowerCase();
  if (value.includes("windows")) return "WINDOWS";
  if (value.includes("macintosh") || value.includes("mac os")) return "MACOS";
  return null;
}

function fileSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

function lastSeen(value: string | null): string {
  if (!value) return "Not connected yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

async function responseJson<ResponseValue>(response: Response): Promise<ResponseValue> {
  if (!response.ok) throw new Error(`Worker request returned HTTP ${response.status}.`);
  return response.json() as Promise<ResponseValue>;
}

export function MediaWorkerSetup() {
  const [workers, setWorkers] = useState<WorkerList | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggested = useMemo(recommendedPlatform, []);
  const enrollmentId = useMemo(
    () => new URLSearchParams(window.location.search).get("enrollment"),
    [],
  );

  const refresh = useCallback(async () => {
    const value = await responseJson<WorkerList>(
      await fetch("/api/v2/media-workers", { headers: { accept: "application/json" } }),
    );
    setWorkers(value);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMessage("Worker status is temporarily unavailable."));
  }, [refresh]);

  useEffect(() => {
    if (!enrollmentId) return;
    void fetch(`/api/v2/media-worker-enrollments/${enrollmentId}`, {
      headers: { accept: "application/json" },
    })
      .then(responseJson<Enrollment>)
      .then(setEnrollment)
      .catch(() => setMessage("This computer connection is unavailable or expired."));
  }, [enrollmentId]);

  async function approve() {
    if (!enrollmentId) return;
    setBusy(true);
    setMessage(null);
    try {
      await responseJson(
        await fetch(`/api/v2/media-worker-enrollments/${enrollmentId}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      setMessage("Connected. The worker will come online automatically in a few seconds.");
      const clean = new URL(window.location.href);
      clean.searchParams.delete("enrollment");
      window.history.replaceState(null, "", clean);
      setEnrollment(null);
      window.setTimeout(() => void refresh(), 1_000);
    } catch {
      setMessage("This computer could not be connected. Reopen VideoForge Worker and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Remove this computer from VideoForge? Any active local job will stop."))
      return;
    setBusy(true);
    try {
      await responseJson(
        await fetch(`/api/v2/media-workers/${id}/revoke`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      setMessage("Computer removed. Open its worker again to reconnect it.");
      await refresh();
    } catch {
      setMessage("The computer could not be removed right now.");
    } finally {
      setBusy(false);
    }
  }

  const releases = workers
    ? [
        {
          platform: "WINDOWS" as const,
          label: "Download for Windows",
          extension: ".exe",
          ...workers.release.windows,
        },
        {
          platform: "MACOS" as const,
          label: "Download for Mac",
          extension: ".dmg",
          ...workers.release.macos,
        },
      ].sort((left, right) =>
        left.platform === suggested ? -1 : right.platform === suggested ? 1 : 0,
      )
    : [];

  return (
    <section className="worker-setup" aria-labelledby="worker-setup-title">
      <p>Local compute · $0 provider CPU cost</p>
      <h2 id="worker-setup-title">Connect your computer once</h2>
      <p>
        VideoForge uses your own Windows or Mac computer for transcription and final rendering. The
        worker starts with your computer and needs no keys, folders, URLs, or technical setup.
      </p>

      {enrollment ? (
        <div className="worker-connect" role="region" aria-label="Computer connection request">
          <strong>Connect {enrollment.display_name}?</strong>
          <span>
            {enrollment.platform === "WINDOWS" ? "Windows" : "Mac"} · {enrollment.architecture}
          </span>
          <p>
            This gives only your account permission to send transcription and rendering work to this
            computer. It does not expose your files to other VideoForge users.
          </p>
          <button
            type="button"
            disabled={busy || enrollment.state !== "PENDING"}
            onClick={() => void approve()}
          >
            {busy ? "Connecting…" : "Connect this computer"}
          </button>
        </div>
      ) : null}

      <ol className="worker-steps">
        <li>Download the worker for this computer.</li>
        <li>Install and open it. Your browser returns here once.</li>
        <li>Select “Connect this computer.” Everything after that is automatic.</li>
      </ol>

      <div className="worker-downloads">
        {releases.map((release, index) => (
          <a
            className={index === 0 && suggested ? "worker-download recommended" : "worker-download"}
            href={release.url}
            key={release.platform}
            download
          >
            <strong>{release.label}</strong>
            <span>
              {release.extension} · v{workers?.release.version} · {fileSize(release.size_bytes)}
              {index === 0 && suggested ? " · Recommended" : ""}
            </span>
          </a>
        ))}
      </div>

      <div className="worker-devices" aria-live="polite">
        <h3>Your computers</h3>
        {!workers ? <p>Checking worker status…</p> : null}
        {workers?.devices.length === 0 ? <p>No computer is connected yet.</p> : null}
        {workers?.devices.map((device) => (
          <article className="worker-device" key={device.id}>
            <div>
              <strong>{device.display_name}</strong>
              <span>
                {device.platform === "WINDOWS" ? "Windows" : "Mac"} · v{device.worker_version}
              </span>
            </div>
            <div>
              <span className={`worker-status ${device.status.toLowerCase()}`}>
                {device.status.replaceAll("_", " ")}
              </span>
              <small>
                {device.status === "BUSY"
                  ? "Rendering or transcribing now"
                  : lastSeen(device.last_seen_at)}
              </small>
            </div>
            {device.status !== "REVOKED" ? (
              <button type="button" disabled={busy} onClick={() => void revoke(device.id)}>
                Remove
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {message ? <p role="status">{message}</p> : null}
      <p className="worker-privacy">
        The worker accepts only jobs owned by this account. It receives short-lived file links and
        never receives database, storage, Cloudflare, Google, or GPU-provider credentials.
      </p>
    </section>
  );
}
