import {
  type ComponentPropsWithoutRef,
  isValidElement,
  type ReactNode,
} from 'react';
import { createCssVariablesTheme, createHighlighter } from 'shiki';

import { CopyButton } from './CopyButton';

// Every token color resolves through a --shiki-* custom property defined in
// prose.css with light-dark(), so highlighting follows the site's
// color-scheme pipeline exactly — no second theme pass, no flash on load.
const cssVariablesTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
});

/** The fence languages the docs actually use; anything else renders plain. */
const LANGS = ['typescript', 'tsx', 'bash', 'css'] as const;
const LANG_ALIASES = new Set<string>(['ts', ...LANGS]);

// One highlighter per build process (static export renders every page in
// the same worker), created lazily on the first fenced block.
let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    themes: [cssVariablesTheme],
    langs: [...LANGS],
  });
  return highlighterPromise;
}

/** `title="register.ts"` from a fence meta string, or null. */
function titleFromMeta(meta: string | undefined): string | null {
  if (meta === undefined) return null;
  const match = /(?:^|\s)title="([^"]+)"/.exec(meta);
  return match === null ? null : match[1];
}

interface FencedCode {
  code: string;
  lang: string;
  title: string | null;
}

// MDX hands the pre component its single <code> child carrying the fence's
// class (language-*), raw source text, and the meta string copied to
// data-meta by lib/mdx/rehype-docs.mjs.
function readFence(children: ReactNode): FencedCode | null {
  if (!isValidElement(children)) return null;
  const props = children.props as {
    className?: string;
    children?: unknown;
    'data-meta'?: string;
  };
  if (typeof props.children !== 'string') return null;
  const lang = /language-(\S+)/.exec(props.className ?? '')?.[1];
  if (lang === undefined || !LANG_ALIASES.has(lang)) return null;
  return {
    code: props.children.trimEnd(),
    lang,
    title: titleFromMeta(props['data-meta']),
  };
}

export type CodeBlockProps = ComponentPropsWithoutRef<'pre'>;

// Docs code block: Shiki-highlighted at build time (an async server
// component — the static export bakes the spans into the HTML), with a copy
// button and an optional filename bar from the fence meta. prose.css keeps
// the panel treatment (border, radius, tint) and the 13px/20px mono metrics
// on the rendered pre. Fences without a known language fall through to the
// original plain pre.
export async function CodeBlock({ children, ...rest }: CodeBlockProps) {
  const fence = readFence(children);
  if (fence === null) return <pre {...rest}>{children}</pre>;

  const highlighter = await getHighlighter();
  const html = highlighter.codeToHtml(fence.code, {
    lang: fence.lang,
    theme: 'css-variables',
  });

  return (
    <figure className="code-block" data-language={fence.lang}>
      {fence.title === null ? (
        <CopyButton text={fence.code} className="code-block-copy-floating" />
      ) : (
        <figcaption className="code-block-title">
          <span>{fence.title}</span>
          <CopyButton text={fence.code} />
        </figcaption>
      )}
      {/* Shiki output is trusted build-time HTML from our own sources. */}
      <div
        className="code-block-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </figure>
  );
}
