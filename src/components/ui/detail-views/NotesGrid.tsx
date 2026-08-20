"use client";

import { useState, useCallback, useEffect } from "react";
import { useItineraryNotes } from "@/hooks/useItineraryNotes";
import { NoteCardGrid, NoteEditor, type NoteItem, type ActivityNoteCard } from "@/components/ui/notes/InlineNoteEditor";

interface NotesGridProps {
  itineraryId: string;
  className?: string;
  onEditingChange?: (editing: boolean) => void;
  noteBackRef?: React.MutableRefObject<(() => void) | null>;
  noteDeleteRef?: React.MutableRefObject<(() => void) | null>;
  /** Notes authored on itinerary activities, shown in the same grid. */
  activityNotes?: ActivityNoteCard[];
  /** Called with the activity id when an activity-note card is clicked. */
  onActivityNoteClick?: (activityId: string) => void;
}

function NotesGrid({ itineraryId, className, onEditingChange, noteBackRef, noteDeleteRef, activityNotes, onActivityNoteClick }: NotesGridProps) {
  const { notes, saveNote, deleteNote } = useItineraryNotes(itineraryId);
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null);
  const [isNewNote, setIsNewNote] = useState(false);

  const handleNewNote = useCallback(() => {
    const now = new Date().toISOString();
    setEditingNote({ id: crypto.randomUUID(), content: "", createdAt: now, updatedAt: now });
    setIsNewNote(true);
    onEditingChange?.(true);
  }, [onEditingChange]);

  const handleNoteClick = useCallback((note: NoteItem) => {
    setEditingNote(note);
    setIsNewNote(false);
    onEditingChange?.(true);
  }, [onEditingChange]);

  const handleSave = useCallback((note: NoteItem) => {
    if (!note.content.trim()) return;
    // Idempotent upsert: create and update are the same call (the client id is
    // stable for the editing session). Clear the "new" flag so delete is offered.
    saveNote(note);
    setIsNewNote(false);
  }, [saveNote]);

  const handleBack = useCallback(() => {
    setEditingNote(null);
    setIsNewNote(false);
    onEditingChange?.(false);
  }, [onEditingChange]);

  useEffect(() => {
    if (noteBackRef) noteBackRef.current = editingNote ? handleBack : null;
    if (noteDeleteRef) noteDeleteRef.current = editingNote && !isNewNote
      ? () => { deleteNote(editingNote.id); handleBack(); }
      : null;
  });

  if (editingNote) {
    return (
      <NoteEditor
        note={editingNote}
        isNew={isNewNote}
        showControls={false}
        onSave={handleSave}
        onDelete={deleteNote}
        onBack={handleBack}
        backRef={noteBackRef}
        className={className}
      />
    );
  }

  return (
    <NoteCardGrid
      notes={notes}
      onNoteClick={handleNoteClick}
      onNewNote={handleNewNote}
      activityNotes={activityNotes}
      onActivityNoteClick={onActivityNoteClick}
      className={className}
    />
  );
}

NotesGrid.displayName = "NotesGrid";

export { NotesGrid };
export type { NotesGridProps };
