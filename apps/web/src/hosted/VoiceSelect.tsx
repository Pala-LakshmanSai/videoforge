import {
  Check,
  ChevronDown,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  Search,
  Star,
  X,
} from "lucide-react";
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
  const audio = useRef<HTMLAudioElement>(null);
  const playbackRequest = useRef(0);
  const [preview, setPreview] = useState<Voice | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  function stopPreview() {
    playbackRequest.current += 1;
    audio.current?.pause();
    setPreview(null);
    setPlaying(false);
    setLoading(false);
    setPreviewError(false);
  }
  function playAudio(element: HTMLAudioElement) {
    const request = ++playbackRequest.current;
    setLoading(true);
    setPreviewError(false);
    void element.play().catch(() => {
      if (request === playbackRequest.current) {
        setLoading(false);
        setPlaying(false);
        setPreviewError(true);
      }
    });
  }
  function listen(voice: Voice) {
    if (!voice.preview_url || disabled) return;
    if (preview?.voice_id === voice.voice_id && audio.current) {
      if (playing || loading) {
        playbackRequest.current += 1;
        audio.current.pause();
        setPlaying(false);
        setLoading(false);
      } else {
        if (previewError || audio.current.error) audio.current.load();
        playAudio(audio.current);
      }
    } else {
      stopPreview();
      setLoading(true);
      setPreview(voice);
    }
  }
  useEffect(() => {
    const element = audio.current;
    if (!preview || !element) return;
    playAudio(element);
    return () => {
      playbackRequest.current += 1;
      element.pause();
    };
  }, [preview]);
  const selected = voices.find((voice) => voice.voice_id === value);
  const visible = voices.filter((voice) => matchesVoiceName(voice, query)).sort(compareVoices);
  const activeIndex = Math.min(active, Math.max(0, visible.length - 1));
  function close() {
    stopPreview();
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
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          input.current?.focus();
          close();
        }
      }}
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
          aria-haspopup="grid"
          aria-keyshortcuts="Alt+P"
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
            if (event.altKey && event.key.toLowerCase() === "p" && open) {
              event.preventDefault();
              if (visible[activeIndex]) listen(visible[activeIndex]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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
      {preview && (
        <audio
          ref={audio}
          key={preview.voice_id}
          src={preview.preview_url ?? undefined}
          aria-label={`${preview.name} voice sample`}
          onPlaying={() => {
            setPlaying(true);
            setLoading(false);
            setPreviewError(false);
          }}
          onPause={() => {
            setPlaying(false);
            setLoading(false);
          }}
          onEnded={() => {
            setPlaying(false);
            setLoading(false);
          }}
          onError={() => {
            playbackRequest.current += 1;
            setPlaying(false);
            setLoading(false);
            setPreviewError(true);
          }}
        />
      )}
      {open && !disabled && (
        <div className={`voice-select-menu ${above ? "voice-select-menu-above" : ""}`}>
          <p className="voice-select-hint">
            {query.trim()
              ? `${visible.length} matching voices`
              : "Your favorites first · Listen before choosing"}
          </p>
          <div role="grid" id={`${id}-list`} aria-label="Voice options">
            {visible.map((voice, index) => (
              <div
                key={voice.voice_id}
                id={`${id}-option-${index}`}
                role="row"
                ref={index === activeIndex ? activeOption : undefined}
                aria-selected={voice.voice_id === value}
                className={`voice-select-option ${index === activeIndex ? "is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(voice)}
              >
                <span role="gridcell" className="voice-select-name">
                  <strong>{voice.name}</strong>
                  <small>{voice.tags || "Narration voice"}</small>
                </span>
                <span role="gridcell" className="voice-select-actions">
                  {voice.starred ? (
                    <Star size={15} fill="currentColor" aria-label="Starred" />
                  ) : voice.saved ? (
                    <small>Saved</small>
                  ) : null}
                  {voice.voice_id === value && <Check size={16} aria-label="Selected" />}
                  <button
                    type="button"
                    className={`voice-select-listen ${preview?.voice_id === voice.voice_id ? "is-previewing" : ""}`}
                    tabIndex={index === activeIndex ? 0 : -1}
                    disabled={!voice.preview_url}
                    aria-label={
                      !voice.preview_url
                        ? `Preview unavailable for ${voice.name}`
                        : `${preview?.voice_id === voice.voice_id && (playing || loading) ? "Pause" : "Listen to"} ${voice.name}`
                    }
                    title={
                      voice.preview_url
                        ? "Listen to sample · Alt+P for highlighted voice"
                        : "No sample available"
                    }
                    onFocus={() => setActive(index)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActive(index);
                      listen(voice);
                    }}
                  >
                    {preview?.voice_id === voice.voice_id && loading ? (
                      <LoaderCircle size={17} className="voice-select-loading" aria-hidden="true" />
                    ) : preview?.voice_id === voice.voice_id && playing ? (
                      <Pause size={17} aria-hidden="true" />
                    ) : (
                      <Play size={17} aria-hidden="true" />
                    )}
                  </button>
                </span>
              </div>
            ))}
          </div>
          {preview && (
            <div className="voice-select-preview" role="status">
              <Headphones size={16} aria-hidden="true" />
              <span>
                <strong>{preview.name}</strong>
                <small>
                  {previewError
                    ? "Couldn't play sample. Try again."
                    : loading
                      ? "Loading sample…"
                      : playing
                        ? "Playing sample · Your selection is unchanged"
                        : "Sample ready · Listen again anytime"}
                </small>
              </span>
              <button type="button" aria-label="Stop voice sample" onClick={stopPreview}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
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
