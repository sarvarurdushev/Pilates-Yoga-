import { relatedRegion } from "./core.js";

// The caller supplies notes already scoped by the server to the selected client.
// An exact source link must never fall back to another note in the same region.
export function visibleFeedback(notes, { noteId = "", regionId = "" } = {}) {
  if (noteId) {
    const note = notes.find((item) => item.id === noteId);
    return note && (!regionId || relatedRegion(note.region_id, regionId)) ? [note] : [];
  }
  return regionId ? notes.filter((note) => relatedRegion(note.region_id, regionId)) : notes;
}
