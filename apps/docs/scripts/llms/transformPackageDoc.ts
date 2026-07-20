export interface TransformPackageDocOptions {
  /** Levels to demote every heading by (1 turns `##` into `###`). */
  headingShift: number;
  /** Drop the document's own H1 title (the assembled section heading replaces it). */
  dropTitle: boolean;
  /** H2 section titles whose sections are repo-internal and removed whole. */
  stripSections: readonly string[];
}

const EXTERNAL_LINK_TARGET = /^(https?:\/\/|#|mailto:)/;

// Replaces markdown links whose targets are repo-relative paths (`../theme`,
// `ACCESSIBILITY.md`) with their plain link text: those targets do not exist
// at the published llms-full.txt URL, and a broken link misleads the reading
// agent. External http(s), anchor, and mailto links pass through untouched.
function rewriteRelativeLinks(line: string): string {
  return line.replace(
    /!?\[([^\]]*)\]\(([^()\s]+)\)/g,
    (match, text: string, target: string) =>
      EXTERNAL_LINK_TARGET.test(target) ? match : text
  );
}

// Prefixes a heading line with `shift` extra hashes, capped at markdown's
// maximum depth of 6 so deep READMEs never produce invalid headings.
function shiftHeading(level: number, title: string, shift: number): string {
  return `${'#'.repeat(Math.min(6, level + shift))} ${title}`;
}

/**
 * Transforms a package README (or companion doc) for inclusion in
 * llms-full.txt: strips repo-internal H2 sections (contributor workflow,
 * publishing), optionally drops the H1 title, demotes the remaining headings
 * under the assembled per-package section heading, and rewrites repo-relative
 * links to plain text. Fenced code blocks are never treated as markdown, so
 * `#` comment lines and example links inside snippets survive verbatim.
 */
export function transformPackageDoc(
  markdown: string,
  options: TransformPackageDocOptions
): string {
  const stripTitles = new Set(options.stripSections);
  const output: string[] = [];
  let inFence = false;
  let skippingSection = false;
  let titleDropped = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      if (!skippingSection) output.push(line);
      continue;
    }
    if (inFence) {
      if (!skippingSection) output.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length;
      const title = heading[2].trim();
      // A stripped section runs until the next heading at H2 or above.
      if (skippingSection && level <= 2) skippingSection = false;
      if (skippingSection) continue;
      if (level === 2 && stripTitles.has(title)) {
        skippingSection = true;
        continue;
      }
      if (level === 1 && options.dropTitle && !titleDropped) {
        titleDropped = true;
        continue;
      }
      output.push(shiftHeading(level, title, options.headingShift));
      continue;
    }

    if (!skippingSection) output.push(rewriteRelativeLinks(line));
  }

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
