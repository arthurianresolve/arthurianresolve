import { createServer } from 'node:http';
import { lstat, open, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootRealpath = realpath(root);
const PREVIEW_HOST = '127.0.0.1:4173';
export const PREVIEW_ORIGIN = `http://${PREVIEW_HOST}`;
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const SAFE_TAGS = new Map([
  ['a', new Set(['href'])], ['blockquote', new Set()], ['br', new Set()], ['em', new Set()],
  ['h1', new Set(['align'])], ['h2', new Set(['align'])], ['hr', new Set()],
  ['img', new Set(['alt', 'height', 'src', 'width'])], ['p', new Set(['align'])],
  ['picture', new Set()], ['source', new Set(['media', 'srcset'])], ['strong', new Set()],
  ['sub', new Set()], ['table', new Set()], ['tbody', new Set()], ['td', new Set(['align', 'width'])],
  ['th', new Set(['align', 'width'])], ['thead', new Set()], ['tr', new Set()], ['wbr', new Set()],
]);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'source', 'wbr']);
const SAFE_ENTITY = /&(?:amp|apos|gt|lt|nbsp|quot|#\d{1,7}|#x[\da-f]{1,6});/gi;
const SAFE_MEDIA = /^(?:\((?:prefers-color-scheme: (?:dark|light)|prefers-reduced-motion: reduce)\))(?: and \((?:prefers-color-scheme: (?:dark|light)|prefers-reduced-motion: reduce)\))*$/;

/** Escape Markdown image text and URLs before inserting them into HTML attributes. */
function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeEntities(value) {
  return value.replace(SAFE_ENTITY, (entity) => {
    const body = entity.slice(1, -1).toLowerCase();
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"' }[body];
  });
}

function escapeText(value) {
  return value.replace(/&(?!(?:amp|apos|gt|lt|nbsp|quot|#\d{1,7}|#x[\da-f]{1,6});)/gi, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findTagEnd(source, start) {
  let quote = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  throw new Error('README contains an unterminated HTML tag.');
}

function parseAttributes(source) {
  let cursor = 0;
  let selfClosing = false;
  const attributes = [];
  if (source.trimEnd().endsWith('/')) {
    selfClosing = true;
    source = source.trimEnd().slice(0, -1);
  }
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    if (cursor === source.length) break;
    const nameMatch = /^([A-Za-z_:][A-Za-z0-9:._-]*)/.exec(source.slice(cursor));
    if (!nameMatch) throw new Error('README contains a malformed HTML attribute.');
    const name = nameMatch[1].toLowerCase();
    cursor += nameMatch[1].length;
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    if (source[cursor] !== '=') throw new Error('README HTML attributes must have values.');
    cursor += 1;
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    if (source[cursor] !== '"') throw new Error('README HTML attributes must use double quotes.');
    cursor += 1;
    const end = source.indexOf('"', cursor);
    if (end < 0) throw new Error('README contains an unterminated HTML attribute.');
    if (attributes.some(([existing]) => existing === name)) throw new Error(`README repeats the ${name} attribute.`);
    attributes.push([name, source.slice(cursor, end)]);
    cursor = end + 1;
  }
  return { attributes, selfClosing };
}

function safeUrl(value, kind) {
  const decoded = decodeEntities(value).trim();
  if (!decoded || /[\u0000-\u0020\u007f"'<>\\]/u.test(decoded)) throw new Error(`README contains an unsafe ${kind} URL.`);
  if (kind === 'image' && decoded.includes(',')) throw new Error('README image srcset values must contain one URL.');
  let parsed;
  try { parsed = new URL(decoded, PREVIEW_ORIGIN); } catch { throw new Error(`README contains an invalid ${kind} URL.`); }
  if (kind === 'href') {
    if (parsed.protocol !== 'https:' && !(parsed.origin === PREVIEW_ORIGIN && !/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(decoded))) {
      throw new Error('README links must use HTTPS or stay within the preview.');
    }
  } else if (parsed.protocol !== 'https:' && !(parsed.origin === PREVIEW_ORIGIN && /^(?:\/?assets)\//.test(decoded))) {
    throw new Error('README images must use HTTPS or a local asset.');
  }
  return escapeAttribute(decoded);
}

function safeAttribute(tag, name, value) {
  const decoded = decodeEntities(value);
  if (/[\u0000-\u001f\u007f]/u.test(decoded)) throw new Error(`README contains an unsafe ${name} attribute.`);
  if (name === 'href' || name === 'src' || name === 'srcset') return safeUrl(decoded, name === 'href' ? 'href' : 'image');
  if (name === 'media') {
    if (!SAFE_MEDIA.test(decoded)) throw new Error('README contains an unsupported media query.');
  } else if (name === 'align') {
    if (!/^(?:center|left|right)$/.test(decoded)) throw new Error('README contains an unsupported alignment.');
  } else if (name === 'width' || name === 'height') {
    if (!/^\d{1,4}(?:\.\d{1,2})?%?$/.test(decoded)) throw new Error(`README contains an invalid ${name}.`);
  } else if (name === 'alt' && decoded.length > 4096) {
    throw new Error('README alt text is too long.');
  }
  return escapeAttribute(decoded);
}

/** Render the README's small, known-safe HTML vocabulary for the local page. */
export function sanitizeReadme(source) {
  let cursor = 0;
  let output = '';
  const stack = [];
  while (cursor < source.length) {
    const tagStart = source.indexOf('<', cursor);
    if (tagStart < 0) {
      output += escapeText(source.slice(cursor));
      break;
    }
    output += escapeText(source.slice(cursor, tagStart));
    if (source.startsWith('<!--', tagStart)) {
      const commentEnd = source.indexOf('-->', tagStart + 4);
      if (commentEnd < 0) throw new Error('README contains an unterminated HTML comment.');
      cursor = commentEnd + 3;
      continue;
    }
    const tagEnd = findTagEnd(source, tagStart);
    const raw = source.slice(tagStart, tagEnd + 1);
    const closing = /^<\/([A-Za-z][A-Za-z0-9]*)\s*>$/.exec(raw);
    if (closing) {
      const tag = closing[1].toLowerCase();
      if (!SAFE_TAGS.has(tag) || VOID_TAGS.has(tag) || stack.pop() !== tag) throw new Error(`README contains an unexpected </${tag}> tag.`);
      output += `</${tag}>`;
      cursor = tagEnd + 1;
      continue;
    }
    const opening = /^<([A-Za-z][A-Za-z0-9]*)([\s\S]*)>$/.exec(raw);
    if (!opening) throw new Error('README contains unsupported HTML.');
    const tag = opening[1].toLowerCase();
    if (!SAFE_TAGS.has(tag)) throw new Error(`README contains unsupported <${tag}> HTML.`);
    const { attributes, selfClosing } = parseAttributes(opening[2]);
    const allowed = SAFE_TAGS.get(tag);
    for (const [name] of attributes) if (!allowed.has(name)) throw new Error(`README contains an unsupported ${name} attribute.`);
    const rendered = attributes.map(([name, value]) => ` ${name}="${safeAttribute(tag, name, value)}"`).join('');
    if (!VOID_TAGS.has(tag) && selfClosing) throw new Error(`README self-closes non-void <${tag}> HTML.`);
    output += `<${tag}${rendered}${VOID_TAGS.has(tag) ? ' />' : '>'}`;
    if (!VOID_TAGS.has(tag)) stack.push(tag);
    cursor = tagEnd + 1;
  }
  if (stack.length) throw new Error(`README does not close <${stack.at(-1)}> HTML.`);
  return output;
}

function isWithin(base, target) {
  const relativePath = relative(base, target);
  return relativePath === '' || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

async function canonicalExistingPath(file) {
  const [canonicalRoot, canonicalFile] = await Promise.all([rootRealpath, realpath(file)]);
  if (!isWithin(canonicalRoot, canonicalFile)) throw new Error('Preview path leaves the workspace.');
  return canonicalFile;
}

async function canonicalOutputPath(file) {
  const canonicalRoot = await rootRealpath;
  const canonicalParent = await realpath(dirname(file));
  if (!isWithin(canonicalRoot, canonicalParent)) throw new Error('Preview output leaves the workspace.');
  try {
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Preview output cannot be a symlink.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return resolve(canonicalParent, basename(file));
}

async function readWorkspaceFile(relativePath, encoding) {
  return readCanonicalFile(resolve(root, relativePath), encoding);
}

async function writeWorkspaceFile(relativePath, content) {
  const target = await canonicalOutputPath(resolve(root, relativePath));
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function readCanonicalFile(file, encoding) {
  const canonicalFile = await canonicalExistingPath(file);
  const handle = await open(canonicalFile, 'r');
  try {
    const [canonicalRoot, openedPath, openedStat, currentStat] = await Promise.all([
      rootRealpath, realpath(canonicalFile), handle.stat(), stat(canonicalFile),
    ]);
    if (!isWithin(canonicalRoot, openedPath) || openedStat.dev !== currentStat.dev || openedStat.ino !== currentStat.ino) {
      throw new Error('Preview path changed during open.');
    }
    return handle.readFile(encoding ? { encoding } : undefined);
  } finally {
    await handle.close();
  }
}

/** Build the review page from the README and force generated local SVG sources. */
export async function buildPreview() {
  const readme = await readWorkspaceFile('README.md', 'utf8');
  const template = await readWorkspaceFile('preview/template.html', 'utf8');
  const content = sanitizeReadme(readme
    // The README mixes HTML sections with standalone Markdown images.
    .replace(/^!\[([^\]\r\n]*)\]\((https?:\/\/[^\s)]+)\)\r?$/gm,
      (_, alt, url) => `<p><img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" /></p>`)
    .replace(/<source\b[^>]*github-contribution-grid-starship[^>]*\/>/g, '')
    .replace(/https:\/\/raw\.githubusercontent\.com\/arthurianresolve\/arthurianresolve\/output\/(github-(?:stats-panels|contribution-grid-starship)-[\w-]+\.svg)/g, 'assets/$1'))
    .replace(/^[ \t]+$/gm, '')
    .replace('<img width="940" src="assets/github-contribution-grid-starship-dark.svg" alt="CONTRIBUTION - IT TOO SHALL PASS.', '<img id="starship" width="940" src="assets/github-contribution-grid-starship-dark.svg" alt="CONTRIBUTION - IT TOO SHALL PASS.');
  await writeWorkspaceFile('preview.html', template.replace('<!-- README -->', content));
}

const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

// Node exposes only the first Host in headers.host; count raw fields to reject duplicates.
function hasExpectedHost(request) {
  const hosts = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === 'host') hosts.push(request.rawHeaders[index + 1]);
  }
  return hosts.length === 1 && hosts[0] === PREVIEW_HOST;
}

/** Serve only public preview assets inside the workspace, without browser caching. */
async function serveAsset(request, response) {
  const headOnly = request.method === 'HEAD';
  const send = (status, body, headers) => response.writeHead(status, headers).end(headOnly ? undefined : body);
  if (!ALLOWED_METHODS.has(request.method)) {
    send(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }
  if (!hasExpectedHost(request)) {
    send(403, 'Forbidden');
    return;
  }
  try {
    const url = new URL(request.url, PREVIEW_ORIGIN);
    if (url.origin !== PREVIEW_ORIGIN) {
      send(403, 'Forbidden');
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    // This single diagnostics route is the only exception to the hidden-file prohibition.
    const diagnostic = pathname === '/diagnostics.json';
    const file = diagnostic ? resolve(root, '.preview/flight-diagnostics.json')
      : resolve(root, `.${pathname === '/' ? '/preview.html' : pathname}`);
    if (!diagnostic && (!isWithin(root, file) || !types[extname(file)] || pathname.split(/[\\/]/).some((part) => part.startsWith('.')))) {
      send(403, 'Forbidden');
      return;
    }
    const body = await readCanonicalFile(file);
    const headers = { 'Content-Type': diagnostic ? 'application/json; charset=utf-8' : types[extname(file)], 'Cache-Control': 'no-store' };
    if (!diagnostic) headers['X-Content-Type-Options'] = 'nosniff';
    send(200, body, headers);
  } catch {
    send(404, 'Not found');
  }
}

export function createPreviewServer() {
  return createServer(serveAsset);
}
