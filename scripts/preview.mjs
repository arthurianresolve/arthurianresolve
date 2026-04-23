import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPreview, createPreviewServer, PREVIEW_ORIGIN } from '../src/preview.mjs';

export { buildPreview, createPreviewServer } from '../src/preview.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildPreview();
  if (!process.argv.includes('--build')) {
    const server = createPreviewServer();
    server.listen(4173, '127.0.0.1', () => console.log(`Profile preview: ${PREVIEW_ORIGIN}`));
    server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  }
}
