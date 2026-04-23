const MAX_SOURCE_BYTES = 256 * 1024;
const SAFE_ELEMENTS = new Map([
  ['svg', new Set(['width', 'height', 'viewBox', 'xmlns', 'role', 'aria-label', 'x', 'y', 'fill'])],
  ['title', new Set()],
  ['style', new Set()],
  ['rect', new Set(['x', 'y', 'rx', 'ry', 'width', 'height', 'fill'])],
  ['g', new Set(['class', 'style', 'transform'])],
  ['path', new Set(['d', 'fill'])],
  ['text', new Set(['x', 'y', 'fill', 'class', 'text-anchor'])],
  ['circle', new Set(['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity', 'stroke-linecap',
    'stroke-dasharray', 'stroke-dashoffset', 'transform', 'class'])],
]);
const SAFE_CLASSES = new Set(['title', 'label', 'value', 'trend-text', 'row', 'ring-progress', 'ring-grade', 'ring-pct']);
const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const NUMBER_LIST = new RegExp(`^${NUMBER}(?:[ ,]+${NUMBER})*$`);
const SAFE_STYLE = `<style>
    .title { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: #b4ef77; animation: fadeIn .8s ease-in-out forwards; }
    .label { font: 400 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6edf3; }
    .value { font: 700 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6edf3; }
    .trend-text { font: 700 10px 'Segoe UI', Ubuntu, Sans-Serif; }
    .ring-grade { font: 800 20px 'Segoe UI', Ubuntu, Sans-Serif; fill: #b4ef77; }
    .ring-pct { font: 600 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6edf3; opacity: 0.7; }
    .row { opacity: 0; animation: fadeIn .3s ease-in-out forwards; }
    .ring-progress { animation: ringFill 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
    @keyframes ringFill { from { stroke-dashoffset: 251.32741228718345; } }
    @media (prefers-reduced-motion: reduce) {
      .row, .title { animation: none !important; opacity: 1; }
      .ring-progress { animation: none !important; }
    }
  </style>`;

/** Parse the restricted attribute grammar without enabling an XML entity engine. */
function parseAttributes(source) {
  const attributes = [];
  let offset = 0;
  while (offset < source.length) {
    const whitespace = /^\s+/.exec(source.slice(offset));
    if (whitespace) offset += whitespace[0].length;
    if (offset === source.length) break;
    const attribute = /^([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/.exec(source.slice(offset));
    if (!attribute) throw new Error('The ghstats.dev card contains malformed or unsupported SVG attributes.');
    attributes.push([attribute[1], attribute[2]]);
    offset += attribute[0].length;
  }
  if (new Set(attributes.map(([name]) => name)).size !== attributes.length) {
    throw new Error('The ghstats.dev card contains duplicate SVG attributes.');
  }
  return attributes;
}

// Only predefined XML entities are accepted; declarations and custom entities stay forbidden.
function safeText(value) {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(value)
    && !/&(?!(?:amp|apos|quot|lt|gt);)/.test(value);
}

function safeAttribute(name, value) {
  if (['x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'opacity',
    'stroke-dasharray', 'stroke-dashoffset'].includes(name)) return NUMBER_LIST.test(value);
  if (name === 'viewBox') return new RegExp(`^${NUMBER}(?: +${NUMBER}){3}$`).test(value);
  if (name === 'fill' || name === 'stroke') return /^(?:none|#[0-9a-fA-F]{6})$/.test(value);
  if (name === 'd') return /^[MmZzLlHhVvCcSsQqTtAa0-9.,+\-\sEe]+$/.test(value) && /[Mm]/.test(value);
  if (name === 'class') return SAFE_CLASSES.has(value);
  if (name === 'style') return /^animation-delay:\d{1,4}ms$/.test(value);
  if (name === 'transform') return /^(?:translate\([-+\d., ]+\)|rotate\([-+\d., ]+\))$/.test(value);
  if (name === 'text-anchor') return /^(?:end|middle)$/.test(value);
  if (name === 'stroke-linecap') return value === 'round';
  if (name === 'xmlns') return value === 'http://www.w3.org/2000/svg';
  if (name === 'role') return value === 'img';
  if (name === 'aria-label') return safeText(value);
  return false;
}

/** Retain only the provider's passive, expected SVG vocabulary and replace its CSS locally. */
export function sanitizeStatsSvg(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_SOURCE_BYTES || /<!|<\?/.test(source)) {
    throw new Error('The ghstats.dev card contains unsupported SVG markup.');
  }
  const token = /<\/?[A-Za-z][^>]*>/g;
  const stack = [];
  let result = '';
  let cursor = 0;
  let inStyle = false;
  let styleSeen = false;
  for (const match of source.matchAll(token)) {
    const text = source.slice(cursor, match.index);
    if (!inStyle) {
      if (!safeText(text)) throw new Error('The ghstats.dev card contains unsafe SVG text.');
      result += text;
    }
    cursor = match.index + match[0].length;
    const closing = match[0].startsWith('</');
    const selfClosing = /\/\s*>$/.test(match[0]);
    const parsed = /^<\/?([A-Za-z][\w-]*)([\s\S]*?)(?:\/)?\s*>$/.exec(match[0]);
    if (!parsed || !SAFE_ELEMENTS.has(parsed[1])) throw new Error('The ghstats.dev card contains unsupported SVG elements.');
    const name = parsed[1];
    if (closing) {
      if (parsed[2].trim() || stack.pop() !== name) throw new Error('The ghstats.dev card is not well formed.');
      if (name === 'style') inStyle = false;
      else result += match[0];
      continue;
    }
    const attributes = parseAttributes(parsed[2].replace(/\/\s*$/, ''));
    const allowed = SAFE_ELEMENTS.get(name);
    if (attributes.some(([attribute, value]) => !allowed.has(attribute) || !safeAttribute(attribute, value))) {
      throw new Error('The ghstats.dev card contains unsupported SVG attributes.');
    }
    if (name === 'style') {
      if (styleSeen || selfClosing || stack.length !== 1 || stack[0] !== 'svg') {
        throw new Error('The ghstats.dev card contains an unexpected style element.');
      }
      styleSeen = true;
      inStyle = true;
      result += SAFE_STYLE;
    } else result += match[0];
    if (!selfClosing) stack.push(name);
  }
  const tail = source.slice(cursor);
  if (inStyle || stack.length || !safeText(tail)) throw new Error('The ghstats.dev card is not well formed.');
  result += tail;
  if (!styleSeen || !result.startsWith('<svg') || !result.trimEnd().endsWith('</svg>')) {
    throw new Error('The ghstats.dev card layout changed; existing stats assets were preserved.');
  }
  return result;
}
