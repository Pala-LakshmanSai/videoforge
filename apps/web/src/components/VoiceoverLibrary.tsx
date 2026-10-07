import * as Dialog from "@radix-ui/react-dialog";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  AudioLines,
  Clock3,
  Download,
  Film,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, EmptyState } from "./ui";
import "../styles/features/voiceover-library.css";

export type LibraryMediaTab = "videos" | "voiceovers";

export interface VoiceoverCreator {
  readonly id?: string;
  readonly name?: string;
  readonly email?: string;
  /** Legacy SQL projection kept readable until the API normalizes creator fields. */
  readonly creator_id?: string;
  readonly creator_name?: string;
  readonly creator_email?: string;
}

export interface VoiceoverLibraryItem {
  readonly id: string;
  readonly title: string;
  readonly voice_name: string;
  readonly voice_id: string;
  readonly state: string;
  readonly filename: string;
  readonly created_at: string;
  readonly script: string;
  readonly character_count: number;
  readonly duration_ms?: number | null;
  readonly content_length: number;
  readonly creator_id?: string | null;
  readonly creator_name: string;
  readonly creator_email: string;
  readonly audio_url?: string | null;
  readonly download_url?: string | null;
}

interface VoiceoverLibraryResponse {
  readonly voiceovers: readonly VoiceoverLibraryItem[];
  readonly creators?: readonly VoiceoverCreator[];
  readonly total?: number;
  readonly total_voiceovers?: number;
  readonly total_bytes?: number;
  readonly page?: number;
  readonly page_size?: number;
}

export function LibraryMediaToggle({
  value,
  onChange,
}: {
  value: LibraryMediaTab;
  onChange: (value: LibraryMediaTab) => void;
}) {
  return (
    <div className="library-media-toggle" aria-label="Library media type" role="group">
      <button
        className={value === "videos" ? "is-active" : ""}
        type="button"
        aria-pressed={value === "videos"}
        onClick={() => onChange("videos")}
      >
        <Film size={16} aria-hidden="true" />
        Videos
      </button>
      <button
        className={value === "voiceovers" ? "is-active" : ""}
        type="button"
        aria-pressed={value === "voiceovers"}
        onClick={() => onChange("voiceovers")}
      >
        <AudioLines size={16} aria-hidden="true" />
        Voiceovers
      </button>
    </div>
  );
}

function bytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function duration(milliseconds?: number | null) {
  if (!milliseconds || !Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function stateLabel(state: string, ready: boolean) {
  if (ready) return "Ready";
  if (state === "WAITING") return "Waiting for capacity";
  if (state === "SUBMITTING") return "Starting generation";
  if (state === "PROCESSING") return "Generating MP3";
  if (state === "UNKNOWN_NO_RETRY") return "Status needs a check";
  if (state === "FAILED") return "Generation failed";
  if (state === "ARCHIVE_FAILED") return "Archive failed";
  if (state === "ARCHIVING" || state === "COMPLETED") return "Archiving MP3";
  return state ? state.replaceAll("_", " ").toLowerCase() : "Processing";
}

function canDeleteVoiceover(
  voiceover: Pick<VoiceoverLibraryItem, "state" | "audio_url" | "download_url">,
) {
  return (
    voiceover.state === "COMPLETED" &&
    Boolean(voiceover.audio_url) &&
    Boolean(voiceover.download_url)
  );
}

interface VoiceoverFilters {
  readonly search: string;
  readonly creator: string;
  readonly page: number;
}

async function loadVoiceovers(
  centralized: boolean,
  filters: VoiceoverFilters,
): Promise<VoiceoverLibraryResponse> {
  const params = new URLSearchParams();
  if (centralized) params.set("centralized", "1");
  if (filters.search) params.set("search", filters.search);
  if (filters.creator) params.set("creator", filters.creator);
  params.set("page", String(filters.page));
  const response = await fetch(`/api/v2/voiceovers/library?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 401) throw new Error("Your session expired. Sign in again.");
  if (response.status === 403)
    throw new Error("Voiceover Library is available only to the designated studio owner.");
  if (response.status === 429) throw new Error("Too many requests. Wait a minute, then refresh.");
  if (!response.ok) throw new Error("Voiceovers could not be loaded. Please try again.");
  return response.json() as Promise<VoiceoverLibraryResponse>;
}

export function VoiceoverLibrary({ centralized = false }: { centralized?: boolean }) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<VoiceoverFilters>({ search: "", creator: "", page: 0 });
  const [deleteVoiceover, setDeleteVoiceover] = useState<VoiceoverLibraryItem | null>(null);
  const [audioErrorId, setAudioErrorId] = useState<string | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const queryKey = ["voiceover-library", centralized ? "centralized" : "owned", filters] as const;

  useEffect(() => {
    if (searchInput.trim() === filters.search) return;
    const timeout = window.setTimeout(
      () => setFilters((previous) => ({ ...previous, search: searchInput.trim(), page: 0 })),
      300,
    );
    return () => window.clearTimeout(timeout);
  }, [filters.search, searchInput]);

  const query = useQuery({
    queryKey,
    queryFn: () => loadVoiceovers(centralized, filters),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
    retry: false,
  });
  const remove = useMutation({
    mutationFn: async (voiceoverId: string) => {
      const response = await fetch(
        `/api/v2/voiceovers/library/${encodeURIComponent(voiceoverId)}/delete${
          centralized ? "?centralized=1" : ""
        }`,
        { method: "POST", headers: { accept: "application/json" } },
      );
      if (response.status === 401 || response.status === 403)
        throw new Error("Your owner session is no longer authorized. Sign in again.");
      if (!response.ok)
        throw new Error("The voiceover could not be deleted. Retry to complete deletion.");
    },
    onSuccess: () => {
      setDeleteVoiceover(null);
      void queryClient.invalidateQueries({ queryKey: ["voiceover-library"] });
    },
  });

  const data = query.data;
  const creators = data?.creators ?? [];
  const total = data?.total ?? data?.voiceovers.length ?? 0;
  const totalVoiceovers = data?.total_voiceovers ?? total;
  const page = data?.page ?? filters.page;
  const pageSize = data?.page_size ?? 48;
  const hasFilters = Boolean(filters.search || filters.creator);
  const resetFilters = () => {
    setSearchInput("");
    setFilters({ search: "", creator: "", page: 0 });
  };

  if (query.isPending) {
    return (
      <section className="voiceover-library" aria-busy="true">
        <div className="voiceover-library-loading">
          <span className="spinner" aria-hidden="true" />
          <p>Loading voiceovers…</p>
        </div>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="voiceover-library">
        <EmptyState
          icon={<AlertTriangle />}
          title="Voiceover Library unavailable"
          body={query.error.message}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className="voiceover-library" aria-labelledby="voiceover-library-title">
      <header className="voiceover-library-header">
        <div>
          <span className="voiceover-library-kicker">
            <AudioLines size={15} aria-hidden="true" />
            AUDIO COLLECTION
          </span>
          <h2 id="voiceover-library-title">
            Voiceovers<span>.</span>
          </h2>
          <p>
            {centralized
              ? "Every creator’s narration in one place."
              : "Your generated narration, ready to reuse."}
          </p>
        </div>
        <div className="voiceover-library-stat">
          <strong>{totalVoiceovers}</strong>
          <span>Saved voiceovers</span>
        </div>
      </header>
      <div className="voiceover-library-toolbar">
        <label className="voiceover-library-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search voiceovers"
            placeholder="Search title, voice, or creator…"
            maxLength={200}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        {centralized && creators.length > 0 ? (
          <label className="voiceover-library-filter">
            <UserRound size={16} aria-hidden="true" />
            <select
              aria-label="Filter voiceovers by creator"
              value={filters.creator}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, creator: event.target.value, page: 0 }))
              }
            >
              <option value="">All creators</option>
              {creators.map((item) => (
                <option
                  key={item.id ?? item.creator_id ?? item.email ?? item.creator_email}
                  value={item.id ?? item.creator_id ?? ""}
                >
                  {item.name ?? item.creator_name ?? "Unknown creator"} ·{" "}
                  {item.email ?? item.creator_email ?? ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          variant="secondary"
          aria-label="Refresh voiceovers"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={17} className={query.isFetching ? "voiceover-refreshing" : ""} />
        </Button>
      </div>
      <div className="voiceover-library-results">
        <h3>
          {hasFilters ? "Search results" : "All voiceovers"}
          <span>{total}</span>
        </h3>
        <span>{query.isFetching ? "Updating…" : "Newest first"}</span>
      </div>
      {data?.voiceovers.length === 0 ? (
        <EmptyState
          icon={<AudioLines />}
          title={totalVoiceovers && hasFilters ? "No voiceovers match" : "No voiceovers yet"}
          body={
            totalVoiceovers && hasFilters
              ? "Try a different title, voice, or creator."
              : "Generated voiceovers will appear here automatically."
          }
          action={
            totalVoiceovers && hasFilters ? (
              <Button variant="secondary" onClick={resetFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="voiceover-grid" aria-busy={query.isFetching || undefined}>
          {data?.voiceovers.map((voiceover) => {
            const hasAudio = Boolean(voiceover.audio_url);
            const ready = canDeleteVoiceover(voiceover);
            const canDelete = ready;
            const title = voiceover.title || voiceover.filename || "Untitled voiceover";
            const creatorName = voiceover.creator_name || "Unknown creator";
            const creatorEmail = voiceover.creator_email || "Creator unavailable";
            return (
              <article className="voiceover-card" key={voiceover.id}>
                <div className="voiceover-card-topline">
                  <span className="voiceover-art" aria-hidden="true">
                    <AudioLines size={21} />
                  </span>
                  <span className={ready ? "voiceover-status is-ready" : "voiceover-status"}>
                    {stateLabel(voiceover.state, ready)}
                  </span>
                </div>
                <div className="voiceover-card-creator">
                  <span className="voiceover-avatar" aria-hidden="true">
                    {creatorName.slice(0, 1).toUpperCase() || "?"}
                  </span>
                  <span>
                    <strong>Created by {creatorName}</strong>
                    <small>{creatorEmail}</small>
                  </span>
                </div>
                <h3 title={title}>{title}</h3>
                <div className="voiceover-card-meta">
                  <time dateTime={voiceover.created_at}>{dateLabel(voiceover.created_at)}</time>
                  <span>{bytes(voiceover.content_length)}</span>
                </div>
                {hasAudio ? (
                  <>
                    <audio
                      className="voiceover-audio"
                      controls
                      preload="none"
                      src={voiceover.audio_url ?? undefined}
                      aria-label={`Listen to ${title}`}
                      onPlay={(event) => {
                        if (currentAudio.current && currentAudio.current !== event.currentTarget) {
                          currentAudio.current.pause();
                        }
                        currentAudio.current = event.currentTarget;
                        setAudioErrorId(null);
                      }}
                      onError={() => setAudioErrorId(voiceover.id)}
                      onEnded={(event) => {
                        if (currentAudio.current?.src === event.currentTarget.src) {
                          currentAudio.current = null;
                        }
                      }}
                    >
                      Your browser does not support audio playback.
                    </audio>
                    {audioErrorId === voiceover.id ? (
                      <p className="voiceover-audio-error" role="alert">
                        Audio could not be loaded. Refresh the library and try again.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="voiceover-audio-unavailable">
                    <Clock3 size={15} />
                    {voiceover.state === "FAILED" || voiceover.state === "ARCHIVE_FAILED"
                      ? "No audio was saved"
                      : voiceover.state === "UNKNOWN_NO_RETRY"
                        ? "Audio status needs a check"
                        : "Audio is being prepared"}
                  </div>
                )}
                <dl className="voiceover-details">
                  <div>
                    <dt>Voice</dt>
                    <dd>{voiceover.voice_name || voiceover.voice_id || "—"}</dd>
                  </div>
                  <div>
                    <dt>Length</dt>
                    <dd>{duration(voiceover.duration_ms)}</dd>
                  </div>
                  <div>
                    <dt>Script</dt>
                    <dd>{voiceover.character_count.toLocaleString()} characters</dd>
                  </div>
                </dl>
                {voiceover.script ? (
                  <details className="voiceover-script">
                    <summary>View script</summary>
                    <p>{voiceover.script}</p>
                  </details>
                ) : null}
                <div className="voiceover-card-actions">
                  {voiceover.download_url ? (
                    <a
                      className="button button-secondary"
                      href={voiceover.download_url}
                      download
                      aria-label={`Download ${title}`}
                    >
                      <Download size={15} />
                      Download MP3
                    </a>
                  ) : (
                    <span className="voiceover-no-download">
                      {voiceover.state === "FAILED" || voiceover.state === "ARCHIVE_FAILED"
                        ? "No download"
                        : "Download when ready"}
                    </span>
                  )}
                  <Button
                    variant="secondary"
                    className="voiceover-delete"
                    aria-label={`Delete ${title}`}
                    disabled={remove.isPending || !canDelete}
                    onClick={(event) => {
                      deleteTrigger.current = event.currentTarget;
                      remove.reset();
                      setDeleteVoiceover(voiceover);
                    }}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {data && total > pageSize ? (
        <footer className="voiceover-pagination">
          <span>
            Page {page + 1} of {Math.ceil(total / pageSize)}
          </span>
          <div>
            <Button
              variant="secondary"
              disabled={page === 0 || query.isFetching}
              onClick={() => setFilters((previous) => ({ ...previous, page: previous.page - 1 }))}
            >
              <ChevronLeft size={16} />
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={query.isFetching || (page + 1) * pageSize >= total}
              onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}
            >
              Next
              <ChevronRight size={16} />
            </Button>
          </div>
        </footer>
      ) : null}
      <Dialog.Root
        open={!!deleteVoiceover}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteVoiceover(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content
            className="voiceover-delete-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus();
            }}
          >
            <header>
              <div>
                <Dialog.Title>Delete this voiceover?</Dialog.Title>
                <Dialog.Description>
                  Permanently delete “
                  {deleteVoiceover?.title || deleteVoiceover?.filename || "this voiceover"}” by{" "}
                  {deleteVoiceover?.creator_name || "Unknown creator"} (
                  {deleteVoiceover?.creator_email || "creator unavailable"}). This cannot be undone.
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="button button-secondary"
                aria-label="Close voiceover deletion"
              >
                <X size={18} />
              </Dialog.Close>
            </header>
            {remove.isError ? (
              <p className="voiceover-delete-error" role="alert">
                {remove.error.message}
              </p>
            ) : null}
            <footer className="voiceover-card-actions">
              <Button
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => setDeleteVoiceover(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => deleteVoiceover && remove.mutate(deleteVoiceover.id)}
              >
                <Trash2 size={15} />
                {remove.isPending ? "Deleting…" : "Delete voiceover"}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
