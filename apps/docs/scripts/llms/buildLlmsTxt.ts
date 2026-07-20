import type { LlmsDocsPage, LlmsPackageSummary, LlmsSite } from './llmsTypes';

/**
 * Builds the /llms.txt index document per https://llmstxt.org: H1 title,
 * blockquote summary, then H2 sections of markdown link lists with one-line
 * descriptions. Pure assembly so tests can assert on the document shape.
 */
export function buildLlmsTxt(
  site: LlmsSite,
  packages: readonly LlmsPackageSummary[],
  docsPages: readonly LlmsDocsPage[]
): string {
  const lines: string[] = [
    `# ${site.title}`,
    '',
    `> ${site.summary}`,
    '',
    `- GitHub: ${site.githubUrl}`,
    `- Install: \`${site.installCommand}\``,
    ...site.notes.map((note) => `- ${note}`),
    '',
    '## Packages',
    '',
  ];

  for (const pkg of packages) {
    lines.push(
      `- [${pkg.name}](https://www.npmjs.com/package/${pkg.name}): v${pkg.version} — ${pkg.description}`
    );
  }

  lines.push('', '## Docs', '');
  for (const page of docsPages) {
    lines.push(`- [${page.label}](${page.url}): ${page.description}`);
  }

  lines.push(
    '',
    '## Optional',
    '',
    `- [Full documentation](${site.baseUrl}/llms-full.txt): complete docs for every package in one file, with published versions`,
    `- [GitHub repository](${site.githubUrl}): source code and issue tracker`
  );

  return lines.join('\n') + '\n';
}
