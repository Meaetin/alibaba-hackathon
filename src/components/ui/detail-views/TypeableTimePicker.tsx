"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { inputControlVariants, inputVariants } from "@/components/ui/primitives/Input";
import { toHHMM, fromHHMM } from "@/lib/utils/calendar";

// 10-minute intervals (00, 10, 20, 30, 40, 50 each hour).
const TIME_OPTIONS: number[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 10) {
    TIME_OPTIONS.push(h + m / 60);
  }
}

/** Tolerant 24-hour parse of free-typed input → normalized "HH:MM", or null.
 *  Accepts "14:30", "1430", "14", "9:5", "930". */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let h: number, m: number;
  if (s.includes(":")) {
    const [hp, mp] = s.split(":");
    h = Number(hp);
    m = mp == null || mp === "" ? 0 : Number(mp);
  } else {
    const d = s.replace(/\D/g, "");
    if (d.length <= 2) { h = Number(d); m = 0; }
    else if (d.length === 3) { h = Number(d.slice(0, 1)); m = Number(d.slice(1)); }
    else { h = Number(d.slice(0, 2)); m = Number(d.slice(2, 4)); }
  }
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

interface TypeableTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** When set ("HH:MM"), only offer times strictly AFTER it — e.g. an End picker
   *  that can't select a time at/before Start. Omit when end-before-start is valid
   *  (e.g. flight depart/arrive or lodging check-in/check-out crossing midnight). */
  minTime?: string;
}

/** Boxed, typeable 24-hour time combobox. Type "HH:MM" (or "1430"/"14") directly,
 *  or pick from the always-visible 10-min list (typing scrolls to + highlights the
 *  match). Shared by the add-location, flight, and lodging forms. */
export function TypeableTimePicker({
  value,
  onChange,
  placeholder = "HH:MM",
  className,
  minTime,
}: TypeableTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Re-sync the visible draft when `value` changes externally and we're not typing.
  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  const selectedHour = fromHHMM(value);
  const minHour = minTime ? fromHHMM(minTime) : null;
  const options = minHour == null ? TIME_OPTIONS : TIME_OPTIONS.filter((t) => t > minHour);

  // Row the typed text currently points at (for scroll + highlight).
  const q = draft.trim();
  const qd = q.replace(/\D/g, "");
  const typedIndex = q
    ? options.findIndex((t) => {
        const label = toHHMM(t);
        return (
          label.startsWith(q) ||
          label.replace(":", "").startsWith(qd) ||
          label.replace(/^0/, "").startsWith(q)
        );
      })
    : -1;

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const mh = minTime ? fromHHMM(minTime) : null;
    const opts = mh == null ? TIME_OPTIONS : TIME_OPTIONS.filter((t) => t > mh);
    const s = draft.trim();
    const d = s.replace(/\D/g, "");
    let idx = s
      ? opts.findIndex((t) => {
          const label = toHHMM(t);
          return label.startsWith(s) || label.replace(":", "").startsWith(d) || label.replace(/^0/, "").startsWith(s);
        })
      : -1;
    const typed = idx >= 0;
    if (idx < 0) idx = opts.findIndex((t) => t === fromHHMM(value));
    const el = idx >= 0 ? (list.children[idx] as HTMLElement | undefined) : undefined;
    if (!el) return;
    if (typed) {
      list.scrollTop = Math.max(0, el.offsetTop - 8);
    } else {
      el.scrollIntoView({ block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, value, minTime]);

  const commitDraft = () => {
    const parsed = parseTimeInput(draft);
    const valid = parsed != null && (minHour == null || (fromHHMM(parsed) ?? -1) > minHour);
    if (valid) {
      onChange(parsed);
      setDraft(parsed);
    } else {
      setDraft(value);
    }
  };

  const selectOption = (t: number) => {
    const hhmm = toHHMM(t);
    onChange(hhmm);
    setDraft(hhmm);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="typeable-time-picker relative">
      {/* Boxed typeable control */}
      <div
        className={cn(
          "typeable-time-picker-control",
          inputVariants({ variant: "default", size: "md", icon: "trailing", hasValue: Boolean(draft) }),
          className,
        )}
      >
        <input
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            requestAnimationFrame(() => {
              if (wrapRef.current?.contains(document.activeElement)) return;
              setOpen(false);
              commitDraft();
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitDraft(); setOpen(false); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setDraft(value); setOpen(false); (e.target as HTMLInputElement).blur(); }
          }}
          className={cn(inputControlVariants(), "typeable-time-picker-input text-content font-medium")}
        />
        <span className="typeable-time-picker-icon flex shrink-0 items-center justify-center size-5 text-content-secondary [&_svg]:size-4">
          <Clock />
        </span>
      </div>

      {/* Options — styled to match the design-system Menu popup */}
      {open && options.length > 0 && (
        <div ref={listRef} className="typeable-time-picker-menu absolute inset-x-0 top-full z-20 mt-1 flex max-h-[240px] flex-col items-stretch gap-1 overflow-y-auto scrollbar-none rounded-2xl border border-edge bg-surface p-2 shadow-default">
          {options.map((t, i) => {
            const isSelected = selectedHour === t;
            const isTyped = i === typedIndex;
            return (
              <button
                key={t}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); selectOption(t); }}
                className={cn(
                  "typeable-time-picker-option relative flex h-10 w-full shrink-0 items-center px-3 text-left",
                  "rounded-xl border border-transparent outline-none select-none cursor-pointer transition-[background-color,border-color,color]",
                  "type-body-2 font-medium text-glyph",
                  "hover:bg-surface-alt hover:border-edge-subtle active:bg-surface-muted active:border-edge",
                  isTyped && !isSelected && "bg-surface-alt border-edge-subtle",
                  isSelected && "bg-surface-muted border-edge",
                )}
              >
                {toHHMM(t)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
