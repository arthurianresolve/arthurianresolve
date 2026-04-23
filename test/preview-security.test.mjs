import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { createPreviewServer } from '../scripts/preview.mjs';

let server;
let port;

function send({ method = 'GET', host = '127.0.0.1:4173', path = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const call = request({ hostname: '127.0.0.1', port, method, path, headers: { Host: host } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    call.on('error', reject);
    call.end();
  });
}

function sendRaw(message) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.end(message));
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

test.before(async () => {
  server = createPreviewServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

test.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test('[PREVIEW-SEC-01] only the exact loopback host can read preview resources', async () => {
  assert.equal((await send()).status, 200);
  assert.equal((await send({ host: 'attacker.invalid:4173' })).status, 403);
  assert.equal((await send({ host: 'localhost:4173' })).status, 403);
  assert.equal((await send({ path: 'http://attacker.invalid/' })).status, 403);
  const duplicate = await sendRaw('GET / HTTP/1.1\r\nHost: 127.0.0.1:4173\r\nHost: attacker.invalid:4173\r\nConnection: close\r\n\r\n');
  assert.match(duplicate, /^HTTP\/1\.1 403 /);
});

test('[PREVIEW-SEC-02] only GET and HEAD are accepted', async () => {
  const head = await send({ method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  const post = await send({ method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('[PREVIEW-SEC-03] hidden paths, aliases and ambiguous requests remain blocked', async () => {
  for (const path of ['/.git/config', '/%2epreview/flight-diagnostics.json', '/%2e%2e/package.json', '/data/contributions.json']) {
    assert.equal((await send({ path })).status, 403, path);
  }
  assert.equal((await send({ path: '//attacker.invalid/' })).status, 403);
  assert.equal((await send({ path: '/diagnostics.json', host: 'attacker.invalid:4173' })).status, 403);
  for (const host of ['', '127.0.0.1', '127.0.0.1:4174', '127.1:4173']) assert.equal((await send({ host })).status, 403, host);
  for (const hosts of ['', 'Host: 127.0.0.1:4173\r\nHost: 127.0.0.1:4173\r\n']) {
    const response = await sendRaw(`GET / HTTP/1.1\r\n${hosts}Connection: close\r\n\r\n`);
    assert.match(response, /^HTTP\/1\.1 (?:400|403) /);
  }
  assert.equal((await send({ method: 'HEAD', path: '/missing.svg' })).body.length, 0);
});
