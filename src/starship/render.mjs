import { EXIT_FADE, HULL_BOUNDS, PLAYBACK_SPEED, SHIELD, TARDIS_SCALE } from './config.mjs';
import { validateCalendar } from './calendar.mjs';
import { planAnimation } from './fleet.mjs';
import { positionAt } from './motion.mjs';
import { compactMotionFrames } from './keyframes.mjs';
import { ALIEN, THEMES, TARDIS_LAMP, pixels, shipArtwork, tardisFaceArtwork, tardisProjection } from './artwork.mjs';

/** Escape data inserted into SVG text or attributes. */
export const escapeXml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/**
 * Render a validated calendar and its deterministic fleet plan as standalone SVG.
 * No browser script or external image is required. This function emits CSS, cells,
 * weapons, beams and ships in paint order; it does not choose routes or apply damage.
 * animated=false renders the complete calendar with separated stationary sprites.
 */
export function renderStarship(calendar, theme = 'dark', animated = true) {
  validateCalendar(calendar);
  return renderPlan(calendar, planAnimation(calendar.days), theme, animated);
}

/** Render an already prepared plan for the same validated calendar; never re-plan or mutate it. */
export function renderPlan(calendar, plan, theme = 'dark', animated = true, { compact = true } = {}) {
  const p = THEMES[theme];
  if (!p) throw new Error('Unknown theme.');
  const { cells, ships, fleetFlights, reset, duration } = plan;
  const shots = fleetFlights.flatMap((ship) => ship.shots).filter((shot) => shot.hit < reset - 0.3).sort((a, b) => a.hit - b.hit);
  const combatShots = fleetFlights.flatMap((ship) => ship.combatShots ?? []).filter((shot) => shot.hit < reset - 0.3);
  const total = calendar.days.reduce((sum, day) => sum + day.count, 0);
  const snapshotDate = escapeXml(calendar.fetchedAt.slice(0, 10));
  const pct = (time) => `${(time / duration * 100).toFixed(4)}%`;
  const timeline = (name, body) => `@keyframes ${name}{${body}}`;
  const playbackDuration = (duration / PLAYBACK_SPEED).toFixed(3);
  const motion = (name) => `animation:${name} ${playbackDuration}s linear infinite`;
  const css = [];
  const shotMap = Map.groupBy(shots, (shot) => shot.date);
  const stars = Array.from({ length: 35 }, (_, i) => `<rect x="${24 + (i * 163) % 890}" y="${82 + (i * 41) % 221}" width="${i % 5 === 0 ? 2 : 1}" height="${i % 5 === 0 ? 2 : 1}" fill="${p.muted}" opacity="${i % 3 === 0 ? 0.35 : 0.16}"/>`).join('');
  /** Render one cell and its damage/fade keyframes; density changes come from reconciled hits. */
  function renderCell(cell, i) {
    const hits = shotMap.get(cell.date);
    if (animated && hits) {
      const stages = hits.map((shot) => `${pct(shot.hit - 0.001)}{fill:${p.cells[shot.before]};opacity:1}${pct(shot.hit)}{fill:${p.cells[Math.max(1, shot.after)]};opacity:1}${shot.after === 0 ? `${pct(shot.destroyedAt)},${pct(reset)}{fill:${p.cells[1]};opacity:0}` : ''}`).join('');
      css.push(timeline(`cell${i}`, `0%{fill:${p.cells[cell.level]};opacity:1}${stages}${pct(reset + 0.4)},100%{fill:${p.cells[cell.level]};opacity:1}`));
    }
    return `<g><title>${escapeXml(cell.date)}: ${cell.count} contributions</title><rect class="motion" x="${cell.x}" y="${cell.y}" width="12" height="12" rx="2" fill="${p.cells[cell.level]}"${animated && hits ? ` style="${motion(`cell${i}`)}"` : ''}/></g>`;
  }
  const grid = cells.map(renderCell).join('');
  /** Render a weapon and optional final explosion; cosmetic shots never receive explosions. */
  function renderProjectile(shot, i) {
    const beam = shot.shipId === 'cruiser' ? (theme === 'dark' ? '#ff4b55' : '#cf1635') : shot.shipId === 'bird' ? (theme === 'dark' ? '#91ff72' : '#378514') : shot.shipId === 'discovery' ? '#55bfff' : p.laser;
    const travel = `translate(${shot.x + 6 - shot.from.x}px,${shot.y + 6 - shot.from.y}px)`;
    if (shot.weapon === 'phaser') {
      css.push(timeline(`laser${i}`, `0%,${pct(shot.fire - 0.001)}{opacity:0}${pct(shot.fire)},${pct(shot.hit)}{opacity:1}${pct(shot.hit + 0.08)},100%{opacity:0}`));
    } else if (shot.weapon !== 'discovery-laser') {
      css.push(timeline(`laser${i}`, `0%,${pct(shot.fire - 0.001)}{opacity:0;transform:translate(0,0)}${pct(shot.fire)}{opacity:1;transform:translate(0,0)}${pct(shot.hit)}{opacity:1;transform:${travel}}${pct(shot.hit + 0.001)},100%{opacity:0;transform:${travel}}`));
    }
    let explosion = '';
    if (shot.after === 0) {
      css.push(timeline(`burst${i}`, `0%,${pct(shot.hit - 0.001)}{opacity:0;transform:scale(0.6)}${pct(shot.hit)}{opacity:1;transform:scale(0.6)}${pct(shot.hit + 0.22)},100%{opacity:0;transform:scale(1.7)}`));
      explosion = `<g class="effect" transform="translate(${shot.x + 6} ${shot.y + 6})"><g fill="${beam}" opacity="0" style="${motion(`burst${i}`)}"><path d="M-10-1h4v2h-4z M6-1h4v2H6z M-1-10h2v4h-2z M-1 6h2v4h-2z M-6-6h2v2h-2z M4-6h2v2H4z M-6 4h2v2h-2z M4 4h2v2H4z"/></g></g>`;
    }
    const projectile = shot.weapon === 'phaser'
      ? `<path d="M${shot.from.x} ${shot.from.y}L${shot.x + 6} ${shot.y + 6}" stroke="${beam}" stroke-width="4" opacity="0.25"/><path d="M${shot.from.x} ${shot.from.y}L${shot.x + 6} ${shot.y + 6}" stroke="${beam}" stroke-width="1.5"/>`
      : ['torpedo', 'green-torpedo'].includes(shot.weapon)
        ? `<g transform="translate(${shot.from.x} ${shot.from.y})"><circle r="4" fill="${beam}" opacity="0.2"/><path d="M-4 0h8M0-4v8" stroke="${beam}" stroke-width="0.8"/><circle r="2" fill="${beam}"/><circle r="0.8" fill="#ffd4d7"/></g>`
        : `<path d="M${shot.from.x} ${shot.from.y}l${-shot.dx * 6} ${-shot.dy * 6}" stroke="${beam}" stroke-width="2"/>`;
    return `${shot.weapon === 'discovery-laser' ? '' : `<g class="effect" data-weapon="${shot.weapon}" opacity="0" style="${motion(`laser${i}`)}">${projectile}</g>`}${explosion}`;
  }
  const projectiles = animated ? [...shots, ...combatShots].map(renderProjectile).join('') : '';
  /** Render a continuous blue beam independently of its discrete damage pulses. */
  function renderEmergencyBeam(beam, i) {
    css.push(timeline(`emergency${i}`, `0%,${pct(beam.fire - 0.001)}{opacity:0}${pct(beam.fire)},${pct(beam.end)}{opacity:1}${pct(beam.end + 0.001)},100%{opacity:0}`));
    const line = `M${beam.from.x} ${beam.from.y}L${beam.to.x} ${beam.to.y}`;
    return `<g class="effect" data-weapon="discovery-laser" opacity="0" style="${motion(`emergency${i}`)}"><path d="${line}" stroke="#55bfff" stroke-width="7" opacity="0.22"/><path d="${line}" stroke="#55bfff" stroke-width="2"/><path d="${line}" stroke="#cff0ff" stroke-width="0.6"/></g>`;
  }
  const emergencyBeams = animated ? fleetFlights.flatMap((ship) => ship.beams ?? []).filter((beam) => beam.end < reset - 0.3).map(renderEmergencyBeam).join('') : '';
  const transform = (pos) => `translate(${pos.x}px,${pos.y}px) rotate(${pos.angle}deg)`;
  /** Project four walls around the upright axis; spin during glides and hold between appearances. */
  function renderTardisTurn(ship, flightName) {
    const samples = [{ time: 0, turns: 0 }];
    let phase = 0;
    for (const cycle of ship.cycles) {
      // Boundary samples keep hidden intervals between crossings still;
      // visible rotation stays coupled to forward or reverse translation.
      if (cycle.spinStart > (samples.at(-1)?.time ?? 0) && cycle.spinStart < reset) samples.push({ time: cycle.spinStart, turns: phase });
      phase += cycle.turns;
      const steps = Math.max(1, Math.ceil(cycle.turns * 24));
      for (let i = 0; i <= steps; i++) {
        const time = cycle.spinStart + (cycle.spinEnd - cycle.spinStart) * i / steps;
        if (time < reset) samples.push({ time, turns: phase - cycle.turns + cycle.turns * i / steps });
      }
      if (cycle.spinEnd < reset && cycle.glideEnd < reset) samples.push({ time: cycle.glideEnd, turns: phase });
    }
    const walls = Object.keys(tardisProjection(0)).map((face) => {
      const name = `${flightName}-${face}`;
      const matrix = (turns) => {
        const [scale, offset] = tardisProjection(turns)[face].map((value) => +value.toFixed(4));
        return `matrix(${scale},0,0,1,${offset},0)`;
      };
      css.push(timeline(name, samples.map(({ time, turns }) => `${pct(time)}{transform:${matrix(turns)}}`).join('')
        + `100%{transform:${matrix(0)}}`));
      return `<g class="motion${face === 'front' ? '' : ' tardis-wall'}" data-face="${face}" transform="${matrix(0)}" style="${motion(name)}">${tardisFaceArtwork(theme, face === 'front')}</g>`;
    }).join('');
    return `<g aria-label="TARDIS blue police box" data-spin-axis="vertical" transform="scale(${TARDIS_SCALE})">${walls}${TARDIS_LAMP}</g>`;
  }
  /** Attach orange aft exhaust only to translating Discovery segments, including retreats. */
  function renderAfterburner(ship, flightName) {
    const name = `${flightName}-afterburner`;
    // Adjacent moves share a flame; turns and traffic pauses leave a visible dark interval.
    const intervals = [];
    for (const burn of ship.burns) {
      if (burn.start >= reset) break;
      const previous = intervals.at(-1);
      if (previous && Math.abs(previous.end - burn.start) < 1e-8) previous.end = burn.end;
      else intervals.push({ ...burn });
    }
    css.push(timeline(name, `0%{opacity:0}${intervals.map((burn) => `${pct(burn.start - 0.001)}{opacity:0}${pct(burn.start)},${pct(Math.min(burn.end, reset))}{opacity:1}${pct(Math.min(burn.end + 0.001, reset + 0.001))}{opacity:0}`).join('')}100%{opacity:0}`));
    return `<g class="effect" data-effect="discovery-afterburner" opacity="0" style="${motion(name)}"><path d="M-3.2 18.5Q-3.5 22-1.7 25L0 21.5 1.7 25Q3.5 22 3.2 18.5Z" fill="#ff8a26"/><path d="M-1.8 18.5-1 22 0 20.5 1 22 1.8 18.5Z" fill="#ffd18a"/></g>`;
  }
  /** Reuse one sprite per type across all crossings; invisible gaps handle re-entry. */
  function renderFlight(ship, index) {
    const flightName = `flight-${ship.id}-${index}`;
    const visibilityName = `visibility-${ship.id}-${index}`;
    // A blocked planner can return no travel. Keep that failed attempt invisible
    // instead of briefly flashing a stationary sprite at its entrance.
    const crossings = animated ? fleetFlights.filter((flight) => flight.id === ship.id
      && flight.startAt < reset - 0.3 && flight.exitAt > flight.startAt) : [ship];
    const initial = ship.id === 'bird' ? { ...ship.positions[0], x: 40 } : ship.positions[0];
    const visibility = (shown) => `opacity:${Number(shown)}${ship.id === 'tardis' ? `;visibility:${shown ? 'visible' : 'hidden'}` : ''}`;
    if (animated) {
      const frames = crossings.flatMap((flight) => {
        const end = Math.min(flight.exitAt, reset - 0.3);
        // Keep the old exit pose throughout its fade; relocation occurs while invisible.
        return [...flight.positions.filter((pos) => pos.time < end),
          { ...positionAt(flight, end), time: end }, { ...positionAt(flight, end), time: end + EXIT_FADE }];
      });
      const exportedFrames = compact ? compactMotionFrames(frames, duration) : frames;
      css.push(timeline(flightName, `0%{transform:${transform(initial)}}` + exportedFrames.map((pos) => `${pct(pos.time)}{transform:${transform(pos)}}`).join('') + `100%{transform:${transform(frames.at(-1) ?? initial)}}`));
      css.push(timeline(visibilityName, `0%{${visibility(false)}}${crossings.map((flight) => {
        const end = Math.min(flight.exitAt, reset - 0.3);
        return `${pct(flight.startAt)}{${visibility(false)}}${pct(Math.min(flight.startAt + 0.3, end))},${pct(end)}{${visibility(true)}}${pct(end + EXIT_FADE)}{${visibility(false)}}`;
      }).join('')}100%{${visibility(false)}}`));
    }
    const flight = `${motion(flightName)},${visibilityName} ${playbackDuration}s linear infinite`;
    const shields = animated ? crossings.flatMap((flight) => flight.shields ?? []).map((shield, i) => {
      const name = `shield-${index}-${i}`;
      css.push(timeline(name, `0%,${pct(shield.hit - 0.001)}{opacity:0}${pct(shield.hit)}{opacity:1}${pct(shield.hit + SHIELD.duration)},100%{opacity:0}`));
      const colour = ship.id === 'cruiser' ? '#55cfff' : '#e0ffab';
      return `<g class="effect" data-shield="${ship.id}" opacity="0" style="${motion(name)}"><ellipse cy="3" rx="14" ry="19" fill="${colour}" fill-opacity="0.16" stroke="${colour}" stroke-width="1.4"/><ellipse cy="3" rx="15.5" ry="20.5" fill="none" stroke="${colour}" stroke-opacity="0.2" stroke-width="2"/></g>`;
    }).join('') : '';
    const artwork = animated && ship.id === 'tardis' ? renderTardisTurn({ cycles: crossings.flatMap((flight) => flight.cycles) }, flightName) : shipArtwork(ship.id, theme);
    const exhaust = animated && ship.id === 'discovery' ? renderAfterburner({ burns: crossings.flatMap((flight) => flight.burns) }, flightName) : '';
    if (animated && ship.id === 'tardis') {
      const [left, right, top, bottom] = HULL_BOUNDS.tardis;
      // One clipped paint group owns all four walls. Visibility is separate
      // from movement, so the complete box hides before its left-edge reset.
      return `<g class="motion" data-ship="tardis" transform="translate(${initial.x} ${initial.y})" style="${motion(flightName)}"><defs><clipPath id="tardis-hull-clip"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/></clipPath></defs><g class="motion tardis-visibility" data-visible-ship="tardis" visibility="hidden" clip-path="url(#tardis-hull-clip)" style="${motion(visibilityName)}">${artwork}</g></g>`;
    }
    return `<g class="motion" data-ship="${ship.id}" transform="translate(${initial.x} ${initial.y}) rotate(${initial.angle})"${animated ? ` style="${flight}"` : ''}>${exhaust}${artwork}${shields}</g>`;
  }
  const fleet = ships.map(renderFlight).join('');
  const months = cells.filter((cell, i) => i === 0 || cell.date.slice(8) === '01').filter((cell, i, list) => i === 0 || cell.x - list[i - 1].x > 24).map((cell) => `<text x="${cell.x}" y="120">${new Date(`${cell.date}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}</text>`).join('');
  const activeDays = cells.filter((cell) => cell.count > 0).length;
  const label = [
    `${calendar.username}'s contribution calendar: ${total.toLocaleString('en-US')} contributions across ${calendar.days.length} days.`,
    'Five separated travelers reappear independently after each crossing. Starflight enters from the right and travels left; the other travelers enter from the left.',
    'Each type has one visible sprite. Routes prefer different fields, and ships never trail closely in the same lane.',
    'SpaceX Starflight and Enterprise D now travel at two-thirds of their previous movement speed. Starflight follows least resistance; Enterprise D targets high density with 3–5 red torpedoes alternating with two red phasers.',
    'The Klingon Bird of Prey and Discovery appear together one playback second after both lead ships reach the grid.',
    'The Klingon travels twice Discovery’s speed and fires only green photon torpedoes at randomly selected contribution blocks.',
    'When in range it exchanges harmless fire with Enterprise D; bright blue and pale green shield bubbles flash before the ships diverge.',
    'Discovery keeps its one-third baseline speed in repeating seven-, five-, and three-block bursts, with orange aft exhaust only during movement. Starflight runs at 60% of the updated Enterprise and Klingon rate.',
    'If blocked Discovery fires a two-second blue beam, dealing up to two hits to each of two blocks ahead, then continues or retreats left and retries.',
    'After Discovery reaches the grid, a blue TARDIS follows a continuous sine wave spanning the full grid height with clearance for its hull, detouring around surviving blocks and staying out of other ships’ wakes.',
    'Its longest side matches Enterprise D’s, with its proportions preserved. It spins during seven-block glides and reverses along the same cleared sine wave to yield to blocks or ships. If there is no cleared prefix to reverse along, appearance waits for a safe departure.',
    `Ships clear ${shotMap.size} blocks with ${shots.length} damage events. Each hit lowers density by one level; the last hit explodes the block.`,
    'Playback is slowed and the board refreshes between rounds.',
  ].join(' ');
  // Only the explicit #play-animation link opts out of the reduced-motion default.
  // A fragment works in a standalone SVG without scripts or extra generated assets.
  return `<svg id="play-animation" xmlns="http://www.w3.org/2000/svg" width="940" height="360" viewBox="0 0 940 360" role="img" aria-labelledby="title desc">
<title id="title">CONTRIBUTION - IT TOO SHALL PASS · ${escapeXml(calendar.username)}</title><desc id="desc">${escapeXml(label)} Snapshot ${snapshotDate}. Reduced motion shows the complete calendar unless playback is explicitly selected.</desc>
<style>text{font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace}${css.join('')}@media(prefers-reduced-motion:reduce){svg:not(:target) .motion{animation:none!important;opacity:1!important}svg:not(:target) .tardis-visibility{visibility:visible!important}svg:not(:target) .effect,svg:not(:target) .tardis-wall{display:none!important}}</style>
<rect x="0.5" y="0.5" width="939" height="359" rx="8" fill="${p.bg}" stroke="${p.border}"/>
<path d="M1 64H939M1 316H939" stroke="${p.border}"/>
<g transform="translate(25 25)" fill="${p.accent}"><path d="${pixels(ALIEN, 2)}"/></g>
<text x="63" y="36" font-size="15" font-weight="700" letter-spacing="1.2" fill="${p.text}">CONTRIBUTION - IT TOO SHALL PASS</text>
<text x="913" y="36" text-anchor="end" font-size="12" fill="${p.accent}">${total.toLocaleString('en-US')} CONTRIBUTIONS</text>
${stars}<g font-size="10" fill="${p.muted}">${months}</g>${grid}${projectiles}${emergencyBeams}${fleet}
<text x="26" y="290" font-size="8" fill="${p.muted}">STARFLIGHT · LOW RESISTANCE</text>
<text x="232" y="290" font-size="8" fill="${p.muted}">ENTERPRISE D · HIGH DENSITY</text>
<text x="438" y="290" font-size="8" fill="${p.muted}">BIRD OF PREY · RANDOM</text>
<text x="644" y="290" font-size="8" fill="${p.muted}">DISCOVERY ONE · 7/5/3 BURSTS</text>
<text x="850" y="290" font-size="8" fill="${p.muted}">TARDIS · WAVE</text>
<text x="26" y="342" font-size="10" letter-spacing="1" fill="${p.muted}">${calendar.days.length} DAYS · ${activeDays} ACTIVE DAYS · ${snapshotDate}</text>
<g>${p.cells.map((color, i) => `<rect x="${785 + i * 14}" y="331" width="10" height="10" rx="2" fill="${color}"/>`).join('')}</g>
<text x="775" y="340" text-anchor="end" font-size="9" fill="${p.muted}">LESS</text><text x="860" y="340" font-size="9" fill="${p.muted}">MORE</text>
</svg>\n`;
}
