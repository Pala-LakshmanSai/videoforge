import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDollarSign,
  CloudCog,
  Download,
  FileAudio,
  FileJson,
  Gauge,
  ImagePlus,
  Images,
  KeyRound,
  LockKeyhole,
  MoreHorizontal,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
  UsersRound,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { CompositionPreview } from "../components/CompositionPreview";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  Button,
  EmptyState,
  Metric,
  Panel,
  ProgressBar,
  StageTimeline,
} from "../components/ui";
import { api } from "../lib/api";
import { loadDraft, saveDraft, updateDraft, type ProjectDraft } from "../lib/draft";
import { currentScenario, withScenario } from "../lib/scenario";
import type { AvatarProfile, ImageStyle, ProjectStage, ProjectSummary, Tone } from "../lib/types";

function statusTone(status: string): Tone {
  if (["COMPLETE", "APPROVED", "PASSED", "PUBLISHED", "READY"].includes(status)) return "success";
  if (["FAILED", "INVALID"].includes(status)) return "danger";
  if (["BLOCKED", "NEEDS_ATTENTION", "CANCELLED", "STALE", "NEEDS_REVIEW"].includes(status))
    return "warning";
  if (["RUNNING", "STARTING", "ANALYZING", "VALIDATING", "READY_FOR_REVIEW"].includes(status))
    return "info";
  return "neutral";
}

function readLocalEntities<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

function fixtureLink(path: string) {
  return withScenario(path, currentScenario());
}

export function QueueScreen() {
  const scenario = currentScenario();
  const query = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const projects = query.data?.projects ?? [];
  const running = projects.filter((project) => project.status === "RUNNING").length;
  const attention = projects.filter((project) => project.status === "NEEDS_ATTENTION").length;
  const complete = projects.filter((project) =>
    ["READY_FOR_REVIEW", "APPROVED"].includes(project.status),
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Production queue"
        title="Every project, honestly tracked."
        description="Watch parallel image and avatar work, queue position, retries, cost, and blockers without opening a provider console."
        actions={
          <Link
            to="/projects/new"
            search={{ fixture: scenario } as never}
            className="button button-primary"
          >
            <Plus size={16} />
            New project
          </Link>
        }
      />
      <div className="grid grid-4">
        <Metric
          label="Active"
          value={String(running)}
          detail="parallel lanes running"
          tone="info"
        />
        <Metric
          label="Queued"
          value={String(projects.filter((project) => project.status === "QUEUED").length)}
          detail="fair workspace order"
        />
        <Metric
          label="Needs attention"
          value={String(attention)}
          detail="actionable blockers"
          tone={attention ? "warning" : "success"}
        />
        <Metric label="Ready" value={String(complete)} detail="review or approved" tone="success" />
      </div>
      <Panel
        className="queue-panel"
        eyebrow="Workspace"
        heading="Current projects"
        action={
          <Badge tone={query.isError ? "danger" : "success"}>
            {query.isError ? "API unavailable" : "Live fixture"}
          </Badge>
        }
      >
        {query.isPending ? (
          <div className="empty-state">
            <span className="spinner" />
            <p>Loading authoritative queue state…</p>
          </div>
        ) : null}
        {!query.isPending && projects.length === 0 ? (
          <EmptyState
            icon={<Video />}
            title="Queue is clear"
            body="Create a project to begin a fixture-backed production run."
            action={
              <Link
                className="button button-primary"
                to="/projects/new"
                search={{ fixture: scenario } as never}
              >
                New project
              </Link>
            }
          />
        ) : null}
        {projects.length ? (
          <div className="table-list">
            <div className="table-row table-head">
              <span>Project</span>
              <span>Status</span>
              <span>Progress</span>
              <span>ETA</span>
              <span>Cost</span>
              <span>Queue</span>
            </div>
            {projects.map((project) => {
              const percent = project.total
                ? Math.round((project.completed / project.total) * 100)
                : 0;
              return (
                <Link
                  className="table-row"
                  key={project.id}
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  search={{ fixture: scenario } as never}
                >
                  <div className="project-title">
                    <span className="project-icon">
                      <Video size={18} />
                    </span>
                    <div>
                      <strong>{project.title}</strong>
                      <small>
                        {project.owner} · {project.createdAt}
                      </small>
                    </div>
                  </div>
                  <span className="table-cell">
                    <Badge tone={statusTone(project.status)}>
                      {project.status.replaceAll("_", " ")}
                    </Badge>
                  </span>
                  <span className="table-cell">
                    <strong>{percent}%</strong>
                    <ProgressBar value={percent} label={`${project.title} progress`} />
                  </span>
                  <span className="table-cell">{project.eta}</span>
                  <span className="table-cell">
                    ${project.actualCost.toFixed(2)} / ${project.estimatedCost.toFixed(2)}
                  </span>
                  <span className="table-cell">{project.queuePosition ?? "—"}</span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </Panel>
    </>
  );
}

function useProjectDraft() {
  const [draft, setDraftState] = useState<ProjectDraft>(() => loadDraft());
  const setDraft = (next: ProjectDraft | ((current: ProjectDraft) => ProjectDraft)) => {
    setDraftState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      saveDraft(resolved);
      return resolved;
    });
  };
  return [draft, setDraft] as const;
}

export function CreateProjectScreen() {
  const scenario = currentScenario();
  const [draft, setDraft] = useProjectDraft();
  const [audioError, setAudioError] = useState<string | null>(null);
  const [submittedError, setSubmittedError] = useState<string | null>(null);
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const localAvatars = readLocalEntities<AvatarProfile>("videoforge:fixture:avatars:v1");
  const localStyles = readLocalEntities<ImageStyle>("videoforge:fixture:styles:v1");
  const avatars = [...(bootstrap.data?.avatars ?? []), ...localAvatars].filter(
    (item, index, list) =>
      list.findIndex((candidate) => candidate.versionId === item.versionId) === index,
  );
  const styles = [...(bootstrap.data?.styles ?? []), ...localStyles].filter(
    (item, index, list) =>
      list.findIndex((candidate) => candidate.versionId === item.versionId) === index,
  );
  const readyAvatars = avatars.filter((avatar) => avatar.status === "READY");
  const publishedStyles = styles.filter((style) => style.status === "PUBLISHED");

  const conflict =
    draft.applyExtraPromptKeywords &&
    /\b(add|include|show|write)\b.{0,30}\b(logo|caption|title|watermark|text)\b/i.test(
      draft.extraPromptKeywords,
    );
  const keywordEmpty = draft.applyExtraPromptKeywords && !draft.extraPromptKeywords.trim();
  const canSubmit = Boolean(
    draft.title.trim() &&
      draft.voiceoverAssetId &&
      draft.avatarProfileVersionId &&
      draft.imageStyleVersionId &&
      !conflict &&
      !keywordEmpty,
  );
  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        title: draft.title.trim(),
        voiceover_asset_id: draft.voiceoverAssetId,
        avatar_profile_version_id: draft.avatarProfileVersionId,
        image_style_version_id: draft.imageStyleVersionId,
        optional_script: draft.optionalScript || null,
        extra_prompt_keywords: draft.extraPromptKeywords || null,
        apply_extra_prompt_keywords: draft.applyExtraPromptKeywords,
        generation_mode: draft.generationMode,
        spend_cap_usd: draft.spendCapUsd,
        user_seed: draft.userSeed,
      };
      const mutationId = crypto.randomUUID();
      await api.mutate("/api/v1/projects/preflight", payload, scenario, `${mutationId}:preflight`);
      return api.mutate<{ id: string; status: string }>(
        "/api/v1/projects",
        payload,
        scenario,
        `${mutationId}:create`,
      );
    },
    onSuccess: (result) =>
      window.location.assign(fixtureLink(`/projects/${result.id || "project_fixture_001"}`)),
    onError: (error) =>
      setSubmittedError(error instanceof Error ? error.message : "Project could not be created."),
  });

  function chooseAudio(file?: File) {
    if (!file) return;
    if (!/\.(wav|mp3|m4a|aac|flac)$/i.test(file.name)) {
      setAudioError("Use WAV, MP3, M4A/AAC, or FLAC audio.");
      return;
    }
    if (file.size > 1_000_000_000) {
      setAudioError("Voiceover must be 1 GB or smaller.");
      return;
    }
    setAudioError(null);
    setDraft((value) => ({
      ...value,
      voiceoverAssetId: `fixture_voiceover_${file.size}`,
      voiceoverName: file.name,
    }));
  }

  return (
    <>
      <PageHeader
        eyebrow="New production"
        title="Create once. Let the lanes work."
        description="Choose a stored avatar and published image style, add final narration, then start one immutable fixture revision."
      />
      <div className="layout-main">
        <Panel eyebrow="Project inputs" heading="Production brief">
          <div className="form-grid">
            <div className="field field-wide">
              <label htmlFor="project-title">Video title</label>
              <input
                id="project-title"
                className="input"
                maxLength={240}
                placeholder="Why food prices behave the way they do"
                value={draft.title}
                onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              />
              <small>
                {draft.title.trim().length}/240 · Used as context, never burned into the video.
              </small>
            </div>
            <div className="field field-wide">
              <span className="field-label">Final voiceover</span>
              <label className="dropzone">
                <input
                  aria-label="Upload final voiceover"
                  type="file"
                  accept="audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/flac"
                  onChange={(event) => chooseAudio(event.target.files?.[0])}
                />
                <FileAudio size={28} />
                <span>
                  <strong>{draft.voiceoverName ?? "Drop or choose final narration"}</strong>
                  {draft.voiceoverAssetId
                    ? "Verified fixture upload handle preserved"
                    : "WAV, MP3, M4A/AAC, or FLAC · 10 sec–60 min"}
                </span>
              </label>
              {audioError ? (
                <div className="validation validation-danger">
                  <AlertTriangle size={16} />
                  {audioError}
                </div>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="avatar-version">Avatar Profile</label>
              <select
                id="avatar-version"
                className="select"
                value={draft.avatarProfileVersionId}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, avatarProfileVersionId: event.target.value }))
                }
              >
                <option value="">Select a ready avatar</option>
                {readyAvatars.map((avatar) => (
                  <option key={avatar.versionId} value={avatar.versionId}>
                    {avatar.name} · v{avatar.version} · {avatar.compatibility}
                  </option>
                ))}
              </select>
              <div className="cluster">
                <Link
                  className="button button-ghost"
                  to="/avatars"
                  search={{ fixture: scenario } as never}
                >
                  Manage avatars
                </Link>
                <Link
                  className="button button-secondary"
                  to="/avatars/new"
                  search={{ fixture: scenario, returnTo: "/projects/new" } as never}
                >
                  <UserPlus size={15} />
                  New avatar
                </Link>
              </div>
              {readyAvatars.length === 0 ? (
                <div className="validation validation-warning">
                  <AlertTriangle size={16} />
                  Create your first ready avatar before generation.
                </div>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="style-version">Image Style</label>
              <select
                id="style-version"
                className="select"
                value={draft.imageStyleVersionId}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, imageStyleVersionId: event.target.value }))
                }
              >
                {publishedStyles.map((style) => (
                  <option key={style.versionId} value={style.versionId}>
                    {style.name} · v{style.version}
                    {style.isDefault ? " · Default" : ""}
                  </option>
                ))}
              </select>
              <div className="cluster">
                <Link
                  className="button button-ghost"
                  to="/styles"
                  search={{ fixture: scenario } as never}
                >
                  Manage styles
                </Link>
                <Link
                  className="button button-secondary"
                  to="/styles/new"
                  search={{ fixture: scenario, returnTo: "/projects/new" } as never}
                >
                  <ImagePlus size={15} />
                  New style
                </Link>
              </div>
            </div>
            <div className="field field-wide">
              <div className="toggle-row">
                <div>
                  <strong>Apply extra keywords to every AI image</strong>
                  <p className="helper">
                    Affects AI images only. It does not change avatar, timing, or layout.
                  </p>
                </div>
                <Switch.Root
                  className="switch-root"
                  checked={draft.applyExtraPromptKeywords}
                  onCheckedChange={(checked) =>
                    setDraft((value) => ({ ...value, applyExtraPromptKeywords: checked }))
                  }
                >
                  <Switch.Thumb className="switch-thumb" />
                </Switch.Root>
              </div>
              <textarea
                className="textarea"
                maxLength={500}
                value={draft.extraPromptKeywords}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, extraPromptKeywords: event.target.value }))
                }
                aria-label="Extra image prompt keywords"
              />
              {!draft.applyExtraPromptKeywords ? (
                <div className="validation">
                  <PauseCircle size={16} />
                  Not applied. Text is preserved and sent to neither DeepSeek nor Mage.
                </div>
              ) : keywordEmpty ? (
                <div className="validation validation-danger">
                  <X size={16} />
                  Enter at least one keyword or turn the toggle off.
                </div>
              ) : conflict ? (
                <div className="validation validation-danger">
                  <X size={16} />
                  Requests for visible text, captions, logos, or watermarks are prohibited.
                </div>
              ) : (
                <div className="validation validation-success">
                  <Check size={16} />
                  Applied once to image prompts. Permanent no-text guardrails still win.
                </div>
              )}
            </div>
            <details className="field field-wide">
              <summary>Optional exact script</summary>
              <textarea
                className="textarea"
                value={draft.optionalScript}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, optionalScript: event.target.value }))
                }
                placeholder="Paste the final narration transcript if available…"
              />
            </details>
            <div className="field field-wide">
              <span className="field-label">Execution mode</span>
              <div className="option-grid">
                {(["LOWEST_COST", "BALANCED", "FASTER"] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    className={`option-card ${draft.generationMode === mode ? "selected" : ""}`}
                    onClick={() => setDraft((value) => ({ ...value, generationMode: mode }))}
                  >
                    <strong>{mode.replace("_", " ")}</strong>
                    <span>
                      {mode === "LOWEST_COST"
                        ? "Cheapest tested profiles"
                        : mode === "BALANCED"
                          ? "Recommended cost and speed"
                          : "Faster tested endpoint priority"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Panel>
        <div className="stack">
          <Panel eyebrow="Immutable preflight" heading="Effective settings">
            <div className="stack">
              <div className="validation validation-success">
                <ShieldCheck size={16} />
                Fixture mode is locked. External provider calls: 0.
              </div>
              <div
                className={`validation ${draft.avatarProfileVersionId ? "validation-success" : "validation-warning"}`}
              >
                <UsersRound size={16} />
                Exact ready Avatar Profile version{" "}
                {draft.avatarProfileVersionId ? "selected" : "required"}; no inline upload.
              </div>
              <div
                className={`validation ${draft.imageStyleVersionId ? "validation-success" : "validation-warning"}`}
              >
                <Images size={16} />
                Published immutable Image Style {draft.imageStyleVersionId ? "pinned" : "required"}.
              </div>
              <div className="validation validation-success">
                <WandSparkles size={16} />
                Layout is deterministic; no LLM chooses composition.
              </div>
            </div>
            <div className="divider" />
            <div className="field">
              <label htmlFor="spend-cap">Hard spend cap</label>
              <input
                id="spend-cap"
                className="input"
                type="number"
                min="0.1"
                max="2"
                step="0.05"
                value={draft.spendCapUsd}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    spendCapUsd: Math.min(2, Math.max(0.1, Number(event.target.value))),
                  }))
                }
              />
              <small>Fixture run settles at $0. Production contract rejects caps above $2.</small>
            </div>
            <div className="divider" />
            {submittedError ? (
              <div className="validation validation-danger">
                <AlertTriangle size={16} />
                {submittedError}
              </div>
            ) : null}
            <Button busy={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>
              {create.isPending ? "Creating immutable revision…" : "Generate video"}
              <ArrowRight size={16} />
            </Button>
            {!canSubmit ? (
              <p className="helper">
                Add a title, verified voiceover, ready avatar, and published style to continue.
              </p>
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}

const defaultStages: ProjectStage[] = [
  {
    id: "ingest",
    label: "Ingest",
    status: "COMPLETE",
    completed: 1,
    total: 1,
    detail: "Voiceover verified and immutable revision created.",
  },
  {
    id: "timing",
    label: "Word timing",
    status: "COMPLETE",
    completed: 1,
    total: 1,
    detail: "Fixture transcript aligned; no paid ASR.",
  },
  {
    id: "timeline",
    label: "Timeline",
    status: "COMPLETE",
    completed: 1,
    total: 1,
    detail: "Deterministic 30 fps plan compiled without gaps.",
  },
  {
    id: "prompts",
    label: "Image prompts",
    status: "COMPLETE",
    completed: 5,
    total: 5,
    detail: "Pinned documentary style and phrase roles compiled.",
  },
  {
    id: "media",
    label: "Image + avatar lanes",
    status: "RUNNING",
    completed: 31,
    total: 52,
    detail: "AvatarForcing fixture clip 18/22 · Mage image 13/30.",
  },
  {
    id: "assembly",
    label: "Assembly",
    status: "QUEUED",
    completed: 0,
    total: 1,
    detail: "Waiting for accepted asset barrier.",
  },
  {
    id: "qa",
    label: "Technical QA",
    status: "QUEUED",
    completed: 0,
    total: 1,
    detail: "FFprobe and checksum pending.",
  },
];

const scenarioMessages: Partial<
  Record<ReturnType<typeof currentScenario>, { tone: Tone; title: string; body: string }>
> = {
  gpu_cold_start: {
    tone: "info",
    title: "GPU cold start",
    body: "Container is ready; the model is loading. Queue wait and model-ready time are shown separately.",
  },
  image_partial_failure: {
    tone: "warning",
    title: "Image chunk needs one retry",
    body: "13/15 items are accepted. Only two failed scene IDs will be retried.",
  },
  avatar_lip_failure: {
    tone: "warning",
    title: "Reviewer classification required",
    body: "Clip 18 is otherwise good but has isolated lip sync drift. MuseTalk is the only approved repair route.",
  },
  skyreels_approval_required: {
    tone: "warning",
    title: "Whole-frame fallback needs budget approval",
    body: "SkyReels would start from the exact pinned Avatar Profile source, never the failed derivative.",
  },
  budget_blocked: {
    tone: "danger",
    title: "Budget blocked",
    body: "The next dispatch would exceed the immutable project cap. No provider work has started.",
  },
  dispatch_ack_unknown: {
    tone: "warning",
    title: "Dispatch acknowledgement unknown",
    body: "VideoForge is reconciling the original idempotency key and will not blindly dispatch again.",
  },
  callback_reconciling: {
    tone: "info",
    title: "Reconnecting to worker truth",
    body: "A callback was missed. Accepted artifacts and the provider job are being reconciled.",
  },
  cancel_requested: {
    tone: "warning",
    title: "Cancellation requested",
    body: "Queued work is blocked; already-running work is settling cooperatively and billed cost remains visible.",
  },
};

export function ProjectScreen({ projectId }: { projectId: string }) {
  const scenario = currentScenario();
  const query = useQuery({
    queryKey: ["project", projectId, scenario],
    queryFn: () => api.project(projectId, scenario),
  });
  const [action, setAction] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    tone: "info" | "danger";
    text: string;
  } | null>(null);
  const project: ProjectSummary = query.data?.project ?? {
    id: projectId,
    title: "Why the everyday world is changing",
    owner: "Lakshman",
    status: scenario === "project_ready_for_review" ? "READY_FOR_REVIEW" : "RUNNING",
    stage: "Image + avatar generation",
    completed: 31,
    total: 52,
    eta: "18 min",
    mode: "BALANCED",
    estimatedCost: 0.91,
    actualCost: 0.34,
    queuePosition: null,
    createdAt: "Today, 10:42",
    stages: defaultStages,
  };
  const percent = Math.round((project.completed / Math.max(1, project.total)) * 100);
  const message = scenarioMessages[scenario];

  async function perform(label: string, path: string) {
    setAction(label);
    setActionNotice({
      tone: "info",
      text:
        label === "retry"
          ? "Retry request pending. Duplicate submission is disabled."
          : "Cancellation request pending. Duplicate submission is disabled.",
    });
    try {
      await api.mutate(path, { project_id: project.id }, scenario);
      setActionNotice({
        tone: "info",
        text:
          label === "retry"
            ? "Retry accepted for the failed item set only. Next fixture check in 10 seconds."
            : "Cancellation accepted. Running work is settling; next fixture check in 10 seconds.",
      });
    } catch (error) {
      setActionNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "The fixture action could not be accepted.",
      });
    } finally {
      window.setTimeout(() => setAction(null), 650);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Active revision · rev_fixture_001"
        title={project.title}
        description="Original voiceover, Avatar Profile v1, Authentic Documentary Stock v1, and deterministic scheduler-v1 are pinned."
        actions={
          <>
            <Button
              variant="secondary"
              busy={action === "retry"}
              onClick={() => perform("retry", `/api/v1/projects/${project.id}/retry`)}
            >
              <RefreshCw size={15} />
              Retry failed
            </Button>
            <Button
              variant="danger"
              busy={action === "cancel"}
              onClick={() => perform("cancel", `/api/v1/projects/${project.id}/cancel`)}
            >
              <X size={15} />
              Cancel safely
            </Button>
          </>
        }
      />
      {message ? (
        <div
          className={`notice ${message.tone === "warning" ? "notice-warning" : message.tone === "danger" ? "notice-danger" : ""}`}
        >
          <strong>{message.title}.</strong> {message.body}
        </div>
      ) : null}
      {actionNotice ? (
        <div
          className={`notice ${actionNotice.tone === "danger" ? "notice-danger" : ""}`}
          role="status"
          aria-live="polite"
        >
          {actionNotice.text}
        </div>
      ) : null}
      <div className="grid grid-4">
        <Metric
          label="Stage"
          value={project.stage}
          detail={`${project.completed}/${project.total} authoritative units`}
          tone="info"
        />
        <Metric label="ETA" value={project.eta} detail="queue wait reported separately" />
        <Metric
          label="Current cost"
          value={`$${project.actualCost.toFixed(2)}`}
          detail={`$${project.estimatedCost.toFixed(2)} estimate · $1.50 cap`}
          tone="success"
        />
        <Metric
          label="Worker health"
          value={query.isError ? "Blocked" : "Healthy"}
          detail="fixture lanes · no provider calls"
          tone={query.isError ? "danger" : "success"}
        />
      </div>
      <div className="layout-main">
        <div className="stack">
          <Panel
            eyebrow="Command track"
            heading={`${percent}% complete`}
            action={
              <Badge tone={statusTone(project.status)}>{project.status.replaceAll("_", " ")}</Badge>
            }
          >
            <ProgressBar value={percent} label="Overall project progress" />
            <p className="helper" style={{ marginTop: 12 }}>
              Overall progress is computed from versioned stage weights and completed units—not a
              fabricated smooth percentage.
            </p>
          </Panel>
          <Panel eyebrow="Parallel execution" heading="Image and avatar lanes">
            <div className="grid grid-2">
              <div className="metric metric-info">
                <span>Image lane</span>
                <strong>13 / 30</strong>
                <small>Mage fixture · image 14 compiling</small>
                <ProgressBar value={43} label="Image lane progress" />
              </div>
              <div className="metric metric-info">
                <span>Avatar lane</span>
                <strong>18 / 22</strong>
                <small>AvatarForcing fixture · selected span only</small>
                <ProgressBar value={82} label="Avatar lane progress" />
              </div>
            </div>
          </Panel>
          <Panel eyebrow="Latest accepted assets" heading="Composition preview">
            <div className="grid grid-3">
              <div>
                <CompositionPreview type="AVATAR_FULL" />
                <p className="helper">One accepted clip · full crop</p>
              </div>
              <div>
                <CompositionPreview type="IMAGE_FULL" />
                <p className="helper">Narration-relevant image · slow zoom</p>
              </div>
              <div>
                <CompositionPreview type="AVATAR_SPLIT_IMAGE" />
                <p className="helper">Same avatar clip · fixed split crop</p>
              </div>
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel eyebrow="Pipeline" heading="Authoritative stages">
            <StageTimeline stages={project.stages ?? defaultStages} />
          </Panel>
          <Panel eyebrow="Recent events" heading="Immutable activity">
            {(
              query.data?.events ?? [
                { id: "e1", at: "10:48:21", detail: "Image task image:seg_0014 accepted." },
                { id: "e2", at: "10:47:54", detail: "Avatar clip 18 model ready." },
                { id: "e3", at: "10:47:12", detail: "Cost reservation updated to $0.34." },
              ]
            ).map((event) => (
              <div className="timeline-event" key={event.id}>
                <span>{event.at}</span>
                <i />
                <strong>{event.detail}</strong>
              </div>
            ))}
          </Panel>
          <Link
            className="button button-primary"
            to="/projects/$projectId/review"
            params={{ projectId }}
            search={{ fixture: scenario } as never}
          >
            Open review strip
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </>
  );
}

export function ReviewScreen({ projectId }: { projectId: string }) {
  const scenario = currentScenario();
  const [sameClipMode, setSameClipMode] = useState<"AVATAR_FULL" | "AVATAR_SPLIT_IMAGE">(
    "AVATAR_FULL",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [approved, setApproved] = useState(scenario === "project_approved");
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [reviewActionNotice, setReviewActionNotice] = useState<string | null>(null);
  const shots = [
    {
      id: "seg_0001",
      time: "00:00–00:04",
      type: sameClipMode,
      phrase: "The story begins with one simple observation.",
      status: "SELECTED",
    },
    {
      id: "seg_0002",
      time: "00:04–00:10",
      type: "IMAGE_FULL" as const,
      phrase: "Prices respond to the pressures around them.",
      status: "SELECTED",
    },
    {
      id: "seg_0003",
      time: "00:10–00:14",
      type: "AVATAR_SPLIT_IMAGE" as const,
      phrase: "That becomes visible in ordinary daily choices.",
      status: scenario === "avatar_lip_failure" ? "FLAGGED" : "SELECTED",
    },
  ];

  async function act(id: string) {
    setBusy(id);
    setApprovalError(null);
    setReviewActionNotice(null);
    try {
      if (id === "approve") {
        await Promise.all([
          api.mutate(`/api/v1/projects/${projectId}/approve`, { project_id: projectId }, scenario),
          new Promise((resolve) => window.setTimeout(resolve, 600)),
        ]);
        setApproved(true);
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        setReviewActionNotice(
          id.endsWith("-regen")
            ? "Synthetic regeneration request captured for this segment only. Next fixture check in 10 seconds; provider calls remain zero."
            : "Synthetic defect classification opened for this segment. The accepted candidate remains unchanged.",
        );
      }
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "Approval could not be recorded.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Review candidate v3"
        title={approved ? "Approved and provenance-bound." : "Ready for your review."}
        description="Technical checks can select drafts, but only your explicit approval creates the creative APPROVED state."
        actions={
          <>
            <Link
              className="button button-secondary"
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ fixture: scenario } as never}
            >
              Back to progress
            </Link>
            <Button busy={busy === "approve"} disabled={approved} onClick={() => act("approve")}>
              <ShieldCheck size={16} />
              {approved ? "Approved" : "Approve final"}
            </Button>
          </>
        }
      />
      <div
        className={`notice ${approvalError ? "notice-danger" : approved ? "" : "notice-warning"}`}
        role="status"
        aria-live="polite"
      >
        <strong>
          {approvalError
            ? "Approval blocked."
            : busy === "approve"
              ? "Approval pending."
              : approved
                ? "Approval recorded."
                : "Synthetic review fixture."}
        </strong>{" "}
        {approvalError
          ? approvalError
          : busy === "approve"
            ? "Duplicate submission is disabled while the immutable candidate is checked."
            : approved
              ? "Reviewer, candidate checksum, manifest, and final output are immutable."
              : "Inspect relevance, style, anatomy, pseudo-text, identity, motion, and lip sync before approving."}
      </div>
      {reviewActionNotice ? (
        <div className="notice" role="status" aria-live="polite">
          {reviewActionNotice}
        </div>
      ) : null}
      <Panel
        eyebrow="Fast contact sheet"
        heading="Three representative segments"
        action={
          <div className="cluster">
            <Button
              variant={sameClipMode === "AVATAR_FULL" ? "primary" : "secondary"}
              onClick={() => setSameClipMode("AVATAR_FULL")}
            >
              Same clip · full
            </Button>
            <Button
              variant={sameClipMode === "AVATAR_SPLIT_IMAGE" ? "primary" : "secondary"}
              onClick={() => setSameClipMode("AVATAR_SPLIT_IMAGE")}
            >
              Same clip · split
            </Button>
          </div>
        }
      >
        <div className="review-grid">
          {shots.map((shot) => (
            <article className="review-card" key={shot.id}>
              <CompositionPreview type={shot.type} />
              <div className="review-meta">
                <strong>{shot.time}</strong>
                <Badge tone={shot.status === "FLAGGED" ? "warning" : "success"}>
                  {shot.status}
                </Badge>
              </div>
              <p>{shot.phrase}</p>
              <div className="cluster">
                <Button
                  variant="secondary"
                  busy={busy === `${shot.id}-regen`}
                  onClick={() => act(`${shot.id}-regen`)}
                >
                  <RefreshCw size={14} />
                  Regenerate
                </Button>
                {shot.type !== "IMAGE_FULL" ? (
                  <Button
                    variant="ghost"
                    busy={busy === `${shot.id}-flag`}
                    onClick={() => act(`${shot.id}-flag`)}
                  >
                    <AlertTriangle size={14} />
                    Classify defect
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <div className="grid grid-3">
        <Panel eyebrow="Output" heading="1920×1080 · 30 fps">
          <p className="helper">
            H.264/AAC · hard cuts · no subtitle/data streams · original voiceover binding.
          </p>
        </Panel>
        <Panel eyebrow="Visual grammar" heading="Three layouts only">
          <p className="helper">
            Full avatar, full image, and avatar-left/image-right. Every AI image receives a slow
            zoom.
          </p>
        </Panel>
        <Panel
          eyebrow="Download"
          heading={approved ? "Production manifest ready" : "Approval required"}
        >
          {approved ? (
            <div className="cluster">
              <Button variant="secondary">
                <Download size={15} />
                Synthetic MP4
              </Button>
              <Button variant="secondary">
                <FileJson size={15} />
                Manifest
              </Button>
            </div>
          ) : (
            <p className="helper">
              Downloads bind only after explicit approval of this exact candidate.
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}

export function AvatarHubScreen() {
  const scenario = currentScenario();
  const query = useQuery({ queryKey: ["avatars", scenario], queryFn: () => api.avatars(scenario) });
  const local = readLocalEntities<AvatarProfile>("videoforge:fixture:avatars:v1");
  const avatars = [...(query.data ?? []), ...local].filter(
    (item, index, list) =>
      list.findIndex((candidate) => candidate.versionId === item.versionId) === index,
  );
  return (
    <>
      <PageHeader
        eyebrow="Reusable presenters"
        title="Avatar Hub"
        description="Upload a private presenter source once, validate it, approve the immutable ready version, then reuse it by image and name."
        actions={
          <Link
            className="button button-primary"
            to="/avatars/new"
            search={{ fixture: scenario } as never}
          >
            <UserPlus size={16} />
            New avatar
          </Link>
        }
      />
      <div className="notice">
        <strong>Privacy boundary.</strong> Source images stay workspace-scoped, EXIF/GPS-free
        runtime derivatives are model inputs, and no avatar bytes are sent to Runware.
      </div>
      <Panel
        eyebrow="Workspace profiles"
        heading={`${avatars.length} named avatar${avatars.length === 1 ? "" : "s"}`}
      >
        {avatars.length === 0 ? (
          <EmptyState
            icon={<UsersRound />}
            title="No ready avatars yet"
            body="Create your first named presenter before starting an ordinary project. There is no per-project upload bypass."
            action={
              <Link
                className="button button-primary"
                to="/avatars/new"
                search={{ fixture: scenario } as never}
              >
                Create your first avatar
              </Link>
            }
          />
        ) : (
          <div className="card-grid">
            {avatars.map((avatar) => (
              <article className="entity-card" key={avatar.versionId}>
                <div className="entity-card-top">
                  <div className="profile-picture">{avatar.initials}</div>
                  <div>
                    <h3>{avatar.name}</h3>
                    <div className="cluster">
                      <Badge tone={statusTone(avatar.status)}>{avatar.status}</Badge>
                      <Badge tone={statusTone(avatar.compatibility)}>{avatar.compatibility}</Badge>
                    </div>
                  </div>
                </div>
                <p>
                  Active ready version v{avatar.version} · {avatar.dimensions}
                  <br />
                  Last used {avatar.lastUsed}
                </p>
                <div className="entity-card-footer">
                  <span className="helper">Exact ID {avatar.versionId.slice(0, 18)}…</span>
                  <Button variant="ghost">
                    <MoreHorizontal size={17} aria-label={`Manage ${avatar.name}`} />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

export function NewAvatarScreen() {
  const scenario = currentScenario();
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo") || "/avatars";
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [likeness, setLikeness] = useState(false);
  const [busy, setBusy] = useState(false);

  function finish() {
    setBusy(true);
    window.setTimeout(() => {
      const versionId = `avatar_version_${crypto.randomUUID()}`;
      const next: AvatarProfile = {
        id: `avatar_${crypto.randomUUID()}`,
        versionId,
        name: name.trim(),
        initials: name
          .trim()
          .split(/\s+/)
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        version: 1,
        status: "READY",
        compatibility: "UNTESTED",
        dimensions: "1200×1600",
        lastUsed: "Never",
      };
      localStorage.setItem(
        "videoforge:fixture:avatars:v1",
        JSON.stringify([
          ...readLocalEntities<AvatarProfile>("videoforge:fixture:avatars:v1"),
          next,
        ]),
      );
      updateDraft({ avatarProfileVersionId: versionId });
      window.location.assign(fixtureLink(returnTo));
    }, 650);
  }

  return (
    <>
      <PageHeader
        eyebrow={`New avatar · step ${step} of 3`}
        title="Create a reusable presenter."
        description="This source is uploaded once in the Avatar Hub. Ordinary projects select the immutable ready version and never copy the source."
        actions={
          <Link
            className="button button-ghost"
            to="/avatars"
            search={{ fixture: scenario } as never}
          >
            Cancel
          </Link>
        }
      />
      <div className="layout-main">
        <Panel
          eyebrow="Source workflow"
          heading={
            step === 1
              ? "Name and upload"
              : step === 2
                ? "Technical and framing review"
                : "Rights and approval"
          }
        >
          {step === 1 ? (
            <div className="stack">
              <div className="field">
                <label htmlFor="avatar-name">Profile name</label>
                <input
                  id="avatar-name"
                  className="input"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Maya — studio presenter"
                />
              </div>
              <label className="dropzone">
                <input
                  aria-label="Upload avatar source"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setSourceName(event.target.files?.[0]?.name ?? null)}
                />
                <Upload size={27} />
                <span>
                  <strong>{sourceName ?? "Choose one private centered source"}</strong>JPEG, PNG, or
                  WebP · at least 512×512 · 20 MB max
                </span>
              </label>
              <Button disabled={!name.trim() || !sourceName} onClick={() => setStep(2)}>
                Validate source
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="stack">
              <div className="composition">
                <div className="avatar-frame">
                  <span className="avatar-silhouette" />
                </div>
              </div>
              <div className="validation validation-success">
                <Check size={16} />
                Magic bytes, dimensions, checksum, orientation, color profile, and EXIF/GPS-free
                derivative verified.
              </div>
              <div className="validation validation-success">
                <Check size={16} />
                One presenter, horizontally centered, direct-to-camera safe area confirmed.
              </div>
              <Button onClick={() => setStep(3)}>
                Confirm framing
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="stack">
              <label className="toggle-row">
                <span>
                  <strong>Image-use rights</strong>
                  <p className="helper">
                    I own, license, or have another documented basis to use this source.
                  </p>
                </span>
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(event) => setRights(event.target.checked)}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Likeness animation consent</strong>
                  <p className="helper">
                    I have the right and consent to animate the depicted likeness.
                  </p>
                </span>
                <input
                  type="checkbox"
                  checked={likeness}
                  onChange={(event) => setLikeness(event.target.checked)}
                />
              </label>
              <div className="notice">
                <strong>Optional compatibility testing is not running.</strong> Saving this ready
                source costs $0 and makes no model call.
              </div>
              <Button busy={busy} disabled={!rights || !likeness} onClick={finish}>
                Approve and add to Avatar Hub
              </Button>
            </div>
          ) : null}
        </Panel>
        <Panel eyebrow="Immutable result" heading="What gets pinned">
          <div className="stack">
            <div className="validation">
              <LockKeyhole size={16} />
              Original checksum and private source asset.
            </div>
            <div className="validation">
              <ShieldCheck size={16} />
              Runtime derivative, thumbnail, preparation and validation versions.
            </div>
            <div className="validation">
              <KeyRound size={16} />
              Authenticated rights and likeness attestations.
            </div>
            <div className="validation">
              <CloudCog size={16} />
              Compatibility state is explicit; no hidden model test.
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function StylesHubScreen() {
  const scenario = currentScenario();
  const query = useQuery({ queryKey: ["styles", scenario], queryFn: () => api.styles(scenario) });
  const local = readLocalEntities<ImageStyle>("videoforge:fixture:styles:v1");
  const styles = [...(query.data ?? []), ...local].filter(
    (item, index, list) =>
      list.findIndex((candidate) => candidate.versionId === item.versionId) === index,
  );
  return (
    <>
      <PageHeader
        eyebrow="Reusable visual direction"
        title="Image Styles Hub"
        description="Analyze references once, review the extracted visual traits, publish an immutable version, and reuse it without per-video vision calls."
        actions={
          <Link
            className="button button-primary"
            to="/styles/new"
            search={{ fixture: scenario } as never}
          >
            <ImagePlus size={16} />
            New style
          </Link>
        }
      />
      <div className="notice">
        <strong>Built-in default.</strong> Authentic Documentary Stock is seeded locally, immutable,
        non-deletable, and never sends private planning references to a model.
      </div>
      <Panel
        eyebrow="Workspace library"
        heading={`${styles.length} published or draft style${styles.length === 1 ? "" : "s"}`}
      >
        <div className="card-grid">
          {styles.map((style) => (
            <article className="entity-card" key={style.versionId}>
              <div
                className="style-cover"
                style={
                  {
                    "--cover-a": style.palette[0],
                    "--cover-b": style.palette[1],
                  } as React.CSSProperties
                }
              />
              <div className="cluster">
                <h3>{style.name}</h3>
                {style.isDefault ? <Badge tone="info">DEFAULT</Badge> : null}
              </div>
              <p>{style.summary}</p>
              <div className="entity-card-footer">
                <div className="cluster">
                  <Badge tone={statusTone(style.status)}>{style.status}</Badge>
                  <span className="helper">
                    v{style.version} · {style.referenceCount} refs
                  </span>
                </div>
                <Button variant="ghost">
                  <MoreHorizontal size={17} aria-label={`Manage ${style.name}`} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </>
  );
}

export function NewStyleScreen() {
  const scenario = currentScenario();
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo") || "/styles";
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [rights, setRights] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [busy, setBusy] = useState(false);

  function publish() {
    setBusy(true);
    window.setTimeout(() => {
      const versionId = `style_version_${crypto.randomUUID()}`;
      const next: ImageStyle = {
        id: `style_${crypto.randomUUID()}`,
        versionId,
        name: name.trim(),
        summary:
          "Natural light, restrained contrast, material texture, and documentary camera language.",
        version: 1,
        status: "PUBLISHED",
        referenceCount: files.length,
        palette: ["#1f3b45", "#b6805e"],
      };
      localStorage.setItem(
        "videoforge:fixture:styles:v1",
        JSON.stringify([...readLocalEntities<ImageStyle>("videoforge:fixture:styles:v1"), next]),
      );
      updateDraft({ imageStyleVersionId: versionId });
      window.location.assign(fixtureLink(returnTo));
    }, 650);
  }

  return (
    <>
      <PageHeader
        eyebrow={`New style · step ${step} of 4`}
        title="Extract style, not reference content."
        description="References teach reusable medium, light, color, framing, texture, and imperfection. People, logos, objects, and exact compositions are never reusable requirements."
        actions={
          <Link
            className="button button-ghost"
            to="/styles"
            search={{ fixture: scenario } as never}
          >
            Cancel
          </Link>
        }
      />
      <div className="layout-main">
        <Panel
          eyebrow="Version workflow"
          heading={
            step === 1
              ? "Upload references"
              : step === 2
                ? "Consent and analyze"
                : step === 3
                  ? "Review extracted traits"
                  : "Publish immutable version"
          }
        >
          {step === 1 ? (
            <div className="stack">
              <div className="field">
                <label htmlFor="style-name">Style name</label>
                <input
                  id="style-name"
                  className="input"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Warm field documentary"
                />
              </div>
              <label className="dropzone">
                <input
                  aria-label="Upload style references"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) =>
                    setFiles(
                      Array.from(event.target.files ?? [])
                        .map((file) => file.name)
                        .slice(0, 8),
                    )
                  }
                />
                <Images size={28} />
                <span>
                  <strong>
                    {files.length
                      ? `${files.length} private reference${files.length === 1 ? "" : "s"} selected`
                      : "Choose 3–8 visual references"}
                  </strong>
                  Normalized sRGB copies strip EXIF/GPS before analysis
                </span>
              </label>
              <Button disabled={!name.trim() || files.length < 3} onClick={() => setStep(2)}>
                Continue
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="stack">
              <label className="toggle-row">
                <span>
                  <strong>Reference rights attestation</strong>
                  <p className="helper">
                    I have a documented right to use these images for style analysis.
                  </p>
                </span>
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(event) => setRights(event.target.checked)}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Runware processing disclosure</strong>
                  <p className="helper">
                    Normalized copies go to Runware; standard processing is not zero-data-retention
                    or confidential.
                  </p>
                </span>
                <input
                  type="checkbox"
                  checked={disclosure}
                  onChange={(event) => setDisclosure(event.target.checked)}
                />
              </label>
              <div className="notice notice-warning">
                <strong>Fixture checkpoint.</strong> Analyze simulates the one-time call and records
                $0. No Runware request is made.
              </div>
              <Button disabled={!rights || !disclosure} onClick={() => setStep(3)}>
                Analyze fixture references
              </Button>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="stack">
              <div className="grid grid-2">
                <div className="metric">
                  <span>Medium</span>
                  <strong>Documentary still</strong>
                  <small>Supported by ref_01, ref_03</small>
                </div>
                <div className="metric">
                  <span>Lighting</span>
                  <strong>Natural soft side light</strong>
                  <small>High confidence · 0.91</small>
                </div>
                <div className="metric">
                  <span>Color</span>
                  <strong>Warm earth + muted cyan</strong>
                  <small>One outlier excluded</small>
                </div>
                <div className="metric">
                  <span>Texture</span>
                  <strong>Material detail</strong>
                  <small>Restrained digital sharpness</small>
                </div>
              </div>
              <div className="validation validation-success">
                <Check size={16} />
                People, logos, visible instructions, and exact subjects were not converted into
                prompt requirements.
              </div>
              <Button onClick={() => setStep(4)}>Accept reviewed profile</Button>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="stack">
              <div
                className="style-cover"
                style={{ "--cover-a": "#1f3b45", "--cover-b": "#b6805e" } as React.CSSProperties}
              />
              <div className="validation validation-success">
                <ShieldCheck size={16} />
                Publishing creates immutable style profile v1 and atomically activates it.
              </div>
              <div className="notice">
                <strong>No automatic test.</strong> A separate optional Mage preview would require
                an explicit estimate and authorization.
              </div>
              <Button busy={busy} onClick={publish}>
                Publish style v1
              </Button>
            </div>
          ) : null}
        </Panel>
        <Panel eyebrow="Ordinary project rule" heading="Analyze once">
          <p className="helper">
            Once published, projects pin the style version and profile hash. Video generation reuses
            text guidance and performs zero Gemini style-analysis calls.
          </p>
          <div className="divider" />
          <div className="validation">
            <CircleDollarSign size={16} />
            One-time analysis cost stays separate from project spend.
          </div>
        </Panel>
      </div>
    </>
  );
}

export function LibraryScreen() {
  const scenario = currentScenario();
  return (
    <>
      <PageHeader
        eyebrow="Approved outputs"
        title="Library"
        description="Preview, download, inspect provenance, archive, and understand retention for finished productions."
      />
      <div className="card-grid">
        <Panel eyebrow="Approved today" heading="Why the everyday world is changing">
          <CompositionPreview type="AVATAR_SPLIT_IMAGE" />
          <div className="entity-card-footer">
            <Badge tone="success">APPROVED</Badge>
            <div className="cluster">
              <Link
                className="button button-secondary"
                to="/projects/$projectId/review"
                params={{ projectId: "project_fixture_001" }}
                search={{ fixture: scenario } as never}
              >
                <Play size={15} />
                Review
              </Link>
              <Button variant="secondary">
                <Download size={15} />
                Download
              </Button>
            </div>
          </div>
        </Panel>
        <Panel eyebrow="Retention" heading="30 days remaining">
          <p className="helper">
            Final render and production manifest are retained together. Archive or delete is always
            explicit.
          </p>
        </Panel>
        <Panel eyebrow="Provenance" heading="Manifest bound">
          <p className="helper">
            Revision, timeline, prompts, attempts, QA, cost, avatar/style versions, and MP4
            checksum.
          </p>
        </Panel>
      </div>
    </>
  );
}

export function UsageScreen() {
  const scenario = currentScenario();
  const query = useQuery({ queryKey: ["usage", scenario], queryFn: () => api.usage(scenario) });
  const usage = query.data ?? {
    currentMonth: 0.78,
    projectSpend: 0.72,
    styleSpend: 0.06,
    avatarTestSpend: 0,
    storageGb: 0.84,
    gpuSeconds: 0,
    retries: 1,
  };
  return (
    <>
      <PageHeader
        eyebrow="Truthful economics"
        title="Usage and cost"
        description="Project generation, one-time style analysis, optional avatar tests, storage, cold starts, and retries remain separate."
      />
      <div className="grid grid-4">
        <Metric
          label="Current month"
          value={`$${usage.currentMonth.toFixed(2)}`}
          detail="all recorded owners"
          tone="success"
        />
        <Metric
          label="Video projects"
          value={`$${usage.projectSpend.toFixed(2)}`}
          detail="revision-owned events"
        />
        <Metric
          label="Style analysis"
          value={`$${usage.styleSpend.toFixed(2)}`}
          detail="version-owned, one time"
        />
        <Metric
          label="Avatar tests"
          value={`$${usage.avatarTestSpend.toFixed(2)}`}
          detail="explicit only"
        />
      </div>
      <div className="grid grid-3">
        <Panel eyebrow="GPU" heading={`${usage.gpuSeconds} billed seconds`}>
          <p className="helper">
            Fixture mode makes no GPU calls. Model and queue timings remain visibly distinct.
          </p>
        </Panel>
        <Panel eyebrow="Storage" heading={`${usage.storageGb.toFixed(2)} GB`}>
          <p className="helper">Private artifact retention is explicit; no silent deletion.</p>
        </Panel>
        <Panel eyebrow="Retries" heading={`${usage.retries} item-level retry`}>
          <p className="helper">
            Original attempt, reason, charge, and accepted replacement remain traceable.
          </p>
        </Panel>
      </div>
    </>
  );
}

export function SettingsScreen() {
  return (
    <>
      <PageHeader
        eyebrow="Workspace administration"
        title="Settings"
        description="Control invited members, credential status, tested execution profiles, storage, scheduler bounds, and budgets—without exposing secret values."
      />
      <div className="grid grid-2">
        <Panel eyebrow="Access" heading="Invite-only Google accounts">
          <div className="validation validation-success">
            <ShieldCheck size={16} />
            Lakshman · Admin · access granted
          </div>
          <div className="validation">
            <UsersRound size={16} />
            5–10 invited teammates · public signup disabled
          </div>
          <Button variant="secondary">
            <UserPlus size={15} />
            Manage allowlist
          </Button>
        </Panel>
        <Panel eyebrow="Credentials" heading="Server-only status">
          <div className="validation">
            <KeyRound size={16} />
            RunPod · not configured in fixture mode
          </div>
          <div className="validation">
            <KeyRound size={16} />
            Runware · not configured in fixture mode
          </div>
          <p className="helper">
            Values never appear in this page, logs, fixtures, or browser bundles.
          </p>
        </Panel>
        <Panel eyebrow="Execution" heading="Fixture profile v1">
          <div className="validation validation-success">
            <CloudCog size={16} />
            Endpoint: none · GPU priorities: none · maximum rate: $0
          </div>
          <p className="helper">
            Production exposes only immutable tested profiles, never raw per-job endpoint mutation.
          </p>
        </Panel>
        <Panel eyebrow="Defaults" heading="Documentary Stock v1">
          <div className="validation">
            <Gauge size={16} />
            Balanced mode · $1.50 suggested cap · $2 hard contract ceiling
          </div>
          <div className="validation">
            <Sparkles size={16} />
            scheduler-v1 · deterministic bounded variation
          </div>
        </Panel>
      </div>
    </>
  );
}
