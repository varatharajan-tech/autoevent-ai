# Reel walkthrough on your existing event photos

Nothing new gets uploaded and no app changes are made. This is a test run on the photos already in your event.

## Steps
1. Open your event (signed in as the event owner) and go to Reel Studio.
2. Select the event's photos (the 5 AI picks first, plus any others), then turn on "AI storytelling edit".
3. Before generating, record the "Planned story structure": each shot's role (hook / build / climax / close), scene label, hold time and transition.
4. Check the plan against the photo scores in the database: the hook should be the highest-energy photo and the climax the strongest-story photo.
5. Generate the reel, wait for it to finish, and confirm it shows up in Reel History.
6. Switch between the Phone and Full preview, take screenshots of both, and let the reel play.
7. Capture frames at each shot change to confirm the transitions actually render (zoom burst, fades, flash, dramatic fade close) and that captions show on build and climax shots but not on the hook.

## What you get back
- A short walkthrough: shot-by-shot table (role, photo, hold time, transition, caption shown), total length, and phone preview screenshots.
- Any problem found gets reported with its cause; fixes would come as a separate follow-up.

## Technical notes
- Playwright against localhost:8080 using the minted owner session; scores read from `assets` (emotional_energy, storytelling_value, brand_moment).
