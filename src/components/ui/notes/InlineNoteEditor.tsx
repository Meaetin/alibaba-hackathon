"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ChevronLeft, MapPin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmActionDialog } from "@/components/ui/modals/ConfirmActionDialog";

// ───── Types ─────────────────────────────────────────────────────────────────

export interface NoteItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** A note authored against an itinerary activity, surfaced read-only in the
 *  combined Notes grid. Clicking it navigates to the owning activity rather
 *  than editing inline. */
export interface ActivityNoteCard {
  activityId: string;
  activityName: string;
  note: NoteItem;
}

interface NoteCardGridProps {
  notes: NoteItem[];
  onNoteClick: (note: NoteItem) => void;
  onNewNote: () => void;
  /** Activity-derived notes rendered alongside the standalone notes. */
  activityNotes?: ActivityNoteCard[];
  /** Called with the activity id when an activity-note card is clicked. */
  onActivityNoteClick?: (activityId: string) => void;
  className?: string;
}

interface NoteEditorProps {
  note: NoteItem;
  isNew?: boolean;
  /** When true, shows back + delete inside the editor (standalone mode, e.g. Notes tab).
   *  When false, omits them — parent handles back/delete via header (e.g. activity panel). */
  showControls?: boolean;
  onSave: (note: NoteItem) => void;
  onDelete?: (noteId: string) => void;
  onBack?: () => void;
  /** Ref to expose the flush-save-and-back handler to parent */
  backRef?: React.MutableRefObject<(() => void) | null>;
  /** Called (debounced) when the note is emptied so the parent can drop it.
   *  Without it, an emptied note is left untouched (multi-note grid behaviour). */
  onClear?: () => void;
  /** Renders the "Last edited …" footer (single-note activity panel, Figma 1433:20839). */
  showLastEdited?: boolean;
  className?: string;
}

// ───── Helpers ───────────────────────────────────────────────────────────────

function splitNoteContent(content: string) {
  const firstNewline = content.indexOf("\n");
  if (firstNewline === -1) return { title: content, body: "" };
  return {
    title: content.slice(0, firstNewline),
    body: content.slice(firstNewline + 1),
  };
}

/** "Last edited 30 mins ago" style relative label from an ISO timestamp. */
function formatLastEdited(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "Last edited just now";
  if (mins < 60) return `Last edited ${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last edited ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Last edited ${days} day${days === 1 ? "" : "s"} ago`;
  return `Last edited ${new Date(iso).toLocaleDateString()}`;
}

// ───── Note Card Grid ────────────────────────────────────────────────────────

export function NoteCardGrid({ notes, onNoteClick, onNewNote, activityNotes = [], onActivityNoteClick, className }: NoteCardGridProps) {
  return (
    <div className={cn(
      "note-card-grid grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2",
      className,
    )}>
      {/* Activity Notes (read-only previews; click opens the owning activity) */}
      {activityNotes.map(({ activityId, activityName, note }) => {
        const { title, body } = splitNoteContent(note.content);
        return (
          <button
            key={`activity-${activityId}`}
            type="button"
            onClick={() => onActivityNoteClick?.(activityId)}
            className={cn(
              "note-card-activity group flex flex-col aspect-[5/7] text-left",
              "rounded-xl border border-edge bg-surface p-[5px]",
              "hover:border-edge-strong",
              "transition-colors duration-[var(--motion-duration-fast)] cursor-pointer",
            )}
          >
            <div className="flex flex-col flex-1 gap-1.5 rounded-lg bg-surface-alt border border-edge-subtle p-2.5 overflow-hidden">
              {title ? (
                <p className="type-body-2 type-secondary font-semibold text-content line-clamp-2">
                  {title}
                </p>
              ) : (
                <p className="type-body-2 text-content-secondary">Empty note</p>
              )}
              {body && (
                <p className="type-body-3 text-content-secondary line-clamp-5">
                  {body}
                </p>
              )}
              {/* Activity Label */}
              <div className="note-card-activity-label mt-auto flex items-center gap-1 pt-1.5 text-content-tertiary">
                <MapPin className="size-3 shrink-0" />
                <span className="type-body-4 truncate">{activityName}</span>
              </div>
            </div>
          </button>
        );
      })}

      {/* Standalone Notes */}
      {notes.map((note) => {
        const { title, body } = splitNoteContent(note.content);
        return (
          <button
            key={note.id}
            type="button"
            onClick={() => onNoteClick(note)}
            className={cn(
              "note-card group flex flex-col aspect-[5/7] text-left",
              "rounded-xl border border-edge bg-surface p-[5px]",
              "hover:border-edge-strong",
              "transition-colors duration-[var(--motion-duration-fast)] cursor-pointer",
            )}
          >
            <div className="flex flex-col flex-1 gap-1.5 rounded-lg bg-surface-alt border border-edge-subtle p-2.5 overflow-hidden">
              {title ? (
                <p className="type-body-2 type-secondary font-semibold text-content line-clamp-2">
                  {title}
                </p>
              ) : (
                <p className="type-body-2 text-content-secondary">Empty note</p>
              )}
              {body && (
                <p className="type-body-3 text-content-secondary line-clamp-6">
                  {body}
                </p>
              )}
            </div>
          </button>
        );
      })}

      {/* New Note Card */}
      <button
        type="button"
        onClick={onNewNote}
        className={cn(
          "note-card-new group flex flex-col aspect-[5/7] text-left",
          "rounded-xl border border-edge bg-surface p-[5px]",
          "hover:border-edge-strong",
          "transition-colors duration-[var(--motion-duration-fast)] cursor-pointer",
        )}
      >
        <div className="flex flex-col flex-1 rounded-lg p-2.5 overflow-hidden">
          <p className="type-body-2 type-secondary font-semibold text-content">
            New Note
          </p>
        </div>
      </button>
    </div>
  );
}

// ───── Note Editor ───────────────────────────────────────────────────────────

export function NoteEditor({
  note,
  isNew = false,
  showControls = false,
  onSave,
  onDelete,
  onBack,
  backRef,
  onClear,
  showLastEdited = false,
  className,
}: NoteEditorProps) {
  const { title: initialTitle, body: initialBody } = splitNoteContent(note.content);
  const [noteTitle, setNoteTitle] = useState(initialTitle);
  const [noteBody, setNoteBody] = useState(initialBody);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSavedInitial = useRef(false);

  useEffect(() => {
    const { title, body } = splitNoteContent(note.content);
    setNoteTitle(title);
    setNoteBody(body);
    hasSavedInitial.current = false;
  }, [note.id, note.content]);

  const autoSave = useCallback((title: string, body: string) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const content = body ? `${title}\n${body}` : title;
      if (!content.trim()) {
        // Emptied note → let the parent drop it (single-note panel); otherwise no-op.
        onClear?.();
        return;
      }
      onSave({ ...note, content, updatedAt: new Date().toISOString() });
      hasSavedInitial.current = true;
    }, 500);
  }, [note, onSave, onClear]);

  useEffect(() => {
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, []);

  const handleTitleChange = (value: string) => {
    setNoteTitle(value);
    autoSave(value, noteBody);
  };

  const handleBodyChange = (value: string) => {
    setNoteBody(value);
    autoSave(noteTitle, value);
  };

  const handleBack = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const content = noteBody ? `${noteTitle}\n${noteBody}` : noteTitle;
    if (content.trim()) {
      onSave({ ...note, content, updatedAt: new Date().toISOString() });
    } else {
      onClear?.();
    }
    onBack?.();
  }, [note, noteTitle, noteBody, onSave, onClear, onBack]);

  useEffect(() => {
    if (backRef) backRef.current = handleBack;
    return () => { if (backRef) backRef.current = null; };
  });

  const handleDelete = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    onDelete?.(note.id);
    setDeleteConfirmOpen(false);
    onBack?.();
  }, [note.id, onDelete, onBack]);

  return (
    <div className={cn("note-editor flex flex-col h-full", className)}>
      {/* Controls — only in standalone mode */}
      {showControls && (
        <div className="note-editor-controls flex items-center justify-between pb-3">
          <button
            onClick={handleBack}
            className="note-editor-back flex items-center gap-1 rounded-full py-1.5 pl-1.5 pr-3 hover:bg-surface-muted transition-colors"
          >
            <ChevronLeft className="size-4 text-content" />
            <span className="type-body-2 font-medium text-content">Back</span>
          </button>
          {!isNew && onDelete && (
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              className="size-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition-colors shrink-0 text-content-secondary hover:text-content-error"
              aria-label="Delete note"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      )}

      {/* Editor Body */}
      <div className="note-editor-body flex flex-col flex-1 min-h-0 gap-4 px-1">
        <input
          type="text"
          value={noteTitle}
          onChange={(e) => handleTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              bodyRef.current?.focus();
            }
          }}
          placeholder="Title"
          className="type-secondary type-h4 font-medium bg-transparent text-content placeholder:text-content-tertiary focus:outline-none w-full"
          autoFocus
        />
        <textarea
          ref={bodyRef}
          value={noteBody}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder="Write something here..."
          className="flex-1 min-h-[120px] resize-none bg-transparent type-body-2 text-content placeholder:text-content-secondary focus:outline-none w-full"
        />
      </div>

      {/* Last Edited Footer */}
      {showLastEdited && (noteTitle || noteBody) && (
        <p className="note-editor-last-edited type-body-2 font-medium text-content-secondary text-right pt-4">
          {formatLastEdited(note.updatedAt)}
        </p>
      )}

      {/* Delete Confirmation */}
      <ConfirmActionDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete note"
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      >
        <p className="type-body-2 text-content-secondary">
          Are you sure you want to delete this note? This action cannot be undone.
        </p>
      </ConfirmActionDialog>
    </div>
  );
}

NoteCardGrid.displayName = "NoteCardGrid";
NoteEditor.displayName = "NoteEditor";
