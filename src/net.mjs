/**
 * Read an upstream response without allowing an unexpectedly large body to
 * consume the generator's memory before the format-specific parser runs.
 */
export async function readBoundedResponseText(response, maxBytes, label = 'Upstream response') {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a non-negative safe integer.');
  if (!response?.body?.getReader) throw new Error(`${label} has no readable body.`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    try { await reader.cancel(); } catch { /* The source may already be closed. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
