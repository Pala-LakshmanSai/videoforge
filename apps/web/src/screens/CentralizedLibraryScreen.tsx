import { LibraryVideoDetails } from "../components/LibraryVideoDetails";
import type { VideoDetails } from "../lib/library-video-details";
import * as Dialog from "@radix-ui/react-dialog";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Film,
  GalleryHorizontalEnd,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { Button, EmptyState } from "../components/ui";
import { useHostedIdentity } from "../hosted/HostedIdentity";
import "../styles/features/centralized-library.css";

interface Creator {
  creator_id: string;
  creator_name: string;
  creator_email: string;
}
interface Video extends Creator {
  video_details?: VideoDetails;
  attempt_id: string;
  title: string;
  created_at: string;
  content_length: number;
  available: boolean;
  watch_url: string;
  download_url: string;
}
interface Library {
  outputs: Video[];
  total: number;
  total_videos: number;
  total_bytes: number;
  creators: Creator[];
  page_size: number;
}
function size(bytes: number) {
  if (bytes > 0 && bytes < 1024 ** 2) return "<1 MB";
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
}
function VideoCard({
  video,
  onWatch,
  onDelete,
}: {
  video: Video;
  onWatch(trigger: HTMLButtonElement): void;
  onDelete(trigger: HTMLButtonElement): void;
}) {
  const [duration, setDuration] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const card = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!card.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  return (
    <article className="central-video" ref={card}>
      <button
        className="central-thumbnail"
        onClick={(event) => onWatch(event.currentTarget)}
        disabled={!video.available}
        aria-label={`Watch ${video.title}`}
      >
        {video.available && visible ? (
          <video
            muted
            playsInline
            preload="metadata"
            src={`${video.watch_url}#t=0.1`}
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration;
              if (Number.isFinite(seconds)) setDuration(seconds);
            }}
            aria-hidden="true"
          />
        ) : (
          <Film size={36} aria-hidden="true" />
        )}
        <span className="central-play">
          <Play size={22} fill="currentColor" aria-hidden="true" />
        </span>
        <span className="central-duration">
          {!video.available
            ? "Unavailable"
            : duration === null
              ? "MP4"
              : `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`}
        </span>
      </button>
      <div className="central-video-body">
        <div className="central-video-byline">
          <span className="central-avatar" aria-hidden="true">
            {video.creator_name.slice(0, 1).toUpperCase()}
          </span>
          <span className="central-creator">
            <strong>Created by {video.creator_name}</strong>
            <span>{video.creator_email}</span>
          </span>
          <span className="central-ready">{video.available ? "Ready" : "Unavailable"}</span>
        </div>
        <h2 title={video.title}>{video.title}</h2>
        <p className="central-video-meta">
          <time dateTime={video.created_at}>
            {new Date(video.created_at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </time>
          <span>{size(video.content_length)}</span>
        </p>
        <LibraryVideoDetails details={video.video_details} />
        <div className="central-card-actions">
          <Button
            variant="secondary"
            onClick={(event) => onWatch(event.currentTarget)}
            disabled={!video.available}
          >
            <Play size={15} />
            Watch
          </Button>
          {video.available ? (
            <a
              className="button button-secondary central-download"
              href={video.download_url}
              download
              aria-label={`Download ${video.title}`}
            >
              <ArrowDownToLine size={15} />
              Download
            </a>
          ) : (
            <span className="central-unavailable">File unavailable</span>
          )}
          <Button
            variant="secondary"
            className="central-delete"
            aria-label={`Delete ${video.title}`}
            onClick={(event) => onDelete(event.currentTarget)}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
    </article>
  );
}
export function CentralizedLibraryScreen() {
  const queryClient = useQueryClient();
  const identity = useHostedIdentity();
  const allowed = identity?.canViewCentralizedLibrary === true;
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ search: "", creator: "", page: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const watchTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const [deleteVideo, setDeleteVideo] = useState<Video | null>(null);
  const remove = useMutation({
    mutationFn: async (attempt: string) => {
      const response = await fetch(`/api/v2/centralized-library/${attempt}`, {
        method: "DELETE",
        headers: { accept: "application/json" },
      });
      if (response.status === 403 || response.status === 401)
        throw new Error("Your owner session is no longer authorized. Sign in again.");
      if (!response.ok)
        throw new Error("The video could not be deleted. Retry to complete deletion.");
    },
    onSuccess: async () => {
      setDeleteVideo(null);
      setSelectedId(null);
      setFilters((previous) => ({ ...previous, page: 0 }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["centralized-library"] }),
        queryClient.invalidateQueries({ queryKey: ["hosted-library"] }),
      ]);
    },
  });
  useEffect(() => {
    if (search.trim() === filters.search) return;
    const timeout = window.setTimeout(
      () => setFilters((previous) => ({ ...previous, search: search.trim(), page: 0 })),
      300,
    );
    return () => window.clearTimeout(timeout);
  }, [search, filters.search]);
  const query = useQuery({
    queryKey: ["centralized-library", identity?.email, filters],
    enabled: allowed,
    retry: false,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        search: filters.search,
        page: String(filters.page),
        ...(filters.creator ? { creator: filters.creator } : {}),
      });
      const response = await fetch(`/api/v2/centralized-library?${params}`, {
        signal,
        headers: { accept: "application/json" },
      });
      if (response.status === 401) throw new Error("Your session expired. Sign in again.");
      if (response.status === 403)
        throw new Error("Centralized Library is available only to the designated studio owner.");
      if (response.status === 429)
        throw new Error("Too many requests. Wait a minute, then refresh.");
      if (!response.ok) throw new Error("Videos could not be loaded. Please try again.");
      return response.json() as Promise<Library>;
    },
  });
  const data = query.isError ? undefined : query.data;
  const selected = data?.outputs.find(
    (video) => video.attempt_id === selectedId && video.available,
  );
  const resetFilters = () => {
    setSearch("");
    setFilters({ search: "", creator: "", page: 0 });
  };
  if (!allowed)
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Owner access only"
        body="Centralized Library is available only to the designated studio owner."
      />
    );
  return (
    <section className="central-library">
      <header className="central-hero">
        <div className="central-hero-copy">
          <span className="central-eyebrow">
            <GalleryHorizontalEnd size={15} />
            THE STUDIO COLLECTION
          </span>
          <h1>
            Centralized Library<span>.</span>
          </h1>
          <p>Every creator. Every finished video. One place to watch and download.</p>
          <span className="central-owner">
            <ShieldCheck size={14} />
            Owner access
          </span>
        </div>
        <div className="central-stats" aria-label="Collection totals">
          <div>
            <Film size={19} />
            <strong>{data?.total_videos.toLocaleString() ?? "—"}</strong>
            <span>Finished videos</span>
          </div>
          <div>
            <UsersRound size={19} />
            <strong>{data?.creators.length ?? "—"}</strong>
            <span>Creators</span>
          </div>
          <div>
            <ArrowDownToLine size={19} />
            <strong>{data ? size(data.total_bytes) : "—"}</strong>
            <span>In the collection</span>
          </div>
        </div>
      </header>
      <div className="central-toolbar">
        <label className="central-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search videos"
            placeholder="Search videos or creators…"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="central-filter">
          <UsersRound size={16} aria-hidden="true" />
          <select
            aria-label="Filter by creator"
            value={filters.creator}
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, creator: event.target.value, page: 0 }))
            }
          >
            <option value="">All creators</option>
            {data?.creators.map((creator) => (
              <option key={creator.creator_id} value={creator.creator_id}>
                {creator.creator_name} · {creator.creator_email}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          aria-label="Refresh videos"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={17} className={query.isFetching ? "central-refreshing" : ""} />
        </Button>
      </div>
      <div className="central-results">
        <h2>
          {filters.search || filters.creator ? "Search results" : "All videos"}
          <span>{data?.total ?? "—"}</span>
        </h2>
        <span>Newest first</span>
      </div>
      {query.isPending ? (
        <div className="central-grid" aria-busy="true" aria-label="Loading videos">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="central-skeleton" key={index}>
              <div />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="Collection unavailable"
          body={query.error.message}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : data?.outputs.length === 0 ? (
        <EmptyState
          icon={<GalleryHorizontalEnd />}
          title={data.total_videos ? "No videos match" : "Your collection starts here"}
          body={
            data.total_videos
              ? "Try a different title or creator."
              : "Finished videos from all creators will appear here automatically."
          }
          action={
            data.total_videos ? (
              <Button variant="secondary" onClick={resetFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="central-grid">
          {data?.outputs.map((video) => (
            <VideoCard
              key={video.attempt_id}
              video={video}
              onWatch={(trigger) => {
                watchTrigger.current = trigger;
                setPlaybackFailed(false);
                setSelectedId(video.attempt_id);
              }}
              onDelete={(trigger) => {
                deleteTrigger.current = trigger;
                remove.reset();
                setDeleteVideo(video);
              }}
            />
          ))}
        </div>
      )}
      {data && data.total > data.page_size ? (
        <footer className="central-pagination">
          <span>
            Page {filters.page + 1} of {Math.ceil(data.total / data.page_size)}
          </span>
          <div>
            <Button
              variant="secondary"
              disabled={filters.page === 0 || query.isFetching}
              onClick={() => setFilters((previous) => ({ ...previous, page: previous.page - 1 }))}
            >
              <ChevronLeft size={16} />
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={query.isFetching || (filters.page + 1) * data.page_size >= data.total}
              onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}
            >
              Next
              <ChevronRight size={16} />
            </Button>
          </div>
        </footer>
      ) : null}
      <Dialog.Root
        open={allowed && !!deleteVideo}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteVideo(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content
            className="central-player central-delete-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus();
              else document.querySelector<HTMLInputElement>(".central-search input")?.focus();
            }}
          >
            <Dialog.Title>Delete this video?</Dialog.Title>
            <Dialog.Description>
              Permanently delete “{deleteVideo?.title}” by {deleteVideo?.creator_name} (
              {deleteVideo?.creator_email}) from both libraries. This cannot be undone. The project
              and source media stay saved.
            </Dialog.Description>
            {remove.isError ? <p role="alert">{remove.error.message}</p> : null}
            <div className="central-card-actions">
              <Button
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => setDeleteVideo(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => deleteVideo && remove.mutate(deleteVideo.attempt_id)}
              >
                <Trash2 size={15} />
                {remove.isPending ? "Deleting…" : "Delete video"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content
            className="central-player"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (watchTrigger.current?.isConnected) watchTrigger.current.focus();
            }}
          >
            <header>
              <div>
                <Dialog.Title>{selected?.title}</Dialog.Title>
                <Dialog.Description>
                  {selected?.creator_name} · {selected?.creator_email}
                </Dialog.Description>
              </div>
              <Dialog.Close className="button button-secondary" aria-label="Close video">
                <X size={19} />
              </Dialog.Close>
            </header>
            {selected ? (
              <video
                key={selected.attempt_id}
                controls
                autoPlay
                playsInline
                preload="metadata"
                src={selected.watch_url}
                onError={() => setPlaybackFailed(true)}
              >
                Your browser does not support video playback.
              </video>
            ) : null}
            {playbackFailed ? (
              <p role="alert">
                This video could not be played. Close the player and refresh the collection.
              </p>
            ) : null}
            <footer>
              <span>Original MP4 · {selected ? size(selected.content_length) : ""}</span>
              <a className="button button-primary" href={selected?.download_url} download>
                <ArrowDownToLine size={17} />
                Download MP4
              </a>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
