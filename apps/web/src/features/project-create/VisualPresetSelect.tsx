import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PresetImage } from "../presets/PresetImage";

interface VisualPresetOption {
  id: string;
  imageUrl: string;
  meta?: string;
  name: string;
}

export function VisualPresetSelect({
  id,
  label,
  options,
  selectedId,
  onChange,
}: {
  id?: string;
  label: string;
  options: VisualPresetOption[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === selectedId);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter((option) =>
        `${option.name} ${option.meta ?? ""}`.toLowerCase().includes(normalizedQuery),
      )
    : options;

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    },
    [],
  );

  if (options.length <= 1) {
    return (
      <div className="visual-preset-select" id={id}>
        <span className="field-label">{label}</span>
        <div className="visual-preset-summary visual-preset-summary-static">
          {selected ? (
            <>
              <PresetImage src={selected.imageUrl} alt={`${selected.name} selected preset`} />
              <span className="visual-preset-copy">
                <strong>{selected.name}</strong>
                {selected.meta ? <small>{selected.meta}</small> : null}
              </span>
              <Check size={17} aria-label="Selected" />
            </>
          ) : (
            <span className="visual-preset-copy">
              <strong>No {label.toLowerCase()} available</strong>
              <small>Create one to continue</small>
            </span>
          )}
        </div>
      </div>
    );
  }

  function closeAndFocus() {
    const details = detailsRef.current;
    if (!details) return;
    details.open = false;
    window.requestAnimationFrame(() => details.querySelector("summary")?.focus());
  }

  function focusOption(index: number) {
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }

  function focusRelative(direction: -1 | 1) {
    if (!visibleOptions.length) return;
    const current = optionRefs.current.findIndex((element) => element === document.activeElement);
    const next = (Math.max(0, current) + direction + visibleOptions.length) % visibleOptions.length;
    focusOption(next);
  }

  function focusByTypeahead(key: string) {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadRef.current += key.toLocaleLowerCase();
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = "";
      typeaheadTimerRef.current = null;
    }, 600);
    const current = optionRefs.current.findIndex((element) => element === document.activeElement);
    const indexes = visibleOptions.map((_, index) => index);
    const ordered = [...indexes.slice(current + 1), ...indexes.slice(0, current + 1)];
    const match = ordered.find((index) =>
      visibleOptions[index]?.name.toLocaleLowerCase().startsWith(typeaheadRef.current),
    );
    if (match !== undefined) focusOption(match);
  }

  return (
    <div className="visual-preset-select" id={id}>
      <span className="field-label">{label}</span>
      <details
        className="visual-preset-details"
        ref={detailsRef}
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          if (!event.currentTarget.open) setQuery("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && detailsRef.current?.open) {
            event.preventDefault();
            closeAndFocus();
            return;
          }
          const fromSearch = event.target instanceof HTMLInputElement;
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            if (fromSearch && event.key !== "ArrowDown") return;
            event.preventDefault();
            if (!detailsRef.current?.open) {
              detailsRef.current?.setAttribute("open", "");
              setOpen(true);
              const selectedIndex = visibleOptions.findIndex((option) => option.id === selectedId);
              if (event.key === "End") focusOption(Math.max(0, visibleOptions.length - 1));
              else if (event.key === "Home") focusOption(0);
              else if (selectedIndex >= 0) focusOption(selectedIndex);
              else
                focusOption(event.key === "ArrowUp" ? Math.max(0, visibleOptions.length - 1) : 0);
              return;
            }
            if (event.key === "Home") focusOption(0);
            else if (event.key === "End") focusOption(Math.max(0, visibleOptions.length - 1));
            else focusRelative(event.key === "ArrowDown" ? 1 : -1);
            return;
          }
          if (
            !fromSearch &&
            detailsRef.current?.open &&
            event.key.length === 1 &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            focusByTypeahead(event.key);
          }
        }}
      >
        <summary className="visual-preset-summary" aria-expanded={open}>
          {selected ? (
            <>
              <PresetImage src={selected.imageUrl} alt={`${selected.name} selected preset`} />
              <span className="visual-preset-copy">
                <strong>{selected.name}</strong>
                {selected.meta ? <small>{selected.meta}</small> : null}
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
          {options.length > 4 ? (
            <label className="visual-preset-search">
              <span className="sr-only">Search {label.toLowerCase()}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}`}
              />
            </label>
          ) : null}
          {visibleOptions.map((option, optionIndex) => {
            const checked = option.id === selectedId;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                className={`visual-preset-option ${checked ? "selected" : ""}`}
                key={option.id}
                ref={(element) => {
                  optionRefs.current[optionIndex] = element;
                }}
                tabIndex={checked ? 0 : -1}
                onClick={() => {
                  onChange(option.id);
                  closeAndFocus();
                }}
              >
                <PresetImage src={option.imageUrl} alt={`${option.name} preset`} />
                <span className="visual-preset-copy">
                  <strong>{option.name}</strong>
                  {option.meta ? <small>{option.meta}</small> : null}
                </span>
                {checked ? <Check size={18} aria-hidden="true" /> : null}
              </button>
            );
          })}
          {visibleOptions.length === 0 ? (
            <span className="visual-preset-empty">
              {options.length === 0 ? "No ready presets" : "No matching presets"}
            </span>
          ) : null}
        </div>
      </details>
    </div>
  );
}
