# Permanent fix for blank images and videos

## Phase 1 findings (verified)

Database:
- `assets` — has `storage_path` (clean path, e.g. `user-id/event-id/uuid-IMG.JPG`) **and** `public_url`. All 315 rows have `public_url` set to a **7-day signed URL**, not a public URL. That is why images go blank: the tokens expired.
- `generated_posts` — has `storage_path` (NULL on all 36 rows) and `image_url`, which holds a **7-day signed URL pointing at the source photo in `event-media`**. Designed post images are rendered in the browser from `image_url` and are not stored in a bucket, so once that URL expires the post preview is blank too.
- `generated_reels` — has `storage_path` (always set, in `generated`) and `public_url` (stale signed URL). Reel History already re-signs from `storage_path`, so reels are fine.

Buckets: `event-media` and `generated` are **both private**.

Render sites found:
- `src/routes/_authenticated/events.$id.tsx` — line 456 `<video src={asset.public_url}>`, 458 `<img src={asset.public_url}>`, 583 `<img src={previewSrc}>` (designed/original post preview), plus upload writing `public_url` (line 214) and post design reading `post.image_url` (505-506).
- `src/components/ReelStudio.tsx` — lines 284/286 asset picker thumbs from `public_url`, 127 reel source frames from `public_url`, 362 reel history video (already re-signed), 338 local blob preview (fine).
- `src/lib/mcp/tools/list-reels.ts` — already signs from `storage_path` (correct, no change).
- No `getPublicUrl(` or `/object/public/` anywhere.

Conclusion: the storage paths are already stored correctly for assets and reels; the bug is that the app **reads the stale `public_url` column** instead of minting a fresh signed URL per page load. `generated_posts` is the one table missing a path and needs a backfill.

## Phase 2 — signed URL utility

New `src/lib/storage.ts`:
- `extractStoragePath(urlOrPath, bucket)` — normalises full public/sign/authenticated URLs down to a clean path.
- `getSignedUrl(bucket, path, expiresIn = 31536000)` — single URL, null on failure.
- `getSignedUrls(bucket, paths, expiresIn)` — batch via `createSignedUrls`, returns a path → URL map.
- `useSignedUrl(bucket, path)` and `useSignedUrls(bucket, paths)` React hooks with loading/error state, keyed so they refetch when inputs change.

Signed URLs are minted fresh on every page load, so nothing stored ever expires.

## Phase 3 — components

- `src/components/StorageImage.tsx` — drop-in `<img>` replacement with skeleton, spinner, and an "Image unavailable" fallback.
- `src/components/StorageVideo.tsx` — same pattern for video.

Both use theme tokens (muted/foreground) rather than hardcoded grays so they match the existing design.

## Phase 4 — asset gallery

In `events.$id.tsx`, batch-sign every `asset.storage_path` against `event-media` with `useSignedUrls` and render from that map (skeleton while pending). Assets no longer read `public_url`. Same for the ReelStudio picker thumbnails and for the frames fed into reel generation.

## Phase 5 — generated posts

Post cards resolve their source image by signing `post.storage_path` (falling back to the path extracted from `image_url`) against `event-media`, then feed that fresh URL into `renderDesignedPost`. Original/Designed toggle and download keep working.

## Phase 6 — database (permanent part)

Migration:
- Backfill `generated_posts.storage_path` from `image_url` by stripping everything up to and including `/event-media/` and dropping the query string.
- Add `storage_bucket TEXT` to `assets` and `generated_posts` with sensible defaults so the bucket is explicit going forward.

Code changes so new rows never store an expiring URL:
- Upload handler stops writing a signed URL into `assets.public_url` (path + bucket only).
- Reel save stops writing `generated_reels.public_url`.
- The agent function's post rows get `storage_path` set from the source asset.

Existing `public_url` / `image_url` columns stay in place for compatibility but are no longer read for rendering.

## Phase 7 — Reel Studio

Reel History and previews switch to `StorageVideo` against `generated` + `storage_path`; download links use a freshly minted signed URL.

## Phase 8 — verification

Browser pass on the event page: all assets visible, top picks visible, all post previews visible, network requests hitting `/object/sign/...?token=`, and a hard reload plus a re-login still showing every image.

## Technical notes

- `generated_posts.image_url` currently points into `event-media`, not `generated` — the designed image is rendered client-side and never uploaded. This plan keeps that behaviour and only fixes the source-image URL; persisting designed renders to the `generated` bucket would be a separate change.
- Signing 100+ assets uses one batched `createSignedUrls` call per grid, not one call per tile.
