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

interface ConnectCommand {
  readonly expires_at: string;
  readonly macos: string;
  readonly windows: string;
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
  const [command, setCommand] = useState<ConnectCommand | null>(null);
  const [platform, setPlatform] = useState<"WINDOWS" | "MACOS">(suggested ?? "MACOS");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const freshCommand = useCallback(async () => {
    setCommandBusy(true);
    setCommandError(null);
    setCopied(false);
    try {
      const next = await responseJson<ConnectCommand>(
        await fetch("/api/v2/media-worker/connect-command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      if (
        !Number.isFinite(Date.parse(next.expires_at)) ||
        typeof next.macos !== "string" ||
        typeof next.windows !== "string"
      )
        throw new Error("Invalid connect command");
      setCommand(next);
    } catch {
      setCommandError("Command unavailable. Try again or use the installer below.");
    } finally {
      setCommandBusy(false);
    }
  }, []);
  const remaining = command
    ? Math.max(0, Math.ceil((Date.parse(command.expires_at) - now) / 1000))
    : 0;
  const commandText = command ? (platform === "MACOS" ? command.macos : command.windows) : "";
  const enrollmentId = useMemo(
    () => new URLSearchParams(window.location.search).get("enrollment"),
    [],
  );
  const hasReadyWorker = workers?.devices.some(
    (device) => device.status === "ONLINE" || device.status === "BUSY",
  );

  const refresh = useCallback(async () => {
    const value = await responseJson<WorkerList>(
      await fetch("/api/v2/media-workers", { headers: { accept: "application/json" } }),
    );
    setWorkers(value);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMessage("Worker status is temporarily unavailable."));
    const timer = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    void freshCommand();
  }, [freshCommand]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (command && remaining === 0 && !commandBusy && !commandError) void freshCommand();
  }, [command, remaining, commandBusy, commandError, freshCommand]);

  async function copyCommand() {
    if (!commandText || remaining === 0) return;
    try {
      await navigator.clipboard.writeText(commandText);
      setCopied(true);
    } catch {
      setCommandError("Select the command and copy it manually. Clipboard access is unavailable.");
    }
  }

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

      <div className="worker-command" role="region" aria-label="Connect with a terminal command">
        <div className="worker-command-heading">
          <h3>Connect a computer</h3>
          <div className="worker-platforms" role="group" aria-label="Computer operating system">
            <button
              type="button"
              aria-pressed={platform === "MACOS"}
              onClick={() => {
                setPlatform("MACOS");
                setCopied(false);
              }}
            >
              macOS
            </button>
            <button
              type="button"
              aria-pressed={platform === "WINDOWS"}
              onClick={() => {
                setPlatform("WINDOWS");
                setCopied(false);
              }}
            >
              Windows
            </button>
          </div>
        </div>
        <p>
          Paste one command into{" "}
          {platform === "MACOS"
            ? "Terminal on your Mac"
            : "Command Prompt or PowerShell on your Windows PC"}
          . It installs the worker, connects to your account, and starts it in the background.
        </p>
        <div className="worker-command-copy">
          <pre tabIndex={0} aria-label="Install and connect command">
            <code>
              {commandText ||
                (commandBusy ? "Preparing your command…" : "Get a fresh command to connect.")}
            </code>
          </pre>
          <button
            type="button"
            disabled={!commandText || remaining === 0 || commandBusy}
            onClick={() => void copyCommand()}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="worker-command-footer">
          <small>
            {command && remaining > 0
              ? `For one computer · expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
              : "Commands expire after 15 minutes."}
          </small>
          <button type="button" disabled={commandBusy} onClick={() => void freshCommand()}>
            {commandBusy ? "Preparing…" : "Get a fresh command"}
          </button>
        </div>
        {commandError ? <p role="alert">{commandError}</p> : null}
        <small>
          Keep this command private. It connects the computer to your signed-in account.
        </small>
      </div>

      <Disclosure
        summary="Other ways to install, or a computer waiting for approval"
        open={Boolean(enrollment)}
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
                    ? `Paste a fresh command, or install the current ${device.platform === "WINDOWS" ? "Windows" : "Mac"} worker below.`
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
