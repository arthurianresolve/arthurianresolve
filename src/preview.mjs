import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_HOST = '127.0.0.1:4173';
export const PREVIEW_ORIGIN = `http://${PREVIEW_HOST}`;
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

/** Escape Markdown image text and URLs before inserting them into HTML attributes. */
function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Build the review page from the README and force generated local SVG sources. */
export async function buildPreview() {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  const template = await readFile(resolve(root, 'preview/template.html'), 'utf8');
  const content = readme
    // The README mixes HTML sections with standalone Markdown images.
    .replace(/^!\[([^\]\r\n]*)\]\((https?:\/\/[^\s)]+)\)\r?$/gm,
      (_, alt, url) => `<p><img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" /></p>`)
    .replace(/<source\b[^>]*github-contribution-grid-starship[^>]*\/>/g, '')
    .replace(/https:\/\/raw\.githubusercontent\.com\/arthurianresolve\/arthurianresolve\/output\/(github-(?:stats-panels|contribution-grid-starship)-[\w-]+\.svg)/g, 'assets/$1')
    .replace('src="assets/github-contribution-grid-starship-dark.svg"', 'id="starship" src="assets/github-contribution-grid-starship-dark.svg"');
  await writeFile(resolve(root, 'preview.html'), template.replace('<!-- README -->', content));
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
    if (!diagnostic && (!file.startsWith(root + sep) || !types[extname(file)] || pathname.split(/[\\/]/).some((part) => part.startsWith('.')))) {
      send(403, 'Forbidden');
      return;
    }
    const body = await readFile(file);
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
