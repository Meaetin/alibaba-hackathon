"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Check, ChevronDown, ChevronUp, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/primitives/Button";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import { interpretTravelPreferences } from "@/lib/api/preferences";
import type { PersonaResult } from "@/lib/persona/types";
import {
  PREFERENCE_BY_ID,
  PREFERENCE_REGISTRY,
  createSavedPreferences,
  getPersonaPreferenceIds,
} from "@/lib/preferences/registry";
import type {
  PreferenceInterpretation,
  SavedTravelPreferences,
} from "@/lib/preferences/types";
import { cn } from "@/lib/utils";

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona?: PersonaResult | null;
  preferences?: SavedTravelPreferences | null;
  onSave: (preferences: SavedTravelPreferences) => void;
}

const inputClassName =
  "w-full rounded-xl border border-edge-input bg-surface px-3 py-2.5 type-body-2 text-content outline-none placeholder:text-content-placeholder focus:border-edge-input-active focus:ring-3 focus:ring-edge-input-focus-ring/50 disabled:opacity-50";
const PREFERENCE_OPTION_PREVIEW_LIMIT = 12;

function PreferenceChip({
  id,
  selected,
  onToggle,
}: {
  id: string;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const definition = PREFERENCE_BY_ID.get(id);
  if (!definition) return null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={
        selected
          ? `${definition.label}, selected. Click to remove`
          : `${definition.label}. Click to add`
      }
      className={cn(
        "group inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 type-body-2 font-medium outline-none transition-colors",
        "focus-visible:border-edge-strong focus-visible:ring-3 focus-visible:ring-edge-strong/50",
        selected
          ? "border-edge-brand bg-surface-brand text-content-brand hover:bg-surface-error-subtle"
          : "border-edge-subtle bg-surface text-content hover:bg-surface-muted",
      )}
      onClick={() => onToggle(id)}
    >
      {selected && (
        <span aria-hidden="true" className={cn("relative size-3.5")}>
          <Check
            className={cn(
              "absolute inset-0 size-3.5 opacity-100 transition-opacity duration-100 group-hover:opacity-0 group-focus-visible:opacity-0",
            )}
            strokeWidth={2.5}
          />
          <X
            className={cn(
              "absolute inset-0 size-3.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100",
            )}
            strokeWidth={2.5}
          />
        </span>
      )}
      {definition.label}
    </button>
  );
}

export function PreferencesDialog({
  open,
  onOpenChange,
  persona,
  preferences,
  onSave,
}: PreferencesDialogProps) {
  const { isPhone } = useBreakpoint();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [preferredEndTime, setPreferredEndTime] = useState("21:00");
  const [query, setQuery] = useState("");
  const [description, setDescription] = useState("");
  const [interpretation, setInterpretation] = useState<PreferenceInterpretation | null>(null);
  const [interpretationOrigin, setInterpretationOrigin] = useState<"search" | "description" | null>(null);
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(new Set());
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [error, setError] = useState("");
  const [showAllOptions, setShowAllOptions] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(
      new Set([
        ...(preferences?.selectedIds ?? []),
        ...getPersonaPreferenceIds(persona),
      ]),
    );
    setConfirmedIds(new Set(preferences?.confirmedConstraintIds ?? []));
    setPreferredEndTime(preferences?.preferredEndTime ?? "21:00");
    setQuery("");
    setDescription("");
    setInterpretation(null);
    setInterpretationOrigin(null);
    setSuggestedIds(new Set());
    setError("");
    setShowAllOptions(false);
  }, [open, persona, preferences]);

  const selectedDefinitions = useMemo(
    () => PREFERENCE_REGISTRY.filter(({ id }) => selectedIds.has(id)),
    [selectedIds],
  );
  const unconfirmed = selectedDefinitions.filter(
    ({ id, requiresConfirmation }) => requiresConfirmation && !confirmedIds.has(id),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredPreferences = useMemo(() => {
    const matches = normalizedQuery
      ? PREFERENCE_REGISTRY.filter((item) =>
          [item.label, ...item.aliases].some((value) =>
            value.toLocaleLowerCase().includes(normalizedQuery),
          ),
        )
      : [...PREFERENCE_REGISTRY];
    return matches.sort((a, b) => a.label.localeCompare(b.label));
  }, [normalizedQuery]);
  const exactQueryMatch = useMemo(
    () =>
      normalizedQuery
        ? PREFERENCE_REGISTRY.find((item) =>
            [item.label, ...item.aliases].some(
              (value) => value.toLocaleLowerCase() === normalizedQuery,
            ),
          )
        : undefined,
    [normalizedQuery],
  );
  const displayedPreferences = normalizedQuery || showAllOptions
    ? filteredPreferences
    : filteredPreferences.slice(0, PREFERENCE_OPTION_PREVIEW_LIMIT);

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        setConfirmedIds((confirmed) => {
          const nextConfirmed = new Set(confirmed);
          nextConfirmed.delete(id);
          return nextConfirmed;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const analyze = async (
    text: string,
    origin: "search" | "description",
  ) => {
    if (!text.trim()) {
      setError("Enter a word, phrase, or short description first.");
      return;
    }
    setIsInterpreting(true);
    setInterpretationOrigin(origin);
    setError("");
    try {
      const result = await interpretTravelPreferences(text.trim());
      setInterpretation(result);
      setSuggestedIds(new Set(result.items.map(({ id }) => id)));
      if (result.items.length === 0) {
        setError("We couldn't match that yet. Try a more specific travel preference.");
      }
    } catch (cause) {
      console.error("Failed to interpret the travel preference:", cause);
      setError(cause instanceof Error ? cause.message : "We couldn't interpret that preference.");
    } finally {
      setIsInterpreting(false);
    }
  };

  const addSuggestions = () => {
    setSelectedIds((current) => new Set([...current, ...suggestedIds]));
    setInterpretation(null);
    setInterpretationOrigin(null);
    setSuggestedIds(new Set());
    setQuery("");
    setDescription("");
  };

  const addFromSearch = () => {
    if (exactQueryMatch) {
      setSelectedIds((current) => new Set([...current, exactQueryMatch.id]));
      setQuery("");
      setError("");
      return;
    }
    void analyze(query, "search");
  };

  const renderInterpretationFeedback = (
    origin: "search" | "description",
  ) => {
    if (interpretationOrigin !== origin) return null;
    return (
      <>
        <div role="status" aria-live="polite" className={cn("min-h-5")}>
          {isInterpreting && (
            <p className={cn("type-caption text-content-secondary")}>
              Interpreting your preference…
            </p>
          )}
        </div>
        {error && (
          <p
            id={`${origin}-preference-error`}
            role="alert"
            className={cn("type-body-2 text-content-error")}
          >
            {error}
          </p>
        )}
        {interpretation && interpretation.items.length > 0 && (
          /* Interpretation Review */
          <section
            className={cn(
              "flex flex-col gap-3 rounded-xl border border-edge-brand-subtle bg-surface-brand p-4",
            )}
            aria-labelledby={`${origin}-interpretation-heading`}
            data-region="profile-preferences-interpretation"
          >
            <div className={cn("flex flex-col gap-1")}>
              <h2
                id={`${origin}-interpretation-heading`}
                className={cn("type-body-2 font-semibold text-content")}
              >
                Review matches
              </h2>
              <p className={cn("type-caption text-content-secondary")}>
                Uncheck anything that doesn’t feel right. Important details
                will still need confirmation after they are added.
              </p>
            </div>
            <div className={cn("flex flex-col gap-2")}>
              {interpretation.items.map((item) => {
                const definition = PREFERENCE_BY_ID.get(item.id);
                if (!definition) return null;
                return (
                  <label
                    key={item.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg bg-surface px-3 py-2.5",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={suggestedIds.has(item.id)}
                      onChange={(event) =>
                        setSuggestedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        })
                      }
                      className={cn(
                        "mt-0.5 size-5 accent-[var(--action-brand)]",
                      )}
                    />
                    <span className={cn("min-w-0 type-body-2 text-content")}>
                      <strong>{definition.label}</strong>
                      <span
                        className={cn(
                          "mt-0.5 block type-caption text-content-secondary",
                        )}
                      >
                        Matched from “{item.evidence}”
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className={cn("flex justify-end")}>
              <Button
                type="button"
                variant="primary"
                disabled={suggestedIds.size === 0}
                onClick={addSuggestions}
              >
                Add selected matches
              </Button>
            </div>
          </section>
        )}
      </>
    );
  };

  const save = () => {
    if (unconfirmed.length > 0) {
      setError("Confirm the highlighted safety or schedule preferences before saving.");
      return;
    }
    onSave(
      createSavedPreferences(
        [...selectedIds],
        [...confirmedIds],
        selectedIds.has("early_evenings") ? preferredEndTime : undefined,
        persona,
      ),
    );
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Preferences Backdrop */}
        <Dialog.Backdrop className={cn("preferences-backdrop modal-backdrop-animated fixed inset-0 z-40 bg-surface-overlay")} />
        <Dialog.Popup
          className={cn(
            "preferences-popup modal-popup-animated fixed z-50 flex bg-surface shadow-default",
            isPhone
              ? "inset-x-0 bottom-0 max-h-[94dvh] flex-col rounded-t-2xl border-x border-t border-edge px-0 pb-[env(safe-area-inset-bottom)]"
              : "left-1/2 top-1/2 max-h-[90dvh] w-[min(48rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-edge",
          )}
          data-region="profile-preferences-dialog"
        >
          {isPhone && <div aria-hidden="true" className={cn("mx-auto mt-3 h-1 w-11 shrink-0 rounded-full bg-surface-muted-active")} />}

          {/* Dialog Header */}
          <header className={cn("flex shrink-0 items-start justify-between gap-4 border-b border-edge-subtle px-5 py-4 md:px-6")}>
            <div className={cn("flex min-w-0 flex-col gap-1")}>
              <Dialog.Title className={cn("type-secondary type-body-1 font-semibold text-content")}>
                Travel preferences
              </Dialog.Title>
              <Dialog.Description className={cn("type-body-2 text-content-secondary")}>
                Select tags or describe how you travel. These preferences will shape place ranking and future itineraries.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close preferences"
              render={<Button type="button" variant="ghost" size="sm" icon="only" />}
            >
              <X className={cn("size-4")} />
            </Dialog.Close>
          </header>

          {/* Dialog Content */}
          <div className={cn("flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto overscroll-contain px-5 py-5 md:px-6")} data-region="profile-preferences-content">
            {/* Selected Preferences */}
            <section className={cn("flex flex-col gap-3")} aria-labelledby="selected-preferences-heading">
              <div className={cn("flex items-baseline justify-between gap-3")}>
                <h2 id="selected-preferences-heading" className={cn("type-body-2 font-semibold text-content")}>
                  Selected preferences
                </h2>
                <span className={cn("type-caption text-content-secondary")}>{selectedIds.size} selected</span>
              </div>
              {selectedDefinitions.length > 0 ? (
                <div className={cn("flex flex-wrap gap-2")}>
                  {selectedDefinitions.map(({ id }) => (
                    <PreferenceChip key={id} id={id} selected onToggle={toggleSelected} />
                  ))}
                </div>
              ) : (
                <p className={cn("rounded-xl bg-surface-alt px-3 py-3 type-body-2 text-content-secondary")}>
                  No preferences selected yet.
                </p>
              )}

              {selectedDefinitions.some(({ requiresConfirmation }) => requiresConfirmation) && (
                <div className={cn("flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-alt p-3")}>
                  <p className={cn("type-caption font-semibold text-content")}>Review important details</p>
                  {selectedDefinitions.filter(({ requiresConfirmation }) => requiresConfirmation).map((item) => (
                    <label key={item.id} className={cn("flex cursor-pointer items-start gap-3 type-body-2 text-content")}>
                      <input
                        type="checkbox"
                        checked={confirmedIds.has(item.id)}
                        onChange={(event) => setConfirmedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.id); else next.delete(item.id);
                          return next;
                        })}
                        className={cn("mt-0.5 size-5 accent-[var(--action-brand)]")}
                      />
                      <span>
                        Confirm <strong>{item.label}</strong>
                        {item.category === "dietary" && (
                          <span className={cn("mt-0.5 block type-caption text-content-secondary")}>
                            Saved as an important constraint. Always verify allergen handling directly with a venue.
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                  {selectedIds.has("early_evenings") && (
                    <div className={cn("ml-8 flex max-w-52 flex-col gap-1.5")}>
                      <label htmlFor="preferred-end-time" className={cn("type-caption font-medium text-content")}>Preferred day end</label>
                      <input
                        id="preferred-end-time"
                        type="time"
                        value={preferredEndTime}
                        onChange={(event) => setPreferredEndTime(event.target.value)}
                        className={cn(inputClassName, "h-10 py-1.5")}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Preference Search */}
            <section
              className={cn("flex flex-col gap-3")}
              aria-labelledby="preference-search-heading"
              data-region="profile-preferences-search"
            >
              <div className={cn("flex flex-col gap-1")}>
                <label
                  id="preference-search-heading"
                  htmlFor="preference-search"
                  className={cn("type-body-2 font-semibold text-content")}
                >
                  Search or add a preference
                </label>
                <p
                  id="preference-search-hint"
                  className={cn("type-caption text-content-secondary")}
                >
                  Search the options below. If there isn’t an exact tag, enter
                  what you want and press Add to find the closest match.
                </p>
              </div>
              <div className={cn("flex flex-col gap-2 sm:flex-row")}>
                <div className={cn("relative flex-1")}>
                  <Search
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-glyph-secondary",
                    )}
                  />
                  <input
                    id="preference-search"
                    type="search"
                    value={query}
                    maxLength={120}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setInterpretation(null);
                      setInterpretationOrigin(null);
                      setError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addFromSearch();
                      }
                    }}
                    placeholder='Search tags or try “sunrise hikes”'
                    className={cn(inputClassName, "ps-10")}
                    aria-describedby={
                      error && interpretationOrigin === "search"
                        ? "search-preference-error"
                        : "preference-search-hint"
                    }
                    aria-invalid={
                      error && interpretationOrigin === "search"
                        ? true
                        : undefined
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isInterpreting || !normalizedQuery}
                  onClick={addFromSearch}
                >
                  {isInterpreting && interpretationOrigin === "search"
                    ? "Adding…"
                    : "Add"}
                </Button>
              </div>
              {normalizedQuery && (
                <p className={cn("type-caption text-content-secondary")}>
                  {filteredPreferences.length > 0
                    ? `${filteredPreferences.length} matching tag${filteredPreferences.length === 1 ? "" : "s"}`
                    : "No existing tag matches exactly. Press Add to interpret it."}
                </p>
              )}
              {renderInterpretationFeedback("search")}
            </section>

            {/* Preference Options */}
            <section
              className={cn("flex flex-wrap gap-2")}
              aria-label="Preference tags"
              data-region="profile-preference-tags"
            >
              {displayedPreferences.map(({ id }) => (
                <PreferenceChip
                  key={id}
                  id={id}
                  selected={selectedIds.has(id)}
                  onToggle={toggleSelected}
                />
              ))}
              {!normalizedQuery &&
                filteredPreferences.length > PREFERENCE_OPTION_PREVIEW_LIMIT && (
                  <button
                    type="button"
                    aria-expanded={showAllOptions}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-edge-subtle bg-surface px-3 py-1.5 type-body-2 font-medium text-content outline-none transition-colors hover:bg-surface-muted focus-visible:border-edge-strong focus-visible:ring-3 focus-visible:ring-edge-strong/50",
                    )}
                    onClick={() => setShowAllOptions((current) => !current)}
                  >
                    {showAllOptions ? (
                      <ChevronUp
                        aria-hidden="true"
                        className={cn("size-3.5")}
                        strokeWidth={2}
                      />
                    ) : (
                      <ChevronDown
                        aria-hidden="true"
                        className={cn("size-3.5")}
                        strokeWidth={2}
                      />
                    )}
                    {showAllOptions ? "Show less" : "Show more"}
                  </button>
                )}
              {filteredPreferences.length === 0 && (
                <p
                  className={cn(
                    "rounded-xl bg-surface-alt px-3 py-3 type-body-2 text-content-secondary",
                  )}
                >
                  No pre-made tags found. Press Add above and we’ll map your
                  preference to the closest available option.
                </p>
              )}
            </section>

            {/* Travel Description */}
            <section className={cn("flex flex-col gap-3")} aria-labelledby="describe-preferences-heading">
              <div className={cn("flex flex-col gap-1")}>
                <h2 id="describe-preferences-heading" className={cn("type-body-2 font-semibold text-content")}>Describe how you like to travel</h2>
                <p className={cn("type-caption text-content-secondary")}>Write a short sentence and we’ll identify matching tags for you to review.</p>
              </div>
              <label htmlFor="preference-description" className={cn("sr-only")}>Short travel preference description</label>
              <textarea
                id="preference-description"
                rows={4}
                maxLength={600}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void analyze(description, "description");
                  }
                }}
                placeholder="For example: I’m allergic to seafood, like hiking and breakfast, and don’t stay out late."
                className={cn(inputClassName, "min-h-28 resize-y")}
                aria-describedby={
                  error && interpretationOrigin === "description"
                    ? "description-preference-error"
                    : "preference-description-hint"
                }
                aria-invalid={
                  error && interpretationOrigin === "description"
                    ? true
                    : undefined
                }
              />
              <div className={cn("flex flex-wrap items-center justify-between gap-2")}>
                <span id="preference-description-hint" className={cn("type-caption text-content-secondary")}>Press ⌘/Ctrl + Enter to interpret</span>
                <Button type="button" variant="secondary" icon="leading" disabled={isInterpreting} onClick={() => void analyze(description, "description")}>
                  <Sparkles className={cn("size-4")} />
                  {isInterpreting && interpretationOrigin === "description"
                    ? "Finding preferences…"
                    : "Find preferences"}
                </Button>
              </div>
              {renderInterpretationFeedback("description")}
            </section>
          </div>

          {/* Dialog Footer */}
          <footer className={cn("flex shrink-0 items-center justify-end gap-2 border-t border-edge-subtle bg-surface px-5 py-4 md:px-6")}>
            <Dialog.Close render={<Button type="button" variant="ghost" />}>Cancel</Dialog.Close>
            <Button type="button" variant="primary" onClick={save}>Save preferences</Button>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
