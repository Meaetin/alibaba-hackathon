"use client";

import { cn } from "@/lib/utils";
import { NotesGrid } from "@/components/ui/detail-views/NotesGrid";
import type { ActivityNoteCard } from "@/components/ui/notes/InlineNoteEditor";

interface NotesTabProps {
  itineraryId: string;
  className?: string;
  onEditingChange?: (editing: boolean) => void;
  noteBackRef?: React.MutableRefObject<(() => void) | null>;
  noteDeleteRef?: React.MutableRefObject<(() => void) | null>;
  /** Activity-authored notes shown alongside standalone notes. */
  activityNotes?: ActivityNoteCard[];
  /** Open the owning activity when its note card is clicked. */
  onActivityNoteClick?: (activityId: string) => void;
}

export function NotesTab({ itineraryId, className, onEditingChange, noteBackRef, noteDeleteRef, activityNotes, onActivityNoteClick }: NotesTabProps) {
  return (
    <div data-slot="notes-tab" className={cn("notes-tab-root p-3 h-full", className)}>
      {/* Notes Grid */}
      <NotesGrid
        itineraryId={itineraryId}
        onEditingChange={onEditingChange}
        noteBackRef={noteBackRef}
        noteDeleteRef={noteDeleteRef}
        activityNotes={activityNotes}
        onActivityNoteClick={onActivityNoteClick}
      />
    </div>
  );
}
