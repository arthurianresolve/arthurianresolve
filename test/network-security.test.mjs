import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedResponseText } from '../src/net.mjs';
import { generate as generateStarship, MAX_CALENDAR_RESPONSE_BYTES } from '../scripts/generate-starship.mjs';
import { generateStats, MAX_STATS_RESPONSE_BYTES } from '../scripts/generate-stats.mjs';

function responseFromChunks(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }));
}

test('[NET-SEC-01] bounded response reading preserves UTF-8 across chunks and rejects over-limit bodies', async () => {
  const bytes = new TextEncoder().encode('A€B');
  assert.equal(await readBoundedResponseText(responseFromChunks([bytes.slice(0, 2), bytes.slice(2)]), bytes.byteLength, 'test response'), 'A€B');
  await assert.rejects(readBoundedResponseText(responseFromChunks([new Uint8Array([1, 2]), new Uint8Array([3])]), 2, 'test response'), /exceeds/);
});

test('[NET-SEC-02] both network generators reject oversized upstream responses before parsing', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('x'.repeat(MAX_CALENDAR_RESPONSE_BYTES + 1));
    await assert.rejects(generateStarship({ username: 'arthurianresolve' }), /GitHub calendar response exceeds/);
    globalThis.fetch = async () => new Response('x'.repeat(MAX_STATS_RESPONSE_BYTES + 1));
    await assert.rejects(generateStats({ username: 'arthurianresolve' }), /ghstats\.dev response exceeds/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
