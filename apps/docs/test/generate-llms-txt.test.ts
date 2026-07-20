import { describe, expect, test } from 'bun:test';

import { buildLlmsFullTxt } from '../scripts/llms/buildLlmsFullTxt';
import { buildLlmsTxt } from '../scripts/llms/buildLlmsTxt';
import type {
  LlmsDocsPage,
  LlmsPackageSection,
  LlmsSite,
} from '../scripts/llms/llmsTypes';
import { transformPackageDoc } from '../scripts/llms/transformPackageDoc';

const SITE: LlmsSite = {
  title: 'Cynco',
  summary: 'Ledger UI packages.',
  baseUrl: 'https://docs.example',
  githubUrl: 'https://github.com/example/cynco',
  installCommand: 'pnpm add @cynco/journals',
  notes: ['Amounts are integer minor units.'],
};

const DOCS_PAGES: readonly LlmsDocsPage[] = [
  {
    label: 'Journals docs',
    url: 'https://docs.example/docs/journals',
    description: 'journal entry rendering',
  },
];

function makeSection(
  overrides: Partial<LlmsPackageSection> = {}
): LlmsPackageSection {
  return {
    name: '@cynco/journals',
    version: '1.2.3',
    description: 'Journal rendering.',
    docsUrl: 'https://docs.example/docs/journals',
    body: 'Body prose.',
    ...overrides,
  };
}

const TRANSFORM_DEFAULTS = {
  headingShift: 1,
  dropTitle: true,
  stripSections: ['Development', 'Publishing'],
} as const;

describe('transformPackageDoc', () => {
  test('drops the H1 title and demotes remaining headings one level', () => {
    const result = transformPackageDoc(
      '# Title\n\nIntro.\n\n## Usage\n\n### Nested\n\nProse.',
      TRANSFORM_DEFAULTS
    );
    expect(result).not.toContain('# Title');
    expect(result).toContain('### Usage');
    expect(result).toContain('#### Nested');
    expect(result).toContain('Intro.');
  });

  test('caps heading demotion at markdown depth 6', () => {
    const result = transformPackageDoc('###### Deep', TRANSFORM_DEFAULTS);
    expect(result).toBe('###### Deep');
  });

  test('removes a stripped section through to the next H2', () => {
    const result = transformPackageDoc(
      [
        '# Title',
        '## Usage',
        'Keep me.',
        '## Development',
        'Internal setup.',
        '### Internal sub',
        'More internal.',
        '## Styling',
        'Keep me too.',
      ].join('\n'),
      TRANSFORM_DEFAULTS
    );
    expect(result).not.toContain('Development');
    expect(result).not.toContain('Internal');
    expect(result).toContain('Keep me.');
    expect(result).toContain('### Styling');
    expect(result).toContain('Keep me too.');
  });

  test('ignores markdown syntax inside fenced code blocks', () => {
    const result = transformPackageDoc(
      [
        '# Title',
        '## Usage',
        '```bash',
        '# a shell comment, not a heading',
        '## another comment',
        '```',
        'After.',
      ].join('\n'),
      TRANSFORM_DEFAULTS
    );
    expect(result).toContain('# a shell comment, not a heading');
    expect(result).toContain('## another comment');
    expect(result).toContain('After.');
  });

  test('rewrites repo-relative links to plain text, keeps external links', () => {
    const result = transformPackageDoc(
      'See [`@cynco/theme`](../theme) and [gate](ACCESSIBILITY.md), or ' +
        '[GitHub](https://github.com/example) and [anchor](#usage).',
      TRANSFORM_DEFAULTS
    );
    expect(result).toContain('See `@cynco/theme` and gate');
    expect(result).toContain('[GitHub](https://github.com/example)');
    expect(result).toContain('[anchor](#usage)');
    expect(result).not.toContain('../theme');
  });

  test('collapses blank-line runs left behind by stripping', () => {
    const result = transformPackageDoc(
      '# Title\n\n\n\nProse.\n\n## Development\n\nGone.\n',
      TRANSFORM_DEFAULTS
    );
    expect(result).toBe('Prose.');
  });
});

describe('buildLlmsTxt', () => {
  const output = buildLlmsTxt(SITE, [makeSection()], DOCS_PAGES);

  test('opens with the spec H1 + blockquote summary', () => {
    const lines = output.split('\n');
    expect(lines[0]).toBe('# Cynco');
    expect(lines[2]).toBe('> Ledger UI packages.');
  });

  test('lists install command and site notes', () => {
    expect(output).toContain('- Install: `pnpm add @cynco/journals`');
    expect(output).toContain('- Amounts are integer minor units.');
  });

  test('lists each package as an npm link with version and description', () => {
    expect(output).toContain(
      '- [@cynco/journals](https://www.npmjs.com/package/@cynco/journals): v1.2.3 — Journal rendering.'
    );
  });

  test('links the docs pages and the full documentation file', () => {
    expect(output).toContain(
      '- [Journals docs](https://docs.example/docs/journals): journal entry rendering'
    );
    expect(output).toContain('(https://docs.example/llms-full.txt)');
  });

  test('ends with exactly one trailing newline', () => {
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });
});

describe('buildLlmsFullTxt', () => {
  const sections = [
    makeSection(),
    makeSection({
      name: '@cynco/theme',
      version: '0.9.0',
      description: 'Palettes.',
      docsUrl: null,
      body: 'Theme prose.',
    }),
  ];
  const output = buildLlmsFullTxt(SITE, sections, '2026-07-20T00:00:00.000Z');

  test('carries the generated-at header', () => {
    expect(output).toContain('- Generated: 2026-07-20T00:00:00.000Z');
  });

  test('injects live versions into per-package section headings, in order', () => {
    const journals = output.indexOf('## @cynco/journals v1.2.3');
    const theme = output.indexOf('## @cynco/theme v0.9.0');
    expect(journals).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(journals);
  });

  test('delimits package sections with horizontal rules', () => {
    const delimiters = output.match(/^---$/gm);
    expect(delimiters).toHaveLength(sections.length);
  });

  test('includes the docs link only for packages with a dedicated page', () => {
    expect(output).toContain('- Docs: https://docs.example/docs/journals');
    const themeSection = output.slice(output.indexOf('## @cynco/theme'));
    expect(themeSection).not.toContain('- Docs:');
    expect(themeSection).toContain(
      '- npm: https://www.npmjs.com/package/@cynco/theme'
    );
  });

  test('embeds each package body', () => {
    expect(output).toContain('Body prose.');
    expect(output).toContain('Theme prose.');
  });
});
