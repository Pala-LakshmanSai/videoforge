import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Images, RefreshCw, Play, Video, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface ProjectMediaReviewItem {
  readonly id: string;
  readonly url: string;
  readonly label: string;
  readonly detail?: string | null;
  readonly prompt?: string | null;
}

type MediaSection = "images" | "avatar";

export interface ProjectMediaReviewTotals {
  readonly images: number;
  readonly avatar: number;
}

export interface ProjectMediaReviewHasMore {
  readonly images: boolean;
  readonly avatar: boolean;
}

export interface ProjectMediaReviewProps {
  readonly images: readonly ProjectMediaReviewItem[];
  readonly avatarVideos: readonly ProjectMediaReviewItem[];
  readonly mediaTotals?: ProjectMediaReviewTotals;
  readonly mediaHasMore?: ProjectMediaReviewHasMore;
  readonly onLoadMore?: (section: MediaSection) => void;
  readonly loadingMore?: MediaSection | null;
  readonly loadMoreError?: string | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly launcher: MediaSection;
  readonly onRegenerate?: (item: ProjectMediaReviewItem, prompt: string) => Promise<void>;
  readonly regenerationUnavailableReason?: string;
}

interface RegenerationFailure {
  readonly message: string;
  readonly retryable: boolean;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function sectionTitle(section: MediaSection): string {
  return section === "images" ? "Generated images" : "Avatar videos/footage";
}

function sectionNoun(section: MediaSection): string {
  return section === "images" ? "image" : "avatar footage";
}

function MediaReviewEmpty({ section }: { readonly section: MediaSection }) {
  return (
    <div className="media-review-state" role="status">
      {section === "images" ? (
        <Images size={34} aria-hidden="true" />
      ) : (
        <Video size={34} aria-hidden="true" />
      )}
      <h3>No {section === "images" ? "generated images" : "avatar footage"} yet</h3>
      <p>
        {section === "images"
          ? "Accepted images appear here when ready."
          : "Accepted avatar clips appear here when ready."}
      </p>
    </div>
  );
}

function MediaReviewError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="media-review-state media-review-state-error" role="alert">
      <span className="media-review-state-icon" aria-hidden="true">
        !
      </span>
      <h3>Media is temporarily unavailable</h3>
      <p>{message}</p>
      {onRetry ? (
        <button className="button button-secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function ProjectMediaReview({
  images,
  avatarVideos,
  mediaTotals,
  mediaHasMore,
  onLoadMore,
  loadingMore = null,
  loadMoreError = null,
  loading = false,
  error = null,
  onRetry,
  launcher,
  onRegenerate,
  regenerationUnavailableReason = "Single-image regeneration is not available in this release.",
}: ProjectMediaReviewProps) {
  const [activeSection, setActiveSection] = useState<MediaSection | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const dirtyPromptIds = useRef(new Set<string>());
  const regenerationLock = useRef(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [regenerationSuccessId, setRegenerationSuccessId] = useState<string | null>(null);
  const [regenerationErrors, setRegenerationErrors] = useState<Record<string, RegenerationFailure>>(
    {},
  );
  const [failedAssetUrl, setFailedAssetUrl] = useState<string | null>(null);
  const imageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const avatarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeItems =
    activeSection === "images" ? images : activeSection === "avatar" ? avatarVideos : [];
  const activeTotal = activeSection
    ? (mediaTotals?.[activeSection] ?? activeItems.length)
    : 0;
  const activeHasMore = activeSection ? (mediaHasMore?.[activeSection] ?? false) : false;
  const selectedItem = activeItems[selectedIndex] ?? null;

  useEffect(() => {
    if (selectedIndex >= activeItems.length) {
      setSelectedIndex(Math.max(0, activeItems.length - 1));
    }
  }, [activeItems.length, selectedIndex]);

  useEffect(() => {
    const items = [...images, ...avatarVideos];
    setPromptDrafts((current) => {
      let next = current;
      for (const item of items) {
        if (dirtyPromptIds.current.has(item.id)) continue;
        const prompt = item.prompt ?? "";
        if (current[item.id] === prompt) continue;
        if (next === current) next = { ...current };
        next[item.id] = prompt;
      }
      return next;
    });
  }, [avatarVideos, images]);

  function promptFor(item: ProjectMediaReviewItem): string {
    return Object.prototype.hasOwnProperty.call(promptDrafts, item.id)
      ? (promptDrafts[item.id] ?? "")
      : (item.prompt ?? "");
  }

  function updatePrompt(item: ProjectMediaReviewItem, value: string): void {
    dirtyPromptIds.current.add(item.id);
    setPromptDrafts((current) => ({ ...current, [item.id]: value }));
    setRegenerationSuccessId(null);
    setRegenerationErrors((current) => {
      if (!current[item.id]) return current;
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }

  async function regenerate(item: ProjectMediaReviewItem, draft = promptFor(item)) {
    const prompt = draft.trim();
    if (!onRegenerate || !prompt || regenerationLock.current) return;
    regenerationLock.current = true;
    setRegeneratingId(item.id);
    setRegenerationSuccessId(null);
    setRegenerationErrors((current) => {
      if (!current[item.id]) return current;
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    try {
      await onRegenerate(item, prompt);
      setFailedAssetUrl(null);
      setRegenerationSuccessId(item.id);
    } catch (error) {
      const reason = error instanceof Error && error.message.trim() ? ` ${error.message}` : "";
      const retryable =
        !(error && typeof error === "object" && "retryable" in error) ||
        (error as { retryable?: unknown }).retryable !== false;
      setRegenerationErrors((current) => ({
        ...current,
        [item.id]: {
          message: `The image could not be regenerated.${reason} Your current image has been kept.`,
          retryable,
        },
      }));
    } finally {
      regenerationLock.current = false;
      setRegeneratingId(null);
    }
  }

  function handlePromptKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    item: ProjectMediaReviewItem,
  ): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void regenerate(item, event.currentTarget.value);
  }

  function openViewer(section: MediaSection) {
    setActiveSection(section);
    setSelectedIndex(0);
    setFailedAssetUrl(null);
  }

  function closeViewer() {
    const previousSection = activeSection;
    setActiveSection(null);
    setFailedAssetUrl(null);
    window.requestAnimationFrame(() => {
      if (previousSection === "images") imageTriggerRef.current?.focus();
      if (previousSection === "avatar") avatarTriggerRef.current?.focus();
    });
  }

  function move(direction: -1 | 1) {
    if (activeItems.length < 2) return;
    setFailedAssetUrl(null);
    setSelectedIndex((index) => (index + direction + activeItems.length) % activeItems.length);
  }

  return (
    <span className="media-review-stage-launcher">
      {launcher === "images" ? (
        <button
          ref={imageTriggerRef}
          className="button button-secondary stage-media-review-button"
          type="button"
          aria-haspopup="dialog"
          aria-label="View generated images"
          onClick={() => openViewer("images")}
        >
          <span className="media-review-launch-icon" aria-hidden="true">
            <Images size={21} />
          </span>
          <span className="media-review-launch-copy">
            <strong>View generated images</strong>
            <small>
              {loading
                ? "Loading media…"
                : error
                  ? "Unavailable"
                : countLabel(mediaTotals?.images ?? images.length, "image", "images")}
            </small>
          </span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>
      ) : null}
      {launcher === "avatar" ? (
        <button
          ref={avatarTriggerRef}
          className="button button-secondary stage-media-review-button"
          type="button"
          aria-haspopup="dialog"
          aria-label="View avatar videos/footage"
          onClick={() => openViewer("avatar")}
        >
          <span
            className="media-review-launch-icon media-review-launch-icon-avatar"
            aria-hidden="true"
          >
            <Video size={21} />
          </span>
          <span className="media-review-launch-copy">
            <strong>View avatar videos/footage</strong>
            <small>
              {loading
                ? "Loading media…"
                : error
                  ? "Unavailable"
                  : countLabel(mediaTotals?.avatar ?? avatarVideos.length, "clip", "clips")}
            </small>
          </span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>
      ) : null}

      <Dialog.Root open={activeSection !== null} onOpenChange={(open) => !open && closeViewer()}>
        <Dialog.Portal>
          <Dialog.Overlay className="media-review-overlay" />
          <Dialog.Content
            className="media-review-dialog"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              }
            }}
          >
            <header className="media-review-dialog-header">
              <div>
                <p className="eyebrow">Media review</p>
                <Dialog.Title>
                  {activeSection ? sectionTitle(activeSection) : "Media review"}
                </Dialog.Title>
                <Dialog.Description>Use arrow keys or thumbnails to browse.</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  className="media-review-close"
                  type="button"
                  aria-label="Close media viewer"
                >
                  <X size={22} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </header>

            <div className="media-review-dialog-tabs" role="tablist" aria-label="Media type">
              {(["images", "avatar"] as const).map((section) => {
                const count =
                  section === "images"
                    ? (mediaTotals?.images ?? images.length)
                    : (mediaTotals?.avatar ?? avatarVideos.length);
                const selected = activeSection === section;
                return (
                  <button
                    className="media-review-tab"
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    key={section}
                    onClick={() => openViewer(section)}
                  >
                    {sectionTitle(section)} <span>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="media-review-dialog-body">
              {loading ? (
                <div className="media-review-state" aria-busy="true">
                  <span className="spinner" aria-hidden="true" />
                  <h3>Loading project media</h3>
                  <p>Checking accepted outputs…</p>
                </div>
              ) : error ? (
                <MediaReviewError message={error} onRetry={onRetry} />
              ) : !activeSection ? null : activeItems.length === 0 ? (
                <MediaReviewEmpty section={activeSection} />
              ) : selectedItem ? (
                <div
                  className={`media-review-stage${activeSection === "images" ? " media-review-stage-images" : ""}`}
                >
                  <div className="media-review-primary">
                    <div className="media-review-main-frame">
                      {failedAssetUrl === selectedItem.url ? (
                        <div className="media-review-asset-error" role="alert">
                          <strong>This media could not be loaded.</strong>
                          <span>Try another item or refresh.</span>
                          {onRetry ? (
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={onRetry}
                            >
                              Refresh media
                            </button>
                          ) : null}
                        </div>
                      ) : activeSection === "images" ? (
                        <img
                          src={selectedItem.url}
                          alt={selectedItem.label}
                          onError={() => setFailedAssetUrl(selectedItem.url)}
                        />
                      ) : (
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          src={selectedItem.url}
                          aria-label={selectedItem.label}
                          onError={() => setFailedAssetUrl(selectedItem.url)}
                        />
                      )}
                    </div>
                    <div className="media-review-caption">
                      <div>
                        <strong>{selectedItem.label}</strong>
                        {selectedItem.detail ? <span>{selectedItem.detail}</span> : null}
                      </div>
                      <span>
                        {selectedIndex + 1} / {activeTotal} {sectionNoun(activeSection)}
                      </span>
                    </div>
                    {activeSection === "images" ? (
                      <div className="media-review-regeneration">
                        <label htmlFor={`media-review-prompt-${selectedItem.id}`}>
                          Image prompt
                        </label>
                        <textarea
                          id={`media-review-prompt-${selectedItem.id}`}
                          className="textarea media-review-prompt-editor"
                          rows={2}
                          value={promptFor(selectedItem)}
                          aria-label="Image prompt"
                          disabled={regeneratingId !== null}
                          placeholder="Describe a replacement image."
                          onChange={(event) => updatePrompt(selectedItem, event.target.value)}
                          onKeyDown={(event) => handlePromptKeyDown(event, selectedItem)}
                          aria-describedby={`media-review-prompt-help-${selectedItem.id}`}
                        />
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={
                            !onRegenerate ||
                            regeneratingId !== null ||
                            !promptFor(selectedItem).trim() ||
                            regenerationErrors[selectedItem.id]?.retryable === false
                          }
                          onClick={() => void regenerate(selectedItem)}
                        >
                          <RefreshCw size={16} aria-hidden="true" />
                          {regeneratingId === selectedItem.id
                            ? "Regenerating…"
                            : "Regenerate image"}
                        </button>
                        <p id={`media-review-prompt-help-${selectedItem.id}`}>
                          {!onRegenerate
                            ? regenerationUnavailableReason
                            : regenerationErrors[selectedItem.id]?.retryable === false
                              ? "Refresh the project to reconcile this request before trying again."
                              : !promptFor(selectedItem).trim()
                                ? "Enter a prompt."
                                : "Press Enter to regenerate. Shift+Enter adds a line. Existing video stays unchanged."}
                        </p>
                        <p className="media-review-regeneration-cost">
                          Regeneration costs up to $2.
                        </p>
                        {regeneratingId === selectedItem.id ? (
                          <p role="status" aria-live="polite">
                            Creating replacement. Current image stays available.
                          </p>
                        ) : null}
                        {regenerationErrors[selectedItem.id] ? (
                          <p role="alert">{regenerationErrors[selectedItem.id]?.message}</p>
                        ) : null}
                        {regenerationSuccessId === selectedItem.id ? (
                          <p role="status" aria-live="polite">
                            Image regenerated.
                          </p>
                        ) : null}
                        {regeneratingId !== null && regeneratingId !== selectedItem.id ? (
                          <p role="status" aria-live="polite">
                            Another image is being regenerated. Wait for it to finish.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {activeItems.length > 1 ? (
                      <div
                        className="media-review-navigation"
                        aria-label={`${sectionTitle(activeSection)} navigation`}
                      >
                        <button
                          type="button"
                          aria-label={`Previous ${sectionNoun(activeSection)}`}
                          onClick={() => move(-1)}
                        >
                          <ArrowLeft size={20} aria-hidden="true" />
                        </button>
                        <span>
                          {selectedIndex + 1} / {activeTotal}
                        </span>
                        <button
                          type="button"
                          aria-label={`Next ${sectionNoun(activeSection)}`}
                          onClick={() => move(1)}
                        >
                          <ArrowRight size={20} aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <aside
                    className="media-review-thumbnails"
                    aria-label={`${sectionTitle(activeSection)} thumbnails`}
                  >
                    <div className="media-review-thumbnails-heading">
                      <strong>All accepted</strong>
                      <span>
                        {activeItems.length === activeTotal
                          ? countLabel(activeTotal, "item", "items")
                          : `${activeItems.length.toLocaleString()} of ${activeTotal.toLocaleString()} accepted`}
                      </span>
                    </div>
                    <div className="media-review-thumbnail-grid">
                      {activeItems.map((item, index) => (
                        <button
                          className={`media-review-thumbnail${index === selectedIndex ? " is-selected" : ""}`}
                          type="button"
                          aria-label={`Open ${sectionNoun(activeSection)} ${index + 1}`}
                          aria-current={index === selectedIndex ? "true" : undefined}
                          key={item.id}
                          onClick={() => {
                            setFailedAssetUrl(null);
                            setSelectedIndex(index);
                          }}
                        >
                          {activeSection === "images" ? (
                            <img src={item.url} alt="" aria-hidden="true" />
                          ) : (
                            <span className="media-review-thumbnail-video" aria-hidden="true">
                              <Play size={18} fill="currentColor" />
                            </span>
                          )}
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                    {loadMoreError ? (
                      <p className="media-review-load-more-error" role="alert">
                        More media could not be loaded. {loadMoreError}
                      </p>
                    ) : null}
                    {activeHasMore && onLoadMore ? (
                      <button
                        className="button button-secondary media-review-load-more"
                        type="button"
                        disabled={loadingMore !== null}
                        onClick={() => onLoadMore(activeSection)}
                      >
                        {loadingMore === activeSection
                          ? "Loading more…"
                          : `Load more ${sectionNoun(activeSection)}`}
                      </button>
                    ) : null}
                  </aside>
                </div>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </span>
  );
}
