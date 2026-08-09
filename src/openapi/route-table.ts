import type { Express } from 'express';

/**
 * The routes an Express app actually serves, as `METHOD /full/path`.
 *
 * Test-only, and the one place in the codebase that reads Express internals.
 * There is no public API for "list your routes": `app.router.stack` holds the
 * layers, but a layer records its path relative to where its router was
 * mounted, so `/tasks/:id` gives no hint that it lives under `/api/v1`.
 *
 * Mount prefixes are recovered from the layers themselves. A router layer's
 * matcher returns the prefix it matched for any path beneath it, so feeding it
 * a path that is known to route — one the OpenAPI document already
 * describes — reveals the prefix without that prefix being written down twice.
 * A router none of the known paths reach cannot be resolved, and is reported
 * rather than silently skipped: that is exactly the case of a whole module
 * added and never documented.
 *
 * The cost of reading internals is that an Express upgrade can change the
 * shape. It fails loudly here rather than quietly returning fewer routes,
 * because an empty or partial table would make the coverage test pass while
 * checking nothing. See docs/adr/0015.
 */

interface Matcher {
  (path: string): { path: string } | false;
}

interface Layer {
  name: string;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  matchers?: Matcher[];
  /** True when the router was mounted at the root with no path of its own. */
  slash?: boolean;
}

/**
 * Express writes `:id` where OpenAPI writes `{id}`, and a router's own root is
 * `'/'`, which appends a trailing slash to the mount it sits under. Both are
 * spelling, not routing: `/api/v1/tasks/` and `/api/v1/tasks` are the same
 * endpoint, and only the second is what the document calls it.
 */
const toOpenApiPath = (path: string) => path.replace(/:([^/]+)/g, '{$1}').replace(/(.)\/$/, '$1');

const routeEntries = (layer: Layer, prefix: string): string[] => {
  const path = `${prefix}${layer.route?.path ?? ''}`;

  return Object.keys(layer.route?.methods ?? {})
    .filter((method) => method !== '_all')
    .map((method) => `${method.toUpperCase()} ${toOpenApiPath(path) || '/'}`);
};

/**
 * The prefix a mounted router sits at, discovered by asking its own matcher
 * about paths already known to exist. Returns null when no known path reaches
 * it, which means the router is entirely undocumented.
 */
const resolvePrefix = (layer: Layer, prefix: string, knownPaths: string[]): string | null => {
  // A router mounted at the root adds nothing to the path. Its matcher reports
  // this with `slash` rather than by matching every input, so asking it about
  // a known path would wrongly say the router is unreachable.
  if (layer.slash) return '';

  for (const known of knownPaths) {
    if (!known.startsWith(prefix)) continue;

    const matched = layer.matchers?.[0]?.(known.slice(prefix.length) || '/');
    if (matched) return matched.path;
  }

  return null;
};

const walk = (stack: Layer[], prefix: string, knownPaths: string[], unresolved: string[]) =>
  stack.flatMap((layer): string[] => {
    if (layer.route) return routeEntries(layer, prefix);

    const nested = layer.handle?.stack;
    if (!nested?.length) return [];

    const mount = resolvePrefix(layer, prefix, knownPaths);
    if (mount === null) {
      // A mounted router that no known path reaches. Recorded rather than
      // skipped, so an undocumented module fails loudly.
      unresolved.push(`${prefix}<unresolved router with ${String(nested.length)} layers>`);
      return [];
    }

    return walk(nested, `${prefix}${mount}`, knownPaths, unresolved);
  });

export interface RouteTable {
  routes: string[];
  unresolved: string[];
}

/**
 * `knownPaths` seeds the prefix discovery: any set of paths the app is known
 * to serve, normally the paths of the OpenAPI document being checked.
 */
export const routeTable = (app: Express, knownPaths: string[]): RouteTable => {
  const stack = (app as unknown as { router?: { stack?: Layer[] } }).router?.stack;

  if (!stack?.length) {
    throw new Error(
      'Could not read the Express route table. The internal layer shape has changed — fix src/openapi/route-table.ts rather than deleting the coverage test.',
    );
  }

  const unresolved: string[] = [];
  const routes = walk(stack, '', knownPaths, unresolved);

  return { routes, unresolved };
};
