import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';

import { CodeBlock } from '@/components/docs/CodeBlock';

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

// Element map for the docs MDX sources. prose.css styles headings, tables,
// lists, and inline code through .docs-prose descendant selectors, so the
// markdown output needs no classes — only fenced code (Shiki + chrome) and
// anchors get components.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    pre: CodeBlock,
    a: DocsLink,
    ...components,
  };
}
