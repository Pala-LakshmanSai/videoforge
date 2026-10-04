import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Headphones,
  Pause,
  Play,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import { VoiceSelect } from "./VoiceSelect";
import { matchesVoiceName, type Voice } from "./voice-library";
export type { Voice } from "./voice-library";
import { PageHeader } from "../components/PageHeader";

interface VoiceoverJob {
  id: string;
  state: string;
  filename: string;
  voice_id: string;
  failure_code: string | null;
  audio_url: string | null;
  script?: string;
}
class VoiceoverRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function voiceoverJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json()) as T & { error?: { code: string; message?: string } };
  if (!res.ok)
    throw new VoiceoverRequestError(
      body.error?.message ?? body.error?.code ?? "Voiceover request failed.",
      res.status,
    );
  return body;
}
export function useVoices(enabled = true) {
  return useQuery({
    queryKey: ["voiceover-voices"],
    queryFn: () => voiceoverJson<{ voices: Voice[] }>("/api/v2/voiceovers/voices"),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}
export function VoiceoverHub() {
  const [importId, setImportId] = useState("");
  const voices = useVoices(),
    client = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"saved" | "starred" | "all" | null>(null);
  const [limit, setLimit] = useState(60);
  const [preview, setPreview] = useState<Voice | null>(null);
  const [playing, setPlaying] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const importDetails = useRef<HTMLDetailsElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const all = voices.data?.voices ?? [];
  const savedCount = all.filter((voice) => voice.saved).length;
  const starredCount = all.filter((voice) => voice.starred).length;
  const selectedFilter = filter ?? (savedCount ? "saved" : "all");
  useEffect(() => {
    if (voices.data && filter === null) setFilter(savedCount ? "saved" : "all");
  }, [voices.data, filter, savedCount]);
  useEffect(() => setLimit(60), [search, selectedFilter]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  function closeImport() {
    if (importDetails.current) importDetails.current.open = false;
    setImportOpen(false);
  }
  useEffect(() => {
    if (!importOpen) return;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !importDetails.current?.contains(event.target))
        closeImport();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [importOpen]);
  const save = useMutation({
    mutationFn: ({ voice, saved, starred }: { voice: Voice; saved: boolean; starred: boolean }) =>
      voiceoverJson(`/api/v2/voiceovers/voices/${voice.voice_id}`, {
        method: "POST",
        body: JSON.stringify({ saved, starred }),
      }),
    onSuccess: (_result, change) => {
      client.setQueryData<{ voices: Voice[] }>(
        ["voiceover-voices"],
        (data) =>
          data && {
            voices: data.voices.map((voice) =>
              voice.voice_id === change.voice.voice_id
                ? { ...voice, saved: change.saved, starred: change.starred }
                : voice,
            ),
          },
      );
      setNotice(
        change.starred
          ? "Voice starred and saved."
          : change.saved
            ? "Voice saved."
            : "Voice removed from Saved.",
      );
      return client.invalidateQueries({ queryKey: ["voiceover-voices"] });
    },
  });
  const importVoice = useMutation({
    mutationFn: () =>
      voiceoverJson("/api/v2/voiceovers/import", {
        method: "POST",
        body: JSON.stringify({ voice_id: importId.trim() }),
      }),
    onSuccess: () => {
      setImportId("");
      setSearch("");
      setFilter("saved");
      closeImport();
      importDetails.current?.querySelector("summary")?.focus();
      setNotice("Voice imported and saved.");
      return client.invalidateQueries({ queryKey: ["voiceover-voices"] });
    },
  });
  const visible = all
    .filter(
      (voice) =>
        (selectedFilter === "all" || (selectedFilter === "saved" ? voice.saved : voice.starred)) &&
        matchesVoiceName(voice, search),
    )
    .sort(
      (a, b) =>
        (selectedFilter === "all" ? 0 : Number(b.starred) - Number(a.starred)) ||
        a.name.localeCompare(b.name),
    );
  const displayed = visible.slice(0, limit);
  function listen(voice: Voice) {
    setPreviewError(null);
    if (preview?.voice_id === voice.voice_id && audio.current) {
      if (previewError || audio.current.error) audio.current.load();
      if (!audio.current.paused) audio.current.pause();
      else
        void audio.current
          .play()
          .catch(() =>
            setPreviewError("Preview could not play. Try again or choose another voice."),
          );
    } else {
      setPlaying(false);
      setPreview(voice);
    }
  }
  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }
  return (
    <div className="page voiceover-hub">
      <PageHeader
        eyebrow="Your voice library"
        title="Voiceover Hub"
        description="A voice for every story. Keep your favorites close."
        actions={
          <details
            className="voice-import"
            ref={importDetails}
            onToggle={(event) => setImportOpen(event.currentTarget.open)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeImport();
                importDetails.current?.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-expanded={importOpen}>
              <Plus size={17} aria-hidden="true" />
              Import voice
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <form
              className="voice-import-panel"
              onSubmit={(event) => {
                event.preventDefault();
                if (importId.trim() && !importVoice.isPending) importVoice.mutate();
              }}
            >
              <strong>Import from ElevenLabs</strong>
              <p>Paste a voice ID to add it to your private library.</p>
              <label className="field">
                <span className="field-label">Voice ID</span>
                <input
                  className="input"
                  aria-label="ElevenLabs voice ID"
                  placeholder="Paste voice ID"
                  value={importId}
                  maxLength={160}
                  disabled={importVoice.isPending}
                  onChange={(event) => setImportId(event.target.value)}
                />
              </label>
              <button
                className="button button-primary"
                type="submit"
                disabled={!importId.trim() || importVoice.isPending}
              >
                {importVoice.isPending ? "Importing…" : "Import and save"}
              </button>
              {importVoice.error && <p role="alert">{importVoice.error.message}</p>}
            </form>
          </details>
        }
      />
      <div className="voice-hub-toolbar">
        <div className="voice-hub-search">
          <Search size={20} aria-hidden="true" />
          <input
            ref={searchInput}
            type="search"
            aria-label="Search voices"
            placeholder="Search by voice name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") clearSearch();
            }}
          />
          {search && (
            <button
              type="button"
              className="voice-icon-button"
              aria-label="Clear voice search"
              onClick={clearSearch}
            >
              <X size={17} />
            </button>
          )}
        </div>
        <div className="voice-hub-library-row">
          <div className="voice-hub-filters" role="group" aria-label="Voice library">
            {(
              [
                { id: "all", label: "All voices", count: all.length },
                { id: "saved", label: "Saved", count: savedCount },
                { id: "starred", label: "Starred", count: starredCount },
              ] as const
            ).map((item) => (
              <button
                type="button"
                key={item.id}
                className={selectedFilter === item.id ? "is-active" : ""}
                aria-pressed={selectedFilter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span>{item.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
          <p className="voice-results-count" role="status">
            {voices.isPending
              ? "Loading library…"
              : `${visible.length.toLocaleString()} ${visible.length === 1 ? "voice" : "voices"}${search.trim() ? ` starting with “${search.trim()}”` : ""}`}
          </p>
        </div>
      </div>
      {notice && (
        <p className="voice-hub-notice" role="status">
          <Check size={16} aria-hidden="true" />
          {notice}
        </p>
      )}
      {voices.isPending && (
        <div className="voice-hub-grid" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <div className="voice-card voice-card-skeleton" key={n}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      )}
      {voices.error && (
        <div className="voice-hub-empty" role="alert">
          <Headphones size={32} />
          <h3>Voices could not load</h3>
          <p>{voices.error.message}</p>
          <button className="button button-secondary" onClick={() => void voices.refetch()}>
            Try again
          </button>
        </div>
      )}
      {save.error && (
        <p className="voice-hub-notice" role="alert">
          {save.error.message}
        </p>
      )}
      {preview && (
        <div className="voice-preview">
          <span className="voice-preview-symbol">
            <Headphones size={22} aria-hidden="true" />
          </span>
          <div className="voice-preview-copy">
            <small>{playing ? "Now playing" : "Voice preview"}</small>
            <strong>{preview.name}</strong>
          </div>
          <audio
            ref={audio}
            key={preview.voice_id}
            aria-label={`${preview.name} preview`}
            src={preview.preview_url ?? undefined}
            controls
            autoPlay
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setPlaying(false);
              setPreviewError("Preview unavailable. Try another voice or listen again.");
            }}
          />
          <button
            type="button"
            className="voice-icon-button"
            aria-label="Close voice preview"
            onClick={() => {
              setPreview(null);
              setPlaying(false);
              setPreviewError(null);
            }}
          >
            <X size={19} />
          </button>
          {previewError && (
            <p role="alert" className="voice-preview-error">
              {previewError}
            </p>
          )}
        </div>
      )}
      {!voices.isPending && !voices.error && !visible.length && (
        <div className="voice-hub-empty">
          <span className="voice-empty-symbol">
            {search.trim() ? <Search size={28} /> : <Bookmark size={28} />}
          </span>
          <h3>
            {search.trim()
              ? "No matching voices"
              : selectedFilter === "starred"
                ? "Your favorites belong here"
                : "Build your voice library"}
          </h3>
          <p>
            {search.trim()
              ? "Try the beginning of a voice name, or browse the full library."
              : selectedFilter === "starred"
                ? "Star a voice to find it first when you create."
                : "Listen to a few voices, then save the ones you love."}
          </p>
          <div className="voice-empty-actions">
            {search && (
              <button className="button button-secondary" onClick={clearSearch}>
                Clear search
              </button>
            )}
            {selectedFilter !== "all" && (
              <button className="button button-primary" onClick={() => setFilter("all")}>
                Explore all voices
              </button>
            )}
          </div>
        </div>
      )}
      <div className="voice-hub-grid">
        {displayed.map((voice) => {
          const isPlaying = preview?.voice_id === voice.voice_id && playing;
          const pending = save.isPending && save.variables?.voice.voice_id === voice.voice_id;
          const tone = (voice.name.codePointAt(0) ?? 0) % 5;
          return (
            <article
              className={`voice-card ${preview?.voice_id === voice.voice_id ? "is-previewing" : ""}`}
              key={voice.voice_id}
            >
              <div className="voice-card-heading">
                <span className={`voice-monogram voice-tone-${tone}`} aria-hidden="true">
                  {Array.from(voice.name)[0]?.toUpperCase()}
                </span>
                <h3 title={voice.name}>{voice.name}</h3>
                <button
                  type="button"
                  className="voice-star"
                  aria-label={`${voice.starred ? "Unstar" : "Star"} ${voice.name}`}
                  aria-pressed={voice.starred}
                  title={voice.starred ? "Remove star" : "Star voice"}
                  disabled={save.isPending}
                  onClick={() => save.mutate({ voice, saved: true, starred: !voice.starred })}
                >
                  <Star size={18} fill={voice.starred ? "currentColor" : "none"} />
                </button>
              </div>
              <div className="voice-card-tags">
                {(voice.tags || "Narration")
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .slice(0, 3)
                  .map((tag, i) => (
                    <span key={`${tag}-${i}`}>{tag}</span>
                  ))}
              </div>
              <div className="voice-card-actions">
                <button
                  type="button"
                  className={`voice-listen ${isPlaying ? "is-playing" : ""}`}
                  disabled={!voice.preview_url}
                  aria-label={`${isPlaying ? "Pause" : "Listen to"} ${voice.name}`}
                  onClick={() => listen(voice)}
                >
                  <span>
                    {isPlaying ? (
                      <Pause size={15} fill="currentColor" />
                    ) : (
                      <Play size={15} fill="currentColor" />
                    )}
                  </span>
                  {voice.preview_url ? (isPlaying ? "Pause" : "Listen") : "No preview"}
                </button>
                <button
                  type="button"
                  className={`voice-save ${voice.saved ? "is-saved" : ""}`}
                  aria-label={`${voice.saved ? "Remove" : "Save"} ${voice.name}`}
                  aria-pressed={voice.saved}
                  disabled={save.isPending}
                  onClick={() => save.mutate({ voice, saved: !voice.saved, starred: false })}
                >
                  {voice.saved ? <Check size={15} /> : <Plus size={15} />}
                  {pending ? "Saving…" : voice.saved ? "Saved" : "Save voice"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {visible.length > displayed.length && (
        <div className="voice-hub-more">
          <p className="muted">
            Showing {displayed.length} of {visible.length.toLocaleString()} voices
          </p>
          <button
            className="button button-secondary"
            onClick={() => setLimit((value) => value + 60)}
          >
            Show more voices
          </button>
        </div>
      )}
    </div>
  );
}
export interface ScriptProjectInput {
  script: string;
  voiceId: string;
}
/** Draft input only. Create video owns the durable submission and progress. */
export function ScriptProjectFields({
  value,
  onChange,
  disabled,
}: {
  value: ScriptProjectInput;
  onChange: (value: ScriptProjectInput) => void;
  disabled: boolean;
}) {
  const voices = useVoices();
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const readSequence = useRef(0);
  const current = useRef(value);
  current.current = value;
  useEffect(
    () => () => {
      readSequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (!value.voiceId && voices.data) {
      const preferred =
        voices.data.voices.find((v) => v.starred) ?? voices.data.voices.find((v) => v.saved);
      if (preferred) onChange({ ...value, voiceId: preferred.voice_id });
    }
  }, [voices.data, value, onChange]);
  return (
    <div className="script-voiceover">
      <div className="create-section-grid">
        <label className="field">
          <span className="field-label">Script file</span>
          <input
            className="input"
            type="file"
            accept=".txt,text/plain"
            disabled={disabled}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const sequence = ++readSequence.current;
              setError(null);
              onChange({ ...current.current, script: "" });
              if (!/\.txt$/iu.test(file.name) || file.size > 400000) {
                setError("Choose a plain text (.txt) file, up to 100,000 characters.");
                return;
              }
              setReading(true);
              try {
                const script = await file.text();
                if (sequence !== readSequence.current) return;
                if (!script.trim() || script.length > 100000 || script.includes("\0"))
                  throw new Error("Use 1 to 100,000 plain text characters.");
                onChange({ ...current.current, script });
              } catch (e) {
                if (sequence === readSequence.current)
                  setError(e instanceof Error ? e.message : "Unable to read script.");
              } finally {
                if (sequence === readSequence.current) setReading(false);
              }
            }}
          />
        </label>
        <div className="field">
          <VoiceSelect
            voices={voices.data?.voices ?? []}
            value={value.voiceId}
            disabled={disabled || voices.isPending}
            onChange={(voiceId) => onChange({ ...value, voiceId })}
          />
          <Link to="/voiceovers">Manage voices</Link>
        </div>
      </div>
      <label className="field">
        <span className="field-label">Script</span>
        <textarea
          className="textarea"
          rows={8}
          aria-label="Voiceover script"
          placeholder="Paste your narration, or upload a .txt file above."
          disabled={disabled || reading}
          maxLength={100000}
          value={value.script}
          onChange={(event) => {
            setError(null);
            onChange({ ...value, script: event.target.value });
          }}
        />
        <span className="helper">{value.script.length.toLocaleString()} / 100,000 characters</span>
      </label>
      {reading ? (
        <p role="status" className="helper">
          Reading script…
        </p>
      ) : null}
      {error || voices.isError ? (
        <p role="alert" className="validation validation-danger">
          {error ?? "Voices could not load."}{" "}
          {voices.isError ? (
            <button type="button" onClick={() => void voices.refetch()}>
              Retry voices
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="validation validation-info">
        <Headphones size={18} aria-hidden="true" />
        <span>
          <strong>Voiceover comes first.</strong> Click Create video to generate your narration,
          then build your video automatically. You can follow each stage in Progress.
        </span>
      </div>
    </div>
  );
}

export function ScriptVoiceover({
  disabled,
  onReady,
  onInvalidate,
}: {
  disabled: boolean;
  onReady: (file: File) => void;
  onInvalidate: () => void;
}) {
  const voices = useVoices(),
    [script, setScript] = useState(""),
    [filename, setFilename] = useState("voiceover.mp3"),
    [voiceId, setVoiceId] = useState(""),
    [error, setError] = useState<string | null>(null),
    [job, setJob] = useState<VoiceoverJob | null>(null),
    [unconfirmed, setUnconfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [audioUrl, setAudioUrl] = useState<string | null>(null);
  const request = useRef<{ id: string; body: string } | null>(null),
    loaded = useRef<string | null>(null),
    alive = useRef(true),
    objectUrl = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  const current = useRef({ script, voiceId, filename });
  current.current = { script, voiceId, filename };
  const jobs = useQuery({
    queryKey: ["voiceover-latest-job"],
    queryFn: () => voiceoverJson<{ job: VoiceoverJob | null }>("/api/v2/voiceovers/jobs"),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const activeJob = job ?? (jobs.isFetchedAfterMount ? jobs.data?.job : null) ?? null;
  useEffect(() => {
    if (jobs.isFetchedAfterMount && jobs.data?.job && !job) {
      setJob(jobs.data.job);
      if (!current.current.script) {
        setScript(jobs.data.job.script ?? "");
        setVoiceId(jobs.data.job.voice_id);
        setFilename(jobs.data.job.filename);
        chooseDefault.current = true;
      }
    }
  }, [jobs.data, jobs.isFetchedAfterMount]);
  const status = useQuery({
    queryKey: ["voiceover-job", activeJob?.id],
    queryFn: () => voiceoverJson<{ job: VoiceoverJob }>(`/api/v2/voiceovers/jobs/${activeJob!.id}`),
    enabled: Boolean(activeJob && ["PROCESSING", "SUBMITTING"].includes(activeJob.state)),
    retry: false,
    refetchInterval: 3_000,
  });
  useEffect(() => {
    if (status.data?.job) setJob(status.data.job);
  }, [status.data]);
  const chooseDefault = useRef(false);
  useEffect(() => {
    if (chooseDefault.current || !voices.data) return;
    const first =
      voices.data.voices.find((v) => v.starred) ?? voices.data.voices.find((v) => v.saved);
    if (first) setVoiceId(first.voice_id);
    chooseDefault.current = true;
  }, [voices.data]);
  async function acceptAudio(selected: VoiceoverJob) {
    if (!selected.audio_url) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(selected.audio_url, {
        credentials: "same-origin",
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error("Unable to download voiceover. Try again.");
      const blob = await res.blob();
      if (!blob.size || blob.size > 1_073_741_824)
        throw new Error("Generated voiceover has an invalid size.");
      if (!alive.current) return;
      const file = new File([blob], selected.filename, { type: "audio/mpeg" });
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(file);
      setAudioUrl(objectUrl.current);
      onReady(file);
      loaded.current = selected.id;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Voiceover download failed.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (activeJob?.state === "COMPLETED" && activeJob.id !== loaded.current) {
      loaded.current = activeJob.id;
      void acceptAudio(activeJob);
    }
  }, [activeJob?.id, activeJob?.state]);
  function change(clearRequest = true) {
    onInvalidate();
    setAudioUrl(null);
    setError(null);
    if (clearRequest) request.current = null;
  }
  async function generate() {
    if (disabled || busy) return;
    setBusy(true);
    setError(null);
    setAudioUrl(null);
    onInvalidate();
    const input = { ...current.current };
    if (!request.current) request.current = { id: crypto.randomUUID(), body: "" };
    if (!request.current.body)
      request.current.body = JSON.stringify({
        id: request.current.id,
        script: input.script,
        voice_id: input.voiceId,
        filename: input.filename,
      });
    try {
      const result = await voiceoverJson<{ job: VoiceoverJob }>("/api/v2/voiceovers/jobs", {
        method: "POST",
        body: request.current.body,
        signal: AbortSignal.timeout(45_000),
      });
      if (alive.current) {
        setUnconfirmed(false);
        setJob(result.job);
        loaded.current = null;
      }
    } catch (e) {
      if (alive.current) {
        setUnconfirmed(!(e instanceof VoiceoverRequestError) || e.status >= 500);
        setError(
          e instanceof Error
            ? e.message
            : "Request timed out. Check your saved generation before trying again.",
        );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const locked =
    disabled ||
    busy ||
    !jobs.isFetchedAfterMount ||
    Boolean(
      activeJob && ["PROCESSING", "SUBMITTING", "UNKNOWN_NO_RETRY"].includes(activeJob.state),
    );
  const inputLocked = locked || unconfirmed;
  return (
    <div className="script-voiceover">
      <div className="script-voiceover-fields">
        <label className="field">
          <span className="field-label">Script file</span>
          <input
            className="input"
            aria-label="Script file"
            type="file"
            accept=".txt,text/plain"
            disabled={inputLocked}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              change();
              setScript("");
              if (!/\.txt$/iu.test(file.name) || file.size > 400_000) {
                setError("Upload a plain text (.txt) script, up to 100,000 characters.");
                return;
              }
              setBusy(true);
              try {
                const text = await file.text();
                if (!alive.current) return;
                if (!text.trim() || text.length > 100_000 || text.includes("\0")) {
                  setError("Script must contain 1 to 100,000 plain text characters.");
                  return;
                }
                setScript(text);
                setFilename(
                  file.name
                    .replace(/\.txt$/iu, ".mp3")
                    .replace(/[^A-Za-z0-9._-]/gu, "_")
                    .slice(0, 150)
                    .replace(/\.mp3$/iu, "") + ".mp3",
                );
              } catch {
                if (alive.current)
                  setError("This script file could not be read. Try another .txt file.");
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          />
        </label>
        <div className="field">
          <VoiceSelect
            voices={voices.data?.voices ?? []}
            value={voiceId}
            disabled={inputLocked || voices.isPending}
            onChange={(id) => {
              change();
              setVoiceId(id);
            }}
          />
          <Link to="/voiceovers">Manage voices</Link>
        </div>
      </div>
      <label className="field">
        <span className="field-label">Script</span>
        <textarea
          className="textarea"
          aria-label="Voiceover script"
          rows={8}
          maxLength={100_000}
          value={script}
          disabled={inputLocked}
          placeholder="Upload a .txt file or paste your script here."
          onChange={(e) => {
            change();
            setScript(e.target.value);
          }}
        />
        <span className="muted">{script.length.toLocaleString()} / 100,000 characters</span>
      </label>
      {voices.error && <p role="alert">{voices.error.message}</p>}
      {(error || status.error) && <p role="alert">{error ?? status.error?.message}</p>}
      {unconfirmed && (
        <p role="status">
          Check this generation before changing the script; its response is unconfirmed.
        </p>
      )}
      {activeJob && ["PROCESSING", "SUBMITTING"].includes(activeJob.state) && (
        <p role="status">Creating voiceover… You can return later.</p>
      )}
      {activeJob?.state === "UNKNOWN_NO_RETRY" && (
        <p role="alert">
          The provider response is uncertain. Your request is saved and will not be submitted again.
          Upload audio while this request is reconciled.
        </p>
      )}
      {activeJob?.state === "FAILED" && (
        <p role="alert">
          Voice generation failed ({activeJob.failure_code}). You can try a new generation.
        </p>
      )}
      {audioUrl && (
        <div className="generated-voiceover">
          <span>Voiceover ready · {activeJob?.filename}</span>
          <audio aria-label="Generated voiceover preview" controls src={audioUrl} />
          <a href={audioUrl} download={activeJob?.filename ?? filename}>
            Download MP3
          </a>
        </div>
      )}
      {activeJob?.state === "COMPLETED" && !audioUrl && !unconfirmed && (
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void acceptAudio(activeJob)}
        >
          Load saved voiceover
        </button>
      )}
      <button
        className="button button-primary"
        disabled={locked || !script.trim() || !voiceId}
        onClick={() => {
          if (
            !unconfirmed &&
            request.current?.id === activeJob?.id &&
            (activeJob?.state === "FAILED" || activeJob?.state === "COMPLETED")
          )
            request.current = null;
          void generate();
        }}
      >
        {busy
          ? "Preparing voiceover…"
          : unconfirmed
            ? "Check generation"
            : audioUrl
              ? "Generate again"
              : "Generate voiceover"}
      </button>
    </div>
  );
}
