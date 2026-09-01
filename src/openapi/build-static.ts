import { mkdir } from 'node:fs/promises';

import { buildOpenApiDocument } from './document';

/**
 * Writes the reference as two static files, for hosting somewhere that runs no
 * server. See docs/adr/0015.
 *
 * The document needs nothing from the outside world — no database, no Redis,
 * no environment — because it is derived from Zod schemas alone, and every
 * Prisma import in the schema modules is `import type` and so erased at
 * runtime. That is what makes GitHub Pages a viable host: the same bytes
 * `/openapi.json` serves, produced without booting the application.
 *
 * The page loads Scalar from the same unpinned CDN URL that
 * `@scalar/express-api-reference` defaults to, so the hosted reference and the
 * local one render through identical code rather than drifting apart at
 * whatever version each happened to pin.
 */

const CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';

const page = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${CDN}"></script>
    <script>
      Scalar.createApiReference('#app', { url: './openapi.json' })
    </script>
  </body>
</html>
`;

const outDir = process.argv[2] ?? 'dist/reference';

await mkdir(outDir, { recursive: true });

const document = buildOpenApiDocument();

await Bun.write(`${outDir}/openapi.json`, `${JSON.stringify(document, null, 2)}\n`);
await Bun.write(`${outDir}/index.html`, page('Kanso API reference'));

const operations = Object.values(document.paths ?? {}).reduce(
  (total, methods) => total + Object.keys(methods).length,
  0,
);

console.log(`${outDir}: ${operations} operations`);
