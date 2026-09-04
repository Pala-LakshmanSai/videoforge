import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Images, Play, Video, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface ProjectMediaReviewItem {
  readonly id: string;
  readonly url: string;
  readonly label: string;
  readonly detail?: string | null;
}

type MediaSection = "images" | "avatar";

export interface ProjectMediaReviewProps {
  readonly images: readonly ProjectMediaReviewItem[];
  readonly avatarVideos: readonly ProjectMediaReviewItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
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
          ? "Accepted Stage 6 image outputs will appear here when the image lane has finished."
          : "Accepted Stage 7 avatar clips will appear here when the avatar lane has finished."}
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
  loading = false,
  error = null,
  onRetry,
}: ProjectMediaReviewProps) {
  const headingId = useId();
  const [activeSection, setActiveSection] = useState<MediaSection | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedAssetId, setFailedAssetId] = useState<string | null>(null);
  const imageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const avatarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeItems =
    activeSection === "images" ? images : activeSection === "avatar" ? avatarVideos : [];
  const selectedItem = activeItems[selectedIndex] ?? null;

  useEffect(() => {
    if (selectedIndex >= activeItems.length) {
      setSelectedIndex(Math.max(0, activeItems.length - 1));
    }
  }, [activeItems.length, selectedIndex]);

  function openViewer(section: MediaSection) {
    setActiveSection(section);
    setSelectedIndex(0);
    setFailedAssetId(null);
  }

  function closeViewer() {
    const previousSection = activeSection;
    setActiveSection(null);
    setFailedAssetId(null);
    window.requestAnimationFrame(() => {
      if (previousSection === "images") imageTriggerRef.current?.focus();
      if (previousSection === "avatar") avatarTriggerRef.current?.focus();
    });
  }

  function move(direction: -1 | 1) {
    if (activeItems.length < 2) return;
    setFailedAssetId(null);
    setSelectedIndex((index) => (index + direction + activeItems.length) % activeItems.length);
  }

  return (
    <section className="media-review-panel" aria-labelledby={headingId}>
      <header className="media-review-heading">
        <div>
          <p className="eyebrow">Stage 6 + 7 output</p>
          <h2 id={headingId}>Review source media</h2>
          <p>
            Inspect accepted image generations and avatar footage before the final video review.
          </p>
        </div>
        <span className="media-review-private-note">Private to this project</span>
      </header>

      <div className="media-review-actions">
        <button
          ref={imageTriggerRef}
          className="media-review-launch"
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
                  : countLabel(images.length, "image", "images")}
            </small>
          </span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>
        <button
          ref={avatarTriggerRef}
          className="media-review-launch"
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
                  : countLabel(avatarVideos.length, "clip", "clips")}
            </small>
          </span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>
      </div>

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
                <Dialog.Description>
                  Browse signed project media. Use the arrow keys or the thumbnail rail to move
                  through the set.
                </Dialog.Description>
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
                const count = section === "images" ? images.length : avatarVideos.length;
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
                  <p>Checking the accepted outputs for this project…</p>
                </div>
              ) : error ? (
                <MediaReviewError message={error} onRetry={onRetry} />
              ) : !activeSection ? null : activeItems.length === 0 ? (
                <MediaReviewEmpty section={activeSection} />
              ) : selectedItem ? (
                <div className="media-review-stage">
                  <div className="media-review-primary">
                    <div className="media-review-main-frame">
                      {failedAssetId === selectedItem.id ? (
                        <div className="media-review-asset-error" role="alert">
                          <strong>This media could not be loaded.</strong>
                          <span>Try another item or refresh the project.</span>
                        </div>
                      ) : activeSection === "images" ? (
                        <img
                          src={selectedItem.url}
                          alt={selectedItem.label}
                          onError={() => setFailedAssetId(selectedItem.id)}
                        />
                      ) : (
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          src={selectedItem.url}
                          aria-label={selectedItem.label}
                          onError={() => setFailedAssetId(selectedItem.id)}
                        />
                      )}
                    </div>
                    <div className="media-review-caption">
                      <div>
                        <strong>{selectedItem.label}</strong>
                        {selectedItem.detail ? <span>{selectedItem.detail}</span> : null}
                      </div>
                      <span>
                        {selectedIndex + 1} / {activeItems.length} {sectionNoun(activeSection)}
                      </span>
                    </div>
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
                          {selectedIndex + 1} / {activeItems.length}
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
                      <span>{countLabel(activeItems.length, "item", "items")}</span>
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
                            setFailedAssetId(null);
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
                  </aside>
                </div>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
