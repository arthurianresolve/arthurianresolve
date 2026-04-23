# Reliability improvements — 8 September 2026

The animation now records its decisions and checks the completed fleet before exporting. The public artifact remains a standalone SVG; no browser framework or new package dependency was added.

## Inspect a pause

Run `npm run generate:diagnostics`, then `npm run preview`. Open **Flight diagnostics** in the preview toolbar, or visit `http://127.0.0.1:4173/preview/diagnostics.html`.

Select a ship and activity, then select a decision to pause at its midpoint. Traffic waits identify the other ship; block-related intervals identify the date. Launches, turns, burst pauses, retreats, shield exchanges and entrance recovery have separate reasons. Cancelled volleys retain their conservative time reservations and are labelled accordingly. The time slider also lets you inspect movement between decisions.

The local JSON report includes the snapshot date, validation counts and SHA-256 fingerprints of all four SVGs. The inspector refuses to pair a stale report with a different animation. It opens paused, supports both themes, and synchronizes all CSS animations when seeking. Public profile playback and its automatic fallback are described in [ARCHITECTURE.md](ARCHITECTURE.md).

## Validate and recover

`validatePlan` checks finite, chronological motion and effect times; muzzle attachment and aim; cumulative damage and explosion clearance; grid traversal; duplicate appearances; and continuous hull, shield, exhaust and close-following clearance. It checks the final reconciled plan. `writePlan` validates and renders all variants before writing files, so a bad plan or render cannot replace existing output.

The six-second preferred traffic budget makes Bird's first flight and repeat flights try another entrance before accepting an extended safe wait. It is a preference per reservation, not a maximum on every pause. Collision checks remain mandatory. An optional encounter is skipped when its duration exceeds the four-second combat budget.

The new narrow-corridor and seeded partial-week fixtures exposed a trapped initial Discovery dock. Discovery now tries two outer bays at the same scheduled appearance time when its normal bay cannot depart safely. Tests retain the original middle height and launch behavior when the normal bay works.

## Measured SVG simplification

The comparison used one frozen retained-calendar fleet plan for both renders, with compaction disabled and enabled. The uncompacted output first had to reproduce the saved baseline byte-for-byte. This isolates keyframe removal from route and scheduling changes.

| Dark animated SVG | Before | After |
| --- | ---: | ---: |
| Bytes | 2,108,688 | 2,092,716 |
| CSS keyframe offsets | 31,783 | 31,507 |

The reduction is 15,972 bytes (0.76%) and 276 offsets. At all 15,957 original movement offsets, the largest interpolation difference was `2.84e-14` pixels/degrees, below the `1e-8` comparison tolerance. Turns, curves, hold boundaries and rounded CSS offsets are preserved. Collision geometry is not simplified. These deterministic size measurements make no claim about frame rate or execution speed.

[KEYFRAME-MEASUREMENT.json](KEYFRAME-MEASUREMENT.json) records Node/host details, exact source and artifact hashes, the comparison contract and results. Local reproduction inputs and harness remain in `.preview/reliability-baseline/` and `.preview/measure-keyframes.mjs`; those large working artifacts are intentionally ignored by Git.

## Verification

The full 59-test suite passed on Node v26.8.1. Focused validator, trace and export checks also passed after the final small edits. The production validator additionally passed every repeated crossing in the retained, fully dense and empty integration fixtures. Other fixtures cover a narrow corridor, alternating density and seeded opposing traffic with partial weeks. Synthetic cases are bounded regression evidence, not exhaustive coverage of every possible calendar.

Generation from the retained snapshot passed with 366 cells, 20 flights, 165 damage events and 190 ship pairs. All four generated variants parsed as XML and matched their diagnostic fingerprints. The served SVGs and report matched local hashes, the browser module had the correct MIME type, and the direct hidden-file path remained forbidden.

Chrome review covered ship/activity filters, loading more decisions, selecting a Bird of Prey traffic hold at 19.90 seconds, playback/resume, and preserving the selected time across light/dark themes. The profile was checked at desktop and narrow widths with light theme and static motion. Chrome and the in-app profile were left refreshed, with the diagnostic page also open in Chrome. These are local checks; the hosted GitHub workflow has not been run by this change.
