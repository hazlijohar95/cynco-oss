import { describe, expect, test } from 'bun:test';

import { extractMdxDoc } from '../scripts/llms/extractMdxDoc';

describe('extractMdxDoc', () => {
  test('drops import lines and keeps prose', () => {
    const result = extractMdxDoc(
      [
        "import { Demo } from '@/examples/Demo';",
        '',
        '# Title',
        '',
        'Prose stays.',
      ].join('\n')
    );
    expect(result).not.toContain('import');
    expect(result).toContain('# Title');
    expect(result).toContain('Prose stays.');
  });

  test('drops a multi-line JSX block through to the next blank line', () => {
    const result = extractMdxDoc(
      [
        'Before.',
        '',
        '<div className="demo-container">',
        '  <Demo entry={PAYROLL_ENTRY} />',
        '</div>',
        '',
        'After.',
      ].join('\n')
    );
    expect(result).not.toContain('demo-container');
    expect(result).not.toContain('PAYROLL_ENTRY');
    expect(result).toContain('Before.');
    expect(result).toContain('After.');
  });

  test('keeps fences inside a CodeTabs wrapper, drops the wrapper tags', () => {
    const result = extractMdxDoc(
      [
        "<CodeTabs labels={['Vanilla', 'SSR']}>",
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
        '```tsx',
        'const y = <Demo />;',
        '```',
        '',
        '</CodeTabs>',
        '',
        'After.',
      ].join('\n')
    );
    expect(result).not.toContain('CodeTabs');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('const y = <Demo />;');
    expect(result).toContain('After.');
  });

  test('strips escaped heading id markers from heading lines only', () => {
    const result = extractMdxDoc(
      [
        '## Installation \\{#installation\\}',
        '',
        'Install with `\\{#x\\}`?',
      ].join('\n')
    );
    expect(result).toContain('## Installation');
    expect(result).not.toContain('{#installation}');
    // Non-heading lines are left alone.
    expect(result).toContain('Install with `\\{#x\\}`?');
  });

  test('never treats fence contents as JSX, imports, or headings', () => {
    const result = extractMdxDoc(
      [
        '```ts',
        "import { Register } from '@cynco/journals';",
        '<journals-container>',
        '# not a heading',
        '```',
      ].join('\n')
    );
    expect(result).toContain("import { Register } from '@cynco/journals';");
    expect(result).toContain('<journals-container>');
    expect(result).toContain('# not a heading');
  });

  test('keeps GFM tables with inline HTML cells', () => {
    const result = extractMdxDoc(
      [
        '| Key | Action |',
        '| --- | ------ |',
        '| <kbd>↓</kbd> | Move focus. |',
      ].join('\n')
    );
    expect(result).toContain('| <kbd>↓</kbd> | Move focus. |');
  });

  test('collapses the blank-line runs stripping leaves behind', () => {
    const result = extractMdxDoc(
      ["import { A } from 'a';", '', '<A />', '', '', 'Prose.'].join('\n')
    );
    expect(result).toBe('Prose.');
  });
});
