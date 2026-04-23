# Animation review — 8 September 2026

This records the initial debugging stage. The subsequent validator, diagnostics, congestion recovery and current 59-test results are recorded in [RELIABILITY.md](RELIABILITY.md).

The Bird of Prey stopped because an armed flight could treat another ship's future clearance as a reservation and wait several empty cells before the obstruction. The planner now advances through those cells and clears the obstruction itself unless the shared clearance is imminent. On the retained calendar, the longest continuous Bird of Prey hold fell from 73.55 to 6.00 playback seconds. Remaining holds include traffic avoidance, turns and firing; this comparison is specific to the retained calendar, not a timing guarantee for every year.

## Changes

- Consolidated partial damage, cumulative final hits, explosion clearance and final ownership in `src/starship/damage.mjs`. Queries use a per-date index of the earliest useful hits instead of repeatedly filtering and sorting the fleet's complete shot history.
- Repeat flight planning uses original cell levels with shared hits; route scoring uses the remaining levels. This prevents subtracting earlier damage twice.
- Moved cosmetic combat into `src/starship/encounters.mjs`. It reuses the traffic hold's event-shifting rules and checks both physical overlap and close following.
- Fixed default random/dense route selection when no earlier route is supplied.
- Rejected non-string or malformed timestamps, impossible timestamp dates, unsafe counts and overflowing totals. Escaped timestamp text consistently in SVG output.
- Omitted unused projectile keyframes for Discovery's continuous beam. Kept no-travel TARDIS attempts invisible without adding duplicate sprites.
- Updated function comments, module ownership and behavior-to-test mapping in `ARCHITECTURE.md`.

## Verification

All 47 tests pass: the full 46-test suite passed before the final rendering regression, then all four renderer tests passed including the new case. They cover data parsing, route policies, shared damage, all five travelers, weapons, launch timing, hull/shield/exhaust separation, close following, respawning, TARDIS reversal, SVG themes and reduced motion. Dedicated regressions reproduce the long scheduled wait and a zero-health block whose explosion has not yet cleared.

Additional complete fleet plans for the retained, alternating-density, sparse and recently-dense calendars passed continuous ship separation and block-clearance checks. Dark/light animated/static SVGs were regenerated from the retained public snapshot, parsed as XML and compared byte-for-byte with the files served by the preview. Chrome checks covered the former stopping area, TARDIS disappearance/re-entry, dark/light themes, paused motion and the narrow layout. Both Chrome and the in-app preview were refreshed. Local generation and browser preview checks do not establish that the hosted GitHub workflow has run.
