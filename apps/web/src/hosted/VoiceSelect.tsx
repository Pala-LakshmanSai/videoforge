import { Check, ChevronDown, Search, Star } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { compareVoices, matchesVoiceName, type Voice } from "./voice-library";

export function VoiceSelect({
  voices,
  value,
  disabled,
  onChange,
}: {
  voices: Voice[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const selected = voices.find((voice) => voice.voice_id === value);
  const visible = voices.filter((voice) => matchesVoiceName(voice, query)).sort(compareVoices);
  const activeIndex = Math.min(active, Math.max(0, visible.length - 1));
  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
  }
  function choose(voice: Voice) {
    if (voice.voice_id !== value) onChange(voice.voice_id);
    close();
  }
  function openMenu() {
    const bounds = input.current?.getBoundingClientRect();
    setAbove(Boolean(bounds && window.innerHeight - bounds.bottom < 360 && bounds.top > 260));
    setOpen(true);
  }
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open) activeOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open, query]);
  return (
    <div
      className="voice-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <span className="field-label" id={`${id}-label`}>
        Voice
      </span>
      <div className={`voice-select-input ${open ? "is-open" : ""}`}>
        <Search size={17} aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-label="Script voice"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && visible.length ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={open ? query : (selected?.name ?? "")}
          placeholder={open ? "Search by voice name…" : "Choose a voice"}
          onFocus={openMenu}
          onClick={openMenu}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            openMenu();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "Tab") close();
            else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) {
                openMenu();
                setActive(0);
              } else
                setActive(
                  visible.length
                    ? (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + visible.length) %
                        visible.length
                    : 0,
                );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (open && visible[activeIndex]) choose(visible[activeIndex]);
              else openMenu();
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Close voice menu" : "Open voice menu"}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else {
              input.current?.focus();
              openMenu();
            }
          }}
        >
          <ChevronDown size={17} aria-hidden="true" />
        </button>
      </div>
      {open && !disabled && (
        <div className={`voice-select-menu ${above ? "voice-select-menu-above" : ""}`}>
          <p className="voice-select-hint">
            {query.trim()
              ? `${visible.length} matching voices`
              : "Your favorites first · Search by name"}
          </p>
          <div role="listbox" id={`${id}-list`} aria-label="Voice options">
            {visible.map((voice, index) => (
              <div
                key={voice.voice_id}
                id={`${id}-option-${index}`}
                role="option"
                ref={index === activeIndex ? activeOption : undefined}
                aria-selected={voice.voice_id === value}
                className={`voice-select-option ${index === activeIndex ? "is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(voice)}
              >
                <span>
                  <strong>{voice.name}</strong>
                  <small>{voice.tags || "Narration voice"}</small>
                </span>
                {voice.starred ? (
                  <Star size={15} fill="currentColor" aria-label="Starred" />
                ) : voice.saved ? (
                  <small>Saved</small>
                ) : null}
                {voice.voice_id === value && <Check size={16} aria-label="Selected" />}
              </div>
            ))}
          </div>
          {!visible.length && (
            <p className="voice-select-empty" role="status">
              No matching voices. Try the start of a name.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
