/**
 * Lowers a docs MDX source (app/docs/[*]/content.mdx) to plain markdown for
 * llms-full.txt, so the docs site and the llms documents share one source.
 *
 * MDX-specific constructs are removed by line-level rules that lean on how
 * the docs sources are authored (single-line imports; JSX blocks separated
 * from prose by blank lines with no blank lines inside):
 *
 * - import lines are dropped;
 * - JSX blocks (a line opening with `<`) are dropped through to the next
 *   blank line — this removes demo components and the CodeTabs wrappers
 *   while keeping the fenced code inside a tabs block;
 * - heading id markers (`\{#id\}`, escaped braces because bare `{…}` is an
 *   MDX expression) are stripped from heading lines;
 * - fenced code passes through verbatim, so `<` and `#` inside samples are
 *   never mistaken for JSX or headings.
 *
 * Inline JSX that reads as HTML in markdown (`<kbd>`, `<sup>`) is left in
 * place — markdown consumers render or tolerate it.
 */

const HEADING_LINE = /^#{1,6}\s/;
const ID_MARKER = /\s*\\\{#[\w-]+\\\}\s*$/;

export function extractMdxDoc(mdx: string): string {
  const output: string[] = [];
  let inFence = false;
  let skippingJsx = false;

  for (const line of mdx.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }

    if (skippingJsx) {
      if (line.trim() === '') skippingJsx = false;
      continue;
    }
    if (/^import\s/.test(line)) continue;
    if (/^\s*</.test(line)) {
      skippingJsx = true;
      continue;
    }

    if (HEADING_LINE.test(line)) {
      output.push(line.replace(ID_MARKER, ''));
      continue;
    }

    output.push(line);
  }

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
