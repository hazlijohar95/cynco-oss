// Module shape of the docs MDX sources: the compiled body plus the
// build-time table of contents injected by lib/mdx/rehype-docs.mjs.
declare module '*.mdx' {
  import type { ComponentType } from 'react';

  import type { DocsTocEntry } from '@/lib/docs-toc';

  const MDXContent: ComponentType<Record<string, unknown>>;
  export default MDXContent;
  export const tableOfContents: readonly DocsTocEntry[];
}
