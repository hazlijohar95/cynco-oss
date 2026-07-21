// Account taxonomy: classifies canonical account paths into the five
// accounting types and derives the presentation facts (normal balance,
// statement role) that trial balances and financial statements are built on.
//
// The taxonomy is deliberately opinionated by default — the five-type
// Assets/Liabilities/Equity/Income/Expenses convention with `Revenue`
// accepted as a synonym root for income — and every opinion has an escape
// hatch: root names are remappable (localized charts) and any subtree can be
// overridden per path (contra accounts, nonstandard layouts). A path the
// taxonomy cannot classify returns `null`; consumers flag unclassified
// accounts rather than guessing, matching the suite-wide rule that the data
// layer never invents meaning to make output look complete.

import { getAncestorAccountPaths, isValidAccountPath } from './accountPath';

/**
 * The five fundamental account types of double-entry accounting. Singular
 * semantic names; the plural root-segment naming convention
 * (`Assets:Current:Cash`) maps onto these via {@link DEFAULT_ROOT_ACCOUNT_TYPES}.
 */
export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'income'
  | 'expense';

/**
 * Which sign an account's balance is expected to carry. In the suite's
 * signed-amount model (positive = debit, negative = credit) a debit-normal
 * account usually holds a positive balance and a credit-normal account a
 * negative one; presentation layers use this to render both as positive
 * magnitudes in the conventional debit/credit columns.
 */
export type NormalBalance = 'debit' | 'credit';

/** Which financial statement an account's balance reports on. */
export type StatementRole = 'balance-sheet' | 'income-statement';

/**
 * Everything the taxonomy knows about one account path. `normalBalance` and
 * `statement` are derived facts — type determines both, and `contra` flips
 * the normal balance (accumulated depreciation is an asset with a credit
 * normal balance) — carried on the object so renderers never re-derive them.
 */
export interface AccountClassification {
  type: AccountType;
  /** True when the account carries the opposite of its type's normal balance. */
  contra: boolean;
  normalBalance: NormalBalance;
  statement: StatementRole;
}

/**
 * One per-path override. Fields resolve independently: an override may set
 * only `contra` and let `type` fall through to an ancestor override or the
 * root mapping, so `Assets:Contra` can flip the balance convention without
 * restating what an asset is.
 */
export interface AccountTaxonomyOverride {
  type?: AccountType;
  contra?: boolean;
}

/** Options bag for {@link createAccountTaxonomy}. */
export interface AccountTaxonomyOptions {
  /**
   * Maps a path's first segment to an account type. Replaces (not merges
   * with) {@link DEFAULT_ROOT_ACCOUNT_TYPES} when provided, so a localized
   * chart (`Aset`, `Liabiliti`) states its own complete convention.
   * Segment comparison is exact and case-sensitive, like every other path
   * comparison in the suite.
   */
  rootTypes?: Readonly<Record<string, AccountType>>;
  /**
   * Per-path overrides, inherited by every descendant. When several
   * ancestors of a path carry overrides, the nearest one wins — per field,
   * see {@link AccountTaxonomyOverride}. Keys must be canonical paths;
   * invalid keys are ignored (never matched).
   */
  overrides?: Readonly<Record<string, AccountTaxonomyOverride>>;
}

/**
 * A classification oracle for account paths. Immutable once created: the
 * classification of a path never changes, so results are memoized per
 * instance and `classify` is safe to call in per-row render loops.
 */
export interface AccountTaxonomy {
  /**
   * Classification for a canonical account path, or `null` when the path is
   * invalid or no root mapping / override gives it a type. Null means
   * "unclassified — flag it", never "assume something reasonable".
   */
  classify(path: string): AccountClassification | null;
}

/**
 * The default root-segment convention: the five plural English roots used
 * across the suite's examples, plus `Revenue` as a widely-used synonym root
 * for income. Custom conventions replace this map via
 * {@link AccountTaxonomyOptions.rootTypes}.
 */
export const DEFAULT_ROOT_ACCOUNT_TYPES: Readonly<Record<string, AccountType>> =
  {
    Assets: 'asset',
    Liabilities: 'liability',
    Equity: 'equity',
    Income: 'income',
    Revenue: 'income',
    Expenses: 'expense',
  };

/**
 * The normal balance convention of double-entry accounting: assets and
 * expenses are debit-normal; liabilities, equity, and income are
 * credit-normal. Exposed for renderers that work from a bare type (statement
 * section totals) rather than a full classification.
 */
export function getNormalBalanceForType(type: AccountType): NormalBalance {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

/**
 * Which statement a type reports on: income and expenses drive the income
 * statement; assets, liabilities, and equity sit on the balance sheet.
 */
export function getStatementRoleForType(type: AccountType): StatementRole {
  return type === 'income' || type === 'expense'
    ? 'income-statement'
    : 'balance-sheet';
}

/**
 * Builds an immutable {@link AccountTaxonomy} from a root-name convention
 * plus per-path overrides. Classification cost is O(path depth) on the first
 * call per path and O(1) after (memoized), so callers may treat `classify`
 * as free inside render loops.
 */
export function createAccountTaxonomy(
  options: AccountTaxonomyOptions = {}
): AccountTaxonomy {
  const rootTypes = options.rootTypes ?? DEFAULT_ROOT_ACCOUNT_TYPES;
  const overrides = options.overrides ?? {};
  const cache = new Map<string, AccountClassification | null>();

  // Nearest-first lineage of a path: the path itself, then each ancestor
  // walking toward the root. Override resolution scans this once per field.
  function getLineage(path: string): string[] {
    const lineage = getAncestorAccountPaths(path);
    lineage.reverse();
    lineage.unshift(path);
    return lineage;
  }

  function resolve(path: string): AccountClassification | null {
    if (!isValidAccountPath(path)) {
      return null;
    }
    const lineage = getLineage(path);

    let type: AccountType | null = null;
    let contra = false;
    let contraResolved = false;
    for (const ancestor of lineage) {
      const override = overrides[ancestor];
      if (override == null) {
        continue;
      }
      if (type == null && override.type != null) {
        type = override.type;
      }
      if (!contraResolved && override.contra != null) {
        contra = override.contra;
        contraResolved = true;
      }
      if (type != null && contraResolved) {
        break;
      }
    }

    if (type == null) {
      const rootSegment = lineage[lineage.length - 1];
      type = rootTypes[rootSegment] ?? null;
    }
    if (type == null) {
      return null;
    }

    const typeNormal = getNormalBalanceForType(type);
    const normalBalance = contra
      ? typeNormal === 'debit'
        ? 'credit'
        : 'debit'
      : typeNormal;
    return {
      type,
      contra,
      normalBalance,
      statement: getStatementRoleForType(type),
    };
  }

  return {
    classify(path: string): AccountClassification | null {
      const cached = cache.get(path);
      if (cached !== undefined) {
        return cached;
      }
      const classification = resolve(path);
      cache.set(path, classification);
      return classification;
    },
  };
}
