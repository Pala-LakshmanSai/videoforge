import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileAudio,
  FileJson,
  ImagePlus,
  Images,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserPlus,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { CompositionPreview } from "../components/CompositionPreview";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  Button,
  DetailsSheet,
  Disclosure,
  EmptyState,
  Metric,
  Panel,
  ProgressBar,
  ProgressRing,
  StageTimeline,
} from "../components/ui";
import { api } from "../lib/api";
import { loadDraft, saveDraft, updateDraft, type ProjectDraft } from "../lib/draft";
import { currentScenario, withScenario } from "../lib/scenario";
import type {
  AvatarProfile,
  ImageStyle,
  ProjectStage,
  ProjectSummary,
  ScenarioId,
  Tone,
} from "../lib/types";

function statusTone(status: string): Tone {
  if (["COMPLETE", "APPROVED", "PASSED", "PUBLISHED", "READY"].includes(status)) return "success";
  if (["FAILED", "INVALID"].includes(status)) return "danger";
  if (["BLOCKED", "NEEDS_ATTENTION", "CANCELLED", "STALE", "NEEDS_REVIEW"].includes(status))
    return "warning";
  if (["RUNNING", "STARTING", "ANALYZING", "VALIDATING", "READY_FOR_REVIEW"].includes(status))
    return "info";
  return "neutral";
}

function formatShortDate(value: string): string {
  if (value === "Never") return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(
    parsed,
  );
}

function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAvatarProfile(value: unknown): value is AvatarProfile {
  if (!isRecord(value)) return false;
  return (
    [
      "id",
      "versionId",
      "name",
      "initials",
      "dimensions",
      "lastUsed",
      "thumbnailUrl",
      "profileHash",
      "preparationProfile",
      "validationProfile",
    ].every((field) => typeof value[field] === "string") &&
    typeof value.version === "number" &&
    ["READY", "VALIDATING", "NEEDS_REVIEW", "FAILED", "ARCHIVED"].includes(String(value.status)) &&
    ["UNTESTED", "RUNNING", "PASSED", "FAILED", "STALE", "CANCELLED"].includes(
      String(value.compatibility),
    ) &&
    value.rightsStatus === "ATTESTED"
  );
}

function isImageStyle(value: unknown): value is ImageStyle {
  if (!isRecord(value)) return false;
  return (
    [
      "id",
      "versionId",
      "name",
      "summary",
      "coverUrl",
      "profileHash",
      "medium",
      "lighting",
      "color",
      "texture",
      "retentionSummary",
    ].every((field) => typeof value[field] === "string") &&
    typeof value.version === "number" &&
    typeof value.referenceCount === "number" &&
    ["PUBLISHED", "ANALYZING", "NEEDS_REVIEW", "FAILED", "ARCHIVED"].includes(
      String(value.status),
    ) &&
    Array.isArray(value.palette) &&
    value.palette.length === 2 &&
    value.palette.every((item) => typeof item === "string") &&
    isStringArray(value.referenceUrls) &&
    isStringArray(value.exampleUrls) &&
    ["ATTESTED", "SYSTEM_OWNED"].includes(String(value.rightsStatus))
  );
}

function readLocalEntities<T>(key: string, isValid: (value: unknown) => value is T): T[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

function fixtureLink(path: string) {
  return withScenario(path, currentScenario());
}

function PresetGallery({
  style,
  urls,
  kind,
}: {
  style: ImageStyle;
  urls: string[];
  kind: "reference" | "owned example";
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = selected === null ? null : urls[selected];

  function closeLightbox() {
    const returnIndex = selected;
    setSelected(null);
    window.requestAnimationFrame(() => {
      if (returnIndex !== null) tileRefs.current[returnIndex]?.focus();
    });
  }

  function move(direction: -1 | 1) {
    setSelected((index) =>
      index === null ? null : (index + direction + urls.length) % urls.length,
    );
  }

  return (
    <>
      <div className="reference-mosaic">
        {urls.map((url, index) => (
          <button
            className="reference-tile"
            type="button"
            key={url}
            ref={(element) => {
              tileRefs.current[index] = element;
            }}
            onClick={() => setSelected(index)}
            aria-label={`Open ${style.name} ${kind} ${index + 1}`}
          >
            <figure>
              <img src={url} alt={`${style.name} ${kind} ${index + 1}`} />
              <figcaption>
                {kind === "reference"
                  ? `ref_${String(index + 1).padStart(2, "0")}`
                  : `example_${String(index + 1).padStart(2, "0")}`}
              </figcaption>
            </figure>
          </button>
        ))}
      </div>
      <Dialog.Root open={selected !== null} onOpenChange={(open) => !open && closeLightbox()}>
        <Dialog.Portal>
          <Dialog.Overlay className="lightbox-overlay" />
          <Dialog.Content
            className="reference-lightbox"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") move(-1);
              if (event.key === "ArrowRight") move(1);
            }}
          >
            <Dialog.Title className="sr-only">
              {style.name} {kind} preview
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Use the previous and next buttons or arrow keys to inspect this gallery.
            </Dialog.Description>
            {current ? <img src={current} alt={`${style.name} ${kind} enlarged`} /> : null}
            <div className="reference-lightbox-meta">
              <div>
                <strong>
                  {kind === "reference" ? "Reference" : "Owned example"} {Number(selected) + 1}
                </strong>
                <span>
                  Published v{style.version} · {style.rightsStatus}
                </span>
              </div>
              <span>
                {style.medium} · {style.lighting}
              </span>
            </div>
            {urls.length > 1 ? (
              <div className="lightbox-navigation">
                <button type="button" onClick={() => move(-1)} aria-label="Previous image">
                  <ArrowLeft size={22} />
                </button>
                <span>
                  {Number(selected) + 1} / {urls.length}
                </span>
                <button type="button" onClick={() => move(1)} aria-label="Next image">
                  <ArrowRight size={22} />
                </button>
              </div>
            ) : null}
            <Dialog.Close className="sheet-close lightbox-close" aria-label="Close image preview">
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
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
        eyebrow="Production"
        title="Your queue"
        description={`${running} active · ${attention} need attention · ${complete} ready`}
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
      <div className="grid grid-4 queue-overview">
        <Metric label="Active" value={String(running)} detail="running now" tone="info" />
        <Metric
          label="Queued"
          value={String(projects.filter((project) => project.status === "QUEUED").length)}
          detail="waiting"
        />
        <Metric
          label="Needs attention"
          value={String(attention)}
          detail="needs action"
          tone={attention ? "warning" : "success"}
        />
        <Metric label="Ready" value={String(complete)} detail="review or download" tone="success" />
      </div>
      <Panel
        className="queue-panel"
        eyebrow="Workspace"
        heading="Projects"
        action={
          <Badge tone={query.isError ? "danger" : "success"}>
            {query.isError ? "Offline" : "Live"}
          </Badge>
        }
      >
        {query.isPending ? (
          <div className="empty-state">
            <span className="spinner" />
            <p>Loading queue…</p>
          </div>
        ) : null}
        {!query.isPending && projects.length === 0 ? (
          <EmptyState
            icon={<Video />}
            title="Queue is clear"
            body="Start a new video when you are ready."
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
          <div className="queue-list">
            {projects.map((project) => {
              const percent = project.total
                ? Math.round((project.completed / project.total) * 100)
                : 0;
              return (
                <Link
                  className="queue-card"
                  key={project.id}
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  search={{ fixture: scenario } as never}
                >
                  <div className="queue-card__identity">
                    <span className="project-icon">
                      <Video size={18} />
                    </span>
                    <div>
                      <strong>{project.title}</strong>
                      <small>
                        {project.owner} · {project.mode.replaceAll("_", " ")}
                      </small>
                    </div>
                  </div>
                  <div className="queue-card__status">
                    <Badge tone={statusTone(project.status)}>
                      {project.status.replaceAll("_", " ")}
                    </Badge>
                    <span>{humanize(project.stage)}</span>
                  </div>
                  <div className="queue-card__progress">
                    <strong>{percent}%</strong>
                    <ProgressBar value={percent} label={`${project.title} progress`} />
                  </div>
                  <div className="queue-card__facts">
                    <span>
                      <small>ETA</small>
                      <strong>{project.eta}</strong>
                    </span>
                    <span>
                      <small>Cost</small>
                      <strong>${project.actualCost.toFixed(2)}</strong>
                    </span>
                    <ArrowRight size={20} aria-hidden="true" />
                  </div>
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
  const localAvatars = readLocalEntities("videoforge:fixture:avatars:v1", isAvatarProfile);
  const localStyles = readLocalEntities("videoforge:fixture:styles:v1", isImageStyle);
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
  const selectedAvatar = readyAvatars.find(
    (avatar) => avatar.versionId === draft.avatarProfileVersionId,
  );
  const selectedStyle = publishedStyles.find(
    (style) => style.versionId === draft.imageStyleVersionId,
  );

  const conflict =
    draft.applyExtraPromptKeywords &&
    /\b(add|include|show|write)\b.{0,30}\b(logo|caption|title|watermark|text)\b/i.test(
      draft.extraPromptKeywords,
    );
  const keywordEmpty = draft.applyExtraPromptKeywords && !draft.extraPromptKeywords.trim();
  const canSubmit = Boolean(
    draft.title.trim() &&
      draft.voiceoverAssetId &&
      selectedAvatar &&
      selectedStyle &&
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
      return api.mutate<{ id: string; status: string; nextFixture?: ScenarioId }>(
        "/api/v1/projects",
        payload,
        scenario,
        `${mutationId}:create`,
      );
    },
    onSuccess: (result) =>
      window.location.assign(
        withScenario(
          `/projects/${result.id || "project_fixture_001"}`,
          result.nextFixture ?? scenario,
        ),
      ),
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
      <PageHeader eyebrow="Production" title="New project" />
      <div className="layout-main">
        <Panel eyebrow="Project setup" heading="Narration and look">
          <div className="form-grid">
            <h3 className="form-section-title field-wide">Narration</h3>
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
              <small>{draft.title.trim().length}/240</small>
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
                  {draft.voiceoverAssetId ? "Ready" : "WAV, MP3, M4A/AAC, or FLAC"}
                </span>
              </label>
              {audioError ? (
                <div className="validation validation-danger">
                  <AlertTriangle size={16} />
                  {audioError}
                </div>
              ) : null}
            </div>
            <h3 className="form-section-title field-wide">Look</h3>
            <div className="field preset-field">
              <span className="field-label">Avatar Profile</span>
              <div className="preset-picker" role="radiogroup" aria-label="Avatar Profile">
                {readyAvatars.map((avatar) => {
                  const checked = avatar.versionId === draft.avatarProfileVersionId;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      className={`preset-choice ${checked ? "selected" : ""}`}
                      key={avatar.versionId}
                      onClick={() =>
                        setDraft((value) => ({
                          ...value,
                          avatarProfileVersionId: avatar.versionId,
                        }))
                      }
                    >
                      <img
                        src={avatar.thumbnailUrl || "/fixtures/avatar/amish-farm-host.svg"}
                        alt={`${avatar.name} avatar`}
                      />
                      <span>
                        <strong>{avatar.name}</strong>
                        <small>
                          v{avatar.version} · {avatar.compatibility.toLowerCase()}
                        </small>
                      </span>
                      {checked ? <Check size={20} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
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
            <div className="field preset-field">
              <span className="field-label">Image Style</span>
              <div className="preset-picker" role="radiogroup" aria-label="Image Style">
                {publishedStyles.map((style) => {
                  const checked = style.versionId === draft.imageStyleVersionId;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      className={`preset-choice preset-choice-style ${checked ? "selected" : ""}`}
                      key={style.versionId}
                      onClick={() =>
                        setDraft((value) => ({ ...value, imageStyleVersionId: style.versionId }))
                      }
                    >
                      <img src={style.coverUrl} alt={`${style.name} style`} />
                      <span>
                        <strong>{style.name}</strong>
                        <small>
                          v{style.version}
                          {style.isDefault ? " · default" : ""}
                        </small>
                      </span>
                      {checked ? <Check size={20} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
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
            <Disclosure
              className="field field-wide create-options"
              summary={
                <>
                  <span>Script and image keywords</span>
                  <small>
                    {draft.applyExtraPromptKeywords ? "Keywords on" : "Keywords not applied"}
                  </small>
                </>
              }
            >
              <div className="stack">
                <div className="toggle-row">
                  <strong>Apply extra keywords to AI images</strong>
                  <Switch.Root
                    className="switch-root"
                    checked={draft.applyExtraPromptKeywords}
                    onCheckedChange={(checked) =>
                      setDraft((value) => ({ ...value, applyExtraPromptKeywords: checked }))
                    }
                    aria-label="Apply extra image prompt keywords"
                  >
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </div>
                <div className="field">
                  <label htmlFor="image-keywords">Image keywords</label>
                  <textarea
                    id="image-keywords"
                    className="textarea"
                    maxLength={500}
                    value={draft.extraPromptKeywords}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, extraPromptKeywords: event.target.value }))
                    }
                  />
                </div>
                {!draft.applyExtraPromptKeywords ? (
                  <div className="validation">
                    <PauseCircle size={16} />
                    Not applied
                  </div>
                ) : keywordEmpty ? (
                  <div className="validation validation-danger">
                    <X size={16} />
                    Add keywords or turn the toggle off.
                  </div>
                ) : conflict ? (
                  <div className="validation validation-danger">
                    <X size={16} />
                    Visible text, captions, logos, and watermarks are not allowed.
                  </div>
                ) : (
                  <div className="validation validation-success">
                    <Check size={16} />
                    Keywords will be applied
                  </div>
                )}
                <div className="field">
                  <label htmlFor="exact-script">Exact script (optional)</label>
                  <textarea
                    id="exact-script"
                    className="textarea"
                    value={draft.optionalScript}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, optionalScript: event.target.value }))
                    }
                  />
                </div>
              </div>
            </Disclosure>
            <h3 className="form-section-title field-wide">Run</h3>
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
          <Panel className="create-run-panel" eyebrow="Run" heading="Ready to generate">
            <div className={`run-readiness ${canSubmit ? "ready" : "blocked"}`} role="status">
              {canSubmit ? <Check size={18} /> : <AlertTriangle size={18} />}
              <strong>
                {canSubmit ? "All required inputs are ready" : "Complete required inputs"}
              </strong>
            </div>
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
              <small>Maximum $2.00 · Fixture spend $0</small>
            </div>
            {submittedError ? (
              <div className="validation validation-danger">
                <AlertTriangle size={16} />
                {submittedError}
              </div>
            ) : null}
            <Button busy={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>
              {create.isPending ? "Creating project…" : "Generate video"}
              <ArrowRight size={16} />
            </Button>
            <Disclosure
              className="run-settings"
              summary={
                <>
                  <span>Review settings</span>
                  <small>Versions, mode, seed</small>
                </>
              }
            >
              <div className="detail-facts">
                <span>
                  <small>Avatar</small>
                  <strong>
                    {selectedAvatar
                      ? `${selectedAvatar.name} · v${selectedAvatar.version}`
                      : "Required"}
                  </strong>
                </span>
                <span>
                  <small>Style</small>
                  <strong>
                    {selectedStyle
                      ? `${selectedStyle.name} · v${selectedStyle.version}`
                      : "Required"}
                  </strong>
                </span>
                <span>
                  <small>Mode</small>
                  <strong>{draft.generationMode.replaceAll("_", " ")}</strong>
                </span>
                <span>
                  <small>Keywords</small>
                  <strong>{draft.applyExtraPromptKeywords ? "Applied" : "Not applied"}</strong>
                </span>
                <span>
                  <small>Seed</small>
                  <strong>{draft.userSeed}</strong>
                </span>
                <span>
                  <small>Provider calls</small>
                  <strong>0 in fixture mode</strong>
                </span>
              </div>
            </Disclosure>
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
    capUsd: 1.5,
    lanes: {
      image: { state: "RUNNING", completed: 13, total: 30, action: "Image 14 compiling" },
      avatar: { state: "RUNNING", completed: 18, total: 22, action: "Clip 19 generating" },
    },
    latestArtifact: {
      kind: "IMAGE",
      url: "/fixtures/media/watermelon-market.svg",
      label: "Latest accepted image",
    },
    reviewState: "NOT_READY",
  };
  const percent = Math.round((project.completed / Math.max(1, project.total)) * 100);
  const message = scenarioMessages[scenario];
  const stages = project.stages ?? defaultStages;
  const currentStageIndex = Math.max(
    0,
    stages.findIndex((stage) =>
      ["RUNNING", "RETRYING", "BLOCKED", "FAILED"].includes(stage.status),
    ),
  );
  const imagePercent = Math.round(
    (project.lanes.image.completed / Math.max(1, project.lanes.image.total)) * 100,
  );
  const avatarPercent = Math.round(
    (project.lanes.avatar.completed / Math.max(1, project.lanes.avatar.total)) * 100,
  );

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
        eyebrow={`${project.status.replaceAll("_", " ")} · REV 001`}
        title={project.title}
        description={`${project.owner} · ${project.mode.replaceAll("_", " ")}`}
        actions={
          <>
            <Button
              variant="secondary"
              busy={action === "retry"}
              onClick={() => perform("retry", `/api/v1/projects/${project.id}/retry`)}
            >
              <RefreshCw size={15} />
              Retry
            </Button>
            <Button
              variant="danger"
              busy={action === "cancel"}
              onClick={() => perform("cancel", `/api/v1/projects/${project.id}/cancel`)}
            >
              <X size={15} />
              Cancel
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
      <section className="progress-hero" aria-label="Project progress">
        <ProgressRing value={percent} label="Project progress" detail="complete" />
        <div className="progress-hero-body">
          <div className="progress-hero-heading">
            <div>
              <p className="eyebrow">Current action</p>
              <h2>{humanize(project.stage)}</h2>
            </div>
            <Badge tone={statusTone(project.status)}>{project.status.replaceAll("_", " ")}</Badge>
          </div>
          <div className="progress-metrics">
            <Metric
              label="Stage"
              value={`${String(currentStageIndex + 1).padStart(2, "0")}/${String(stages.length).padStart(2, "0")}`}
              detail={stages[currentStageIndex]?.label ?? project.stage}
              tone="info"
            />
            <Metric
              label="Status"
              value={query.isError ? "Blocked" : "Running"}
              detail={query.isError ? "API unavailable" : "Lanes connected"}
              tone={query.isError ? "danger" : "success"}
            />
            <Metric label="Estimated" value={project.eta} detail="remaining" />
            <Metric
              label="Cost"
              value={`$${project.actualCost.toFixed(2)}`}
              detail={`$${project.capUsd.toFixed(2)} cap`}
              tone="success"
            />
          </div>
          <ProgressBar value={percent} label="Overall project progress" />
        </div>
      </section>

      <div className="progress-workspace">
        <Panel className="pipeline-panel" eyebrow="Pipeline" heading="Production stages">
          <StageTimeline stages={stages} />
        </Panel>

        <div className="progress-side">
          <Panel className="latest-artifact-panel" eyebrow="Latest" heading="Live preview">
            <div className="latest-artifact-frame">
              {project.latestArtifact?.kind === "IMAGE" ? (
                <img src={project.latestArtifact.url} alt={project.latestArtifact.label} />
              ) : project.latestArtifact?.kind === "VIDEO" ? (
                <div
                  className="video-artifact-placeholder"
                  aria-label={project.latestArtifact.label}
                >
                  <CompositionPreview type="AVATAR_SPLIT_IMAGE" />
                  <Badge tone="success">VIDEO READY</Badge>
                </div>
              ) : (
                <CompositionPreview type="IMAGE_FULL" />
              )}
            </div>
            <div className="artifact-caption">
              <span>{project.latestArtifact?.label ?? "Waiting for first accepted asset"}</span>
              <Badge tone={project.latestArtifact ? "success" : "neutral"}>
                {project.latestArtifact ? "Accepted" : "Waiting"}
              </Badge>
            </div>
          </Panel>

          <Panel className="lane-panel" eyebrow="Parallel work" heading="Media lanes">
            <div className="lane-list">
              <div className="lane-row">
                <div>
                  <span>Images</span>
                  <strong>
                    {project.lanes.image.completed} / {project.lanes.image.total}
                  </strong>
                </div>
                <ProgressBar value={imagePercent} label="Image lane progress" />
                <small>{project.lanes.image.action}</small>
              </div>
              <div className="lane-row">
                <div>
                  <span>Avatar</span>
                  <strong>
                    {project.lanes.avatar.completed} / {project.lanes.avatar.total}
                  </strong>
                </div>
                <ProgressBar value={avatarPercent} label="Avatar lane progress" />
                <small>{project.lanes.avatar.action}</small>
              </div>
            </div>
          </Panel>

          <Disclosure
            className="project-details"
            summary={
              <>
                <span>Project details</span>
                <small>Inputs, activity, and provenance</small>
              </>
            }
          >
            <div className="detail-facts">
              <span>
                <small>Avatar</small>
                <strong>Amish Farm Host · v1</strong>
              </span>
              <span>
                <small>Image style</small>
                <strong>Authentic Documentary Stock · v1</strong>
              </span>
              <span>
                <small>Estimate</small>
                <strong>${project.estimatedCost.toFixed(2)}</strong>
              </span>
              <span>
                <small>Revision</small>
                <strong>rev_fixture_001</strong>
              </span>
            </div>
            <div className="activity-list">
              {(query.data?.events ?? []).map((event) => (
                <div className="timeline-event" key={event.id}>
                  <span>{event.at}</span>
                  <i />
                  <strong>{event.detail}</strong>
                </div>
              ))}
            </div>
          </Disclosure>

          <Link
            className="button button-primary progress-review-action"
            to="/projects/$projectId/review"
            params={{ projectId }}
            search={{ fixture: scenario } as never}
          >
            Review output
            <ArrowRight size={18} />
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
            ? "Regeneration queued for this segment. Next check in 10 seconds."
            : "Issue saved. The accepted candidate is unchanged.",
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
        eyebrow={approved ? "Approved" : "Candidate v3"}
        title="Review"
        description={approved ? "Final output locked" : "Ready for review"}
        actions={
          <>
            <Link
              className="button button-secondary"
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ fixture: scenario } as never}
            >
              Progress
            </Link>
            <Button busy={busy === "approve"} disabled={approved} onClick={() => act("approve")}>
              <ShieldCheck size={16} />
              {approved ? "Approved" : "Approve final"}
            </Button>
          </>
        }
      />
      {approvalError || busy === "approve" || approved ? (
        <div
          className={`notice ${approvalError ? "notice-danger" : ""}`}
          role="status"
          aria-live="polite"
        >
          <strong>
            {approvalError
              ? "Approval blocked."
              : busy === "approve"
                ? "Approving…"
                : "Approval recorded."}
          </strong>{" "}
          {approvalError ??
            (busy === "approve"
              ? "Candidate and checksum are being verified."
              : "Downloads are ready.")}
        </div>
      ) : null}
      {reviewActionNotice ? (
        <div className="notice" role="status" aria-live="polite">
          {reviewActionNotice}
        </div>
      ) : null}
      <Panel className="review-player" eyebrow="Final output" heading="Preview">
        <div className="review-player-frame">
          <CompositionPreview type={sameClipMode} />
        </div>
        <div className="review-player-meta">
          <span>01:34 · 1920×1080 · 30 fps</span>
          <Badge tone={approved ? "success" : "warning"}>
            {approved ? "Approved" : "Review needed"}
          </Badge>
        </div>
      </Panel>
      <Panel
        className="review-segments"
        eyebrow="Review strip"
        heading="Segments"
        action={
          <div className="cluster">
            <Button
              variant={sameClipMode === "AVATAR_FULL" ? "primary" : "secondary"}
              onClick={() => setSameClipMode("AVATAR_FULL")}
            >
              Full
            </Button>
            <Button
              variant={sameClipMode === "AVATAR_SPLIT_IMAGE" ? "primary" : "secondary"}
              onClick={() => setSameClipMode("AVATAR_SPLIT_IMAGE")}
            >
              Split
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
                    Flag issue
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <div className="review-footer">
        <Disclosure
          className="project-details"
          summary={
            <>
              <span>Technical details</span>
              <small>Output, layouts, and provenance</small>
            </>
          }
        >
          <div className="detail-facts">
            <span>
              <small>Output</small>
              <strong>H.264/AAC · 1080p30</strong>
            </span>
            <span>
              <small>Layouts</small>
              <strong>Full avatar · Full image · Split</strong>
            </span>
            <span>
              <small>Transitions</small>
              <strong>Hard cuts</strong>
            </span>
            <span>
              <small>Candidate</small>
              <strong>review_candidate_fixture_v3</strong>
            </span>
          </div>
        </Disclosure>
        {approved ? (
          <div className="download-actions">
            <a
              className="button button-secondary"
              href="/fixtures/media/watermelon-market.svg"
              download="videoforge-fixture-preview.svg"
            >
              <Download size={18} />
              Fixture preview
            </a>
            <a
              className="button button-secondary"
              href={`/api/v1/projects/${projectId}?fixture=${scenario}`}
              download="videoforge-fixture-manifest.json"
            >
              <FileJson size={18} />
              Manifest
            </a>
          </div>
        ) : (
          <span className="review-download-status">Approve to download</span>
        )}
      </div>
    </>
  );
}

export function AvatarHubScreen() {
  const scenario = currentScenario();
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["avatars", scenario], queryFn: () => api.avatars(scenario) });
  const local = readLocalEntities("videoforge:fixture:avatars:v1", isAvatarProfile);
  const avatars = [...(query.data ?? []), ...local].filter(
    (item, index, list) =>
      list.findIndex((candidate) => candidate.versionId === item.versionId) === index,
  );
  const visibleAvatars = avatars.filter((avatar) =>
    avatar.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="Presets"
        title="Avatar Hub"
        description={`${avatars.length} reusable presenter${avatars.length === 1 ? "" : "s"}`}
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
      <div className="hub-toolbar">
        <label className="search-field">
          <span className="sr-only">Search avatars</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search avatars"
          />
        </label>
        <Badge tone="success">Private workspace</Badge>
      </div>
      <Panel
        className="hub-panel"
        eyebrow="Workspace profiles"
        heading={`${visibleAvatars.length} avatar${visibleAvatars.length === 1 ? "" : "s"}`}
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
          <div className="card-grid avatar-card-grid">
            {visibleAvatars.map((avatar) => (
              <article className="entity-card avatar-card" key={avatar.versionId}>
                <div className="avatar-card-media">
                  <img
                    src={avatar.thumbnailUrl || "/fixtures/avatar/amish-farm-host.svg"}
                    alt={`${avatar.name} presenter`}
                  />
                  <Badge tone={statusTone(avatar.status)}>{avatar.status}</Badge>
                </div>
                <div className="entity-card-body">
                  <div className="entity-title-row">
                    <div>
                      <h3>{avatar.name}</h3>
                      <span>Active v{avatar.version}</span>
                    </div>
                    <Badge tone={statusTone(avatar.compatibility)}>{avatar.compatibility}</Badge>
                  </div>
                  <p>Last used {formatShortDate(avatar.lastUsed)}</p>
                </div>
                <DetailsSheet
                  title={avatar.name}
                  description={`Active v${avatar.version} · ${avatar.compatibility.toLowerCase()}`}
                  trigger={
                    <button className="entity-details-trigger" type="button">
                      <span>
                        <strong>Details</strong>
                        <small>Source, compatibility, rights</small>
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  }
                >
                  <div className="avatar-crop-grid">
                    <figure>
                      <img
                        src={avatar.thumbnailUrl || "/fixtures/avatar/amish-farm-host.svg"}
                        alt="Full avatar crop"
                      />
                      <figcaption>Full frame</figcaption>
                    </figure>
                    <figure className="split-crop">
                      <img
                        src={avatar.thumbnailUrl || "/fixtures/avatar/amish-farm-host.svg"}
                        alt="Split avatar crop"
                      />
                      <figcaption>Split crop</figcaption>
                    </figure>
                  </div>
                  <div className="detail-facts">
                    <span>
                      <small>Source</small>
                      <strong>{avatar.dimensions}</strong>
                    </span>
                    <span>
                      <small>Compatibility</small>
                      <strong>{avatar.compatibility}</strong>
                    </span>
                    <span>
                      <small>Rights</small>
                      <strong>{avatar.rightsStatus ?? "ATTESTED"}</strong>
                    </span>
                    <span>
                      <small>Preparation</small>
                      <strong>{avatar.preparationProfile ?? "avatar-source-prep-v1"}</strong>
                    </span>
                    <span>
                      <small>Validation</small>
                      <strong>{avatar.validationProfile ?? "avatar-source-validation-v1"}</strong>
                    </span>
                    <span>
                      <small>Version ID</small>
                      <strong>{avatar.versionId}</strong>
                    </span>
                    <span className="detail-fact-wide">
                      <small>Profile hash</small>
                      <strong>{avatar.profileHash ?? "sha256:fixture-local-avatar-profile"}</strong>
                    </span>
                  </div>
                </DetailsSheet>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

export function NewAvatarScreen() {
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
        thumbnailUrl: "/fixtures/avatar/amish-farm-host.svg",
        profileHash: "sha256:fixture-local-avatar-profile",
        preparationProfile: "avatar-source-prep-v1",
        validationProfile: "avatar-source-validation-v1",
        rightsStatus: "ATTESTED",
      };
      localStorage.setItem(
        "videoforge:fixture:avatars:v1",
        JSON.stringify([
          ...readLocalEntities("videoforge:fixture:avatars:v1", isAvatarProfile),
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
        title="New avatar"
        actions={
          <a className="button button-ghost" href={fixtureLink(returnTo)}>
            Cancel
          </a>
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
        <Disclosure
          className="onboarding-details"
          summary={
            <>
              <span>What gets stored</span>
              <small>Private source and provenance</small>
            </>
          }
        >
          <div className="detail-facts">
            <span>
              <small>Source</small>
              <strong>Private original + checksum</strong>
            </span>
            <span>
              <small>Runtime</small>
              <strong>Prepared derivative + thumbnail</strong>
            </span>
            <span>
              <small>Consent</small>
              <strong>Rights + likeness attestations</strong>
            </span>
            <span>
              <small>Compatibility</small>
              <strong>Explicit state and evidence</strong>
            </span>
          </div>
        </Disclosure>
      </div>
    </>
  );
}

export function StylesHubScreen() {
  const scenario = currentScenario();
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["styles", scenario], queryFn: () => api.styles(scenario) });
  const local = readLocalEntities("videoforge:fixture:styles:v1", isImageStyle);
  const styles = [...(query.data ?? []), ...local].filter(
    (item, index, list) =>
      list.findIndex((candidate) => candidate.versionId === item.versionId) === index,
  );
  const visibleStyles = styles.filter((style) =>
    style.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="Presets"
        title="Image Styles"
        description={`${styles.length} reusable visual direction${styles.length === 1 ? "" : "s"}`}
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
      <div className="hub-toolbar">
        <label className="search-field">
          <span className="sr-only">Search image styles</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search styles"
          />
        </label>
        <Badge tone="info">Default pinned</Badge>
      </div>
      <Panel
        className="hub-panel"
        eyebrow="Workspace library"
        heading={`${visibleStyles.length} style${visibleStyles.length === 1 ? "" : "s"}`}
      >
        <div className="card-grid style-card-grid">
          {visibleStyles.map((style) => {
            const references = style.referenceUrls ?? [];
            const examples = style.exampleUrls ?? [];
            const gallery = references.length ? references : examples;
            const galleryLabel = references.length ? "References" : "Owned examples";
            return (
              <article className="entity-card style-card" key={style.versionId}>
                <div className="style-card-media">
                  <img
                    src={style.coverUrl || "/fixtures/styles/warm-rural.svg"}
                    alt={`${style.name} cover`}
                  />
                  <div className="style-card-badges">
                    {style.isDefault ? <Badge tone="info">DEFAULT</Badge> : null}
                    <Badge tone={statusTone(style.status)}>{style.status}</Badge>
                  </div>
                </div>
                <div className="entity-card-body">
                  <div className="entity-title-row">
                    <div>
                      <h3>{style.name}</h3>
                      <span>Published v{style.version}</span>
                    </div>
                  </div>
                  <p>{style.summary}</p>
                </div>
                <DetailsSheet
                  title={style.name}
                  description={`Published v${style.version} · ${galleryLabel} ${gallery.length}`}
                  trigger={
                    <button className="entity-details-trigger" type="button">
                      <span>
                        <strong>
                          {galleryLabel} ({gallery.length})
                        </strong>
                        <small>Profile, rights, provenance</small>
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  }
                >
                  <section className="detail-section">
                    <div className="detail-section-heading">
                      <h4>{galleryLabel}</h4>
                      <span>{gallery.length} images</span>
                    </div>
                    <PresetGallery
                      style={style}
                      urls={gallery}
                      kind={references.length ? "reference" : "owned example"}
                    />
                  </section>
                  <section className="detail-section">
                    <div className="detail-section-heading">
                      <h4>Visual profile</h4>
                    </div>
                    <div className="detail-facts">
                      <span>
                        <small>Medium</small>
                        <strong>{style.medium}</strong>
                      </span>
                      <span>
                        <small>Lighting</small>
                        <strong>{style.lighting}</strong>
                      </span>
                      <span>
                        <small>Color</small>
                        <strong>{style.color}</strong>
                      </span>
                      <span>
                        <small>Texture</small>
                        <strong>{style.texture}</strong>
                      </span>
                    </div>
                  </section>
                  <section className="detail-section">
                    <div className="detail-section-heading">
                      <h4>Rights and retention</h4>
                    </div>
                    <p>
                      {style.rightsStatus} · {style.retentionSummary}
                    </p>
                  </section>
                  <section className="detail-section">
                    <div className="detail-section-heading">
                      <h4>Technical provenance</h4>
                    </div>
                    <div className="detail-facts">
                      <span>
                        <small>Version ID</small>
                        <strong>{style.versionId}</strong>
                      </span>
                      <span>
                        <small>Profile hash</small>
                        <strong>{style.profileHash}</strong>
                      </span>
                    </div>
                  </section>
                </DetailsSheet>
              </article>
            );
          })}
        </div>
      </Panel>
    </>
  );
}

export function NewStyleScreen() {
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
        coverUrl: "/fixtures/styles/warm-rural.svg",
        referenceUrls: [
          "/fixtures/styles/rural-field.svg",
          "/fixtures/styles/rural-hands.svg",
          "/fixtures/styles/rural-kitchen.svg",
          "/fixtures/styles/rural-market.svg",
        ].slice(0, files.length),
        exampleUrls: [],
        profileHash: "sha256:fixture-local-style-profile",
        medium: "Natural-light rural documentary",
        lighting: "Warm available light",
        color: "Earth tones and muted botanical green",
        texture: "Tactile material detail, restrained sharpening",
        rightsStatus: "ATTESTED",
        retentionSummary: "Private normalized references retained for this published version",
      };
      localStorage.setItem(
        "videoforge:fixture:styles:v1",
        JSON.stringify([...readLocalEntities("videoforge:fixture:styles:v1", isImageStyle), next]),
      );
      updateDraft({ imageStyleVersionId: versionId });
      window.location.assign(fixtureLink(returnTo));
    }, 650);
  }

  return (
    <>
      <PageHeader
        eyebrow={`New style · step ${step} of 4`}
        title="New style"
        actions={
          <a className="button button-ghost" href={fixtureLink(returnTo)}>
            Cancel
          </a>
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
        <Disclosure
          className="onboarding-details"
          summary={
            <>
              <span>How styles work</span>
              <small>Analysis, reuse, and cost</small>
            </>
          }
        >
          <div className="detail-facts">
            <span>
              <small>Analysis</small>
              <strong>Once per draft version</strong>
            </span>
            <span>
              <small>Projects</small>
              <strong>Pin published version + hash</strong>
            </span>
            <span>
              <small>Cost</small>
              <strong>Separate from project spend</strong>
            </span>
            <span>
              <small>Fixture run</small>
              <strong>$0 · no provider call</strong>
            </span>
          </div>
        </Disclosure>
      </div>
    </>
  );
}

export function LibraryScreen() {
  const scenario = currentScenario();
  return (
    <>
      <PageHeader eyebrow="Approved outputs" title="Library" />
      <div className="library-grid">
        <Panel
          className="library-output"
          eyebrow="Approved today"
          heading="Why the everyday world is changing"
        >
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
              <a
                className="button button-secondary"
                href="/fixtures/media/watermelon-market.svg"
                download="videoforge-fixture-preview.svg"
              >
                <Download size={15} />
                Fixture preview
              </a>
            </div>
          </div>
          <Disclosure
            className="library-details"
            summary={
              <>
                <span>Details</span>
                <small>Retention and provenance</small>
              </>
            }
          >
            <div className="detail-facts">
              <span>
                <small>Retention</small>
                <strong>30 days remaining</strong>
              </span>
              <span>
                <small>Manifest</small>
                <strong>Bound to approved revision</strong>
              </span>
              <span>
                <small>Output</small>
                <strong>1080p30 · H.264/AAC</strong>
              </span>
              <span>
                <small>Cost</small>
                <strong>$0.78</strong>
              </span>
            </div>
          </Disclosure>
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
      <PageHeader eyebrow="Workspace" title="Usage" />
      <div className="grid grid-4">
        <Metric
          label="Total"
          value={`$${usage.currentMonth.toFixed(2)}`}
          detail="current month"
          tone="success"
        />
        <Metric
          label="Video projects"
          value={`$${usage.projectSpend.toFixed(2)}`}
          detail="generation"
        />
        <Metric
          label="Style analysis"
          value={`$${usage.styleSpend.toFixed(2)}`}
          detail="one time"
        />
        <Metric
          label="Avatar tests"
          value={`$${usage.avatarTestSpend.toFixed(2)}`}
          detail="optional"
        />
      </div>
      <div className="grid grid-3">
        <Metric label="GPU" value={`${usage.gpuSeconds}s`} detail="billed time" />
        <Metric label="Storage" value={`${usage.storageGb.toFixed(2)} GB`} detail="retained" />
        <Metric label="Retries" value={String(usage.retries)} detail="item-level" />
      </div>
    </>
  );
}

export function SettingsScreen() {
  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" />
      <div className="grid grid-2 settings-grid">
        <Panel eyebrow="Team" heading="Access">
          <div className="settings-summary">
            <Badge tone="success">ACTIVE</Badge>
            <strong>Lakshman · Admin</strong>
          </div>
          <Disclosure summary="Team details">
            <div className="detail-facts">
              <span>
                <small>Sign-in</small>
                <strong>Invite-only Google accounts</strong>
              </span>
              <span>
                <small>Workspace</small>
                <strong>5–10 invited teammates</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
        <Panel eyebrow="Connections" heading="Providers">
          <div className="settings-summary">
            <Badge tone="neutral">FIXTURE ONLY</Badge>
            <strong>External calls off</strong>
          </div>
          <Disclosure summary="Connection status">
            <div className="detail-facts">
              <span>
                <small>RunPod</small>
                <strong>Not configured in fixture mode</strong>
              </span>
              <span>
                <small>Runware</small>
                <strong>Not configured in fixture mode</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
        <Panel eyebrow="Execution" heading="Fixture profile v1">
          <div className="settings-summary">
            <Badge tone="success">$0</Badge>
            <strong>No GPU dispatch</strong>
          </div>
          <Disclosure summary="Execution details">
            <div className="detail-facts">
              <span>
                <small>Endpoint</small>
                <strong>None</strong>
              </span>
              <span>
                <small>Rate limit</small>
                <strong>$0</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
        <Panel eyebrow="Defaults" heading="Documentary Stock v1">
          <div className="settings-summary">
            <Badge tone="info">BALANCED</Badge>
            <strong>$1.50 suggested cap</strong>
          </div>
          <Disclosure summary="Default details">
            <div className="detail-facts">
              <span>
                <small>Contract ceiling</small>
                <strong>$2.00</strong>
              </span>
              <span>
                <small>Scheduler</small>
                <strong>scheduler-v1</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
      </div>
    </>
  );
}
