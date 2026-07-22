'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { cleanPagefindUrl, loadPagefind } from '@/lib/search';
import { cn } from '@/lib/utils';

/** One keyboard-selectable row: a section-level hit inside a page group. */
interface SearchHit {
  /** Route plus fragment, already cleaned of export artifacts. */
  url: string;
  /** Nearest heading above the match (the page title for whole-page hits). */
  title: string;
  /** Pagefind excerpt: escaped text with `<mark>` around matched terms. */
  excerpt: string;
}

/** Hits grouped under the page they came from. */
interface SearchGroup {
  pageTitle: string;
  pageUrl: string;
  hits: SearchHit[];
}

// 'unknown' until the runtime module resolves one way or the other;
// 'unavailable' means no index is being served (next dev / next start).
type IndexStatus = 'unknown' | 'ready' | 'unavailable';

const PAGE_LIMIT = 8;
const HITS_PER_PAGE = 4;

/** The five named HTML entities Pagefind's excerpt escaping can emit. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Excerpts are parsed into text + <mark> segments instead of being handed
// to innerHTML — nothing from the index is ever interpreted as markup.
// Index keys are stable here: the split of one excerpt string is static.
function renderExcerpt(excerpt: string): ReactNode {
  return excerpt
    .split(/<\/?mark>/)
    .map((part, index) =>
      index % 2 === 1 ? (
        <mark key={index}>{decodeEntities(part)}</mark>
      ) : (
        <Fragment key={index}>{decodeEntities(part)}</Fragment>
      )
    );
}

export interface DocsSearchDialogProps {
  open: boolean;
  onClose: () => void;
}

// Full-text docs search over the Pagefind index baked into the static
// export. Combobox keyboard model: focus stays on the input, arrows move
// aria-activedescendant through the flattened hit list, Enter follows the
// selected hit, Escape closes. Focus is trapped by construction (the input
// is the dialog's only tabbable control; Tab is swallowed) and returns to
// whichever element invoked the dialog. In dev there is no index, so the
// dialog states that search ships with the built site instead of erroring.
export function DocsSearchDialog({ open, onClose }: DocsSearchDialogProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<IndexStatus>('unknown');

  const flatHits = groups.flatMap((group) => group.hits);

  // Open: remember the invoker, focus the input, park page scroll, and warm
  // the index so the first keystroke isn't also paying the module fetch.
  // Close: undo all of it, focus included.
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    document.body.classList.add('overflow-hidden');
    void loadPagefind().then((pagefind) => {
      setStatus(pagefind === null ? 'unavailable' : 'ready');
    });
    return () => {
      document.body.classList.remove('overflow-hidden');
      previousFocusRef.current?.focus();
    };
  }, [open]);

  // Keep the keyboard selection visible while arrowing through results.
  useEffect(() => {
    document
      .getElementById(`docs-search-hit-${selected}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const runSearch = useCallback(async (term: string) => {
    const pagefind = await loadPagefind();
    if (pagefind === null) {
      setStatus('unavailable');
      return;
    }
    if (term.trim() === '') {
      setGroups([]);
      setSelected(0);
      return;
    }
    // Pagefind debounces internally and resolves null for calls a newer
    // keystroke superseded — those drop here without touching state.
    const response = await pagefind.debouncedSearch(term, {}, 120);
    if (response === null) return;
    const documents = await Promise.all(
      response.results.slice(0, PAGE_LIMIT).map((result) => result.data())
    );
    setGroups(
      documents.map((doc) => ({
        pageTitle: doc.meta.title ?? cleanPagefindUrl(doc.url),
        pageUrl: cleanPagefindUrl(doc.url),
        hits: doc.sub_results.slice(0, HITS_PER_PAGE).map((sub) => ({
          url: cleanPagefindUrl(sub.url),
          title: sub.title,
          excerpt: sub.excerpt,
        })),
      }))
    );
    setSelected(0);
  }, []);

  const goTo = useCallback(
    (url: string) => {
      onClose();
      router.push(url);
    },
    [onClose, router]
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        onClose();
        return;
      case 'ArrowDown':
        event.preventDefault();
        setSelected((index) => Math.min(index + 1, flatHits.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setSelected((index) => Math.max(index - 1, 0));
        return;
      case 'Enter': {
        event.preventDefault();
        const hit = flatHits[selected];
        if (hit !== undefined) goTo(hit.url);
        return;
      }
      case 'Tab':
        // The input is the only tabbable control; swallowing Tab is the
        // whole focus trap.
        event.preventDefault();
        return;
      default:
    }
  };

  if (!open) return null;

  const showEmpty =
    status === 'ready' && query.trim() !== '' && flatHits.length === 0;

  // Running index across groups so aria-activedescendant addresses one
  // flat list while the markup stays grouped by page.
  let hitIndex = -1;

  return (
    <div className="fixed inset-0 z-[80]">
      <div
        aria-hidden="true"
        className="bg-background/50 fixed inset-0 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        className="border-border-opaque bg-background relative mx-auto mt-[10dvh] flex max-h-[70dvh] w-[min(36rem,calc(100vw-2.5rem))] flex-col rounded-xl border bg-clip-padding font-mono shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        <div className="border-border flex items-center gap-2.5 border-b px-4">
          <Search size={14} aria-hidden="true" className="text-text-weak" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={flatHits.length > 0}
            aria-controls="docs-search-results"
            aria-activedescendant={
              flatHits.length > 0 ? `docs-search-hit-${selected}` : undefined
            }
            aria-autocomplete="list"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search the docs…"
            value={query}
            className="placeholder:text-text-weak h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
            onChange={(event) => {
              setQuery(event.target.value);
              void runSearch(event.target.value);
            }}
          />
          <kbd className="border-border text-text-weak rounded-sm border px-1.5 py-0.5 text-[10px]">
            esc
          </kbd>
        </div>

        <div
          id="docs-search-results"
          role="listbox"
          aria-label="Search results"
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {status === 'unavailable' && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              Search runs on the built site — the index is generated from the
              static export, so <code>next dev</code> has nothing to query.
            </p>
          )}
          {status !== 'unavailable' && query.trim() === '' && (
            <p className="text-text-weak px-3 py-6 text-center text-sm">
              Type to search the documentation.
            </p>
          )}
          {showEmpty && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              No matches for “{query.trim()}”.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.pageUrl}>
              <div className="text-text-weak px-3 pt-3 pb-1 text-[11px] tracking-wide uppercase">
                {group.pageTitle}
              </div>
              {group.hits.map((hit) => {
                hitIndex += 1;
                const index = hitIndex;
                return (
                  <a
                    key={`${hit.url}-${index}`}
                    id={`docs-search-hit-${index}`}
                    role="option"
                    aria-selected={index === selected}
                    href={hit.url}
                    tabIndex={-1}
                    className={cn(
                      'block rounded-md px-3 py-2',
                      index === selected && 'bg-muted'
                    )}
                    onClick={(event) => {
                      event.preventDefault();
                      goTo(hit.url);
                    }}
                    onMouseMove={() => setSelected(index)}
                  >
                    <span className="text-foreground block text-sm">
                      {hit.title}
                    </span>
                    <span className="text-muted-foreground [&_mark]:text-foreground block truncate text-xs [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:underline [&_mark]:decoration-1 [&_mark]:underline-offset-2">
                      {renderExcerpt(hit.excerpt)}
                    </span>
                  </a>
                );
              })}
            </div>
          ))}
        </div>

        <div className="border-border text-text-weak flex items-center gap-3 border-t px-4 py-2 text-[11px]">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
