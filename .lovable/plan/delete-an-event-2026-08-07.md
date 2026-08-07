# Delete an event

Add a way to permanently delete an event and everything attached to it.

## What you'll see

- On each event card in the Dashboard: a small trash icon (appears on hover, top-right).
- On the event page header: a "Delete event" option.
- Clicking it opens a confirmation dialog naming the event and warning that all uploaded media, generated posts and reels will be removed. Confirm is disabled until you press the destructive button; a success toast confirms deletion and the event page navigates back to the Dashboard.

## What gets removed

- The event row
- Its assets, generated posts, generated reels, and agent logs
- The uploaded media files and rendered reel files in storage (so nothing lingers)

## Technical notes

1. Migration: recreate the foreign keys on `assets`, `generated_posts`, `generated_reels` (needs an FK on `event_id`, currently missing) and `agent_logs` with `ON DELETE CASCADE`, so removing the event clears its child rows in one statement. Existing owner-scoped RLS already permits deletes.
2. Storage cleanup happens client-side before the row delete: collect `storage_path` values from `assets` (bucket `event-media`) and `generated_reels` (bucket `generated`) and call `storage.remove()` per bucket in chunks; storage failures are logged but do not block the DB delete.
3. Shared `DeleteEventDialog` component (AlertDialog from shadcn) used by both the dashboard card and the event page, taking `eventId`, `eventName`, and an `onDeleted` callback.
4. Dashboard already subscribes to realtime `events` changes, so the card disappears automatically; the event page navigates to `/dashboard` on success.
5. Errors surface as a generic toast, consistent with current error handling.
