import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import type { ImageStyle } from "../../lib/types";

export function PresetGallery({
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
