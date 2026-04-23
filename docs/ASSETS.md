# Header artwork

The `header-name` group in `assets/header.svg` spells `arthurianresolve` in
[Celtic Gaelige](https://www.dafont.com/celtic-gaelige.font), Regular, version 1.00.
Font copyright: 1997 Susan K. Zalusky. All rights reserved.

The lettering uses the original font's glyph outlines, converted with
opentype.js 1.3.4 at 64 SVG units with kerning enabled. The visible left edge is
x=44 and the baseline is y=113. A gap of 40% of the font's normal space is added
between `arthurian` and `resolve` using the `header-name-resolve` path's horizontal
translation. The green cursor is a separate path. Outlines
keep the header self-contained when GitHub renders it as an image; viewers do
not need the font installed. The SVG title retains the readable profile name.

Source font: `celtic_gaelige.ttf`, downloaded from the linked DaFont page on
2026-09-08. SHA-256:
`34cb6307827670f9c5eb955d94e794505cc781d79c04aa3fe87db8696aaf18e3`.
The font binary is not redistributed with the profile assets.

## Stats and activity grade

`assets/github-stats-panels-*.svg` retain the statistics, icons and grade ring from
[ghstats.dev](https://ghstats.dev/), rendered by
[rowkav09/GitHub-profile-stats](https://github.com/rowkav09/GitHub-profile-stats).
Copyright (c) 2026 rowkav09, MIT license. The generated SVGs include the license notice.

`src/stats/card.mjs`, called by `scripts/generate-stats.mjs`, places a 280px grade panel to the left of a 640px
stats panel, with a transparent 20px gap. Their total 940px width matches
the contribution animation. The panels match its 1px border and 8px corner radius;
backgrounds and accents use its theme palette. The README uses the wide pair at every screen size so both panels
stay on one row and scale with the contribution animation. The optional compact
variants place the grade above the stats.
All four variants derive from the same provider response. The retained
`data/github-stats-source.svg` snapshot is normalized through the same passive SVG
allowlist and repository-owned stylesheet used for the published panels, so it can
reproduce the layout offline without preserving provider-controlled active markup.
