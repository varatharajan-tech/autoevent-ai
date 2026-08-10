# Production Readiness Audit — AutoEvent AI

A full QA, security, performance and data-integrity pass over the app, with fixes applied as bugs are found, ending in a production readiness report.

## Scope

Roughly 100 test cases across auth, event creation, media upload, AI generation, Reel Studio, insights, security, responsive UI, performance, database integrity, edge cases, and one full end-to-end journey.

## How it will be run

1. **Architecture read** — every file under routes, components, lib, hooks and the edge function, plus the live database schema, RLS policies, grants and storage bucket settings. Produces the architecture, schema, flows, features and security summary.
2. **Automated browser testing** — a headless browser drives the real app against the live backend: sign-in, dashboard, event create, upload, tabs, reel studio, invalid IDs, and the 375/768/1440px viewports. Console and network traffic are captured for each run so blank images, duplicate requests and per-image signed-URL calls are observed, not assumed.
3. **Security checks by inspection plus probing** — RLS and grants queried directly, storage buckets checked for privacy by fetching an object URL without a token, codebase searched for leaked secrets (names only, never values), CORS allow-list and error messages reviewed, XSS attempted through event name and caption fields.
4. **Fixes** — each failure gets a root cause, an immediate fix, a re-run of that test, and a re-run of two or three related tests to catch regressions.
5. **Report** — bug list with severity and fix status, then the final readiness verdict.

## Known limits (will be reported as NOT TESTED, not faked)

- **Multi-user isolation** (User A vs User B): only one signed-in session is available in the sandbox. RLS policies and grants will be verified by direct SQL inspection and a query as the anon role, but a real second account cannot be created and driven. Manual verification steps will be given.
- **Fresh registration / duplicate email / HIBP rejection**: creating real accounts sends real confirmation email and pollutes auth. Validation behaviour will be tested at the form level and the HIBP/auth settings verified in config; actual signup submissions will only be run if you want real test accounts created.
- **Network-failure-mid-upload** and **5-minute memory-leak observation**: partially simulatable; interval cleanup will be verified by code inspection, offline behaviour by forcing request failures.
- **AI agent run** consumes real AI credits and takes time; it will be run once on a test event unless you'd rather it were skipped.

## Fix policy

Fixes stay proportional to the bug: presentation issues fixed in components and Tailwind classes, security issues fixed in policies and the edge function, performance issues fixed in the data-loading paths. No feature rewrites, no redesign. Anything that would be a larger change is reported with a recommendation rather than done silently.

## Deliverables

- Phase 1 architecture and schema summary
- Per-test PASS / FAIL / NOT TESTED results with evidence
- Bug list in the requested format
- Final production readiness report and verdict
