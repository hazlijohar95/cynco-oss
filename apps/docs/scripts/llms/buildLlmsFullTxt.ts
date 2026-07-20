import type { LlmsPackageSection, LlmsSite } from './llmsTypes';

/**
 * Builds the /llms-full.txt document: a generated-at header followed by one
 * `---`-delimited section per published package, each carrying its live
 * version, npm link, docs link, and transformed README body. Pure assembly so
 * tests can assert on version injection and section ordering.
 */
export function buildLlmsFullTxt(
  site: LlmsSite,
  packages: readonly LlmsPackageSection[],
  generatedAt: string
): string {
  const parts: string[] = [
    `# ${site.title} — full documentation`,
    '',
    `> ${site.summary}`,
    '',
    `- Generated: ${generatedAt}`,
    `- GitHub: ${site.githubUrl}`,
    `- Docs site: ${site.baseUrl}`,
    `- Index: ${site.baseUrl}/llms.txt`,
  ];

  for (const pkg of packages) {
    parts.push(
      '',
      '---',
      '',
      `## ${pkg.name} v${pkg.version}`,
      '',
      `> ${pkg.description}`,
      '',
      `- npm: https://www.npmjs.com/package/${pkg.name}`
    );
    if (pkg.docsUrl !== null) {
      parts.push(`- Docs: ${pkg.docsUrl}`);
    }
    parts.push('', pkg.body);
  }

  return parts.join('\n') + '\n';
}
