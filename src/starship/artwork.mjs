import { BIRD_SCALE, TARDIS_SCALE } from './config.mjs';

import { THEMES } from '../themes.mjs';
export { THEMES } from '../themes.mjs';

export const ALIEN = ['00100000100', '00010001000', '00111111100', '01101110110', '11111111111', '10111111101', '10100000101', '00011011000'];

/**
 * Turn a small binary pixel mask into an SVG path; used for the arcade title icon.
 */
export function pixels(rows, scale = 1) {
  return rows.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '1' ? [`M${x * scale} ${y * scale}h${scale}v${scale}h-${scale}z`] : [])).join('');
}

/**
 * Return a ship sprite facing up, centered on its local origin.
 * Flight groups rotate this artwork into the travel direction. Draw order runs
 * from rear components to forward hull details. Update config.mjs collision bounds
 * and muzzle positions whenever the silhouette or scale changes.
 */
export function shipArtwork(id, theme = 'dark') {
  switch (id) {
    case 'bird': return birdArtwork(theme);
    case 'discovery': return discoveryArtwork(theme);
    case 'cruiser': return enterpriseArtwork(theme);
    case 'tardis': return tardisArtwork(theme);
    default: return starflightArtwork(theme);
  }
}

// The lamp stays on the vertical axis while the surrounding walls turn.
export const TARDIS_LAMP = '<rect x="-.6" y="-6.3" width="1.2" height="1" rx=".2" fill="#c9f3ff"/>';

/** Draw one box wall; only the front doors carry the white instruction placard. */
export function tardisFaceArtwork(theme, front = false) {
  const blue = front ? (theme === 'dark' ? '#347fc9' : '#2467ab') : (theme === 'dark' ? '#2865a2' : '#1c528a');
  return [
    `<path d="M-3.4-4.6-2.8-5.3H2.8L3.4-4.6Z" fill="${blue}"/>`,
    `<rect x="-3.4" y="-4.6" width="6.8" height="10.2" fill="${blue}" stroke="#123b65" stroke-width=".35"/>`,
    '<rect x="-3" y="-4.3" width="6" height="1.2" fill="#102d50"/>',
    '<text x="0" y="-3.45" text-anchor="middle" font-size=".9" fill="#edf9ff">POLICE BOX</text>',
    '<path d="M-2.6-2.5H-.5V0H-2.6ZM.5-2.5H2.6V0H.5Z" fill="#a8dcf3"/>',
    '<path d="M-1.55-2.5V0M1.55-2.5V0M-2.6-1.25H-.5M.5-1.25H2.6M0-3v8.4" stroke="#16446f" stroke-width=".3"/>',
    '<path d="M-2.6 1H-.5V2.6H-2.6ZM.5 1H2.6V2.6H.5ZM-2.6 3.3H-.5V4.9H-2.6ZM.5 3.3H2.6V4.9H.5Z" fill="#1a548b"/>',
    front ? '<rect x="-2.3" y="1.3" width="1.5" height="1" fill="#d4e5e8"/>' : '',
    '<path d="M-3.8 5.6H3.8V6.2H-3.8Z" fill="#143d69"/>',
  ].join('');
}

/**
 * Orthographic wall projections for a turn about the vertical axis. Each pair is
 * [horizontal scale, horizontal offset]; height is unchanged. Hidden walls collapse
 * to zero width, and the positive scales keep visible signs readable rather than mirrored.
 */
export function tardisProjection(turns) {
  const cos = Math.cos(turns * Math.PI * 2);
  const sin = Math.sin(turns * Math.PI * 2);
  // Both side walls share one absolute projection width. Keeping the pair
  // symmetric makes the box read as a solid 3D object at every yaw.
  const sideScale = Math.abs(sin) * 2 / 3.4;
  return {
    front: [Math.max(0, cos), 2 * sin],
    back: [Math.max(0, -cos), -2 * sin],
    right: [sideScale, -3.4 * cos],
    left: [sideScale, 3.4 * cos],
  };
}

/** Draw the stationary front view at Enterprise's overall length. */
function tardisArtwork(theme) {
  return `<g aria-label="TARDIS blue police box" transform="scale(${TARDIS_SCALE})">${tardisFaceArtwork(theme, true)}${TARDIS_LAMP}</g>`;
}

/** Draw the enlarged olive hull: feathered wings, cannons, neck, then command pod. */
function birdArtwork(theme) {
  const hull = theme === 'dark' ? '#8ba86b' : '#5b773f';
  const trim = theme === 'dark' ? '#435d3a' : '#344c2b';
  const edge = theme === 'dark' ? '#b7cc8d' : '#88a160';
  return [
    `<g aria-label="Klingon Bird of Prey" transform="scale(${BIRD_SCALE})">`,
    `<path d="M-1.8.6-6.5-1-6.8 1.7-3.2 5-1.7 4.5ZM1.8.6 6.5-1 6.8 1.7 3.2 5 1.7 4.5Z" fill="${hull}"/>`,
    `<path d="M-2.4 1.2-5.7.1M-2.4 2-5.8 1.3M-2.4 2.8-4.9 2.9M-2.5 3.5-3.6 4.2M2.4 1.2 5.7.1M2.4 2 5.8 1.3M2.4 2.8 4.9 2.9M2.5 3.5 3.6 4.2" fill="none" stroke="${trim}" stroke-width="0.35"/>`,
    `<path d="M-2 .6-6.4-1M2 .6 6.4-1" stroke="${edge}" stroke-width="0.25"/>`,
    `<path d="M-2.8 1h1.1v2.5h-1.1zM1.7 1h1.1v2.5H1.7z" fill="${trim}"/>`,
    `<path d="M-7-3h.8v4.5H-7zM6.2-3H7v4.5h-.8z" fill="${trim}"/>`,
    `<path d="M-6.8-3h.4v1h-.4zM6.4-3h.4v1h-.4z" fill="${edge}"/>`,
    `<path d="M-.55-4.4h1.1v5.5h-1.1z" fill="${edge}"/>`,
    `<ellipse cy="2.3" rx="1.9" ry="2.5" fill="${hull}"/>`,
    `<path d="M0 .1v3.8M-1.5 4.4-.9 5.5H.9L1.5 4.4Z" fill="${trim}" stroke="${trim}" stroke-width="0.25"/>`,
    `<path d="M-.8 4.45H.8" stroke="#c18b58" stroke-width="0.45"/>`,
    `<ellipse cy="-6.1" rx="1.45" ry="1.9" fill="${hull}"/>`,
    `<path d="M-.8-6.9H.8M-.6-5.1H.6" stroke="${trim}" stroke-width="0.35"/>`,
    `<ellipse cy="-6.2" rx=".65" ry=".9" fill="${edge}"/>`,
    `<circle cy="-7.65" r=".25" fill="#d5ffad"/>`,
    `</g>`,
  ].join('');
}

/** Draw Discovery’s spine and engines behind its spherical command module. */
function discoveryArtwork(theme) {
  const p = THEMES[theme];
  const hull = theme === 'dark' ? '#e4dfcf' : '#787667';
  const detail = theme === 'dark' ? '#9b998f' : '#41443f';
  return [
    `<g aria-label="Discovery One-inspired ship">`,
    `<path d="M-0.8-1h1.6v16H-0.8z" fill="${hull}"/>`,
    `<path d="M-2 3h4M-2 6h4M-2 9h4M-2 12h4" stroke="${detail}" stroke-width="1"/>`,
    `<path d="M-3 13h6v5H-3zM-4.5 16h2v3h-2zM2.5 16h2v3h-2z" fill="${hull}"/>`,
    `<path d="M-1.5 17h3v2h-3z" fill="${detail}"/>`,
    `<circle cx="0" cy="-5.5" r="5.5" fill="${hull}"/>`,
    `<path d="M-4-5.5h8M0-10v9" stroke="${detail}" stroke-width="0.55"/>`,
    `<path d="M-3-7.5h6v1.2h-6z" fill="${p.bg}"/>`,
    `<circle cx="-2" cy="-3.3" r="0.8" fill="${detail}"/>`,
    `</g>`,
  ].join('');
}

/** Draw nacelles and engineering hull behind the layered NCC-1701-D saucer. */
function enterpriseArtwork(theme) {
  const hull = theme === 'dark' ? '#c8dbe8' : '#466274';
  const trim = theme === 'dark' ? '#8ba6bc' : '#253e50';
  const blue = theme === 'dark' ? '#3494ff' : '#176dde';
  return [
    `<g aria-label="Enterprise-D-inspired cruiser">`,
    `<path d="M-2-1h4v10H-2zM-2 6-5 9v2l5-2 5 2V9L2 6Z" fill="${trim}"/>`,
    `<path d="M-2.4 2Q-2.5 7 0 11Q2.5 7 2.4 2Z" fill="${hull}"/>`,
    `<rect x="-6" y="5" width="2" height="9" rx="1" fill="${hull}"/>`,
    `<rect x="4" y="5" width="2" height="9" rx="1" fill="${hull}"/>`,
    `<path d="M-5.7 5.8h1.4v1.4h-1.4zM4.3 5.8h1.4v1.4H4.3z" fill="#e3856d"/>`,
    `<path d="M-5.6 7.8h1.2v5.4h-1.2zM4.4 7.8h1.2v5.4H4.4z" fill="${blue}"/>`,
    `<path d="M-5.3 8.2v4.5M5.3 8.2v4.5" stroke="${theme === 'dark' ? '#a4dfff' : '#75c7ff'}" stroke-width=".3"/>`,
    `<g aria-label="NCC-1701-D elliptical saucer">`,
    `<ellipse cy="-3" rx="8.5" ry="7" fill="${hull}"/>`,
    `<ellipse cy="-3" rx="7.8" ry="6.3" fill="none" stroke="${trim}" stroke-width="0.3"/>`,
    `<path d="M-1.9 2.2A6.5 5.3 0 1 1 1.9 2.2" fill="none" stroke="${trim}" stroke-width="0.45"/>`,
    `<path d="M0-9.2v.9M-4-8.1-3.4-7.4M4-8.1 3.4-7.4M-7-5.6-6-5.2M7-5.6 6-5.2M-7.4-1.2-6.4-1.4M7.4-1.2 6.4-1.4M-5 1.5-4.3.9M5 1.5 4.3.9" fill="none" stroke="${trim}" stroke-width="0.2" opacity=".65"/>`,
    `<path d="M-1.5-3.2Q-1.9-1-1.8 1.4H1.8Q1.9-1 1.5-3.2Z" fill="${hull}" stroke="${trim}" stroke-width="0.25"/>`,
    `<ellipse cy="-3.6" rx="1.15" ry="1.45" fill="${trim}"/>`,
    `<ellipse cy="-3.8" rx=".7" ry=".9" fill="${hull}"/>`,
    `<path d="M-3.8 2.8h1.2M2.6 2.8h1.2" stroke="#e3856d" stroke-width="0.4"/>`,
    `<text x="0" y="-6.5" text-anchor="middle" font-size=".85" font-weight="600" fill="${trim}">NCC-1701-D</text>`,
    `</g>`,
    `</g>`,
  ].join('');
}

/** Draw Starflight’s swept fins, silver hull, and dark canopy. */
function starflightArtwork(theme) {
  const hull = theme === 'dark' ? '#edf0f4' : '#9ba7b2';
  const trim = theme === 'dark' ? '#a1abb8' : '#647481';
  return [
    `<g aria-label="SpaceX Starflight-inspired scout">`,
    `<path d="M-2-3-4-2-4 0-2 0M2-3 4-2 4 0 2 0M-3 3-7 10-7 12-2 9M3 3 7 10 7 12 2 9" fill="${trim}"/>`,
    `<path d="M0-6C-2.4-5-3.5 0-3.5 5L-3 11H3L3.5 5C3.5 0 2.4-5 0-6Z" fill="${hull}"/>`,
    `<path d="M0-4C-1.3-3-1.6-1-1.4 2H1.4C1.6-1 1.3-3 0-4Z" fill="#142230"/>`,
    `<path d="M-1.2-2H1.2M-1.4 0H1.4M0-3V2" stroke="#6c8b9b" stroke-width="0.4"/>`,
    `<path d="M-2 3-2.5 9M2 3 2.5 9M-3 10H3" stroke="${trim}" stroke-width="0.6"/>`,
    `<path d="M-3 11h2v1h-2zM1 11h2v1H1z" fill="${trim}"/>`,
    `</g>`,
  ].join('');
}
