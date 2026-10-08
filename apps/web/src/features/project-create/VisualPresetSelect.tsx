import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PresetImage } from "../presets/PresetImage";

interface VisualPresetOption {
  id: string;
  imageUrl: string;
  meta?: string;
  name: string;
  disabled?: boolean;
}

export function VisualPresetSelect({
  id,
  label,
  options,
  selectedId,
  onChange,
  displayedOptions = options,
  collectionControl,
  disabled = false,
}: {
  id?: string;
  label: string;
  options: VisualPresetOption[];
  selectedId: string;
  onChange: (id: string) => void;
  /** Browse a collection without changing the selected preset. */
  displayedOptions?: VisualPresetOption[];
  collectionControl?: ReactNode;
  disabled?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled && detailsRef.current) {
      detailsRef.current.open = false;
      setOpen(false);
    }
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      const details = detailsRef.current;
      if (details && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);
  const selected = options.find((option) => option.id === selectedId);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? displayedOptions.filter((option) =>
        `${option.name} ${option.meta ?? ""}`.toLowerCase().includes(normalizedQuery),
      )
    : displayedOptions;

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    },
    [],
  );

  if (!collectionControl && (options.length === 0 || (options.length === 1 && selected))) {
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
    setOpen(false);
    setQuery("");
    window.requestAnimationFrame(() => details.querySelector("summary")?.focus());
  }

  function focusOption(index: number) {
    const available = visibleOptions.flatMap((option, optionIndex) =>
      option.disabled ? [] : [optionIndex],
    );
    const enabledIndex = available.find((optionIndex) => optionIndex >= index) ?? available.at(-1);
    if (enabledIndex !== undefined)
      window.requestAnimationFrame(() => optionRefs.current[enabledIndex]?.focus());
  }

  function focusRelative(direction: -1 | 1) {
    if (!visibleOptions.length) return;
    const current = optionRefs.current.findIndex((element) => element === document.activeElement);
    const available = visibleOptions.flatMap((option, index) => (option.disabled ? [] : [index]));
    const position = available.indexOf(current);
    const next = available[(position + direction + available.length) % available.length];
    if (next !== undefined) focusOption(next);
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
    const match = ordered.find(
      (index) =>
        !visibleOptions[index]?.disabled &&
        visibleOptions[index]?.name.toLocaleLowerCase().startsWith(typeaheadRef.current),
    );
    if (match !== undefined) focusOption(match);
  }

  return (
    <div className="visual-preset-select" id={id}>
      <span className="field-label">{label}</span>
      <details
        className={`visual-preset-details ${collectionControl ? "visual-preset-collections" : ""}`}
        ref={detailsRef}
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          if (!event.currentTarget.open) setQuery("");
        }}
        onKeyDown={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          if (event.defaultPrevented) return;
          if (
            event.target instanceof HTMLElement &&
            event.target.closest(".visual-preset-collection-control") &&
            event.key !== "Escape"
          )
            return;
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
            else if (fromSearch) focusOption(0);
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
        <summary
          className="visual-preset-summary"
          aria-expanded={open}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
            else setOpen(!detailsRef.current?.open);
          }}
        >
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
            </span>
          )}
          <span className="visual-preset-chevron" aria-hidden="true" />
        </summary>
        {!collectionControl || open ? (
          <div className="visual-preset-menu">
            {collectionControl ? (
              <div className="visual-preset-collection-control">{collectionControl}</div>
            ) : null}
            {collectionControl || options.length > 4 ? (
              <label className="visual-preset-search">
                <span className="sr-only">Search {label.toLowerCase()}</span>
                <input
                  type="search"
                  disabled={disabled}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${label.toLowerCase()}`}
                />
              </label>
            ) : null}
            <div
              className={`visual-preset-options ${collectionControl ? "visual-preset-results" : ""}`}
              role="radiogroup"
              aria-label={`${label} options`}
            >
              {visibleOptions.map((option, optionIndex) => {
                const checked = option.id === selectedId;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={disabled || option.disabled}
                    className={`visual-preset-option ${checked ? "selected" : ""}`}
                    key={option.id}
                    ref={(element) => {
                      optionRefs.current[optionIndex] = element;
                    }}
                    tabIndex={
                      checked ||
                      (optionIndex === visibleOptions.findIndex((item) => !item.disabled) &&
                        !visibleOptions.some((item) => item.id === selectedId))
                        ? 0
                        : -1
                    }
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
                  {collectionControl && !normalizedQuery
                    ? "No avatars in this collection."
                    : options.length === 0
                      ? "No ready presets"
                      : "No matching presets"}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </details>
    </div>
  );
}
