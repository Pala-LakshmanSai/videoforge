import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  Download,
  FileAudio,
  Images,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, EmptyState, Metric, Panel } from "../components/ui";

export interface CatalogResponse {
  readonly avatars: readonly {
    profile_id: string;
    version_id: string;
    name: string;
    version_number: number;
  }[];
  readonly styles: readonly {
    style_id: string;
    version_id: string;
    name: string;
    version_number: number;
  }[];
  readonly media_worker_state: "ONLINE" | "WAITING_FOR_YOUR_COMPUTER";
}

interface HostedAttempt {
  readonly id: string;
  readonly kind: "ASR" | "RENDER";
  readonly state: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly terminal_at: string | null;
  readonly output_checksum_sha256: string | null;
  readonly approved_at: string | null;
  readonly preview_url: string | null;
}

interface ProjectDetailResponse {
  readonly project: {
    id: string;
    title: string;
    created_at: string;
    revision_id: string;
    revision_state: string;
  };
  readonly attempts: readonly HostedAttempt[];
  readonly gpu_transport: "DISABLED_FAKE_ONLY";
}

interface HostedUsageResponse {
  readonly current_month_provider_cpu_usd: 0;
  readonly current_month_gpu_usd: 0;
  readonly attempts: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly personal_worker_seconds: number;
  readonly retained_bytes: number;
  readonly storage_policy: string;
}

export async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await fetch(path, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...init?.headers },
  });
  const payload = (await result.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | T
    | null;
  if (!result.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload ? payload.error : null;
    throw new Error(error?.message ?? error?.code ?? "VideoForge hosted request failed.");
  }
  return payload as T;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function audioDurationMs(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("Voiceover duration could not be read."));
    });
    const value = Math.round(audio.duration * 1_000);
    if (!Number.isSafeInteger(value) || value < 10_000 || value > 3_600_000)
      throw new Error("Voiceover must be between 10 seconds and 60 minutes.");
    return value;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function HostedCreateProjectScreen() {
  const catalog = useQuery({
    queryKey: ["hosted-project-catalog"],
    queryFn: () => readJson<CatalogResponse>("/api/v2/hosted/project-catalog"),
  });
  const [title, setTitle] = useState("");
  const [avatarVersionId, setAvatarVersionId] = useState("");
  const [styleVersionId, setStyleVersionId] = useState("");
  const [voiceover, setVoiceover] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canGenerate = Boolean(
    title.trim() &&
      avatarVersionId &&
      styleVersionId &&
      voiceover &&
      catalog.data?.media_worker_state === "ONLINE",
  );
  const submit = useMutation({
    mutationFn: async () => {
      if (!voiceover) throw new Error("Choose a voiceover first.");
      setError(null);
      const checksum = await sha256(voiceover);
      const durationMs = await audioDurationMs(voiceover);
      const contentType = voiceover.type || "audio/wav";
      if (!["audio/wav", "audio/flac", "audio/mpeg", "audio/mp4"].includes(contentType))
        throw new Error("Use WAV, FLAC, MP3, or M4A audio.");
      const idempotencyKey = `browser-project-${crypto.randomUUID()}`;
      const created = await readJson<{
        project_id: string;
        state: "UPLOAD_PENDING" | "READY";
        upload: null | {
          url: string;
          requiredHeaders: Readonly<Record<string, string>>;
        };
      }>("/api/v2/hosted/projects", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          schema_version: "videoforge-hosted-project-create/v1",
          title: title.trim(),
          avatar_profile_version_id: avatarVersionId,
          image_style_version_id: styleVersionId,
          voiceover: {
            filename: voiceover.name,
            content_type: contentType,
            content_length: voiceover.size,
            checksum_sha256: checksum,
            duration_ms: durationMs,
          },
        }),
      });
      if (created.upload) {
        const headers = Object.fromEntries(
          Object.entries(created.upload.requiredHeaders).filter(
            ([key]) => key !== "content-length",
          ),
        );
        const uploaded = await fetch(created.upload.url, {
          method: "PUT",
          headers,
          body: voiceover,
        });
        if (!uploaded.ok)
          throw new Error(`Private voiceover upload failed (HTTP ${uploaded.status}).`);
      }
      const ready = await readJson<{ project_id: string; cpu_submission: unknown }>(
        `/api/v2/hosted/projects/${created.project_id}/commit`,
        { method: "POST", body: "{}" },
      );
      await readJson("/api/v2/cpu-attempts", {
        method: "POST",
        body: JSON.stringify(ready.cpu_submission),
      });
      return ready.project_id;
    },
    onSuccess: (projectId) => window.location.assign(`/projects/${projectId}`),
    onError: (value) =>
      setError(value instanceof Error ? value.message : "Project could not be created."),
  });

  if (catalog.isPending)
    return (
      <Panel eyebrow="Hosted project" heading="Loading private catalog">
        <p>Checking presets and your computer…</p>
      </Panel>
    );
  if (catalog.isError || !catalog.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Create Project unavailable"
        body="Hosted tenant catalog could not be loaded."
        action={
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            Retry
          </Button>
        }
      />
    );

  return (
    <>
      <PageHeader
        eyebrow="Private hosted staging"
        title="Create Project"
        description="Your computer performs transcription and rendering."
      />
      {catalog.data.media_worker_state !== "ONLINE" ? (
        <div className="notice" role="status">
          <strong>Waiting for your computer.</strong> Install and connect the worker in Settings
          before generating.
        </div>
      ) : null}
      <div className="grid grid-2">
        <Panel eyebrow="Project" heading="Inputs">
          <label className="field">
            <span>Title</span>
            <input
              value={title}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Final English voiceover</span>
            <input
              type="file"
              accept="audio/wav,audio/flac,audio/mpeg,audio/mp4,.wav,.flac,.mp3,.m4a"
              onChange={(event) => setVoiceover(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            <span>Avatar Profile</span>
            <select
              value={avatarVersionId}
              onChange={(event) => setAvatarVersionId(event.target.value)}
            >
              <option value="">Choose a ready avatar</option>
              {catalog.data.avatars.map((avatar) => (
                <option key={avatar.version_id} value={avatar.version_id}>
                  {avatar.name} · v{avatar.version_number}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Image Style</span>
            <select
              value={styleVersionId}
              onChange={(event) => setStyleVersionId(event.target.value)}
            >
              <option value="">Choose a published style</option>
              {catalog.data.styles.map((style) => (
                <option key={style.version_id} value={style.version_id}>
                  {style.name} · v{style.version_number}
                </option>
              ))}
            </select>
          </label>
        </Panel>
        <Panel eyebrow="Readiness" heading="Generation check">
          <p>
            <Check size={16} /> Tenant-private Neon and R2 lineage
          </p>
          <p>
            <Check size={16} /> Personal CPU compute: $0 provider charge
          </p>
          <p>
            <Check size={16} /> GPU transport disabled during V2-06 staging
          </p>
          {catalog.data.avatars.length === 0 ? (
            <p className="validation validation-danger">
              Create and approve an Avatar Profile first.
            </p>
          ) : null}
          {catalog.data.styles.length === 0 ? (
            <p className="validation validation-danger">Publish an Image Style first.</p>
          ) : null}
          <Button
            busy={submit.isPending}
            disabled={!canGenerate || submit.isPending}
            onClick={() => submit.mutate()}
          >
            <FileAudio size={16} /> Create and transcribe
          </Button>
        </Panel>
      </div>
      {error ? (
        <div className="validation validation-danger" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

type HostedPresetHubKind = "avatars" | "styles";

/**
 * The hosted catalog is deliberately smaller than the fixture catalog: it exposes only the
 * tenant-owned, generation-ready ids needed by the hosted project flow. Keeping the hosted hub
 * read-only avoids accidentally routing staging users through fixture-only mutation APIs.
 */
function HostedPresetHubScreen({ kind }: { kind: HostedPresetHubKind }) {
  const catalog = useQuery({
    queryKey: ["hosted-project-catalog"],
    queryFn: () => readJson<CatalogResponse>("/api/v2/hosted/project-catalog"),
  });
  const isAvatar = kind === "avatars";
  const items = catalog.data ? (isAvatar ? catalog.data.avatars : catalog.data.styles) : [];
  const title = isAvatar ? "Avatar Hub" : "Image Styles";
  const itemLabel = isAvatar ? "avatar" : "style";
  const Icon = isAvatar ? UsersRound : Images;

  if (catalog.isPending) {
    return (
      <Panel eyebrow="Private hosted staging" heading={`Loading ${title}`}>
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading tenant-owned {itemLabel}s…</p>
        </div>
      </Panel>
    );
  }
  if (catalog.isError || !catalog.data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title={`${title} unavailable`}
        body="The hosted tenant catalog could not be loaded. No fixture catalog was substituted."
        action={
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Private hosted staging"
        title={title}
        description={`Only ${itemLabel}s owned by this account can be used for generation.`}
      />
      <div className="notice" role="status">
        <strong>Hosted catalog is read-only.</strong> Generation uses the exact tenant-owned,
        approved version shown here; fixture-only creation routes are not available in staging.
      </div>
      <Panel eyebrow="Tenant-private catalog" heading={`Ready ${itemLabel}s`}>
        {items.length === 0 ? (
          <EmptyState
            icon={<Icon />}
            title={`No ready ${itemLabel}s yet`}
            body={`This account has no tenant-owned ${itemLabel} fixture available. An activation owner must provision and approve the bounded V2-06 fixture before a project can be generated.`}
            action={
              <Link className="button button-secondary" to="/settings">
                Open Settings
              </Link>
            }
          />
        ) : (
          <div className="entity-list">
            {items.map((item) => (
              <article className="entity-row" key={item.version_id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    Tenant-owned · version {item.version_number} · {item.version_id}
                  </small>
                </div>
                <Badge tone="success">{isAvatar ? "READY" : "PUBLISHED"}</Badge>
              </article>
            ))}
          </div>
        )}
      </Panel>
      {items.length > 0 ? (
        <Panel eyebrow="Next step" heading="Use this catalog in a project">
          <p>
            Select the exact {itemLabel} version on Create Project. Personal-worker compute stays at
            $0 provider CPU cost; GPU transport remains disabled for V2-06.
          </p>
          <Link className="button button-primary" to="/projects/new">
            Create Project
          </Link>
        </Panel>
      ) : null}
    </>
  );
}

export function HostedAvatarHubScreen() {
  return <HostedPresetHubScreen kind="avatars" />;
}

export function HostedStylesHubScreen() {
  return <HostedPresetHubScreen kind="styles" />;
}

export function HostedPresetCreationUnavailableScreen({ kind }: { kind: HostedPresetHubKind }) {
  const isAvatar = kind === "avatars";
  const title = isAvatar ? "Avatar Hub" : "Image Styles";
  const itemLabel = isAvatar ? "avatar" : "style";
  return (
    <>
      <PageHeader
        eyebrow="Private hosted staging"
        title={`${title} creation unavailable`}
        description="Hosted V2-06 accepts only exact activation-owned presets."
      />
      <EmptyState
        icon={isAvatar ? <UsersRound /> : <Images />}
        title="Read-only hosted catalog"
        body={`The ${itemLabel} creation workflow is intentionally disabled in staging. Open the hub to inspect tenant-owned versions, or return to Settings for worker status.`}
        action={
          <div className="cluster">
            <Link className="button button-secondary" to={isAvatar ? "/avatars" : "/styles"}>
              Open {title}
            </Link>
            <Link className="button button-secondary" to="/settings">
              Settings
            </Link>
          </div>
        }
      />
    </>
  );
}

export function HostedProjectScreen({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hosted-project", projectId],
    queryFn: () => readJson<ProjectDetailResponse>(`/api/v2/hosted/projects/${projectId}`),
    refetchInterval: 5_000,
  });
  const asr = [...(query.data?.attempts ?? [])].reverse().find((attempt) => attempt.kind === "ASR");
  const render = [...(query.data?.attempts ?? [])]
    .reverse()
    .find((attempt) => attempt.kind === "RENDER");
  const renderHandoffAttempt = useRef<string | null>(null);
  const renderHandoff = useMutation({
    mutationFn: async (asrAttemptId: string) => {
      const handoff = await readJson<{ cpu_submission: unknown }>(
        `/api/v2/hosted/projects/${projectId}/render`,
        { method: "POST", body: JSON.stringify({ asr_attempt_id: asrAttemptId }) },
      );
      return readJson(`/api/v2/cpu-attempts`, {
        method: "POST",
        body: JSON.stringify(handoff.cpu_submission),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  useEffect(() => {
    if (asr?.state !== "SUCCEEDED" || render || renderHandoffAttempt.current === asr.id) {
      return;
    }
    renderHandoffAttempt.current = asr.id;
    renderHandoff.mutate(asr.id);
  }, [asr?.id, asr?.state, render?.id, renderHandoff]);
  const cancel = useMutation({
    mutationFn: (attemptId: string) =>
      readJson(`/api/v2/cpu-attempts/${attemptId}`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  if (query.isPending)
    return (
      <Panel eyebrow="Hosted project" heading="Loading progress">
        <p>Reading durable worker state…</p>
      </Panel>
    );
  if (query.isError || !query.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Project unavailable"
        body="No fixture status was substituted."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  return (
    <>
      <PageHeader
        eyebrow={query.data.project.revision_state}
        title={query.data.project.title}
        description="Durable personal-worker progress"
        actions={
          render?.state === "SUCCEEDED" ? (
            <Link
              className="button button-primary"
              to="/projects/$projectId/review"
              params={{ projectId }}
            >
              Review video
            </Link>
          ) : undefined
        }
      />
      <div className="grid grid-3 usage-grid">
        <Metric label="CPU provider" value="$0.00" detail="your computer" tone="success" />
        <Metric
          label="Worker jobs"
          value={String(query.data.attempts.length)}
          detail="ASR and render"
        />
        <Metric label="GPU" value="Disabled" detail="V2-06 firewall" />
      </div>
      <Panel eyebrow="Exact attempts" heading="Progress">
        <div className="entity-list">
          {query.data.attempts.map((attempt) => (
            <article className="entity-row" key={attempt.id}>
              <div>
                <strong>
                  {attempt.kind === "ASR" ? "Transcribe voiceover" : "Render final video"}
                </strong>
                <small>{attempt.id}</small>
              </div>
              <Badge
                tone={
                  attempt.state === "SUCCEEDED"
                    ? "success"
                    : attempt.state === "FAILED"
                      ? "danger"
                      : "info"
                }
              >
                {attempt.state.replaceAll("_", " ")}
              </Badge>
              {["OUTBOXED", "SUBMITTED", "RUNNING", "RECONCILING"].includes(attempt.state) ? (
                <Button
                  variant="danger"
                  busy={cancel.isPending && cancel.variables === attempt.id}
                  onClick={() => cancel.mutate(attempt.id)}
                >
                  <X size={15} /> Cancel
                </Button>
              ) : null}
            </article>
          ))}
        </div>
      </Panel>
      {asr?.state === "SUCCEEDED" && !render ? (
        <div className="notice" role="status">
          <strong>
            {renderHandoff.isError
              ? "Transcription complete; render is waiting for the exact project plan."
              : renderHandoff.isPending
                ? "Transcription complete; preparing the owned render attempt."
                : "Transcription complete; render handoff is queued."}
          </strong>
          {renderHandoff.isError ? <span> {renderHandoff.error.message}</span> : null}
          {renderHandoff.isError ? (
            <Button
              variant="secondary"
              onClick={() => {
                renderHandoffAttempt.current = null;
                if (asr) renderHandoff.mutate(asr.id);
              }}
            >
              Retry render handoff
            </Button>
          ) : null}
        </div>
      ) : null}
      <Button variant="secondary" onClick={() => void query.refetch()}>
        <RefreshCw size={15} /> Refresh
      </Button>
    </>
  );
}

export function HostedReviewScreen({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hosted-project", projectId],
    queryFn: () => readJson<ProjectDetailResponse>(`/api/v2/hosted/projects/${projectId}`),
  });
  const candidate = useMemo(
    () =>
      [...(query.data?.attempts ?? [])]
        .reverse()
        .find((attempt) => attempt.kind === "RENDER" && attempt.state === "SUCCEEDED"),
    [query.data],
  );
  const approve = useMutation({
    mutationFn: () =>
      readJson(`/api/v2/hosted/projects/${projectId}/review`, {
        method: "POST",
        body: JSON.stringify({ attempt_id: candidate?.id }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  if (query.isPending)
    return (
      <Panel eyebrow="Review" heading="Loading candidate">
        <p>Checking exact output receipt…</p>
      </Panel>
    );
  if (query.isError || !candidate?.preview_url)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Output is not ready for review"
        body="A successful checksum-bound render is required. No synthetic preview is shown."
        action={
          <Link
            className="button button-secondary"
            to="/projects/$projectId"
            params={{ projectId }}
          >
            Progress
          </Link>
        }
      />
    );
  return (
    <>
      <PageHeader
        eyebrow={candidate.approved_at ? "Approved" : "Review required"}
        title="Review"
        description={query.data?.project.title}
        actions={
          <Button
            disabled={Boolean(candidate.approved_at)}
            busy={approve.isPending}
            onClick={() => approve.mutate()}
          >
            <ShieldCheck size={16} /> {candidate.approved_at ? "Approved" : "Approve final"}
          </Button>
        }
      />
      <Panel className="review-player" eyebrow="Private R2 candidate" heading="Final output">
        <div className="review-player-frame">
          <video controls preload="metadata" src={candidate.preview_url} />
        </div>
        <div className="review-player-meta">
          <Badge tone={candidate.approved_at ? "success" : "warning"}>
            {candidate.approved_at ? "APPROVED" : "REVIEW NEEDED"}
          </Badge>
          <a
            className="button button-secondary"
            href={candidate.preview_url}
            download="videoforge-output.mp4"
          >
            <Download size={16} /> Download MP4
          </a>
        </div>
      </Panel>
      {approve.isError ? (
        <div className="validation validation-danger">{approve.error.message}</div>
      ) : null}
    </>
  );
}

export function HostedUsageScreen() {
  const query = useQuery({
    queryKey: ["hosted-usage"],
    queryFn: () => readJson<HostedUsageResponse>("/api/v2/hosted/usage"),
  });
  if (query.isPending)
    return (
      <Panel eyebrow="Workspace" heading="Loading Usage">
        <p>Reading exact tenant totals…</p>
      </Panel>
    );
  if (query.isError || !query.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Usage unavailable"
        body="No estimated spend was substituted."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  return (
    <>
      <PageHeader title="Usage" />
      <div className="grid grid-4 usage-grid">
        <Metric label="CPU provider" value="$0.00" detail="personal worker" tone="success" />
        <Metric label="GPU staging" value="$0.00" detail="disabled" />
        <Metric
          label="Worker time"
          value={`${query.data.personal_worker_seconds}s`}
          detail="measured"
        />
        <Metric
          label="Private R2"
          value={`${(query.data.retained_bytes / 1024 / 1024 / 1024).toFixed(3)} GB`}
          detail="until Delete"
        />
      </div>
      <div className="grid grid-3 usage-grid">
        <Metric label="Attempts" value={String(query.data.attempts)} detail="this month" />
        <Metric label="Succeeded" value={String(query.data.succeeded)} detail="durable" />
        <Metric label="Failed" value={String(query.data.failed)} detail="no hidden estimate" />
      </div>
    </>
  );
}
