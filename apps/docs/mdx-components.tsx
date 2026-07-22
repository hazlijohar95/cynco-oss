import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { HeadingAnchor } from '@/components/docs/HeadingAnchor';

// Docs prose links: internal targets go through the client router; external
// targets open in a new tab. Both wear .inline-link — the classless-anchor
// styling in prose.css is reserved for body copy that opts out.
function DocsLink({ href = '', ...rest }: ComponentPropsWithoutRef<'a'>) {
  if (href.startsWith('/')) {
    return <Link href={href} className="inline-link" {...rest} />;
  }
  return (
    <a
      href={href}
      className="inline-link"
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    />
  );
}

// Section headings: identified h2/h3 (rehype-docs turns authored `{#id}`
// markers into ids) carry the hover-revealed copy-link affordance; headings
// without an id render bare. The anchor button is absolutely positioned
// (prose.css), so the mapping adds zero layout.
function makeDocsHeading(Tag: 'h2' | 'h3') {
  function DocsHeading({
    id,
    children,
    ...rest
  }: ComponentPropsWithoutRef<'h2'>) {
    return (
      <Tag id={id} {...rest}>
        {children}
        {id !== undefined && <HeadingAnchor id={id} />}
      </Tag>
    );
  }
  DocsHeading.displayName = `Docs${Tag.toUpperCase()}`;
  return DocsHeading;
}

const DocsH2 = makeDocsHeading('h2');
const DocsH3 = makeDocsHeading('h3');

// Prose tables sit in a horizontal-scroll container so a wide table scrolls
// inside its own box instead of stretching the page on narrow screens. The
// container is focusable (a keyboard needs some way to drive the scroll),
// and role+label keep that tab stop from being an unnamed mystery.
function DocsTable(props: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="table-scroll" role="region" aria-label="Table" tabIndex={0}>
      <table {...props} />
    </div>
  );
}

// Element map for the docs MDX sources. prose.css styles headings, tables,
// lists, and inline code through .docs-prose descendant selectors, so the
// markdown output needs no classes — only fenced code (Shiki + chrome),
// anchors, section headings, and tables get components.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    pre: CodeBlock,
    a: DocsLink,
    h2: DocsH2,
    h3: DocsH3,
    table: DocsTable,
    ...components,
  };
}
