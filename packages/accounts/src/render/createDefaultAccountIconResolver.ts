// Pragmatic default icon resolver over top-level chart-of-accounts segment
// heuristics. Hosts with richer metadata (account types from their own
// store, tags, currencies) should replace it with their own resolver — this
// one exists so `icons: { resolver: createDefaultAccountIconResolver() }`
// gives a plausible chart out of the box.
//
// Heuristics (documented contract, case-insensitive):
// - groups → `folder` (every group, any depth — groups read as containers)
// - leaves by TOP-LEVEL segment:
//   - Assets…      → `cash` when the leaf name contains "cash" or "petty"
//                    (checked FIRST: "Cash-Maybank" is cash held at a bank),
//                    `bank` when it contains "bank",
//                    `receivable` when it contains "receivable" or "debtor",
//                    otherwise `wallet`
//   - Liabilities… → `payable`
//   - Income… / Revenue… → `income`
//   - Expense(s)…  → `expense`
//   - Equity… / Capital… → `equity`
//   - anything else → null (no icon — same look as an unresolved row)

import type { AccountIconContext, AccountIconResolver } from '../types';

export function createDefaultAccountIconResolver(): AccountIconResolver {
  return (context: AccountIconContext) => {
    if (context.isGroup) {
      return 'folder';
    }
    // Top-level segment without allocating a split array — the resolver
    // runs once per rendered row per window commit (hot path).
    const colonIndex = context.path.indexOf(':');
    const top = (
      colonIndex < 0 ? context.path : context.path.slice(0, colonIndex)
    ).toLowerCase();
    const leaf = context.name.toLowerCase();
    if (top.startsWith('asset')) {
      // Cash wins over bank: names like "Cash-Maybank" describe cash held
      // AT a bank — the leading word carries the account's nature.
      if (leaf.includes('cash') || leaf.includes('petty')) {
        return 'cash';
      }
      if (leaf.includes('bank')) {
        return 'bank';
      }
      if (leaf.includes('receivable') || leaf.includes('debtor')) {
        return 'receivable';
      }
      return 'wallet';
    }
    if (top.startsWith('liabilit')) {
      return 'payable';
    }
    if (top.startsWith('income') || top.startsWith('revenue')) {
      return 'income';
    }
    if (top.startsWith('expense')) {
      return 'expense';
    }
    if (top.startsWith('equity') || top.startsWith('capital')) {
      return 'equity';
    }
    return null;
  };
}
