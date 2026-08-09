import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createProjectRequestSchema, validateOutputRuleKeywords } from "@videoforge/contracts";
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
  Library,
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
import { useEffect, useRef, useState } from "react";
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
import { hasStoredDraft, loadDraft, saveDraft, updateDraft, type ProjectDraft } from "../lib/draft";
import {
  validateImageFile,
  validateVoiceoverFile,
  type VerifiedImage,
} from "../lib/media-validation";
import { currentScenario, withScenario } from "../lib/scenario";
import type {
  AvatarProfile,
  ExecutionProfileCatalog,
  ImageStyle,
  FixtureNotice,
  ProjectSummary,
  ScenarioId,
  Tone,
} from "../lib/types";

function statusTone(status: string): Tone {
  if (["COMPLETE", "APPROVED", "PASSED", "PUBLISHED", "READY"].includes(status)) return "success";
  if (["FAILED", "INVALID"].includes(status)) return "danger";
  if (
    [
      "BLOCKED",
      "NEEDS_ATTENTION",
      "CANCELLED",
      "CANCEL_REQUESTED",
      "STALE",
      "NEEDS_REVIEW",
    ].includes(status)
  )
    return "warning";
  if (
    ["RUNNING", "STARTING", "RECONCILING", "ANALYZING", "VALIDATING", "READY_FOR_REVIEW"].includes(
      status,
    )
  )
    return "info";
  return "neutral";
}

function NoticeBanner({ notice }: { notice: FixtureNotice | null | undefined }) {
  if (!notice) return null;
  const tone = notice.tone === "ERROR" ? "danger" : notice.tone === "WARNING" ? "warning" : "info";
  return (
    <div
      className={`notice ${tone === "danger" ? "notice-danger" : tone === "warning" ? "notice-warning" : ""}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <strong>{notice.title}.</strong> {notice.detail}
    </div>
  );
}

function ActionToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div className="app-toast" role="alert" aria-live="assertive">
      <span className="app-toast-icon" aria-hidden="true">
        <AlertTriangle size={18} />
      </span>
      <span>{message}</span>
      <button
        className="app-toast-dismiss"
        type="button"
        aria-label="Dismiss error"
        onClick={onDismiss}
      >
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

function PresetImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return failed || !src.startsWith("/fixtures/") ? (
    <span className="preset-image-fallback" role="img" aria-label={`${alt} unavailable`}>
      <Images aria-hidden="true" />
    </span>
  ) : (
    <img src={src} alt={alt} onError={() => setFailed(true)} />
  );
}

interface VisualPresetOption {
  id: string;
  imageUrl: string;
  meta: string;
  name: string;
}

function ComputeLaneSelect({
  lane,
  selectedProfileId,
  onChange,
}: {
  lane: ExecutionProfileCatalog["lanes"][number];
  selectedProfileId: string;
  onChange: (profileId: string) => void;
}) {
  return (
    <div className="compute-lane-card">
      <div className="compute-lane-heading">
        <span>
          <strong>{lane.selector_label}</strong>
          <small>{lane.model.display_name}</small>
        </span>
        <span className="compute-status">
          <i aria-hidden="true" />
          {lane.status.provider_state === "NOT_CONNECTED" ? "No GPU connected" : lane.status.label}
        </span>
      </div>
      <label>
        <span className="sr-only">{lane.selector_label} compute profile</span>
        <select
          className="input compute-profile-select"
          value={selectedProfileId}
          onChange={(event) => onChange(event.target.value)}
        >
          {lane.selector_options.map((option) => (
            <option key={option.profile_id} value={option.profile_id}>
              {option.label} · {option.detail}
            </option>
          ))}
          <optgroup label="Requires GPU qualification">
            {lane.planned_candidates.map((candidate) => (
              <option disabled key={candidate.candidate_id} value={candidate.candidate_id}>
                {candidate.label} · benchmark required
              </option>
            ))}
          </optgroup>
        </select>
      </label>
    </div>
  );
}

function VisualPresetSelect({
  label,
  options,
  selectedId,
  onChange,
}: {
  label: string;
  options: VisualPresetOption[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = options.find((option) => option.id === selectedId);

  function closeAndFocus() {
    const details = detailsRef.current;
    if (!details) return;
    details.open = false;
    window.requestAnimationFrame(() => details.querySelector("summary")?.focus());
  }

  return (
    <div className="visual-preset-select">
      <span className="field-label">{label}</span>
      <details
        className="visual-preset-details"
        ref={detailsRef}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !detailsRef.current?.open) return;
          event.preventDefault();
          closeAndFocus();
        }}
      >
        <summary className="visual-preset-summary">
          {selected ? (
            <>
              <PresetImage src={selected.imageUrl} alt={`${selected.name} selected preset`} />
              <span className="visual-preset-copy">
                <strong>{selected.name}</strong>
                <small>{selected.meta}</small>
              </span>
            </>
          ) : (
            <span className="visual-preset-copy">
              <strong>Select {label.toLowerCase()}</strong>
              <small>No ready preset selected</small>
            </span>
          )}
          <span className="visual-preset-chevron" aria-hidden="true" />
        </summary>
        <div className="visual-preset-menu" role="radiogroup" aria-label={`${label} options`}>
          {options.map((option) => {
            const checked = option.id === selectedId;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                className={`visual-preset-option ${checked ? "selected" : ""}`}
                key={option.id}
                onClick={() => {
                  onChange(option.id);
                  closeAndFocus();
                }}
              >
                <PresetImage src={option.imageUrl} alt={`${option.name} preset`} />
                <span className="visual-preset-copy">
                  <strong>{option.name}</strong>
                  <small>{option.meta}</small>
                </span>
                {checked ? <Check size={18} aria-hidden="true" /> : null}
              </button>
            );
          })}
          {options.length === 0 ? (
            <span className="visual-preset-empty">No ready presets</span>
          ) : null}
        </div>
      </details>
    </div>
  );
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

  if (query.isPending) {
    return (
      <>
        <PageHeader eyebrow="Production" title="Your queue" />
        <Panel eyebrow="Workspace" heading="Loading projects">
          <div className="empty-state" aria-busy="true">
            <span className="spinner" aria-hidden="true" />
            <p>Connecting to the authoritative queue…</p>
          </div>
        </Panel>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader eyebrow="Production" title="Your queue" />
        <EmptyState
          icon={<AlertTriangle />}
          title="Queue unavailable"
          body="The local API did not return project data. No empty queue is being inferred."
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry load
            </Button>
          }
        />
      </>
    );
  }

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
        {projects.length === 0 ? (
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
  const [draftHydrated, setDraftHydrated] = useState(() => hasStoredDraft());
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioPending, setAudioPending] = useState(false);
  const [submittedError, setSubmittedError] = useState<string | null>(null);
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const compute = useQuery({
    queryKey: ["execution-profiles", scenario],
    queryFn: () => api.executionProfiles(scenario),
  });
  const avatars = bootstrap.data?.avatars ?? [];
  const styles = bootstrap.data?.styles ?? [];
  const readyAvatars = avatars.filter((avatar) => avatar.status === "READY");
  const publishedStyles = styles.filter((style) => style.status === "PUBLISHED");
  const selectedAvatar = readyAvatars.find(
    (avatar) => avatar.versionId === draft.avatarProfileVersionId,
  );
  const selectedStyle = publishedStyles.find(
    (style) => style.versionId === draft.imageStyleVersionId,
  );
  const imageLane = compute.data?.lanes.find((lane) => lane.lane === "image_media");
  const avatarLane = compute.data?.lanes.find((lane) => lane.lane === "avatar_primary");
  const selectedImageProfileId =
    draft.executionProfileOverrides?.image_media_profile_id ??
    imageLane?.selector_options[0]?.profile_id ??
    "";
  const selectedAvatarProfileId =
    draft.executionProfileOverrides?.avatar_primary_profile_id ??
    avatarLane?.selector_options[0]?.profile_id ??
    "";
  const primaryProfilesReady = Boolean(
    imageLane?.selector_options.some(
      (option) => option.selectable && option.profile_id === selectedImageProfileId,
    ) &&
      avatarLane?.selector_options.some(
        (option) => option.selectable && option.profile_id === selectedAvatarProfileId,
      ),
  );

  useEffect(() => {
    if (!bootstrap.data || draftHydrated) return;
    const fixtureDraft = bootstrap.data.draft;
    setDraft((current) => ({
      ...current,
      title: fixtureDraft.title,
      voiceoverAssetId:
        fixtureDraft.voiceover.uploadState === "VERIFIED" ? fixtureDraft.voiceover.assetId : null,
      voiceoverName:
        fixtureDraft.voiceover.uploadState === "VERIFIED" ? fixtureDraft.voiceover.filename : null,
      voiceoverDurationSeconds:
        fixtureDraft.voiceover.uploadState === "VERIFIED"
          ? fixtureDraft.voiceover.durationSeconds
          : null,
      voiceoverSampleRate: null,
      voiceoverChannels: null,
      voiceoverChecksum: null,
      avatarProfileVersionId: fixtureDraft.avatarProfileVersionId ?? "",
      imageStyleVersionId: fixtureDraft.imageStyleVersionId,
      extraPromptKeywords: fixtureDraft.extraPromptKeywords ?? "",
      applyExtraPromptKeywords: fixtureDraft.applyExtraPromptKeywords,
      generationMode: fixtureDraft.generationMode,
      spendCapUsd: fixtureDraft.spendCapUsd,
    }));
    setDraftHydrated(true);
  }, [bootstrap.data, draftHydrated, setDraft]);

  useEffect(() => {
    const imageProfileId = imageLane?.selector_options[0]?.profile_id;
    const avatarProfileId = avatarLane?.selector_options[0]?.profile_id;
    if (draft.executionProfileOverrides !== null || !imageProfileId || !avatarProfileId) return;
    setDraft((current) => ({
      ...current,
      executionProfileOverrides: {
        image_media_profile_id: imageProfileId,
        avatar_primary_profile_id: avatarProfileId,
      },
    }));
  }, [avatarLane, draft.executionProfileOverrides, imageLane, setDraft]);

  const keywordValidation = validateOutputRuleKeywords(draft.extraPromptKeywords);
  const conflict = draft.applyExtraPromptKeywords && !keywordValidation.valid;
  const keywordEmpty = draft.applyExtraPromptKeywords && !draft.extraPromptKeywords.trim();
  const payload = {
    title: draft.title.trim(),
    voiceover_asset_id: draft.voiceoverAssetId ?? "",
    avatar_profile_version_id: draft.avatarProfileVersionId,
    image_style_version_id: draft.imageStyleVersionId,
    optional_script: null,
    extra_prompt_keywords: draft.extraPromptKeywords || null,
    apply_extra_prompt_keywords: draft.applyExtraPromptKeywords,
    generation_mode: draft.generationMode,
    execution_profile_overrides: draft.executionProfileOverrides,
    spend_cap_usd: draft.spendCapUsd,
    user_seed: draft.userSeed,
  };
  const estimatedCostUsd = 0.88;
  const canSubmit = Boolean(
    draftHydrated &&
      !bootstrap.isPending &&
      !bootstrap.isError &&
      !compute.isPending &&
      !compute.isError &&
      !audioPending &&
      !audioError &&
      selectedAvatar &&
      selectedStyle &&
      primaryProfilesReady &&
      !conflict &&
      !keywordEmpty &&
      draft.spendCapUsd >= estimatedCostUsd &&
      createProjectRequestSchema.safeParse(payload).success,
  );
  const create = useMutation({
    mutationFn: async () => {
      setSubmittedError(null);
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

  async function chooseAudio(file?: File) {
    if (!file) return;
    setDraft((value) => ({
      ...value,
      voiceoverAssetId: null,
      voiceoverName: null,
      voiceoverDurationSeconds: null,
      voiceoverSampleRate: null,
      voiceoverChannels: null,
      voiceoverChecksum: null,
    }));
    setAudioError(null);
    setAudioPending(true);
    try {
      const verified = await validateVoiceoverFile(file);
      await api.mutate(
        "/api/v1/voiceovers/register",
        {
          asset_id: verified.assetId,
          checksum: verified.checksum,
          filename: verified.filename,
          duration_seconds: verified.durationSeconds,
          sample_rate: verified.sampleRate,
          channels: verified.channels,
        },
        scenario,
      );
      setDraft((value) => ({
        ...value,
        voiceoverAssetId: verified.assetId,
        voiceoverName: verified.filename,
        voiceoverDurationSeconds: verified.durationSeconds,
        voiceoverSampleRate: verified.sampleRate,
        voiceoverChannels: verified.channels,
        voiceoverChecksum: verified.checksum,
      }));
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Voiceover validation failed.");
    } finally {
      setAudioPending(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Production" title="New project" />
      <ActionToast message={submittedError} onDismiss={() => setSubmittedError(null)} />
      {bootstrap.isError ? (
        <div className="notice notice-danger" role="alert">
          <strong>Project setup unavailable.</strong> Reload after the local API is healthy.
        </div>
      ) : (
        <NoticeBanner notice={bootstrap.data?.notice} />
      )}
      <div className="layout-main">
        <Panel eyebrow="Configure" heading="Project setup">
          <div className="form-grid">
            <section className="create-section field-wide" aria-labelledby="create-narration">
              <header className="create-section-header">
                <span className="create-section-index">01</span>
                <h3 id="create-narration">Narration</h3>
              </header>
              <div className="create-section-grid">
                <div className="field field-wide">
                  <label htmlFor="project-title">Video title</label>
                  <input
                    id="project-title"
                    className="input"
                    maxLength={240}
                    placeholder="Why food prices behave the way they do"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, title: event.target.value }))
                    }
                  />
                  {draft.title.trim().length > 200 ? (
                    <small>{draft.title.trim().length}/240</small>
                  ) : null}
                </div>
                <div className="field field-wide">
                  <span className="field-label">Final voiceover</span>
                  <label className="dropzone">
                    <input
                      aria-label="Upload final voiceover"
                      type="file"
                      accept="audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/flac"
                      disabled={audioPending || create.isPending}
                      onChange={(event) => void chooseAudio(event.target.files?.[0])}
                    />
                    {audioPending ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : (
                      <FileAudio size={28} />
                    )}
                    <span>
                      <strong>
                        {audioPending
                          ? "Checking audio…"
                          : (draft.voiceoverName ?? "Drop or choose final narration")}
                      </strong>
                      {draft.voiceoverAssetId
                        ? "Verified and ready"
                        : "WAV, MP3, M4A, AAC, or FLAC"}
                    </span>
                  </label>
                  {audioError ? (
                    <div className="validation validation-danger">
                      <AlertTriangle size={16} />
                      {audioError}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
            <section className="create-section field-wide" aria-labelledby="create-look">
              <header className="create-section-header">
                <span className="create-section-index">02</span>
                <h3 id="create-look">Look</h3>
              </header>
              <div className="create-section-grid">
                <div className="field preset-field">
                  <VisualPresetSelect
                    label="Avatar Profile"
                    options={readyAvatars.map((avatar) => ({
                      id: avatar.versionId,
                      imageUrl: avatar.thumbnailUrl,
                      meta: `v${avatar.version} · ${humanize(avatar.compatibility)}`,
                      name: avatar.name,
                    }))}
                    selectedId={draft.avatarProfileVersionId}
                    onChange={(avatarProfileVersionId) =>
                      setDraft((value) => ({ ...value, avatarProfileVersionId }))
                    }
                  />
                  <div className="preset-select-actions">
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
                  <VisualPresetSelect
                    label="Image Style"
                    options={publishedStyles.map((style) => ({
                      id: style.versionId,
                      imageUrl: style.coverUrl,
                      meta: `v${style.version}${style.isDefault ? " · Default" : ""}`,
                      name: style.name,
                    }))}
                    selectedId={draft.imageStyleVersionId}
                    onChange={(imageStyleVersionId) =>
                      setDraft((value) => ({ ...value, imageStyleVersionId }))
                    }
                  />
                  <div className="preset-select-actions">
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
                  summary={<span>Image keywords</span>}
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
                          setDraft((value) => ({
                            ...value,
                            extraPromptKeywords: event.target.value,
                          }))
                        }
                      />
                    </div>
                    {keywordEmpty ? (
                      <div className="validation validation-danger">
                        <X size={16} />
                        Add keywords or turn the toggle off.
                      </div>
                    ) : conflict ? (
                      <div className="validation validation-danger">
                        <X size={16} />
                        Remove requests for{" "}
                        {keywordValidation.conflicts.map((item) => item.label).join(", ")}.
                      </div>
                    ) : null}
                  </div>
                </Disclosure>
              </div>
            </section>
            <section className="create-section field-wide" aria-labelledby="create-run">
              <header className="create-section-header">
                <span className="create-section-index">03</span>
                <h3 id="create-run">Run</h3>
              </header>
              <div className="create-section-grid">
                {imageLane && avatarLane ? (
                  <div className="compute-lane-grid field-wide">
                    <ComputeLaneSelect
                      lane={imageLane}
                      selectedProfileId={selectedImageProfileId}
                      onChange={(image_media_profile_id) =>
                        setDraft((value) => ({
                          ...value,
                          executionProfileOverrides: {
                            ...(value.executionProfileOverrides ?? {}),
                            image_media_profile_id,
                          },
                        }))
                      }
                    />
                    <ComputeLaneSelect
                      lane={avatarLane}
                      selectedProfileId={selectedAvatarProfileId}
                      onChange={(avatar_primary_profile_id) =>
                        setDraft((value) => ({
                          ...value,
                          executionProfileOverrides: {
                            ...(value.executionProfileOverrides ?? {}),
                            avatar_primary_profile_id,
                          },
                        }))
                      }
                    />
                  </div>
                ) : compute.isError ? (
                  <div className="validation validation-danger field-wide" role="alert">
                    Compute profiles are unavailable. Reload after the local API is healthy.
                  </div>
                ) : (
                  <div className="validation field-wide" role="status">
                    Loading compute profiles…
                  </div>
                )}
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
            </section>
          </div>
        </Panel>
        <div className="stack">
          <Panel className="create-run-panel" eyebrow="Run" heading="Ready to generate">
            <div className={`run-readiness ${canSubmit ? "ready" : "blocked"}`} role="status">
              {canSubmit ? <Check size={18} /> : <AlertTriangle size={18} />}
              <strong>{canSubmit ? "Ready" : "Complete required inputs"}</strong>
            </div>
            {draft.spendCapUsd < estimatedCostUsd ? (
              <div className="validation validation-danger">
                <AlertTriangle size={16} />${estimatedCostUsd.toFixed(2)} fixture estimate exceeds
                this cap.
              </div>
            ) : null}
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
              <small>Estimated ${estimatedCostUsd.toFixed(2)} · fixture spend $0</small>
            </div>
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

export function ProjectScreen({ projectId }: { projectId: string }) {
  const scenario = currentScenario();
  const query = useQuery({
    queryKey: ["project", projectId, scenario],
    queryFn: () => api.project(projectId, scenario),
    refetchInterval: 10_000,
  });
  const compute = useQuery({
    queryKey: ["execution-profiles", scenario],
    queryFn: () => api.executionProfiles(scenario),
  });
  const [action, setAction] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    tone: "info" | "danger";
    text: string;
  } | null>(null);
  if (query.isPending) {
    return (
      <Panel className="loading-panel" eyebrow="Project" heading="Loading progress">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Connecting to the authoritative project state…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Project progress is unavailable"
        body="The local API did not return a project. No fallback status is being shown."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }

  const project: ProjectSummary = query.data.project;
  const percent = Math.round((project.completed / Math.max(1, project.total)) * 100);
  const stages = project.stages;
  const actionableStageIndex = stages.findIndex((stage) =>
    ["STARTING", "RUNNING", "RETRYING", "BLOCKED", "FAILED", "CANCEL_REQUESTED"].includes(
      stage.status,
    ),
  );
  const nextStageIndex = stages.findIndex((stage) => ["PENDING", "QUEUED"].includes(stage.status));
  const currentStageIndex =
    actionableStageIndex >= 0
      ? actionableStageIndex
      : nextStageIndex >= 0
        ? nextStageIndex
        : Math.max(0, stages.length - 1);
  const imagePercent = Math.round(
    (project.lanes.image.completed / Math.max(1, project.lanes.image.total)) * 100,
  );
  const avatarPercent = Math.round(
    (project.lanes.avatar.completed / Math.max(1, project.lanes.avatar.total)) * 100,
  );
  const imageCompute = compute.data?.lanes.find((lane) => lane.lane === "image_media");
  const avatarCompute = compute.data?.lanes.find((lane) => lane.lane === "avatar_primary");

  async function perform(label: string, path: string) {
    if (action !== null) return;
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
      await query.refetch();
    } catch (error) {
      setActionNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "The fixture action could not be accepted.",
      });
      setAction(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`${project.status.replaceAll("_", " ")} · REV ${project.revisionId.split("_").at(-1)?.toUpperCase() ?? "—"}`}
        title={project.title}
        description={`${project.owner} · ${project.mode.replaceAll("_", " ")}`}
        actions={
          project.allowedActions.includes("RETRY_FAILED_ITEMS") ||
          project.allowedActions.includes("CANCEL") ? (
            <>
              {project.allowedActions.includes("RETRY_FAILED_ITEMS") ? (
                <Button
                  variant="secondary"
                  busy={action === "retry"}
                  disabled={action !== null}
                  onClick={() => perform("retry", `/api/v1/projects/${project.id}/retry`)}
                >
                  <RefreshCw size={15} />
                  Retry
                </Button>
              ) : null}
              {project.allowedActions.includes("CANCEL") ? (
                <Button
                  variant="danger"
                  busy={action === "cancel"}
                  disabled={action !== null}
                  onClick={() => perform("cancel", `/api/v1/projects/${project.id}/cancel`)}
                >
                  <X size={15} />
                  Cancel
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <NoticeBanner notice={query.data.notice} />
      <ActionToast
        message={actionNotice?.tone === "danger" ? actionNotice.text : null}
        onDismiss={() => setActionNotice(null)}
      />
      {actionNotice?.tone === "info" ? (
        <div className="notice" role="status" aria-live="polite">
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
              value={humanize(project.status)}
              detail={
                project.status === "RECONCILING"
                  ? "Checking durable worker truth"
                  : project.status === "CANCEL_REQUESTED"
                    ? "Workers are settling"
                    : project.status === "READY_FOR_REVIEW"
                      ? "Human approval required"
                      : project.status === "APPROVED"
                        ? "Final revision locked"
                        : "Authoritative project state"
              }
              tone={statusTone(project.status)}
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
                  <Badge tone="info">SYNTHETIC CANDIDATE</Badge>
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
                <div className="lane-title">
                  <span>Images</span>
                  <strong>
                    {project.lanes.image.completed} / {project.lanes.image.total}
                  </strong>
                  <span className="compute-status">
                    <i aria-hidden="true" />
                    {imageCompute?.status.provider_state === "NOT_CONNECTED"
                      ? "Fixture · no GPU"
                      : (imageCompute?.status.label ?? "Status unavailable")}
                  </span>
                </div>
                <ProgressBar value={imagePercent} label="Image lane progress" />
                <small>{project.lanes.image.action}</small>
              </div>
              <div className="lane-row">
                <div className="lane-title">
                  <span>Avatar</span>
                  <strong>
                    {project.lanes.avatar.completed} / {project.lanes.avatar.total}
                  </strong>
                  <span className="compute-status">
                    <i aria-hidden="true" />
                    {avatarCompute?.status.provider_state === "NOT_CONNECTED"
                      ? "Fixture · no GPU"
                      : (avatarCompute?.status.label ?? "Status unavailable")}
                  </span>
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
                <strong>{project.pins.avatarProfileVersionId ?? "Not pinned"}</strong>
              </span>
              <span>
                <small>Image style</small>
                <strong>{project.pins.imageStyleVersionId}</strong>
              </span>
              <span>
                <small>Estimate</small>
                <strong>${project.estimatedCost.toFixed(2)}</strong>
              </span>
              <span>
                <small>Revision</small>
                <strong>{project.revisionId}</strong>
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

          {project.allowedActions.includes("REVIEW") ? (
            <Link
              className="button button-primary progress-review-action"
              to="/projects/$projectId/review"
              params={{ projectId }}
              search={{ fixture: scenario } as never}
            >
              Review output
              <ArrowRight size={18} />
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ReviewScreen({ projectId }: { projectId: string }) {
  const scenario = currentScenario();
  const query = useQuery({
    queryKey: ["project", projectId, scenario],
    queryFn: () => api.project(projectId, scenario),
    refetchInterval: 10_000,
  });
  const [sameClipMode, setSameClipMode] = useState<"AVATAR_FULL" | "AVATAR_SPLIT_IMAGE">(
    "AVATAR_FULL",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [approvalRecorded, setApprovalRecorded] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [reviewActionNotice, setReviewActionNotice] = useState<string | null>(null);
  const project = query.data?.project;
  const approved = approvalRecorded || project?.review.state === "APPROVED";
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
    if (busy !== null) return;
    setBusy(id);
    setApprovalError(null);
    setReviewActionNotice(null);
    try {
      if (id === "approve") {
        await Promise.all([
          api.mutate(
            `/api/v1/projects/${projectId}/approve`,
            { project_id: projectId, candidate_id: project?.review.candidateId },
            scenario,
          ),
          new Promise((resolve) => window.setTimeout(resolve, 600)),
        ]);
        setApprovalRecorded(true);
        await query.refetch();
      } else if (id === "retry") {
        await api.mutate(
          `/api/v1/projects/${projectId}/retry`,
          { project_id: projectId },
          scenario,
        );
        setReviewActionNotice("Targeted repair accepted. Next project check in 10 seconds.");
        await query.refetch();
      } else if (id === "fallback") {
        await api.mutate(
          `/api/v1/projects/${projectId}/fallback-approval`,
          { project_id: projectId, approved_increment_usd: 0.18 },
          scenario,
        );
        setReviewActionNotice("The $0.18 fallback reservation was approved for this fixture.");
        await query.refetch();
      } else {
        throw new Error("This review action is not implemented in fixture mode.");
      }
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "Approval could not be recorded.");
    } finally {
      setBusy(null);
    }
  }

  if (query.isPending) {
    return (
      <Panel eyebrow="Review" heading="Loading candidate">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Checking candidate and approval state…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError || !project) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Review unavailable"
        body="No candidate is inferred when project state cannot be loaded."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
  if (!project.allowedActions.includes("REVIEW") && !approved) {
    return (
      <>
        <PageHeader
          eyebrow={humanize(project.status)}
          title="Review"
          description="No candidate yet"
        />
        <EmptyState
          icon={<Video />}
          title="Output is not ready for review"
          body="Return to Progress. Approval stays unavailable until a candidate passes technical checks."
          action={
            <Link
              className="button button-primary"
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ fixture: scenario } as never}
            >
              Open progress
            </Link>
          }
        />
      </>
    );
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
            {project.allowedActions.includes("APPROVE") || approved ? (
              <Button
                busy={busy === "approve"}
                disabled={approved || busy !== null}
                onClick={() => act("approve")}
              >
                <ShieldCheck size={16} />
                {approved ? "Approved" : "Approve final"}
              </Button>
            ) : null}
            {project.allowedActions.includes("RETRY_FAILED_ITEMS") ? (
              <Button busy={busy === "retry"} disabled={busy !== null} onClick={() => act("retry")}>
                <RefreshCw size={16} />
                Retry failed item
              </Button>
            ) : null}
            {project.allowedActions.includes("APPROVE_FALLBACK") ? (
              <Button
                busy={busy === "fallback"}
                disabled={busy !== null}
                onClick={() => act("fallback")}
              >
                Approve $0.18 fallback
              </Button>
            ) : null}
          </>
        }
      />
      <NoticeBanner notice={query.data.notice} />
      <ActionToast message={approvalError} onDismiss={() => setApprovalError(null)} />
      {busy === "approve" || approved ? (
        <div className="notice" role="status" aria-live="polite">
          <strong>{busy === "approve" ? "Approving…" : "Approval recorded."}</strong>{" "}
          {busy === "approve"
            ? "Candidate and checksum are being verified."
            : "Downloads are ready."}
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
              aria-pressed={sameClipMode === "AVATAR_FULL"}
              onClick={() => setSameClipMode("AVATAR_FULL")}
            >
              Full
            </Button>
            <Button
              variant={sameClipMode === "AVATAR_SPLIT_IMAGE" ? "primary" : "secondary"}
              aria-pressed={sameClipMode === "AVATAR_SPLIT_IMAGE"}
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
              <small className="review-segment-state">
                {shot.status === "FLAGGED"
                  ? "Repair is controlled by the project action above."
                  : "Read-only fixture contact sheet"}
              </small>
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
              download="videoforge-fixture-project-record.json"
            >
              <FileJson size={18} />
              Fixture record
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
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const avatars = query.data ?? [];
  const visibleAvatars = avatars.filter((avatar) =>
    avatar.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  if (query.isPending) {
    return (
      <Panel eyebrow="Presets" heading="Loading Avatar Hub">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading reusable presenters…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Avatar Hub unavailable"
        body="The profile catalog could not be loaded. No empty catalog is being inferred."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
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
      <NoticeBanner notice={bootstrap.data?.notice} />
      {bootstrap.data?.activeOperations.avatar ? (
        <div className="notice" role="status">
          <strong>In progress.</strong> {bootstrap.data.activeOperations.avatar}
        </div>
      ) : null}
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
        ) : visibleAvatars.length === 0 ? (
          <EmptyState
            icon={<UsersRound />}
            title="No matching avatars"
            body="Clear or change the search to see the workspace catalog."
          />
        ) : (
          <div className="card-grid avatar-card-grid">
            {visibleAvatars.map((avatar) => (
              <article className="entity-card avatar-card" key={avatar.versionId}>
                <div className="avatar-card-media">
                  <PresetImage src={avatar.thumbnailUrl} alt={`${avatar.name} presenter`} />
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
                  <p>{avatar.warning ?? `Last used ${formatShortDate(avatar.lastUsed)}`}</p>
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
                      <PresetImage
                        src={avatar.thumbnailUrl}
                        alt={`${avatar.name} full avatar crop`}
                      />
                      <figcaption>Full frame</figcaption>
                    </figure>
                    <figure className="split-crop">
                      <PresetImage
                        src={avatar.thumbnailUrl}
                        alt={`${avatar.name} split avatar crop`}
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
  const scenario = currentScenario();
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo") || "/avatars";
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [source, setSource] = useState<VerifiedImage | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourcePending, setSourcePending] = useState(false);
  const [rights, setRights] = useState(false);
  const [likeness, setLikeness] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ["avatars", scenario],
    queryFn: () => api.avatars(scenario),
  });
  const duplicateName = (catalog.data ?? []).some(
    (avatar) => avatar.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.objectUrl);
    },
    [source],
  );

  async function chooseAvatarSource(file?: File) {
    if (!file) return;
    if (source) URL.revokeObjectURL(source.objectUrl);
    setSource(null);
    setSourceError(null);
    setSourcePending(true);
    try {
      setSource(await validateImageFile(file, 512));
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Avatar source validation failed.");
    } finally {
      setSourcePending(false);
    }
  }

  async function finish() {
    if (!source || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      const result = await api.mutate<{ avatarProfile: AvatarProfile }>(
        "/api/v1/avatar-profiles",
        {
          name: name.trim(),
          thumbnail_url: "/fixtures/avatar/amish-farm-host.svg",
          source_dimensions: { width: source.width, height: source.height },
          profile_hash: "sha256:4edb4a84b48056a5e12122153099c2243b7d3b59ac8c76db8a3b3471eedcc672",
          preparation_profile: "fixture-browser-decode-v1",
          validation_profile: "fixture-manual-framing-v1",
          compatibility: "UNTESTED",
          lifecycle: "ACTIVE",
          version_state: "READY",
          uploaded_bytes_persisted: false,
          attestations: { image_use_rights: true, likeness_animation_consent: true },
        },
        scenario,
      );
      updateDraft({ avatarProfileVersionId: result.avatarProfile.versionId });
      window.location.assign(fixtureLink(returnTo));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Avatar Profile could not be saved.");
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`New avatar · step ${step} of 3`}
        title="New avatar"
        actions={
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => window.location.assign(fixtureLink(returnTo))}
          >
            Cancel
          </Button>
        }
      />
      <ActionToast message={saveError} onDismiss={() => setSaveError(null)} />
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
                  disabled={sourcePending}
                  onChange={(event) => void chooseAvatarSource(event.target.files?.[0])}
                />
                {sourcePending ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Upload size={27} />
                )}
                <span>
                  <strong>{source?.filename ?? "Choose one private centered source"}</strong>
                  {source
                    ? `${source.width}×${source.height} · decoded locally`
                    : "JPEG, PNG, or WebP · at least 512×512 · 20 MB max"}
                </span>
              </label>
              {sourceError ? (
                <div className="validation validation-danger">{sourceError}</div>
              ) : null}
              {duplicateName ? (
                <div className="validation validation-danger">
                  Use a unique Avatar Profile name.
                </div>
              ) : null}
              <Button
                disabled={!name.trim() || !source || duplicateName}
                onClick={() => setStep(2)}
              >
                Review source
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="stack">
              {source ? (
                <img
                  className="avatar-source-preview"
                  src={source.objectUrl}
                  alt="Selected avatar source preview"
                />
              ) : null}
              <div className="validation validation-success">
                <Check size={16} />
                File signature, browser decode, and {source?.width}×{source?.height} dimensions
                passed.
              </div>
              <div className="notice notice-warning">
                <strong>Manual check required.</strong> Confirm one centered, front-facing
                presenter. Fixture mode does not run person detection, crop analysis, EXIF
                stripping, or a model.
              </div>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
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
                fixture profile costs $0 and makes no model call. Uploaded bytes stay only in this
                browser page; the Hub uses a labelled owned stand-in thumbnail.
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => setStep(2)}>
                Back
              </Button>
              <Button busy={busy} disabled={!rights || !likeness} onClick={() => void finish()}>
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
              <strong>Not persisted by fixture shell</strong>
            </span>
            <span>
              <small>Runtime</small>
              <strong>Owned stand-in thumbnail</strong>
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
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const styles = query.data ?? [];
  const visibleStyles = styles.filter((style) =>
    style.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  if (query.isPending) {
    return (
      <Panel eyebrow="Presets" heading="Loading Image Styles">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading reusable visual profiles…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Image Styles unavailable"
        body="The style catalog could not be loaded. No empty catalog is being inferred."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
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
      <NoticeBanner notice={bootstrap.data?.notice} />
      {bootstrap.data?.activeOperations.style ? (
        <div className="notice" role="status">
          <strong>In progress.</strong> {bootstrap.data.activeOperations.style}
        </div>
      ) : null}
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
        {visibleStyles.length === 0 ? (
          <EmptyState
            icon={<Images />}
            title="No matching styles"
            body="Clear or change the search to see the workspace library."
          />
        ) : (
          <div className="card-grid style-card-grid">
            {visibleStyles.map((style) => {
              const references = style.referenceUrls ?? [];
              const examples = style.exampleUrls ?? [];
              const gallery = references.length ? references : examples;
              const galleryLabel = references.length ? "References" : "Owned examples";
              return (
                <article className="entity-card style-card" key={style.versionId}>
                  <div className="style-card-media">
                    <PresetImage src={style.coverUrl} alt={`${style.name} cover`} />
                    <div className="style-card-badges">
                      {style.isDefault ? <Badge tone="info">DEFAULT</Badge> : null}
                      <Badge tone={statusTone(style.status)}>{style.status}</Badge>
                    </div>
                  </div>
                  <div className="entity-card-body">
                    <div className="entity-title-row">
                      <div>
                        <h3>{style.name}</h3>
                        <span>
                          {style.status === "PUBLISHED"
                            ? `Published v${style.version}`
                            : `${humanize(style.status)} · draft v${style.draftVersion ?? style.version}`}
                        </span>
                      </div>
                    </div>
                    <p>{style.warning ?? style.summary}</p>
                  </div>
                  <DetailsSheet
                    title={style.name}
                    description={`${style.status === "PUBLISHED" ? `Published v${style.version}` : humanize(style.status)} · ${galleryLabel} ${gallery.length}`}
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
        )}
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
  const [files, setFiles] = useState<VerifiedImage[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filesPending, setFilesPending] = useState(false);
  const [rights, setRights] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const catalog = useQuery({ queryKey: ["styles", scenario], queryFn: () => api.styles(scenario) });
  const duplicateName = (catalog.data ?? []).some(
    (style) => style.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );

  useEffect(
    () => () => {
      for (const file of files) URL.revokeObjectURL(file.objectUrl);
    },
    [files],
  );

  async function chooseStyleReferences(selected: FileList | null) {
    for (const file of files) URL.revokeObjectURL(file.objectUrl);
    setFiles([]);
    setFileError(null);
    const candidates = Array.from(selected ?? []);
    if (candidates.length === 0) return;
    if (candidates.length > 8) {
      setFileError("Choose no more than 8 reference images.");
      return;
    }
    setFilesPending(true);
    try {
      const results = await Promise.allSettled(
        candidates.map((file) => validateImageFile(file, 256)),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) {
        for (const result of results) {
          if (result.status === "fulfilled") URL.revokeObjectURL(result.value.objectUrl);
        }
        throw failure.reason;
      }
      setFiles(results.map((result) => (result as PromiseFulfilledResult<VerifiedImage>).value));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Reference validation failed.");
    } finally {
      setFilesPending(false);
    }
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    setPublishError(null);
    try {
      const exampleUrls = [
        "/fixtures/styles/rural-field.svg",
        "/fixtures/styles/rural-hands.svg",
        "/fixtures/styles/rural-kitchen.svg",
        "/fixtures/styles/rural-market.svg",
      ].slice(0, files.length);
      const result = await api.mutate<{ imageStyle: ImageStyle }>(
        "/api/v1/image-styles",
        {
          name: name.trim(),
          summary:
            "Natural light, restrained contrast, material texture, and documentary camera language.",
          cover_url: "/fixtures/styles/warm-rural.svg",
          reference_urls: [],
          example_urls: exampleUrls,
          profile_hash: "sha256:5606a4a2ff7a347cf3b2529a91e557e945ee0aeb9db26849dc85aaef5f27fde9",
          medium: "Natural-light rural documentary",
          lighting: "Warm available light",
          color: "Earth tones and muted botanical green",
          texture: "Tactile material detail, restrained sharpening",
          retention_summary:
            "Fixture mode retained no uploaded bytes; owned examples stand in after navigation",
          lifecycle: "ACTIVE",
          version_state: "PUBLISHED",
          uploaded_bytes_persisted: false,
          attestations: {
            reference_rights: true,
            processing_disclosure_acknowledged: true,
          },
        },
        scenario,
      );
      updateDraft({ imageStyleVersionId: result.imageStyle.versionId });
      window.location.assign(fixtureLink(returnTo));
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Image Style could not be saved.");
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`New style · step ${step} of 4`}
        title="New style"
        actions={
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => window.location.assign(fixtureLink(returnTo))}
          >
            Cancel
          </Button>
        }
      />
      <ActionToast message={publishError} onDismiss={() => setPublishError(null)} />
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
                  disabled={filesPending}
                  onChange={(event) => void chooseStyleReferences(event.target.files)}
                />
                {filesPending ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Images size={28} />
                )}
                <span>
                  <strong>
                    {files.length
                      ? `${files.length} private reference${files.length === 1 ? "" : "s"} selected`
                      : "Choose 3–8 visual references"}
                  </strong>
                  Files are signature-checked and decoded locally; fixture mode does not upload them
                </span>
              </label>
              {fileError ? <div className="validation validation-danger">{fileError}</div> : null}
              {duplicateName ? (
                <div className="validation validation-danger">Use a unique Image Style name.</div>
              ) : null}
              {files.length ? (
                <div className="reference-mosaic fixture-upload-preview">
                  {files.map((file) => (
                    <figure key={file.objectUrl}>
                      <img src={file.objectUrl} alt={`${file.filename} local preview`} />
                      <figcaption>
                        {file.width}×{file.height}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
              <Button
                disabled={!name.trim() || files.length < 3 || duplicateName}
                onClick={() => setStep(2)}
              >
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
                <strong>Fixture simulation.</strong> No references leave this page, no traits are
                inferred from them, and no Runware request is made. The next screen demonstrates the
                review shape with owned synthetic data at $0.
              </div>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
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
                  <small>Owned fixture example · not inferred</small>
                </div>
                <div className="metric">
                  <span>Lighting</span>
                  <strong>Natural soft side light</strong>
                  <small>Synthetic review value</small>
                </div>
                <div className="metric">
                  <span>Color</span>
                  <strong>Warm earth + muted cyan</strong>
                  <small>Synthetic review value</small>
                </div>
                <div className="metric">
                  <span>Texture</span>
                  <strong>Material detail</strong>
                  <small>Synthetic review value</small>
                </div>
              </div>
              <div className="validation validation-success">
                <Check size={16} />
                The deterministic fixture profile contains no people, logos, visible instructions,
                or exact-subject requirements.
              </div>
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
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
                <strong>Uploaded bytes are not persisted.</strong> The published fixture card will
                show labelled owned examples. A real analysis or Mage test requires separate
                authorization later.
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => setStep(3)}>
                Back
              </Button>
              <Button busy={busy} onClick={() => void publish()}>
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
  const query = useQuery({
    queryKey: ["projects", scenario],
    queryFn: () => api.projects(scenario),
  });
  const approvedProjects = (query.data ?? []).filter((project) => project.status === "APPROVED");
  if (query.isPending) {
    return (
      <Panel eyebrow="Approved outputs" heading="Loading Library">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading approved revisions…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Library unavailable"
        body="Approved output data could not be loaded."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
  return (
    <>
      <PageHeader eyebrow="Approved outputs" title="Library" />
      {approvedProjects.length === 0 ? (
        <EmptyState
          icon={<Library />}
          title="No approved outputs"
          body="Projects appear here only after an explicit final approval."
        />
      ) : (
        <div className="library-grid">
          {approvedProjects.map((project) => (
            <Panel
              key={project.id}
              className="library-output"
              eyebrow="Approved today"
              heading={project.title}
            >
              <CompositionPreview type="AVATAR_SPLIT_IMAGE" />
              <div className="entity-card-footer">
                <Badge tone="success">APPROVED</Badge>
                <div className="cluster">
                  <Link
                    className="button button-secondary"
                    to="/projects/$projectId/review"
                    params={{ projectId: project.id }}
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
                    <strong>${project.actualCost.toFixed(2)}</strong>
                  </span>
                </div>
              </Disclosure>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

export function UsageScreen() {
  const scenario = currentScenario();
  const query = useQuery({ queryKey: ["usage", scenario], queryFn: () => api.usage(scenario) });
  if (query.isPending) {
    return (
      <Panel eyebrow="Workspace" heading="Loading Usage">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading cost and resource totals…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Usage unavailable"
        body="No estimated spend is substituted when usage data cannot be loaded."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
  const usage = query.data;
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
