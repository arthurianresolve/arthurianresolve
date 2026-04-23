# Profile README and Contribution - It Too Shall Pass

The profile source and local preview belong to `arthurianresolve/arthurianresolve`.

For code ownership, function contracts, planning order, and behavior-to-test links, read [Understanding the contribution animation](ARCHITECTURE.md).

## Preview

Run `node scripts/preview.mjs` with Node 24 or newer, then open `http://127.0.0.1:4173` in Chrome. The preview renders `README.md` itself with GitHub-like typography and spacing. Its toolbar is only for local review; GitHub supplies its own surrounding UI and may render spacing differently.

The light/dark and motion controls affect the preview only. The animation is a standalone SVG using CSS keyframes, so the README requires no JavaScript, iframe, or external animation service. A narrow-preview control helps review the mobile layout. The project table uses GitHub-supported column widths, and the grade/stats pair stays in one row; both scale to the contribution image's width.

## Generate

```sh
node scripts/generate-starship.mjs
node scripts/generate-starship.mjs --input data/contributions.json
npm run generate:stats
node --test
```

The first command reads GitHub’s public contribution calendar. The second reproduces the retained public snapshot offline. `--username`, `--out`, and `--snapshot` override the profile and output paths. The parser validates a complete annual calendar, real per-day counts, intensity levels, and consecutive dates. If GitHub changes its markup or the request fails, generation fails; it does not substitute invented activity.

Contributions include the activity GitHub exposes on the public calendar; they are not a commit count. The snapshot timestamp is printed inside the SVG. A private contribution setting can affect the public aggregate. No personal access token is required to read it.

`npm run generate:stats` fetches one card from ghstats.dev and creates matching statistics and grade panels in dark/light and wide/compact variants. Their combined desktop width is 940px, including the 20px gap. The generator accepts only its passive SVG vocabulary, replaces provider CSS with a local stylesheet, and retains that normalized response in `data/github-stats-source.svg`; reproduce the layout offline with `node scripts/generate-stats.mjs --input data/github-stats-source.svg`. Stats are a generated snapshot, refreshed alongside the animation by the existing 12-hour workflow after publication. Provider caching and different snapshot times can make its contribution total differ from the animation's retained calendar.

Five travelers begin at different heights. Starflight enters from the right on row five and travels left. Enterprise D enters from the left on row three; they appear together. Bird of Prey and Discovery appear together at the left one playback second after both lead ships reach the grid. Their preferred rows are two and four; the Klingon can choose another interior entrance if opposing traffic blocks its lane. The TARDIS appears after Discovery reaches the grid, near the bottom of its wave. Each traveler respawns individually after its own exit. Starflight returns to the right; the others return to the left. Armed ships and Discovery can hold for traffic, while the TARDIS reverses or delays appearance. Rounds last at least about three minutes and can extend to show the TARDIS's first successful crossing, with up to three extra retries before a blocked board resets.

Starflight uses a silver shuttle hull, dark canopy, small forward fins, and swept rear wings inspired by the supplied SpaceX Starflight concept. Its weighted search minimizes the hits needed from the right entrance, allowing left, up, and down moves through actual calendar cells. Its nose and forward shots face left. Density levels 1–4 cost 1–4 hits; empty cells cost no hits. Equal-resistance routes prefer fewer moves. Partial weeks use the nearest available entry after alignment outside the graph. Missing dates are not shortcuts. Discovery retreats backward after a blocked beam attempt, and the TARDIS reverses its cleared wave when yielding.

Enterprise D has a broad elliptical saucer with a layered rim, curved phaser strip, central bridge dome, and small NCC-1701-D registry. Its engineering hull, swept pylons, closely spaced twin nacelles, and blue engine lights sit behind the saucer. Red photon torpedo bursts alternate with two red phaser beams: the bursts contain 3, then 4, then 5 torpedoes before repeating. The sequence continues across blocks, retaliatory fire, and repeat crossings. It targets the densest available block in each column, breaking ties by contribution count and distance, preferring targets outside Starflight’s route.

The olive-green Klingon Bird of Prey has a rounded forward command pod, slender neck, broad feathered wings, and forward-pointing wingtip cannon housings. It selects a random active block in each column, then connects those targets using right, up, and down moves. Selection uses a seed derived from the calendar and pass number, so regenerated snapshots are reproducible while successive passes vary. Its only weapon is a green photon torpedo. Within 110 pixels of Enterprise, it can fire at Enterprise between grid shots. Enterprise retaliates; neither ship takes damage. Shield bubbles flash on impact: bright blue for Enterprise, and pale green brighter than the contribution blocks for the Klingon. The opening encounter can pause before they diverge; additional exchanges accept parallel or waiting ships on any crossing and preserve their independent routes. Both weapons need a clear firing window, complete shield clearance and four playback seconds of recovery after the preceding impact. These cosmetic hits never change contribution density.

Discovery One has a spherical command module, long spine, and compact aft engines inspired by 2001: A Space Odyssey. It prefers clear routes and unused fields. When blocked, it pauses and can fire a blue beam lasting exactly two playback seconds. The beam reaches two blocks in the firing direction and deals up to two hits to each, including through the first block. If the passage opens it continues after the explosion; otherwise it retreats along its cleared route to the left and retries. It never flies through a surviving block. A clear route needs no laser or retreat.

Discovery travels in repeating bursts of seven, five, and three grid spaces, pausing for 0.6 playback seconds between bursts. Orange afterburner exhaust appears at its rear only during movement, including retreats. Turns, obstacle waits, and beam firing extinguish the flame. Its speed during a burst remains one-third of the original baseline (half the updated Enterprise speed); a final burst may be shorter at the exit.

The TARDIS is a blue police box with a roof lamp, sign, windows, and paneled doors. Uniform scaling preserves its proportions and puts its longest visible side at 24px, matching Enterprise D's length. Its left and right 3D side walls keep equal projected widths throughout the turn. It spins three times around its vertical axis during each 112-pixel (seven-grid-space) glide. The sine guide spans the grid's full height with the hull inset at each crest. It detours around surviving blocks or immediately reverses along its cleared wave, preserving the phase in both directions. Temporary yields return to the interrupted glide; an uncrossable wall sends it back to the entrance for a later retry. If it has no cleared path to reverse along, it stays invisible until a safe departure. Its complete projected hull is checked against solid blocks. A turning or exit leg may end with a shorter glide.

Collision checks include full hulls, glowing shields, stationary holds, rotations, retreats, and exit fades. A circle test quickly rejects distant pairs; close pairs use oriented rectangles expanded to contain all movement and rotation between checks. Safe intermediate traffic holds let returning ships clear their launch bays. Keep hull bounds and radii in sync with artwork changes. Static and reduced-motion variants show separated stationary poses; the TARDIS stays upright.

Ships prefer routes outside the latest paths of the other types, choosing their usual low/high/random-density targets within those alternatives. Discovery still requires cleared space. The TARDIS's wave does not snap to calendar rows or inherit a ship's route. A wider wake check prevents it from weaving behind another ship within six grid spaces. Shared intersections are allowed where needed, with full hull clearance. Returning armed ships can choose another interior entrance if their normal lane is trapped. One SVG sprite per type is reused across crossings, with re-entry after its previous fade has finished. All four TARDIS walls share a clipped visibility group that hides the entire box before relocation; the legend uses labels without duplicate ship drawings.

Playback runs at half speed (`PLAYBACK_SPEED = 0.5`). The lead-ship factor reduces Enterprise D and Starflight to two-thirds of their previous rates: Enterprise and Bird of Prey are 2/3 of the original baseline, Starflight is 0.4, and Discovery remains 1/3. Bird is twice Discovery’s speed; Starflight is 60% of the updated Enterprise and Bird rate. Discovery’s emergency beam duration is converted from playback seconds so it stays two seconds long.

Normal shots hit the first occupied block up to four spaces ahead; Discovery’s emergency beam is the two-block exception. Each hit lowers density one colour level. The final hit at level one makes the block explode and disappear. Damage is reconciled chronologically across all ships and passes, including emergency hits, so no block is destroyed twice. Surviving contributions remain visible. Density ordering is preserved in both themes. Four SVG variants provide dark/light animated and static presentations.

## Publish when ready

Publish `README.md`, `assets/`, `scripts/`, `src/`, `test/`, `data/`, `package.json`, `.gitignore`, and `.github/workflows/main.yml` on the profile repository’s `main` branch. Include `preview/`, `preview.html`, and `docs/` to retain the local review tools and instructions. The workflow refreshes four animation SVGs and four stats-panel SVGs on `output` every 12 hours, on relevant pushes to `main`, and on manual dispatch. It uses the built-in `GITHUB_TOKEN` with `contents: write`; no custom secret is needed. Repository policies must allow Actions to write that branch.

Run **Actions → Generate Contribution Invaders → Run workflow** once if needed. Confirm it succeeds and all raw image URLs in the README load. The README’s `<picture>` elements select the generated output based on the viewer’s theme and motion preference. The checked-in image is a local preview / browser fallback; a selected remote source that fails does not automatically fall back, so initialize `output` before considering publication complete. GitHub’s image caching and scheduler can delay visible updates.

The workflow preserves existing files on `output` and uses an ordinary, non-forced push. Test results here cover the generator and local preview; the hosted workflow still needs its first GitHub run after publication.

## Design sources

- Original profile starter: <https://github.com/arthurianresolve/arthurianresolve>
- Public bio, website and project descriptions checked on 2026-09-07: <https://github.com/arthurianresolve>
- Layout inspiration: <https://github.com/salesp07/salesp07>
- Snake SVG: <https://raw.githubusercontent.com/salesp07/salesp07/output/github-contribution-grid-snake.svg>
- Reference workflow (without the supplied trailing period): <https://github.com/salesp07/salesp07/blob/main/.github/workflows/main.yml>
- Snake generator: <https://github.com/Platane/snk>
- Starflight silhouette reference supplied by the user, Rodrigo Magro’s concept: <https://mir-s3-cdn-cf.behance.net/project_modules/fs/b5ca2d102097959.5f3480004eb06.jpg>
- Klingon Bird of Prey silhouette reference: <https://www.ex-astris-scientia.org/scans/bop-top-color.jpg>
- Enterprise-D studio-model saucer reference, credited to Drex Files: <https://www.ex-astris-scientia.org/scans/drex/galaxy-4ft-top.jpg>

The artwork and starship generator are newly authored. No source code or contact details from salesp07 are copied. Profile copy is an editorial draft based on the public bio and selected public repositories.
