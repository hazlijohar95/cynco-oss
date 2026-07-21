import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lockstep guard: the repo deliberately duplicates a handful of types and
// tables across packages (journals and importers carry a no-runtime-deps
// policy, so they hand-copy shapes instead of importing the private engine).
// Every duplicate site carries a "MUST mirror / lockstep" comment — but a
// comment is a hope, not a check, and a partial hand-copy of the currency
// exponent table once shipped: 5 exceptions instead of ~26, mis-scaling
// zero- and three-decimal currencies 100×/10× in production. This script is
// the mechanical version of all those comments: a central registry of every
// declared mirror, compared as normalized source text (the technique proven
// by packages/importers/test/lockstepParity.test.ts) so drift fails CI with
// both file names and the exact drifted member.
//
// Comparison is structural-normalized TEXT, never eval/import: the whole
// point of the duplication is that these packages do not load each other, so
// the guard must not either. Interfaces compare member lists (doc comments
// legitimately differ per package), aliases and tables compare normalized
// bodies, and CSS↔constants pairs compare a captured number against the
// declared JS constant behind a fixed selector anchor.

export type MirrorKind = 'interface' | 'type-alias' | 'const-table';

export interface SymbolRef {
  /** Repo-root-relative path. */
  file: string;
  symbol: string;
}

export interface MirrorEntry {
  /** Short id used in failure messages. */
  name: string;
  kind: MirrorKind;
  sourceOfTruth: SymbolRef;
  mirrors: readonly SymbolRef[];
}

const CORE_TYPES = 'packages/ledger-core/src/types.ts';
const CORE_CURRENCY = 'packages/ledger-core/src/currency.ts';
const JOURNALS_TYPES = 'packages/journals/src/types.ts';
const JOURNALS_CONSTANTS = 'packages/journals/src/constants.ts';
const ACCOUNTS_TYPES = 'packages/accounts/src/types.ts';
const ACCOUNTS_CONSTANTS = 'packages/accounts/src/constants.ts';
const STATEMENTS_TYPES = 'packages/statements/src/types.ts';
const STATEMENTS_CONSTANTS = 'packages/statements/src/constants.ts';
const IMPORTERS_TYPES = 'packages/importers/src/types.ts';
const IMPORTERS_CONSTANTS = 'packages/importers/src/constants.ts';

/**
 * The five amount-format presets duplicated across the three rendering
 * packages (journals is the source: the presets and their doc conventions
 * originated there). Registered individually so a failure names the exact
 * preset that drifted.
 */
const AMOUNT_FORMAT_PRESETS = [
  'AMOUNT_FORMAT_COMMA_DOT',
  'AMOUNT_FORMAT_DOT_COMMA',
  'AMOUNT_FORMAT_SPACE_COMMA',
  'AMOUNT_FORMAT_APOSTROPHE_DOT',
  'AMOUNT_FORMAT_INDIAN',
] as const;

/**
 * Every declared mirror in the workspace, from auditing the "MUST mirror /
 * lockstep / keep both in sync" comment sites (rg -i "lockstep|must mirror"
 * packages/). Notes on what is deliberately NOT here:
 *
 * - accounts' CURRENCY_DECIMALS: an alias of the engine's
 *   DEFAULT_CURRENCY_EXPONENTS (accounts inlines ledger-core at build), not
 *   a hand copy — nothing to drift. The alias itself is asserted below
 *   (assertAccountsAliasesEngineTable) so it cannot silently become a copy.
 * - statements' currency table: a re-export of the engine's, same reason.
 * - ledger-core's StatementLine: same NAME as journals' StatementLine but a
 *   DIFFERENT concept (financial-statement line vs bank-statement line), so
 *   journals — not the engine — is the source of truth for that mirror.
 * - formatMinorUnits helper implementations (journals/accounts/statements):
 *   deliberate behavioral duplicates whose source legitimately differs
 *   (imports, table aliasing), pinned instead by three mirrored test suites.
 * - ledger-core's matchesEntryFilter vs EntryStore's internal matcher: two
 *   deliberately different implementations of one behavior (the store's uses
 *   a precomputed lowercase corpus) — text comparison cannot express that.
 */
export const MIRROR_REGISTRY: readonly MirrorEntry[] = [
  // The table whose historical drift motivated this entire guard.
  {
    name: 'currency-exponent-table',
    kind: 'const-table',
    sourceOfTruth: {
      file: CORE_CURRENCY,
      symbol: 'DEFAULT_CURRENCY_EXPONENTS',
    },
    mirrors: [
      { file: JOURNALS_CONSTANTS, symbol: 'CURRENCY_DECIMALS' },
      { file: IMPORTERS_CONSTANTS, symbol: 'CURRENCY_DECIMALS' },
    ],
  },
  // The engine's canonical entry shapes, hand-copied by the two
  // no-runtime-deps domain packages. The engine header calls these "the
  // contract between the data engine, the register renderer, and the tree" —
  // entries flow between the packages as plain objects, so the copies must
  // be member-identical.
  {
    name: 'minor-units-alias',
    kind: 'type-alias',
    sourceOfTruth: { file: CORE_TYPES, symbol: 'MinorUnits' },
    mirrors: [
      { file: JOURNALS_TYPES, symbol: 'MinorUnits' },
      { file: IMPORTERS_TYPES, symbol: 'MinorUnits' },
    ],
  },
  {
    name: 'entry-flag-alias',
    kind: 'type-alias',
    sourceOfTruth: { file: CORE_TYPES, symbol: 'EntryFlag' },
    mirrors: [
      { file: JOURNALS_TYPES, symbol: 'EntryFlag' },
      { file: IMPORTERS_TYPES, symbol: 'EntryFlag' },
    ],
  },
  {
    name: 'posting-interface',
    kind: 'interface',
    sourceOfTruth: { file: CORE_TYPES, symbol: 'Posting' },
    mirrors: [
      { file: JOURNALS_TYPES, symbol: 'Posting' },
      { file: IMPORTERS_TYPES, symbol: 'Posting' },
    ],
  },
  {
    name: 'ledger-entry-interface',
    kind: 'interface',
    sourceOfTruth: { file: CORE_TYPES, symbol: 'LedgerEntry' },
    mirrors: [
      { file: JOURNALS_TYPES, symbol: 'LedgerEntry' },
      { file: IMPORTERS_TYPES, symbol: 'LedgerEntry' },
    ],
  },
  // Bank-statement line (reconciliation input). journals is the source; the
  // engine's identically-named StatementLine is a different concept (see the
  // registry notes above).
  {
    name: 'statement-line-interface',
    kind: 'interface',
    sourceOfTruth: { file: JOURNALS_TYPES, symbol: 'StatementLine' },
    mirrors: [{ file: IMPORTERS_TYPES, symbol: 'StatementLine' }],
  },
  // Locale-shaped amount presentation, duplicated across the three rendering
  // packages (importers has no renderer and no AmountFormat — its
  // CsvAmountFormat is an unrelated parsing descriptor).
  {
    name: 'amount-format-interface',
    kind: 'interface',
    sourceOfTruth: { file: JOURNALS_TYPES, symbol: 'AmountFormat' },
    mirrors: [
      { file: ACCOUNTS_TYPES, symbol: 'AmountFormat' },
      { file: STATEMENTS_TYPES, symbol: 'AmountFormat' },
    ],
  },
  ...AMOUNT_FORMAT_PRESETS.map(
    (symbol): MirrorEntry => ({
      name: `amount-format-preset-${symbol}`,
      kind: 'const-table',
      sourceOfTruth: { file: JOURNALS_CONSTANTS, symbol },
      mirrors: [
        { file: ACCOUNTS_CONSTANTS, symbol },
        { file: STATEMENTS_CONSTANTS, symbol },
      ],
    })
  ),
];

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

export interface LockstepViolation {
  entry: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Structural extraction (pure; the importers parity-test technique,
// generalized)
// ---------------------------------------------------------------------------

/** Strips block and line comments so doc wording can differ per package. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Member signatures of `export interface <name> { ... }`: comments stripped,
 * whitespace collapsed, one string per member. Brace-balanced so nested
 * object types survive. Returns null when the interface is absent — the
 * caller reports that as a violation (a renamed symbol must not pass).
 */
export function interfaceMembers(
  source: string,
  name: string
): string[] | null {
  const start = source.indexOf(`export interface ${name} {`);
  if (start === -1) {
    return null;
  }
  const bodyStart = source.indexOf('{', start) + 1;
  let depth = 1;
  let end = bodyStart;
  while (depth > 0 && end < source.length) {
    const char = source[end];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    end += 1;
  }
  return stripComments(source.slice(bodyStart, end - 1))
    .split(';')
    .map((member) => member.replace(/\s+/g, ' ').trim())
    .filter((member) => member !== '');
}

/** Normalized right-hand side of `export type <name> = ...;`, or null. */
export function typeAliasBody(source: string, name: string): string | null {
  const match = new RegExp(`export type ${name} =([^;]+);`).exec(source);
  if (match == null) {
    return null;
  }
  return stripComments(match[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The object-literal entries of `export const <name>[: type] = {...}` (an
 * optional `Object.freeze(` wrapper is unwrapped), parsed into a key →
 * normalized-value-text record. Semantic-ish comparison: insensitive to
 * comments, whitespace, and entry ORDER — reordering a table is not drift,
 * but a changed, added, or removed entry is.
 */
export function constTableEntries(
  source: string,
  name: string
): Record<string, string> | null {
  const declStart = source.indexOf(`export const ${name}`);
  if (declStart === -1) {
    return null;
  }
  const braceStart = source.indexOf('{', declStart);
  if (braceStart === -1) {
    return null;
  }
  // Brace-balance while tracking string literals: the preset tables contain
  // `group: ','` and `group: "'"`, whose quoted braces/commas/quotes must
  // never count as structure.
  let depth = 1;
  let end = braceStart + 1;
  let quote: string | null = null;
  while (depth > 0 && end < source.length) {
    const char = source[end];
    if (quote != null) {
      if (char === '\\') {
        end += 1; // skip the escaped character
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else {
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
    }
    end += 1;
  }
  const body = stripComments(source.slice(braceStart + 1, end - 1));

  // Split on top-level commas only: preset values like Object.freeze([3, 2])
  // carry commas inside brackets — and `group: ','` a comma inside a string —
  // that must not split entries.
  const parts: string[] = [];
  let partStart = 0;
  let nested = 0;
  quote = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote != null) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') nested += 1;
    if (char === '}' || char === ']' || char === ')') nested -= 1;
    if (char === ',' && nested === 0) {
      parts.push(body.slice(partStart, index));
      partStart = index + 1;
    }
  }
  parts.push(body.slice(partStart));

  const entries: Record<string, string> = {};
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon === -1) {
      continue; // trailing comma remnant / empty part
    }
    const key = part.slice(0, colon).replace(/['"\s]/g, '');
    const value = part
      .slice(colon + 1)
      .replace(/\s+/g, ' ')
      .trim();
    if (key !== '') {
      entries[key] = value;
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Comparison (pure over a file-text lookup)
// ---------------------------------------------------------------------------

export type SourceReader = (file: string) => string;

function describeRef(ref: SymbolRef): string {
  return `${ref.file} → ${ref.symbol}`;
}

/** Compares one registry entry's mirrors against its source of truth. */
export function checkMirrorEntry(
  entry: MirrorEntry,
  read: SourceReader
): LockstepViolation[] {
  const violations: LockstepViolation[] = [];
  const fail = (message: string): void => {
    violations.push({ entry: entry.name, message });
  };

  if (entry.kind === 'interface') {
    const truth = interfaceMembers(
      read(entry.sourceOfTruth.file),
      entry.sourceOfTruth.symbol
    );
    if (truth == null) {
      fail(`source of truth not found: ${describeRef(entry.sourceOfTruth)}`);
      return violations;
    }
    for (const mirror of entry.mirrors) {
      const members = interfaceMembers(read(mirror.file), mirror.symbol);
      if (members == null) {
        fail(`mirror not found: ${describeRef(mirror)}`);
        continue;
      }
      const truthSet = new Set(truth);
      const mirrorSet = new Set(members);
      for (const member of truth) {
        if (!mirrorSet.has(member)) {
          fail(
            `${describeRef(mirror)} is missing or changed member \`${member}\` ` +
              `declared by ${describeRef(entry.sourceOfTruth)} — update the copy.`
          );
        }
      }
      for (const member of members) {
        if (!truthSet.has(member)) {
          fail(
            `${describeRef(mirror)} declares member \`${member}\` that ` +
              `${describeRef(entry.sourceOfTruth)} does not — update the source ` +
              `of truth and every mirror together.`
          );
        }
      }
    }
    return violations;
  }

  if (entry.kind === 'type-alias') {
    const truth = typeAliasBody(
      read(entry.sourceOfTruth.file),
      entry.sourceOfTruth.symbol
    );
    if (truth == null) {
      fail(`source of truth not found: ${describeRef(entry.sourceOfTruth)}`);
      return violations;
    }
    for (const mirror of entry.mirrors) {
      const body = typeAliasBody(read(mirror.file), mirror.symbol);
      if (body == null) {
        fail(`mirror not found: ${describeRef(mirror)}`);
      } else if (body !== truth) {
        fail(
          `${describeRef(mirror)} is \`${body}\` but ` +
            `${describeRef(entry.sourceOfTruth)} is \`${truth}\`.`
        );
      }
    }
    return violations;
  }

  // const-table
  const truth = constTableEntries(
    read(entry.sourceOfTruth.file),
    entry.sourceOfTruth.symbol
  );
  if (truth == null) {
    fail(`source of truth not found: ${describeRef(entry.sourceOfTruth)}`);
    return violations;
  }
  for (const mirror of entry.mirrors) {
    const entries = constTableEntries(read(mirror.file), mirror.symbol);
    if (entries == null) {
      fail(`mirror not found: ${describeRef(mirror)}`);
      continue;
    }
    for (const [key, value] of Object.entries(truth)) {
      if (!(key in entries)) {
        fail(
          `${describeRef(mirror)} is missing entry \`${key}: ${value}\` from ` +
            `${describeRef(entry.sourceOfTruth)} — the partial-copy failure mode ` +
            `that once mis-scaled currencies 100×/10×.`
        );
      } else if (entries[key] !== value) {
        fail(
          `${describeRef(mirror)} has \`${key}: ${entries[key]}\` but ` +
            `${describeRef(entry.sourceOfTruth)} has \`${key}: ${value}\`.`
        );
      }
    }
    for (const key of Object.keys(entries)) {
      if (!(key in truth)) {
        fail(
          `${describeRef(mirror)} has extra entry \`${key}: ${entries[key]}\` ` +
            `absent from ${describeRef(entry.sourceOfTruth)}.`
        );
      }
    }
  }
  return violations;
}

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

/**
 * accounts' CURRENCY_DECIMALS must remain a plain alias of the engine table
 * (that is WHY it is excluded from the currency-table mirror set above). If
 * someone replaces the alias with a hand copy, it must either join the
 * registry or go back to aliasing.
 */
export function constAliasTarget(source: string, name: string): string | null {
  const match = new RegExp(
    `export const ${name}[^=]*=\\s*([A-Za-z_$][\\w$]*)\\s*;`
  ).exec(stripComments(source));
  return match?.[1] ?? null;
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
  for (const entry of MIRROR_REGISTRY) {
    violations.push(...checkMirrorEntry(entry, read));
  }
  for (const mirror of CSS_NUMBER_REGISTRY) {
    violations.push(...checkCssNumberMirror(mirror, read));
  }
  for (const mirror of CSS_FALLBACK_REGISTRY) {
    violations.push(...checkCssFallbackMirror(mirror, read));
  }

  const accountsAlias = constAliasTarget(
    read(ACCOUNTS_CONSTANTS),
    'CURRENCY_DECIMALS'
  );
  if (accountsAlias !== 'DEFAULT_CURRENCY_EXPONENTS') {
    violations.push({
      entry: 'accounts-currency-table-alias',
      message:
        `${ACCOUNTS_CONSTANTS} → CURRENCY_DECIMALS is expected to alias the ` +
        `engine's DEFAULT_CURRENCY_EXPONENTS (accounts inlines ledger-core), ` +
        `but resolves to ${accountsAlias ?? 'a non-alias expression'} — either ` +
        `restore the alias or register the copy in MIRROR_REGISTRY.`,
    });
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

  const mirrorCount = MIRROR_REGISTRY.reduce(
    (sum, entry) => sum + entry.mirrors.length,
    0
  );
  console.log(
    `Lockstep OK — ${MIRROR_REGISTRY.length} registered symbols ` +
      `(${mirrorCount} mirrors), ${CSS_NUMBER_REGISTRY.length} CSS number ` +
      `mirrors, ${CSS_FALLBACK_REGISTRY.length} CSS fallback groups.`
  );
}

if (import.meta.main) {
  main();
}
