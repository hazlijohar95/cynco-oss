import { describe, expect, test } from 'bun:test';

import {
  createAccountTaxonomy,
  getNormalBalanceForType,
  getStatementRoleForType,
} from '../src/taxonomy';

describe('createAccountTaxonomy defaults', () => {
  const taxonomy = createAccountTaxonomy();

  test('classifies the five conventional roots and their descendants', () => {
    expect(taxonomy.classify('Assets:Current:Cash-Maybank')).toEqual({
      type: 'asset',
      contra: false,
      normalBalance: 'debit',
      statement: 'balance-sheet',
    });
    expect(taxonomy.classify('Liabilities:Payables')?.type).toBe('liability');
    expect(taxonomy.classify('Equity:Opening-Balances')?.type).toBe('equity');
    expect(taxonomy.classify('Income:Sales')).toEqual({
      type: 'income',
      contra: false,
      normalBalance: 'credit',
      statement: 'income-statement',
    });
    expect(taxonomy.classify('Expenses:Bank-Charges')?.normalBalance).toBe(
      'debit'
    );
  });

  test('accepts Revenue as a synonym root for income', () => {
    expect(taxonomy.classify('Revenue:Consulting')?.type).toBe('income');
  });

  test('returns null for unknown roots instead of guessing', () => {
    expect(taxonomy.classify('Suspense:Unknown')).toBeNull();
    expect(taxonomy.classify('assets:lowercase-root')).toBeNull();
  });

  test('returns null for invalid paths', () => {
    expect(taxonomy.classify('')).toBeNull();
    expect(taxonomy.classify(':Assets')).toBeNull();
    expect(taxonomy.classify('Assets::Cash')).toBeNull();
  });

  test('memoized calls return identical results', () => {
    const first = taxonomy.classify('Assets:Current');
    expect(first).not.toBeNull();
    expect(taxonomy.classify('Assets:Current')).toBe(first);
  });
});

describe('createAccountTaxonomy overrides', () => {
  test('contra override flips the normal balance and inherits to descendants', () => {
    const taxonomy = createAccountTaxonomy({
      overrides: {
        'Assets:Fixed:Accumulated-Depreciation': { contra: true },
      },
    });
    const contra = taxonomy.classify(
      'Assets:Fixed:Accumulated-Depreciation:Vehicles'
    );
    expect(contra).toEqual({
      type: 'asset',
      contra: true,
      normalBalance: 'credit',
      statement: 'balance-sheet',
    });
    // Sibling subtrees keep the plain classification.
    expect(taxonomy.classify('Assets:Fixed:Vehicles')?.normalBalance).toBe(
      'debit'
    );
  });

  test('type override classifies a nonstandard root subtree', () => {
    const taxonomy = createAccountTaxonomy({
      overrides: { 'Fixed-Assets': { type: 'asset' } },
    });
    expect(taxonomy.classify('Fixed-Assets:Vehicles')?.type).toBe('asset');
    expect(taxonomy.classify('Fixed-Assets')?.statement).toBe('balance-sheet');
  });

  test('nearest override wins per field', () => {
    const taxonomy = createAccountTaxonomy({
      overrides: {
        'Assets:Contra': { contra: true },
        'Assets:Contra:Actually-Normal': { contra: false },
      },
    });
    expect(taxonomy.classify('Assets:Contra:Depreciation')?.contra).toBe(true);
    expect(
      taxonomy.classify('Assets:Contra:Actually-Normal:Cash')?.contra
    ).toBe(false);
  });

  test('contra income is debit-normal', () => {
    const taxonomy = createAccountTaxonomy({
      overrides: { 'Income:Sales-Returns': { contra: true } },
    });
    expect(taxonomy.classify('Income:Sales-Returns')?.normalBalance).toBe(
      'debit'
    );
  });
});

describe('createAccountTaxonomy custom root conventions', () => {
  test('rootTypes replaces the default convention wholesale', () => {
    const taxonomy = createAccountTaxonomy({
      rootTypes: { Aset: 'asset', Liabiliti: 'liability' },
    });
    expect(taxonomy.classify('Aset:Semasa:Tunai')?.type).toBe('asset');
    // The English defaults are gone once a custom convention is supplied.
    expect(taxonomy.classify('Assets:Cash')).toBeNull();
  });
});

describe('type derivation helpers', () => {
  test('normal balances follow the double-entry convention', () => {
    expect(getNormalBalanceForType('asset')).toBe('debit');
    expect(getNormalBalanceForType('expense')).toBe('debit');
    expect(getNormalBalanceForType('liability')).toBe('credit');
    expect(getNormalBalanceForType('equity')).toBe('credit');
    expect(getNormalBalanceForType('income')).toBe('credit');
  });

  test('statement roles split balance sheet from income statement', () => {
    expect(getStatementRoleForType('asset')).toBe('balance-sheet');
    expect(getStatementRoleForType('liability')).toBe('balance-sheet');
    expect(getStatementRoleForType('equity')).toBe('balance-sheet');
    expect(getStatementRoleForType('income')).toBe('income-statement');
    expect(getStatementRoleForType('expense')).toBe('income-statement');
  });
});
