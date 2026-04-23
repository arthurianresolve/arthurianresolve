const names = { scout: 'Starflight', cruiser: 'Enterprise D', bird: 'Bird of Prey', discovery: 'Discovery One', tardis: 'TARDIS' };
const reasons = { appearance: 'Appearing', exit: 'Crossing complete', launch: 'Launch interval', turn: 'Changing direction',
  traffic: 'Waiting for traffic', 'departure-traffic': 'Waiting for a safe departure', 'shared-clearance': 'Waiting for a block to clear',
  'reserved-clearance': 'Holding a cancelled volley’s clearance interval',
  firing: 'Firing and clearing a block', blocked: 'Checking an obstruction', 'emergency-beam': 'Emergency blue laser',
  'retreat-check': 'Preparing to retreat', retry: 'Preparing another attempt', retreat: 'Retreating along cleared space',
  'burst-recharge': 'Between movement bursts', encounter: 'Harmless shield exchange', 'flyby-combat': 'In-range shield exchange',
  'traffic-reversal': 'Reversing to avoid traffic', 'contribution-reversal': 'Reversing while blocks clear', 'wall-reversal': 'Reversing at a solid wall',
  'alternate-entrance': 'Using another entrance', 'extended-traffic-wait': 'No shorter safe entrance available' };
const $ = (id) => document.getElementById(id);
let report, animations = [], paused = true, frame, selected, eventLimit = 150;

/** Seek every CSS animation together so weapons, block damage and ships stay aligned. */
function seek(seconds) {
  paused = true;
  cancelAnimationFrame(frame);
  for (const animation of animations) { animation.pause(); animation.currentTime = seconds * 1000; }
  $('time').value = seconds;
  $('clock').textContent = `${Number(seconds).toFixed(2)} s`;
  $('play').textContent = 'Play';
}

function tick() {
  if (paused) return;
  const seconds = Number(animations[0]?.currentTime ?? 0) / 1000 % report.durationSeconds;
  $('time').value = seconds;
  $('clock').textContent = `${seconds.toFixed(2)} s`;
  frame = requestAnimationFrame(tick);
}

/** Check the artifact fingerprint before allowing a recorded decision to seek it. */
async function loadAnimation(seconds = 0) {
  seek(seconds);
  $('play').disabled = $('time').disabled = true;
  const theme = document.documentElement.dataset.theme;
  const file = `github-contribution-grid-starship-${theme}.svg`;
  const response = await fetch(`/assets/${file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('The generated animation could not be loaded.');
  const bytes = await response.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
  if (digest !== report.artifacts[file]) throw new Error('This timeline belongs to an older SVG. Run npm run generate:diagnostics, then reload.');
  $('stage').innerHTML = new TextDecoder().decode(bytes);
  // This inspector always opens paused. Expose keyframes even when the OS uses
  // reduced motion, so manually seeking still works.
  const style = $('stage').querySelector('svg style');
  style.textContent = style.textContent.split('@media(prefers-reduced-motion:reduce)')[0];
  await new Promise(requestAnimationFrame);
  animations = $('stage').querySelector('svg').getAnimations({ subtree: true });
  if (!animations.length) throw new Error('The browser did not expose the animation timeline.');
  seek(seconds);
  $('play').disabled = $('time').disabled = false;
}

/** Render decision text with DOM text nodes; contribution metadata is never HTML. */
function renderEvents() {
  const filtered = report.events.filter((event) => (!$('ship').value || event.ship === $('ship').value)
    && (!$('reason').value || event.reason === $('reason').value));
  $('events').replaceChildren();
  for (const event of filtered.slice(0, eventLimit)) {
    const button = document.createElement('button');
    button.className = 'event'; button.setAttribute('aria-pressed', 'false');
    const time = document.createElement('time'); time.textContent = `${event.start.toFixed(2)} s`;
    const ship = document.createElement('span'); ship.textContent = names[event.ship];
    const crossing = document.createElement('small'); crossing.textContent = `Crossing ${event.crossing}`; ship.append(crossing);
    const description = document.createElement('span'); description.textContent = reasons[event.reason] ?? event.reason;
    const detail = document.createElement('small');
    detail.textContent = [event.otherShip && `For ${names[event.otherShip]}`, event.date,
      event.end > event.start && `${(event.end - event.start).toFixed(2)} seconds`,
      event.attempts && `${event.attempts} earlier entrance attempts`].filter(Boolean).join(' · ');
    description.append(detail); button.append(time, ship, description);
    button.addEventListener('click', () => {
      selected?.setAttribute('aria-pressed', 'false'); selected = button; button.setAttribute('aria-pressed', 'true');
      seek(Math.min(report.durationSeconds, event.start + (event.end - event.start) / 2));
    });
    $('events').append(button);
  }
  $('count').textContent = `Showing ${Math.min(filtered.length, eventLimit)} of ${filtered.length} decisions. Use the filters to narrow the timeline.`;
  $('more').hidden = filtered.length <= eventLimit;
}

function showError(error) { $('summary').textContent = error.message; $('summary').className = 'error'; }

async function init() {
  const response = await fetch('/diagnostics.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Generate a review timeline with npm run generate:diagnostics, then reload this page.');
  report = await response.json();
  if (report.version !== 1) throw new Error('Unsupported diagnostics version. Regenerate the timeline.');
  $('time').max = report.durationSeconds;
  for (const [value, label] of Object.entries(names)) $('ship').add(new Option(label, value));
  for (const reason of [...new Set(report.events.map((event) => event.reason))].sort()) $('reason').add(new Option(reasons[reason] ?? reason, reason));
  for (const filter of ['ship', 'reason']) $(filter).addEventListener('change', () => { eventLimit = 150; renderEvents(); });
  $('more').addEventListener('click', () => { eventLimit += 150; renderEvents(); });
  $('time').addEventListener('input', () => seek(Number($('time').value)));
  $('play').addEventListener('click', () => {
    if (!paused) { seek(Number(animations[0].currentTime) / 1000 % report.durationSeconds); return; }
    paused = false; $('play').textContent = 'Pause'; animations.forEach((animation) => animation.play()); tick();
  });
  $('theme').addEventListener('click', () => {
    $('theme').disabled = true;
    const light = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = light ? 'light' : 'dark'; $('theme').textContent = light ? 'Dark theme' : 'Light theme';
    loadAnimation(Number($('time').value)).catch(showError).finally(() => { $('theme').disabled = false; });
  });
  renderEvents();
  await loadAnimation();
  $('theme').disabled = false;
  $('summary').textContent = `${report.username} · snapshot ${report.snapshot.slice(0, 10)} · ${report.validation.flights} validated flights · ${report.validation.checkedPairs} ship pairs checked`;
}
init().catch(showError);
