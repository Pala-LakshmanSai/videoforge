import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bookmark, Search, Star, Volume2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

export interface Voice {
  voice_id: string;
  name: string;
  tags: string;
  languages: string;
  preview_url: string | null;
  saved: boolean;
  starred: boolean;
}
interface VoiceoverJob {
  id: string;
  state: string;
  filename: string;
  voice_id: string;
  failure_code: string | null;
  audio_url: string | null;
}
export async function voiceoverJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json()) as T & { error?: { code: string; message?: string } };
  if (!res.ok)
    throw new Error(body.error?.message ?? body.error?.code ?? "Voiceover request failed.");
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
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("saved"),
    [preview, setPreview] = useState<Voice | null>(null);
  const save = useMutation({
    mutationFn: ({ voice, saved, starred }: { voice: Voice; saved: boolean; starred: boolean }) =>
      voiceoverJson(`/api/v2/voiceovers/voices/${voice.voice_id}`, {
        method: "POST",
        body: JSON.stringify({ saved, starred }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["voiceover-voices"] }),
  });
  const importVoice = useMutation({
    mutationFn: () =>
      voiceoverJson("/api/v2/voiceovers/import", {
        method: "POST",
        body: JSON.stringify({ voice_id: importId.trim() }),
      }),
    onSuccess: () => {
      setImportId("");
      setFilter("saved");
      return client.invalidateQueries({ queryKey: ["voiceover-voices"] });
    },
  });
  const all = voices.data?.voices ?? [];
  const visible = all
    .filter(
      (v) =>
        (filter === "all" || (filter === "saved" ? v.saved : v.starred)) &&
        `${v.name} ${v.tags} ${v.languages}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => Number(b.starred) - Number(a.starred) || a.name.localeCompare(b.name));
  const displayed = visible.slice(0, 100);
  return (
    <div className="page voiceover-hub">
      <PageHeader
        title="Voiceover Hub"
        description="Find a voice. Save your favorites for the next script."
      />
      <div className="voice-hub-toolbar">
        <div className="voice-hub-filters" role="group" aria-label="Voice library">
          <button
            className={filter === "saved" ? "is-active" : ""}
            onClick={() => setFilter("saved")}
          >
            Saved ({all.filter((v) => v.saved).length})
          </button>
          <button
            className={filter === "starred" ? "is-active" : ""}
            onClick={() => setFilter("starred")}
          >
            Starred
          </button>
          <button className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
            All voices
          </button>
        </div>
        <label className="voice-hub-search">
          <Search size={18} />
          <input
            aria-label="Search voices"
            placeholder="Search voices, accent or style"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <details className="voice-import">
        <summary>Import an ElevenLabs voice</summary>
        <div className="voice-import-form">
          <label className="field">
            <span className="field-label">Voice ID</span>
            <input
              aria-label="ElevenLabs voice ID"
              placeholder="Paste the voice ID"
              value={importId}
              maxLength={160}
              disabled={importVoice.isPending}
              onChange={(e) => setImportId(e.target.value)}
            />
          </label>
          <button
            className="button button-secondary"
            disabled={!importId.trim() || importVoice.isPending}
            onClick={() => importVoice.mutate()}
          >
            {importVoice.isPending ? "Importing…" : "Import voice"}
          </button>
        </div>
        <p className="muted">Imported voices are saved in your workspace.</p>
        {importVoice.error && <p role="alert">{importVoice.error.message}</p>}
      </details>
      {voices.isPending && <p role="status">Loading voices…</p>}
      {voices.error && (
        <div role="alert">
          <p>{voices.error.message}</p>
          <button className="button button-secondary" onClick={() => void voices.refetch()}>
            Try again
          </button>
        </div>
      )}
      {save.error && <p role="alert">{save.error.message}</p>}
      {preview && (
        <div className="voice-preview">
          <Volume2 size={20} />
          <span>{preview.name}</span>
          <audio
            key={preview.voice_id}
            aria-label={`${preview.name} preview`}
            src={preview.preview_url ?? undefined}
            controls
            autoPlay
            onError={() => setPreview(null)}
          />
        </div>
      )}
      {!voices.isPending && !voices.error && !visible.length && (
        <div className="voice-hub-empty">
          <Volume2 size={36} />
          <h3>{filter === "all" ? "No matching voices" : `No ${filter} voices yet`}</h3>
          <p>
            {filter === "all"
              ? "Try a different search."
              : "Explore the library and save voices you like."}
          </p>
          {filter !== "all" && (
            <button className="button button-primary" onClick={() => setFilter("all")}>
              Explore voices
            </button>
          )}
        </div>
      )}
      <div className="voice-hub-grid">
        {displayed.map((v) => (
          <article className="voice-card" key={v.voice_id}>
            <div className="voice-card-top">
              <div className="voice-card-icon">
                <Volume2 size={22} />
              </div>
              <button
                className="voice-star"
                aria-label={`${v.starred ? "Unstar" : "Star"} ${v.name}`}
                aria-pressed={v.starred}
                disabled={save.isPending}
                onClick={() => save.mutate({ voice: v, saved: true, starred: !v.starred })}
              >
                <Star size={19} fill={v.starred ? "currentColor" : "none"} />
              </button>
            </div>
            <h3>{v.name}</h3>
            <p>{v.tags || "Narration voice"}</p>
            <div className="voice-card-actions">
              <button
                className="button button-secondary"
                disabled={!v.preview_url}
                onClick={() => setPreview(v)}
              >
                Listen
              </button>
              <button
                className={`button ${v.saved ? "button-secondary" : "button-primary"}`}
                disabled={save.isPending}
                onClick={() => save.mutate({ voice: v, saved: !v.saved, starred: false })}
              >
                <Bookmark size={15} />
                {v.saved ? "Remove" : "Save"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {visible.length > 100 && (
        <p className="muted">Showing 100 of {visible.length} voices. Search to narrow the list.</p>
      )}
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
  const activeJob = job ?? jobs.data?.job ?? null;
  useEffect(() => {
    if (jobs.data?.job && !job) setJob(jobs.data.job);
  }, [jobs.data]);
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
        setJob(result.job);
        loaded.current = null;
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Request timed out. Check your saved generation before trying again.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const locked =
    disabled ||
    busy ||
    Boolean(
      activeJob && ["PROCESSING", "SUBMITTING", "UNKNOWN_NO_RETRY"].includes(activeJob.state),
    );
  const saved =
    voices.data?.voices
      .filter((v) => v.saved)
      .sort((a, b) => Number(b.starred) - Number(a.starred) || a.name.localeCompare(b.name)) ?? [];
  const others = voices.data?.voices.filter((v) => !v.saved) ?? [];
  return (
    <div className="script-voiceover">
      <div className="script-voiceover-fields">
        <label className="field">
          <span className="field-label">Script file</span>
          <input
            aria-label="Script file"
            type="file"
            accept=".txt,text/plain"
            disabled={locked}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!/\.txt$/iu.test(file.name) || file.size > 400_000) {
                setError("Upload a plain text (.txt) script, up to 100,000 characters.");
                return;
              }
              const text = await file.text();
              if (!text.trim() || text.length > 100_000) {
                setError("Script must contain 1 to 100,000 characters.");
                return;
              }
              change();
              setScript(text);
              setFilename(
                file.name
                  .replace(/\.txt$/iu, ".mp3")
                  .replace(/[^A-Za-z0-9._-]/gu, "_")
                  .slice(0, 150)
                  .replace(/\.mp3$/iu, "") + ".mp3",
              );
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Voice</span>
          <select
            aria-label="Script voice"
            value={voiceId}
            disabled={locked || voices.isPending}
            onChange={(e) => {
              change();
              setVoiceId(e.target.value);
            }}
          >
            <option value="">Choose a voice</option>
            <optgroup label="Saved voices">
              {saved.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.starred ? "★ " : ""}
                  {v.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="All voices">
              {others.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          </select>
          <Link to="/voiceovers">Manage voices</Link>
        </label>
      </div>
      <label className="field">
        <span className="field-label">Script</span>
        <textarea
          aria-label="Voiceover script"
          rows={8}
          maxLength={100_000}
          value={script}
          disabled={locked}
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
          <span>Voiceover ready</span>
          <audio aria-label="Generated voiceover preview" controls src={audioUrl} />
          <a href={audioUrl} download={activeJob?.filename ?? filename}>
            Download MP3
          </a>
        </div>
      )}
      {activeJob?.state === "COMPLETED" && !audioUrl && (
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
          if (activeJob?.state === "FAILED" || activeJob?.state === "COMPLETED")
            request.current = null;
          void generate();
        }}
      >
        {busy ? "Preparing voiceover…" : audioUrl ? "Generate again" : "Generate voiceover"}
      </button>
    </div>
  );
}
