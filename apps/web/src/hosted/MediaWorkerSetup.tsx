import { useCallback, useEffect, useMemo, useState } from "react";
import { Disclosure } from "../components/ui";

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
  readonly trust:
    | "UNSIGNED_BETA"
    | "AUTHENTICODE_SIGNED"
    | "AD_HOC_BETA"
    | "DEVELOPER_ID_NOTARIZED";
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

function workerStatusLabel(status: WorkerStatus): string {
  if (status === "ONLINE") return "Online";
  if (status === "BUSY") return "Working";
  if (status === "UPDATE_REQUIRED") return "Update required";
  if (status === "REVOKED") return "Revoked";
  return "Offline";
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
  const hasReadyWorker = workers?.devices.some(
    (device) => device.status === "ONLINE" || device.status === "BUSY",
  );
  const needsWorkerUpdate = workers?.devices.some((device) => device.status === "UPDATE_REQUIRED");
  const showOnboarding = !hasReadyWorker || needsWorkerUpdate;

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

  async function remove(device: WorkerDevice) {
    const warning =
      device.status === "REVOKED"
        ? "Remove this old entry? Security history stays."
        : "Remove this computer? Active local work will stop.";
    if (!window.confirm(warning)) return;
    setBusy(true);
    try {
      await responseJson(
        await fetch(
          device.status === "REVOKED"
            ? `/api/v2/media-workers/${device.id}`
            : `/api/v2/media-workers/${device.id}/revoke`,
          {
            method: device.status === "REVOKED" ? "DELETE" : "POST",
            headers: { "content-type": "application/json" },
            ...(device.status === "REVOKED" ? {} : { body: "{}" }),
          },
        ),
      );
      setMessage(
        device.status === "REVOKED"
          ? "Old computer entry removed."
          : "Computer removed. Reopen the worker to reconnect.",
      );
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
      <p>Your computer · no processing charge</p>
      <h2 id="worker-setup-title">
        {hasReadyWorker ? "Computer connected" : "Connect your computer once"}
      </h2>
      <p>
        {hasReadyWorker
          ? "Ready for transcription and final rendering."
          : "Connect a Windows or Mac for transcription and final rendering."}
      </p>

      {enrollment ? (
        <div className="worker-connect" role="region" aria-label="Computer connection request">
          <strong>Connect {enrollment.display_name}?</strong>
          <span>
            {enrollment.platform === "WINDOWS" ? "Windows" : "Mac"} · {enrollment.architecture}
          </span>
          <p>Only your account can send work to this computer. Your files stay private.</p>
          <button
            type="button"
            disabled={busy || enrollment.state !== "PENDING"}
            onClick={() => void approve()}
          >
            {busy ? "Connecting…" : "Connect this computer"}
          </button>
        </div>
      ) : null}

      <Disclosure
        summary={hasReadyWorker ? "Add or update a computer" : "Connect a computer"}
        open={showOnboarding}
      >
        <ol className="worker-steps">
          <li>Download the worker.</li>
          <li>Install and open it. Your browser returns here once.</li>
          <li>Approve the connection here.</li>
        </ol>

        <div className="worker-downloads">
          {releases.map((release, index) => (
            <a
              className={
                index === 0 && suggested ? "worker-download recommended" : "worker-download"
              }
              href={release.url}
              key={release.platform}
              download
            >
              <strong>{release.label}</strong>
              <span>
                {release.extension} · v{workers?.release.version} · {fileSize(release.size_bytes)}
                {release.trust === "AD_HOC_BETA" ? " · ImageForge-style beta" : ""}
                {release.trust === "UNSIGNED_BETA" ? " · Beta" : ""}
                {index === 0 && suggested ? " · Recommended" : ""}
              </span>
            </a>
          ))}
        </div>
      </Disclosure>

      <div className="worker-devices" aria-live="polite">
        <h3>Your computers</h3>
        {!workers ? <p>Checking worker status…</p> : null}
        {workers?.devices.length === 0 ? <p>No computers connected yet.</p> : null}
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
                {workerStatusLabel(device.status)}
              </span>
              <small>
                {device.status === "BUSY"
                  ? "Working now"
                  : device.status === "UPDATE_REQUIRED"
                    ? `Update the ${device.platform === "WINDOWS" ? "Windows" : "Mac"} beta above, then open it again.`
                    : lastSeen(device.last_seen_at)}
              </small>
            </div>
            <button type="button" disabled={busy} onClick={() => void remove(device)}>
              Remove
            </button>
          </article>
        ))}
      </div>
      {message ? <p role="status">{message}</p> : null}
      <p className="worker-privacy">
        It handles only your projects with temporary file access; it never receives account or
        service credentials.
      </p>
    </section>
  );
}
