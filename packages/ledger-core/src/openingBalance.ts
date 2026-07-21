// Opening-balance construction. An opening balance is not a special
// mechanism in this suite — it is an ordinary balanced journal entry, dated
// day one, that debits/credits each carried-forward account against an
// equity offset account. This helper builds that entry correctly so every
// consumer migrating a ledger gets a balanced day-one picture without
// hand-computing the equity plug.

import { isValidAccountPath } from './accountPath';
import { addMinorUnits, assertSafeMinorUnits } from './money';
import type { EntryFlag, LedgerEntry, MinorUnits, Posting } from './types';

/** The default equity offset account opening balances post against. */
export const DEFAULT_OPENING_BALANCE_ACCOUNT = 'Equity:Opening-Balances';

/** One carried-forward balance: the account and its signed day-one amount. */
export interface OpeningBalanceLine {
  /** Canonical colon-delimited account path. */
  account: string;
  /**
   * Signed integer minor units, same sign convention as postings:
   * positive = debit balance (assets), negative = credit balance
   * (liabilities, retained earnings).
   */
  amount: MinorUnits;
  /** ISO 4217 or commodity code. */
  currency: string;
}

/** Options bag for {@link createOpeningBalanceEntry}. */
export interface OpeningBalanceOptions {
  /** Stable unique entry id (caller-provided, like every entry id). */
  id: string;
  /** ISO date `YYYY-MM-DD` the opening balances take effect. */
  date: string;
  /** The carried-forward balances, one line per (account, currency). */
  lines: readonly OpeningBalanceLine[];
  /**
   * Equity account the offsetting postings book against. Defaults to
   * {@link DEFAULT_OPENING_BALANCE_ACCOUNT}.
   */
  equityAccount?: string;
  /** Entry flag; defaults to `cleared` — opening balances are agreed facts. */
  flag?: EntryFlag;
  /** Narration; defaults to `Opening balances`. */
  narration?: string;
  /** Tags for the entry, without any `#` prefix. */
  tags?: readonly string[];
  /** Cross-reference link ids (migration batch, source document). */
  links?: readonly string[];
}

/**
 * Builds the opening-balance journal entry: one posting per line plus one
 * offsetting equity posting per currency, so the entry balances to exactly
 * zero in every currency by construction.
 *
 * This is a programmer-error boundary, not a source-document parser, so it
 * throws instead of degrading: a line with a non-integer amount or an
 * invalid account path is a bug in the migration code, and silently
 * dropping it would fabricate a different opening position — the one thing
 * an opening balance must never do.
 */
export function createOpeningBalanceEntry(
  options: OpeningBalanceOptions
): LedgerEntry {
  const equityAccount =
    options.equityAccount ?? DEFAULT_OPENING_BALANCE_ACCOUNT;
  if (!isValidAccountPath(equityAccount)) {
    throw new TypeError(
      `Invalid equity account path for opening balances: ${equityAccount}`
    );
  }

  const postings: Posting[] = [];
  const totalsByCurrency = new Map<string, MinorUnits>();
  for (const line of options.lines) {
    if (!isValidAccountPath(line.account)) {
      throw new TypeError(
        `Invalid account path in opening balance line: ${line.account}`
      );
    }
    assertSafeMinorUnits(line.amount);
    postings.push({
      account: line.account,
      amount: line.amount,
      currency: line.currency,
    });
    const current = totalsByCurrency.get(line.currency) ?? 0;
    totalsByCurrency.set(line.currency, addMinorUnits(current, line.amount));
  }

  // One equity offset per currency with a nonzero net: currencies whose
  // lines already net to zero need no plug, and adding a zero posting would
  // only be noise in the register.
  for (const [currency, total] of totalsByCurrency) {
    if (total !== 0) {
      postings.push({
        account: equityAccount,
        amount: -total,
        currency,
      });
    }
  }

  return {
    id: options.id,
    date: options.date,
    flag: options.flag ?? 'cleared',
    payee: null,
    narration: options.narration ?? 'Opening balances',
    tags: options.tags ?? [],
    links: options.links ?? [],
    postings,
  };
}
