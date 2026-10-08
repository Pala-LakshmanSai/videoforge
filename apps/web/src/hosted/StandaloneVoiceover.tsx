import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Headphones,
  Library,
  LoaderCircle,
  RefreshCcw,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { useHostedCreateDraftRef, useHostedCreateDraftState } from "./HostedCreateDraft";
import { useHostedIdentity } from "./HostedIdentity";
import { VoiceSelect } from "./VoiceSelect";
import { voiceoverJson, useVoices } from "./VoiceoverHub";

const MAX_SCRIPT_LENGTH = 100_000;
const MAX_SCRIPT_FILE_BYTES = 400_000;
const ACTIVE_STATES = new Set(["WAITING", "SUBMITTING", "PROCESSING", "ARCHIVING"]);
const READY_STATES = new Set(["COMPLETED", "READY"]);

type StandaloneVoiceoverJob = {
  id: string;
  state: string;
  filename: string;
  voice_id: string;
  voice_name?: string | null;
  title?: string | null;
  failure_code?: string | null;
  audio_url?: string | null;
  download_url?: string | null;
  created_at?: string;
  script?: string;
  duration_ms?: number | null;
  content_length?: number | null;
};

type JobResponse = { job: StandaloneVoiceoverJob | null };
type StandaloneVoiceoverRequest = { id: string; body: string };
type StandaloneVoiceoverDraft = {
  email: string;
  title: string;
  script: string;
  voiceId: string;
  titleTouched: boolean;
  request: StandaloneVoiceoverRequest | null;
  job: StandaloneVoiceoverJob | null;
  unconfirmed: boolean;
};

const DRAFT_STORAGE_KEY = "videoforge.standalone-voiceover.v1";

function readDraft(email: string): StandaloneVoiceoverDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(DRAFT_STORAGE_KEY) ?? "null",
    ) as Partial<StandaloneVoiceoverDraft> | null;
    if (
      !parsed ||
      parsed.email !== email ||
      typeof parsed.title !== "string" ||
      typeof parsed.script !== "string"
    )
      return null;
    const request = parsed.request;
    const job = parsed.job;
    return {
      email,
      title: parsed.title,
      script: parsed.script,
      voiceId: typeof parsed.voiceId === "string" ? parsed.voiceId : "",
      titleTouched: parsed.titleTouched === true,
      request:
        request && typeof request.id === "string" && typeof request.body === "string"
          ? { id: request.id, body: request.body }
          : null,
      job:
        job &&
        typeof job.id === "string" &&
        typeof job.state === "string" &&
        typeof job.filename === "string" &&
        typeof job.voice_id === "string"
          ? (job as StandaloneVoiceoverJob)
          : null,
      unconfirmed: parsed.unconfirmed === true,
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: StandaloneVoiceoverDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Private browsing and full storage must not block voiceover creation.
  }
}

function removeDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Best effort cleanup.
  }
}

function filenameForTitle(title: string): string {
  const stem = title
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^[_.]+|[_.]+$/gu, "")
    .slice(0, 140);
  return `${stem || "voiceover"}.mp3`;
}

function titleForFile(name: string): string {
  const stem = name
    .replace(/\.txt$/iu, "")
    .replace(/[_-]+/gu, " ")
    .trim();
  return stem || "New voiceover";
}

function readableDuration(durationMs: number | null | undefined, script: string): string {
  if (durationMs && durationMs > 0) {
    const seconds = Math.max(1, Math.round(durationMs / 1_000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const minutes = Math.max(1, Math.ceil(script.trim().split(/\s+/u).filter(Boolean).length / 145));
  return `~${minutes} min`;
}

function stateLabel(state: string): string {
  if (state === "WAITING") return "Queued";
  if (state === "SUBMITTING") return "Starting generation";
  if (state === "PROCESSING") return "Generating MP3";
  if (state === "ARCHIVING") return "Finalizing MP3";
  if (READY_STATES.has(state)) return "Voiceover ready";
  if (state === "UNKNOWN_NO_RETRY") return "Needs a status check";
  if (state === "FAILED") return "Generation failed";
  if (state === "ARCHIVE_FAILED") return "Audio needs attention";
  return state.replaceAll("_", " ").toLowerCase();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Voiceover request failed. Try again.";
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = Number(error.status);
  return Number.isFinite(status) ? status : null;
}

export function StandaloneVoiceover() {
  const voices = useVoices();
  const queryClient = useQueryClient();
  const identity = useHostedIdentity();
  const [title, setTitle] = useHostedCreateDraftState("standalone-voiceover-title", "");
  const [script, setScript] = useHostedCreateDraftState("standalone-voiceover-script", "");
  const [voiceId, setVoiceId] = useHostedCreateDraftState("standalone-voiceover-voice", "");
  const [job, setJob] = useHostedCreateDraftState<StandaloneVoiceoverJob | null>(
    "standalone-voiceover-job",
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useHostedCreateDraftState(
    "standalone-voiceover-unconfirmed",
    false,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const recent = useQuery({
    queryKey: ["voiceover-library", "studio", identity?.email],
    queryFn: () =>
      voiceoverJson<{ voiceovers: StandaloneVoiceoverJob[]; total?: number }>(
        "/api/v2/voiceovers/library?page=0",
      ),
    enabled: Boolean(identity?.email),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
  const titleTouched = useHostedCreateDraftRef("standalone-voiceover-title-touched", false);
  const alive = useRef(true);
  const request = useHostedCreateDraftRef<StandaloneVoiceoverRequest | null>(
    "standalone-voiceover-request",
    null,
  );
  const hydrated = useRef(false);
  const restoredDraftVoice = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!identity?.email || hydrated.current) return;
    hydrated.current = true;
    const saved = readDraft(identity.email);
    if (!saved) return;
    if (saved.job && saved.job.state !== "UNKNOWN_NO_RETRY") {
      setTitle("");
      setScript("");
      setVoiceId(saved.voiceId);
      setJob(null);
      request.current = null;
      setUnconfirmed(false);
      removeDraft();
      return;
    }
    if (!title) setTitle(saved.title);
    if (!script) setScript(saved.script);
    if (saved.voiceId) {
      restoredDraftVoice.current = true;
      setVoiceId(saved.voiceId);
    }
    if (!job) setJob(saved.job);
    // A persisted request without a persisted job means the POST may have been
    // accepted before the browser disappeared. Keep it in check-only mode so a
    // reload can reconcile the ID instead of submitting a second provider call.
    const needsStatusCheck =
      saved.unconfirmed ||
      (Boolean(saved.request) && !saved.job) ||
      saved.job?.state === "UNKNOWN_NO_RETRY";
    if (!unconfirmed && needsStatusCheck) setUnconfirmed(true);
    if (saved.request) request.current = saved.request;
    titleTouched.current = saved.titleTouched;
  }, [identity?.email, job, script, title, unconfirmed, voiceId]);

  useEffect(() => {
    if (!identity?.email || !request.current) return;
    writeDraft({
      email: identity.email,
      title,
      script,
      voiceId,
      titleTouched: titleTouched.current,
      request: request.current,
      job,
      unconfirmed,
    });
  }, [identity?.email, job, script, title, unconfirmed, voiceId]);

  useEffect(() => {
    if (voiceId || restoredDraftVoice.current || !voices.data?.voices.length) return;
    const preferred =
      voices.data.voices.find((voice) => voice.starred) ??
      voices.data.voices.find((voice) => voice.saved) ??
      voices.data.voices[0];
    if (preferred) setVoiceId(preferred.voice_id);
  }, [voiceId, voices.data]);

  const locked = busy || unconfirmed;
  const filename = useMemo(() => filenameForTitle(title), [title]);
  const selectedVoice = voices.data?.voices.find((voice) => voice.voice_id === voiceId);
  const scriptReady = Boolean(script.trim()) && script.length <= MAX_SCRIPT_LENGTH;
  const canGenerate =
    !busy &&
    (unconfirmed ? Boolean(request.current) : scriptReady && Boolean(voiceId) && !voices.isPending);
  const savedJobs = recent.data?.voiceovers ?? [];
  const queueJobs =
    job && !savedJobs.some((item) => item.id === job.id) ? [job, ...savedJobs] : savedJobs;
  const activeCount = queueJobs.filter((item) => ACTIVE_STATES.has(item.state)).length;
  const readyCount = queueJobs.filter(
    (item) => READY_STATES.has(item.state) && item.audio_url,
  ).length;

  useEffect(() => {
    if (job && savedJobs.some((item) => item.id === job.id)) setJob(null);
  }, [job, recent.data]);

  function acceptJob(accepted: StandaloneVoiceoverJob) {
    setJob(accepted);
    setNotice(`“${accepted.title || title || "Voiceover"}” added to your queue.`);
    setTitle("");
    setScript("");
    titleTouched.current = false;
    setUnconfirmed(false);
    request.current = null;
    removeDraft();
    void queryClient.invalidateQueries({ queryKey: ["voiceover-library"] });
  }

  function clearResult() {
    setJob(null);
    setError(null);
    setUnconfirmed(false);
    request.current = null;
    removeDraft();
  }

  function changeTitle(value: string) {
    titleTouched.current = true;
    clearResult();
    setTitle(value);
  }

  function changeScript(value: string) {
    clearResult();
    setScript(value);
  }

  function changeVoice(value: string) {
    clearResult();
    setVoiceId(value);
  }

  async function readScriptFile(file: File | undefined) {
    if (!file) return;
    clearResult();
    setError(null);
    if (!/\.txt$/iu.test(file.name) || file.size > MAX_SCRIPT_FILE_BYTES) {
      setError("Upload a plain text (.txt) script, up to 100,000 characters.");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      if (!text.trim() || text.length > MAX_SCRIPT_LENGTH || text.includes("\0")) {
        throw new Error("Script must contain 1 to 100,000 plain text characters.");
      }
      if (!alive.current) return;
      setScript(text);
      if (!titleTouched.current) setTitle(titleForFile(file.name));
    } catch (readError) {
      if (alive.current) setError(errorText(readError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function requestBody() {
    if (!request.current) request.current = { id: crypto.randomUUID(), body: "" };
    if (!request.current.body) {
      const payload: Record<string, string> = {
        id: request.current.id,
        script,
        voice_id: voiceId,
        filename,
        title: title.trim() || "Untitled voiceover",
      };
      request.current.body = JSON.stringify(payload);
      if (identity?.email) {
        writeDraft({
          email: identity.email,
          title,
          script,
          voiceId,
          titleTouched: titleTouched.current,
          request: request.current,
          job,
          unconfirmed,
        });
      }
    }
    return request.current;
  }

  async function checkOrSubmit() {
    const saved = requestBody();
    if (unconfirmed) {
      try {
        const result = await voiceoverJson<JobResponse>(
          `/api/v2/voiceovers/jobs/${encodeURIComponent(saved.id)}`,
        );
        if (result.job) {
          if (result.job.state !== "WAITING") {
            acceptJob(result.job);
            return;
          }
        }
      } catch (checkError) {
        if (errorStatus(checkError) !== 404) throw checkError;
      }
    }
    const result = await voiceoverJson<{ job: StandaloneVoiceoverJob }>("/api/v2/voiceovers/jobs", {
      method: "POST",
      body: saved.body,
      signal: AbortSignal.timeout(45_000),
    });
    acceptJob(result.job);
  }

  async function generate() {
    if (!canGenerate) return;
    const saved = requestBody();
    // Admission is durable before the POST. A timeout or tab close after this
    // point must recover by checking this exact ID, never by generating again.
    if (identity?.email) {
      writeDraft({
        email: identity.email,
        title,
        script,
        voiceId,
        titleTouched: titleTouched.current,
        request: saved,
        job,
        unconfirmed: true,
      });
    }
    setUnconfirmed(true);
    setBusy(true);
    setError(null);
    try {
      await checkOrSubmit();
    } catch (generationError) {
      if (!alive.current) return;
      setUnconfirmed(
        errorStatus(generationError) === null || (errorStatus(generationError) ?? 0) >= 500,
      );
      setError(errorText(generationError));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="page standalone-voiceover-page">
      <PageHeader
        eyebrow="Voiceover studio"
        title="Turn your script into a voiceover"
        description="Add your scripts. We’ll make the voiceovers. Come back when they’re ready."
        actions={
          <Link to="/voiceovers" className="button button-secondary">
            <Library size={16} aria-hidden="true" />
            Browse voices
          </Link>
        }
      />

      <div className="standalone-voiceover-layout">
        <form
          className="standalone-voiceover-card"
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <div className="standalone-card-heading">
            <span className="standalone-card-icon" aria-hidden="true">
              <Headphones size={22} />
            </span>
            <div>
              <h2>Create a voiceover</h2>
              <p>Choose a voice, add your script, and keep going.</p>
            </div>
          </div>

          <label className="field">
            <span className="field-label">Voiceover title</span>
            <input
              className="input"
              aria-label="Voiceover title"
              maxLength={140}
              placeholder="e.g. The story of slow design"
              value={title}
              disabled={locked}
              onChange={(event) => changeTitle(event.target.value)}
            />
          </label>

          <div className="standalone-voiceover-input-row">
            <div className="standalone-voice-select">
              <VoiceSelect
                voices={voices.data?.voices ?? []}
                collections={voices.data?.collections}
                value={voiceId}
                disabled={locked || voices.isPending || Boolean(voices.error)}
                onChange={changeVoice}
              />
              {voices.error ? (
                <button
                  className="standalone-inline-retry"
                  type="button"
                  onClick={() => void voices.refetch()}
                >
                  <RefreshCcw size={14} aria-hidden="true" /> Retry voices
                </button>
              ) : null}
            </div>
            <label className="standalone-file-picker">
              <span className="field-label">Script file</span>
              <span className="standalone-file-button">
                <Upload size={16} aria-hidden="true" />
                Upload .txt
              </span>
              <input
                className="sr-only"
                aria-label="Upload script file"
                type="file"
                accept=".txt,text/plain"
                disabled={locked}
                onChange={(event) => {
                  void readScriptFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          <label className="field standalone-script-field">
            <span className="field-label">Script</span>
            <textarea
              className="textarea standalone-script-textarea"
              aria-label="Voiceover script"
              rows={12}
              maxLength={MAX_SCRIPT_LENGTH}
              value={script}
              disabled={locked}
              placeholder="Paste your narration here…"
              onChange={(event) => changeScript(event.target.value)}
            />
            <span className="standalone-script-meta">
              <span>{script.length.toLocaleString()} / 100,000 characters</span>
              <span>
                <Clock3 size={14} aria-hidden="true" /> {readableDuration(null, script)} read
              </span>
            </span>
          </label>

          {error ? (
            <div className="standalone-message standalone-message-error" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
          {unconfirmed && !busy ? (
            <div className="standalone-message standalone-message-warning" role="status">
              <RefreshCcw size={17} aria-hidden="true" />
              <span>Request status is uncertain. Check the saved request before retrying.</span>
            </div>
          ) : null}

          <div className="standalone-submit-row">
            <span className="standalone-submit-hint">
              {selectedVoice ? `${selectedVoice.name} · MP3` : "Choose a voice to continue"}
            </span>
            <button
              className="button button-primary standalone-submit"
              type="submit"
              disabled={!canGenerate}
            >
              {busy ? (
                <LoaderCircle className="is-spinning" size={17} aria-hidden="true" />
              ) : (
                <WandSparkles size={17} aria-hidden="true" />
              )}
              {busy ? "Adding…" : unconfirmed ? "Check generation" : "Add to queue"}
            </button>
          </div>
        </form>

        <aside className="standalone-voiceover-result" aria-label="Voiceover queue">
          <div className="standalone-result-heading">
            <div>
              <p className="eyebrow">Your workspace</p>
              <h2>Voiceover queue</h2>
            </div>
            <button
              type="button"
              className="button button-ghost standalone-queue-refresh"
              aria-label="Refresh voiceover queue"
              onClick={() => void recent.refetch()}
            >
              <RefreshCcw size={17} aria-hidden="true" />
            </button>
          </div>
          <p className="standalone-queue-intro">
            Keep adding scripts. Everything continues in the background.
          </p>
          <div className="standalone-queue-summary">
            <span>
              <i className="standalone-status-dot" />
              {activeCount} in progress
            </span>
            <span>
              <Check size={14} aria-hidden="true" />
              {readyCount} ready
            </span>
          </div>
          {notice ? (
            <p className="standalone-queue-notice" role="status">
              <CheckCircle2 size={16} aria-hidden="true" />
              {notice}
            </p>
          ) : null}
          {recent.isError ? (
            <p role="alert" className="standalone-queue-error">
              Queue couldn’t refresh. Your saved work is safe.{" "}
              <button type="button" onClick={() => void recent.refetch()}>
                Try again
              </button>
            </p>
          ) : null}
          {recent.isPending && !queueJobs.length ? (
            <p className="standalone-queue-intro" role="status">
              Loading your voiceovers…
            </p>
          ) : null}
          {!recent.isPending && !queueJobs.length ? (
            <div className="standalone-result-empty">
              <span className="standalone-result-empty-icon">
                <Headphones size={25} aria-hidden="true" />
              </span>
              <strong>Your next voiceover starts here</strong>
              <p>Add a script to the queue. Finished MP3s stay here and in your Library.</p>
            </div>
          ) : null}
          <ol className="standalone-queue-list" aria-label="Voiceover jobs" tabIndex={0}>
            {queueJobs.map((item) => {
              const ready = READY_STATES.has(item.state) && Boolean(item.audio_url);
              const active = ACTIVE_STATES.has(item.state);
              const name = item.title || item.filename || "Untitled voiceover";
              return (
                <li
                  key={item.id}
                  className={`standalone-queue-item ${ready ? "is-ready" : active ? "is-active" : "needs-attention"}`}
                >
                  <div className="standalone-queue-item-header">
                    <span className="standalone-queue-item-icon" aria-hidden="true">
                      {ready ? (
                        <CheckCircle2 size={18} />
                      ) : item.state === "WAITING" ? (
                        <Clock3 size={18} />
                      ) : active ? (
                        <LoaderCircle size={18} className="is-spinning" />
                      ) : (
                        <AlertTriangle size={18} />
                      )}
                    </span>
                    <div>
                      <h3>{name}</h3>
                      <p>
                        {item.voice_name || "Selected voice"}
                        {item.duration_ms ? ` · ${readableDuration(item.duration_ms, "")}` : ""}
                      </p>
                    </div>
                    <span className="standalone-queue-state">{stateLabel(item.state)}</span>
                  </div>
                  {ready ? (
                    <div className="standalone-queue-audio">
                      <audio
                        controls
                        preload="none"
                        src={item.audio_url!}
                        aria-label={`Listen to ${name}`}
                      />
                      <a
                        className="button button-secondary"
                        href={
                          item.download_url ||
                          `${item.audio_url}${item.audio_url?.includes("?") ? "&" : "?"}download=1`
                        }
                        aria-label={`Download ${name}`}
                      >
                        <Download size={16} aria-hidden="true" />
                        <span>MP3</span>
                      </a>
                    </div>
                  ) : null}
                  {item.state === "UNKNOWN_NO_RETRY" ? (
                    <p className="standalone-job-copy">
                      Generation needs a status check. This request won’t be submitted twice.{" "}
                      <button
                        type="button"
                        className="standalone-inline-retry"
                        onClick={() => {
                          void voiceoverJson<JobResponse>(
                            `/api/v2/voiceovers/jobs/${encodeURIComponent(item.id)}`,
                          )
                            .then(() =>
                              queryClient.invalidateQueries({ queryKey: ["voiceover-library"] }),
                            )
                            .catch((checkError: unknown) => setError(errorText(checkError)));
                        }}
                      >
                        Check status
                      </button>
                    </p>
                  ) : null}
                  {item.state === "FAILED" || item.state === "ARCHIVE_FAILED" ? (
                    <p className="standalone-job-copy">
                      We couldn’t finish this voiceover. Its details are saved in your Library.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {(recent.data?.total ?? 0) > savedJobs.length ? (
            <p className="standalone-queue-intro">
              Showing your latest {savedJobs.length} voiceovers. Your full history is in Library.
            </p>
          ) : null}
          <Link to="/library" className="standalone-queue-library">
            <Library size={16} aria-hidden="true" />
            Open Library <span aria-hidden="true">↗</span>
          </Link>
        </aside>
      </div>
    </div>
  );
}

export type { StandaloneVoiceoverJob };
