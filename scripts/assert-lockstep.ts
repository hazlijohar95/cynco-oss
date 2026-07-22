import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lockstep guard for the mirrors that CANNOT be imports: CSS px/ms values
// that JS constants must mirror by hand. Virtualized spacer math reads the
// JS constant while layout reads the stylesheet — drift desyncs scroll
// geometry from real layout (journals) or animation timing from DOM commits
// (the verdict duration). A stylesheet cannot import a TypeScript constant,
// so these pairs are compared as text probes anchored on stable selectors.
//
// The type/table mirrors this guard once checked (entry shapes, the currency
// exponent table, amount-format presets) no longer exist: every package now
// imports them from @cynco/ledger-core, the suite's one canonical
// definition, so there is nothing left to drift.

const JOURNALS_CONSTANTS = 'packages/journals/src/constants.ts';
const ACCOUNTS_CONSTANTS = 'packages/accounts/src/constants.ts';

export interface LockstepViolation {
  entry: string;
  message: string;
}

/** Strips block and line comments so doc wording can differ per file. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

export type SourceReader = (file: string) => string;

// ---------------------------------------------------------------------------
// CSS ↔ constants mirrors
// ---------------------------------------------------------------------------

/** A regex (source string) whose first capture group is a number. */
export interface NumberProbe {
  file: string;
  pattern: string;
}

/**
 * A JS constant whose numeric value must equal a number embedded in a CSS
 * declaration. `subtract` handles the journals header shape where the CSS
 * says `calc(1lh + 24px)` and the constant stores the TOTAL height
 * (DEFAULT_HEADER_HEIGHT = DEFAULT_LINE_HEIGHT + 24): expected css number =
 * constant − subtract. The css `anchor` is a literal substring (a selector
 * or property name) located first; `pattern` then matches after it, so the
 * guard reads the declaration it means to and not a lookalike elsewhere.
 */
export interface CssNumberMirror {
  name: string;
  constant: NumberProbe;
  subtract?: NumberProbe;
  css: { file: string; anchor: string; pattern: string };
}

const JOURNALS_CSS = 'packages/journals/src/style.css';
const ACCOUNTS_CSS = 'packages/accounts/src/style.css';

/**
 * The CSS px/ms values that JS constants mirror by hand. These are the
 * lockstep comment sites that CAN be checked robustly: each has a stable
 * selector/property anchor and a single unambiguous number. Virtualized
 * spacer math reads the JS constant while layout reads the CSS — drift here
 * desyncs scroll geometry from real layout (journals) or animation timing
 * from DOM commits (the verdict duration).
 */
export const CSS_NUMBER_REGISTRY: readonly CssNumberMirror[] = [
  {
    name: 'journals-register-header-extra-px',
    constant: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const DEFAULT_HEADER_HEIGHT = (\\d+)',
    },
    subtract: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const DEFAULT_LINE_HEIGHT = (\\d+)',
    },
    css: {
      file: JOURNALS_CSS,
      anchor: '[data-register-header] {',
      pattern: 'min-height:\\s*calc\\(1lh \\+ (\\d+)px\\)',
    },
  },
  {
    name: 'journals-reconciliation-header-extra-px',
    constant: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const DEFAULT_HEADER_HEIGHT = (\\d+)',
    },
    subtract: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const DEFAULT_LINE_HEIGHT = (\\d+)',
    },
    css: {
      file: JOURNALS_CSS,
      anchor: '[data-reconciliation-header] {',
      pattern: 'min-height:\\s*calc\\(1lh \\+ (\\d+)px\\)',
    },
  },
  {
    name: 'journals-group-row-extra-px',
    constant: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const GROUP_HEADER_EXTRA_HEIGHT = (\\d+)',
    },
    css: {
      file: JOURNALS_CSS,
      anchor: '[data-group-row] {',
      pattern:
        'height:\\s*calc\\(var\\(--journals-line-height, \\d+px\\) \\+ (\\d+)px\\)',
    },
  },
  {
    name: 'journals-register-empty-extra-px',
    constant: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const REGISTER_EMPTY_EXTRA_HEIGHT = (\\d+)',
    },
    css: {
      file: JOURNALS_CSS,
      anchor: '[data-register-empty] {',
      pattern:
        'height:\\s*calc\\(var\\(--journals-line-height, \\d+px\\) \\+ (\\d+)px\\)',
    },
  },
  {
    name: 'journals-verdict-leave-ms',
    constant: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const RECON_VERDICT_LEAVE_MS = (\\d+)',
    },
    css: {
      file: JOURNALS_CSS,
      anchor: '--journals-verdict-duration:',
      pattern: '--journals-verdict-duration:\\s*(\\d+)ms',
    },
  },
  {
    name: 'accounts-row-height-base-px',
    constant: {
      file: ACCOUNTS_CONSTANTS,
      pattern: 'DENSITY_ROW_HEIGHTS[^=]*=\\s*\\{[^}]*default:\\s*(\\d+)',
    },
    css: {
      file: ACCOUNTS_CSS,
      anchor: '--accounts-row-height: var(',
      pattern: 'calc\\((\\d+)px \\* var\\(--accounts-density-scale\\)\\)',
    },
  },
  {
    name: 'accounts-compact-density-scale',
    constant: {
      file: ACCOUNTS_CONSTANTS,
      pattern: 'DENSITY_SCALE_FACTORS[^=]*=\\s*\\{[^}]*compact:\\s*([\\d.]+)',
    },
    css: {
      file: ACCOUNTS_CSS,
      anchor: "[data-scroller][data-density='compact'] {",
      pattern:
        '--accounts-density-scale: var\\(--accounts-density-scale-override, ([\\d.]+)\\)',
    },
  },
  {
    name: 'accounts-relaxed-density-scale',
    constant: {
      file: ACCOUNTS_CONSTANTS,
      pattern: 'DENSITY_SCALE_FACTORS[^=]*=\\s*\\{[^}]*relaxed:\\s*([\\d.]+)',
    },
    css: {
      file: ACCOUNTS_CSS,
      anchor: "[data-scroller][data-density='relaxed'] {",
      pattern:
        '--accounts-density-scale: var\\(--accounts-density-scale-override, ([\\d.]+)\\)',
    },
  },
];

/**
 * A CSS custom property whose *fallback* value must equal a JS constant at
 * every use site: `var(--journals-line-height, 20px)` appears many times in
 * journals' stylesheet, and the JS row math reads DEFAULT_LINE_HEIGHT — one
 * stale fallback desyncs that use site's layout from the spacer math.
 */
export interface CssFallbackMirror {
  name: string;
  constant: NumberProbe;
  css: { file: string; varName: string; unit: string };
}

export const CSS_FALLBACK_REGISTRY: readonly CssFallbackMirror[] = [
  {
    name: 'journals-line-height-fallbacks',
    constant: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const DEFAULT_LINE_HEIGHT = (\\d+)',
    },
    css: { file: JOURNALS_CSS, varName: '--journals-line-height', unit: 'px' },
  },
  {
    name: 'journals-font-size-fallbacks',
    constant: {
      file: JOURNALS_CONSTANTS,
      pattern: 'export const DEFAULT_FONT_SIZE = (\\d+)',
    },
    css: { file: JOURNALS_CSS, varName: '--journals-font-size', unit: 'px' },
  },
];

/** First capture group of a probe as a number; null when the probe misses. */
export function probeNumber(source: string, pattern: string): number | null {
  const match = new RegExp(pattern).exec(source);
  if (match?.[1] == null) {
    return null;
  }
  return Number(match[1]);
}

/** Checks one CSS number mirror. Anchors and probes that miss are failures. */
export function checkCssNumberMirror(
  mirror: CssNumberMirror,
  read: SourceReader
): LockstepViolation[] {
  const fail = (message: string): LockstepViolation[] => [
    { entry: mirror.name, message },
  ];

  // Comments are stripped from the TS side so a probe can never latch onto a
  // number quoted in prose (the constants files repeat values in doc text).
  const constantValue = probeNumber(
    stripComments(read(mirror.constant.file)),
    mirror.constant.pattern
  );
  if (constantValue == null) {
    return fail(
      `constant probe /${mirror.constant.pattern}/ found nothing in ` +
        `${mirror.constant.file} — the constant moved or was renamed; update the registry.`
    );
  }
  let expected = constantValue;
  if (mirror.subtract != null) {
    const subtractValue = probeNumber(
      stripComments(read(mirror.subtract.file)),
      mirror.subtract.pattern
    );
    if (subtractValue == null) {
      return fail(
        `subtract probe /${mirror.subtract.pattern}/ found nothing in ` +
          `${mirror.subtract.file} — update the registry.`
      );
    }
    expected = constantValue - subtractValue;
  }

  const css = read(mirror.css.file);
  const anchorIndex = css.indexOf(mirror.css.anchor);
  if (anchorIndex === -1) {
    return fail(
      `CSS anchor \`${mirror.css.anchor}\` not found in ${mirror.css.file} — ` +
        `the selector moved or was renamed; update the registry.`
    );
  }
  const cssValue = probeNumber(css.slice(anchorIndex), mirror.css.pattern);
  if (cssValue == null) {
    return fail(
      `CSS probe /${mirror.css.pattern}/ found nothing after anchor ` +
        `\`${mirror.css.anchor}\` in ${mirror.css.file} — update the registry.`
    );
  }

  if (cssValue !== expected) {
    return fail(
      `${mirror.css.file} (after \`${mirror.css.anchor}\`) says ${cssValue} but ` +
        `${mirror.constant.file} declares ${expected}` +
        (mirror.subtract == null ? '' : ` (= ${constantValue} − line height)`) +
        ` — JS math and the stylesheet disagree; change both together.`
    );
  }
  return [];
}

/** Checks every fallback of `var(--name, <n><unit>)` against the constant. */
export function checkCssFallbackMirror(
  mirror: CssFallbackMirror,
  read: SourceReader
): LockstepViolation[] {
  const violations: LockstepViolation[] = [];
  const expected = probeNumber(
    stripComments(read(mirror.constant.file)),
    mirror.constant.pattern
  );
  if (expected == null) {
    return [
      {
        entry: mirror.name,
        message:
          `constant probe /${mirror.constant.pattern}/ found nothing in ` +
          `${mirror.constant.file} — update the registry.`,
      },
    ];
  }
  const css = read(mirror.css.file);
  const escapedVar = mirror.css.varName.replace(/[-]/g, '\\-');
  const pattern = new RegExp(
    `var\\(${escapedVar},\\s*([\\d.]+)${mirror.css.unit}\\)`,
    'g'
  );
  let matched = 0;
  for (const match of css.matchAll(pattern)) {
    matched += 1;
    const value = Number(match[1]);
    if (value !== expected) {
      violations.push({
        entry: mirror.name,
        message:
          `${mirror.css.file} has \`var(${mirror.css.varName}, ` +
          `${match[1]}${mirror.css.unit})\` but ${mirror.constant.file} ` +
          `declares ${expected} — every fallback must match the JS constant.`,
      });
    }
  }
  if (matched === 0) {
    violations.push({
      entry: mirror.name,
      message:
        `no \`var(${mirror.css.varName}, …${mirror.css.unit})\` fallback found in ` +
        `${mirror.css.file} — the variable was renamed; update the registry.`,
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Filesystem driver
// ---------------------------------------------------------------------------

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(scriptDir, '..');
  const cache = new Map<string, string>();
  const read: SourceReader = (file) => {
    let text = cache.get(file);
    if (text == null) {
      text = readFileSync(join(root, file), 'utf8');
      cache.set(file, text);
    }
    return text;
  };

  const violations: LockstepViolation[] = [];
  for (const mirror of CSS_NUMBER_REGISTRY) {
    violations.push(...checkCssNumberMirror(mirror, read));
  }
  for (const mirror of CSS_FALLBACK_REGISTRY) {
    violations.push(...checkCssFallbackMirror(mirror, read));
  }

  if (violations.length > 0) {
    console.error(
      'Lockstep violations (a declared mirror drifted from its source of truth):'
    );
    for (const v of violations) {
      console.error(`  [${v.entry}] ${v.message}`);
    }
    process.exit(1);
  }

  console.log(
    `Lockstep OK — ${CSS_NUMBER_REGISTRY.length} CSS number mirrors, ` +
      `${CSS_FALLBACK_REGISTRY.length} CSS fallback groups.`
  );
}

if (import.meta.main) {
  main();
}
