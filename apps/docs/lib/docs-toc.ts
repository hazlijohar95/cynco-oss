/**
 * One sidebar TOC entry, generated at build time by lib/mdx/rehype-docs.mjs
 * and exported from each docs MDX module as `tableOfContents`. h3 headings
 * nest under their preceding h2 via `children`.
 */
export interface DocsTocEntry {
  id: string;
  text: string;
  children: readonly DocsTocEntry[];
}
