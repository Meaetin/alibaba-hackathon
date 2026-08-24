"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import {
  listItineraryNotes,
  upsertItineraryNote,
  deleteItineraryNote,
  type ItineraryNoteRow,
} from "@/lib/api/itinerary-notes";
import type { NoteItem } from "@/components/ui/notes/InlineNoteEditor";

// The editor works with a single `content` string ("title\nbody"); the table
// stores title/body separately. Convert in both directions at this boundary.
function rowToItem(row: ItineraryNoteRow): NoteItem {
  return {
    id: row.id,
    content: row.body ? `${row.title}\n${row.body}` : row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function splitContent(content: string): { title: string; body: string } {
  const i = content.indexOf("\n");
  return i === -1
    ? { title: content, body: "" }
    : { title: content.slice(0, i), body: content.slice(i + 1) };
}

/**
 * Shared, DB-backed itinerary notes. Returns the standalone "overview" notes
 * (activity_id null) and a map of activity-attached notes, plus idempotent
 * save/delete mutations. Backed by React Query so multiple consumers share one
 * fetch; mount one realtime subscription (see the itinerary page) to invalidate
 * the query when a collaborator changes a note.
 */
export function useItineraryNotes(itineraryId: string) {
  const queryClient = useQueryClient();

  const { data: rows = [] } = useQuery({
    queryKey: queryKeys.itineraryNotes(itineraryId),
    queryFn: () => listItineraryNotes(itineraryId),
    enabled: !!itineraryId,
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.itineraryNotes(itineraryId) }),
    [queryClient, itineraryId],
  );

  const cacheSavedRow = useCallback(
    (row: ItineraryNoteRow) => {
      queryClient.setQueryData<ItineraryNoteRow[]>(
        queryKeys.itineraryNotes(itineraryId),
        (current = []) => [
          row,
          ...current.filter((existing) => {
            if (existing.id === row.id) return false;
            return row.activity_id ? existing.activity_id !== row.activity_id : true;
          }),
        ],
      );
    },
    [queryClient, itineraryId],
  );

  // Standalone overview notes (newest first — the API already orders by updated_at).
  const notes = useMemo<NoteItem[]>(
    () => rows.filter((r) => r.activity_id === null).map(rowToItem),
    [rows],
  );

  // activityId → that activity's single note (as an editor item).
  const activityNotes = useMemo(() => {
    const map = new Map<string, NoteItem>();
    for (const r of rows) if (r.activity_id) map.set(r.activity_id, rowToItem(r));
    return map;
  }, [rows]);

  // Create-or-update a standalone note. The client id is stable, so repeat
  // saves of the same editing session converge on one row.
  const saveNote = useCallback(
    (item: NoteItem) => {
      const { title, body } = splitContent(item.content);
      return upsertItineraryNote(itineraryId, item.id, { activity_id: null, title, body })
        .then((row) => {
          cacheSavedRow(row); invalidate(); return row;
        })
        .catch((err) => { console.error("Failed to save note", err); throw err; });
    },
    [itineraryId, cacheSavedRow, invalidate],
  );

  // Create-or-update the note for one activity. Reuse the existing note id when
  // present (update in place); otherwise mint a fresh one. The server conflicts
  // on activity_id, so a stale client can't create a duplicate.
  const saveActivityNote = useCallback(
    (activityId: string, item: NoteItem) => {
      const existing = rows.find((r) => r.activity_id === activityId);
      const noteId = existing?.id ?? crypto.randomUUID();
      const { title, body } = splitContent(item.content);
      return upsertItineraryNote(itineraryId, noteId, { activity_id: activityId, title, body })
        .then((row) => {
          cacheSavedRow(row); invalidate(); return row;
        })
        .catch((err) => { console.error("Failed to save activity note", err); throw err; });
    },
    [itineraryId, rows, cacheSavedRow, invalidate],
  );

  const deleteNote = useCallback(
    (noteId: string) =>
      deleteItineraryNote(itineraryId, noteId)
        .then(() => {
          invalidate();
        })
        .catch((err) => { console.error("Failed to delete note", err); throw err; }),
    [itineraryId, invalidate],
  );

  const clearActivityNote = useCallback(
    (activityId: string) => {
      const row = rows.find((r) => r.activity_id === activityId);
      if (!row) return Promise.resolve();
      return deleteNote(row.id);
    },
    [rows, deleteNote],
  );

  return { rows, notes, activityNotes, saveNote, saveActivityNote, deleteNote, clearActivityNote };
}
