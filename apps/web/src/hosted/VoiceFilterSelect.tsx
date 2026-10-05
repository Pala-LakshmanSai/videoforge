import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function VoiceFilterSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; count?: number; disabled?: boolean }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeOption = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const selected = options.find((option) => option.value === value);
  function openMenu() {
    const bounds = trigger.current?.getBoundingClientRect();
    setAbove(Boolean(bounds && window.innerHeight - bounds.bottom < 300 && bounds.top > 300));
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    typed.current.text = "";
    setOpen(true);
  }
  function choose(index: number) {
    if (!options[index] || options[index].disabled) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open) activeOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);
  return (
    <div
      className="voice-filter-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        ref={trigger}
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-expanded={open && !disabled}
        aria-haspopup="listbox"
        aria-controls={open && !disabled ? `${id}-list` : undefined}
        aria-activedescendant={open && !disabled ? `${id}-option-${active}` : undefined}
        disabled={disabled}
        className={`voice-filter-trigger ${open && !disabled ? "is-open" : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(active);
            else openMenu();
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) openMenu();
            else {
              const available = options.flatMap((option, index) =>
                option.disabled ? [] : [index],
              );
              const position = available.indexOf(active);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? available.length - 1
                    : (position + (event.key === "ArrowDown" ? 1 : -1) + available.length) %
                      available.length;
              if (available[next] !== undefined) setActive(available[next]);
            }
          } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            if (!open) openMenu();
            const now = Date.now();
            const query =
              (now - typed.current.at < 700 ? typed.current.text : "") + event.key.toLowerCase();
            typed.current = { text: query, at: now };
            const next = options.findIndex(
              (option) => !option.disabled && option.label.toLowerCase().startsWith(query),
            );
            if (next >= 0) setActive(next);
          }
        }}
      >
        <span>{selected?.label ?? "Choose an option"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div className={`voice-filter-menu ${above ? "is-above" : ""}`}>
          <div role="listbox" id={`${id}-list`} aria-labelledby={`${id}-label`}>
            {options.map((option, index) => (
              <div
                key={option.value}
                role="option"
                id={`${id}-option-${index}`}
                ref={index === active ? activeOption : undefined}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={`voice-filter-option ${index === active ? "is-active" : ""}`}
                title={option.disabled ? "No matching voices with your current filters" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => choose(index)}
              >
                <span className="voice-filter-check">
                  <Check size={15} aria-hidden="true" />
                </span>
                <span className="voice-filter-option-label">{option.label}</span>
                {option.count !== undefined && (
                  <span className="voice-filter-option-count">{option.count.toLocaleString()}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
