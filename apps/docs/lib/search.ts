// Client-side access to the Pagefind search index. The docs build exports
// the site and then runs `pagefind --site out` (apps/docs/moon.yml), which
// writes the index and its runtime loader into out/pagefind/ — a sibling of
// the pages, addressable as /pagefind/pagefind.js. That module never exists
// inside the Next bundle, so it is imported at runtime only, and the types
// below hand-declare the slice of its API the search dialog calls.

/** One section-level hit inside a page: the nearest heading above the
 * match plus an excerpt with `<mark>` around the matched terms. */
export interface PagefindSubResult {
  title: string;
  url: string;
  excerpt: string;
}

/** One matching page, resolved lazily via PagefindResult.data(). */
export interface PagefindDocument {
  url: string;
  excerpt: string;
  meta: Record<string, string>;
  sub_results: PagefindSubResult[];
}

export interface PagefindResult {
  id: string;
  data: () => Promise<PagefindDocument>;
}

export interface PagefindSearchResponse {
  results: PagefindResult[];
}

export interface PagefindModule {
  options: (opts: Record<string, unknown>) => Promise<void>;
  init: () => Promise<void>;
  /** Debounced search: resolves null when a newer call supersedes this
   * one. */
  debouncedSearch: (
    term: string,
    searchOptions?: Record<string, unknown>,
    debounceTimeoutMs?: number
  ) => Promise<PagefindSearchResponse | null>;
}

let modulePromise: Promise<PagefindModule | null> | null = null;

/**
 * Loads and initializes the Pagefind runtime once per session. Resolves
 * null where no index is served — `next dev` and `next start` don't run the
 * export pipeline — so the search dialog can show its built-site notice
 * instead of surfacing a module error.
 */
export function loadPagefind(): Promise<PagefindModule | null> {
  modulePromise ??= (async () => {
    try {
      // The specifier is a runtime value (typed string, not a literal) so
      // TypeScript doesn't try to resolve a module that only exists in the
      // built export; the ignore comments do the same for the bundlers.
      const specifier: string = '/pagefind/pagefind.js';
      const pagefind = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ specifier
      )) as PagefindModule;
      await pagefind.options({ baseUrl: '/' });
      await pagefind.init();
      return pagefind;
    } catch {
      return null;
    }
  })();
  return modulePromise;
}

/**
 * Pagefind reports URLs as the exported files it indexed
 * (`/docs/journals.html#csv`, `/index.html`); strip the export artifacts so
 * links match the site's routes.
 */
export function cleanPagefindUrl(url: string): string {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  let path = hashIndex === -1 ? url : url.slice(0, hashIndex);
  path = path.replace(/\.html$/, '');
  if (path.endsWith('/index')) path = path.slice(0, -'/index'.length);
  if (path === '') path = '/';
  return `${path}${hash}`;
}
