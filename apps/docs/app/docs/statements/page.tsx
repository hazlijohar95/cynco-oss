import '@/app/prose.css';
import type { Metadata } from 'next';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';
import { BalanceSheetDemo } from '@/examples/BalanceSheetDemo';
import { IncomeStatementDemo } from '@/examples/IncomeStatementDemo';
import { TrialBalanceDemo } from '@/examples/TrialBalanceDemo';

const docsTitle = 'Statements';
const docsDescription =
  'Documentation for @cynco/statements: trial balance, income statement, ' +
  'and balance sheet derivations plus vanilla and React renderers — per ' +
  'currency, computed proofs, flagged never plugged.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

const VANILLA_API = `
import {
  createAccountTaxonomy,
  deriveTrialBalance,
  TrialBalance,
} from '@cynco/statements';

const taxonomy = createAccountTaxonomy();
const data = deriveTrialBalance(entries, {
  taxonomy,
  asOf: '2026-12-31',
});

const view = new TrialBalance({ showClassification: true });
view.render({
  data,
  parentNode: document.getElementById('mount')!,
});

// Derivations return a fresh immutable object per call, so re-render is a
// reference comparison — pass new data to rebuild, same data to no-op …
view.render({ data: deriveTrialBalance(nextEntries, { taxonomy }) });
// … and tear down.
view.cleanUp();
`;

const REACT_API = `
import {
  createAccountTaxonomy,
  deriveBalanceSheet,
  deriveIncomeStatement,
  deriveTrialBalance,
  type LedgerEntry,
} from '@cynco/statements';
import {
  BalanceSheet,
  IncomeStatement,
  TrialBalance,
} from '@cynco/statements/react';

const taxonomy = createAccountTaxonomy();

export function YearEnd({ entries }: { entries: LedgerEntry[] }) {
  return (
    <>
      <TrialBalance
        data={deriveTrialBalance(entries, { taxonomy, asOf: '2026-12-31' })}
        options={{ showClassification: true }}
        colorScheme="system" // 'light' | 'dark' | 'system'
      />
      <IncomeStatement
        data={deriveIncomeStatement(entries, {
          taxonomy,
          periods: [
            { label: 'FY2025', dateFrom: '2025-01-01', dateTo: '2025-12-31' },
            { label: 'FY2026', dateFrom: '2026-01-01', dateTo: '2026-12-31' },
          ],
        })}
      />
      <BalanceSheet
        data={deriveBalanceSheet(entries, {
          taxonomy,
          dates: [
            {
              label: '31 Dec 2026',
              asOf: '2026-12-31',
              fiscalYearStart: '2026-01-01',
            },
          ],
        })}
      />
    </>
  );
}
`;

const TRIAL_BALANCE_DERIVE = `
// The plain trial balance: signed closing balance per (account, currency),
// split into the conventional debit/credit columns.
const closing = deriveTrialBalance(entries, {
  taxonomy,
  asOf: '2026-12-31', // inclusive; omitted = all-time
  // Zero-activity chart accounts to print at zero in every section:
  accountPaths: ['Equity:Retained-Earnings', 'Assets:Current:Petty-Cash'],
});

// The working trial balance: tag adjusting entries, pass an EntryFilter,
// and every row splits into unadjusted / adjustments / adjusted pairs —
// the six-column year-end working paper.
const working = deriveTrialBalance(entries, {
  taxonomy,
  asOf: '2026-12-31',
  adjustments: { tag: 'adjustment' },
});
`;

const INCOME_STATEMENT_DERIVE = `
const profitAndLoss = deriveIncomeStatement(entries, {
  taxonomy,
  // One column per period, inclusive on both ends, in display order:
  periods: [
    { label: 'FY2025', dateFrom: '2025-01-01', dateTo: '2025-12-31' },
    { label: 'FY2026', dateFrom: '2026-01-01', dateTo: '2026-12-31' },
  ],
});

// Per currency section: income / expenses lines with one amount per
// period, totals, netIncome, and the unclassified residue.
const [myr] = profitAndLoss.sections;
myr.netIncome; // [1_790_000, 1_340_000] — minor units per column
`;

const BALANCE_SHEET_DERIVE = `
const position = deriveBalanceSheet(entries, {
  taxonomy,
  // One column per as-of date; fiscalYearStart splits the computed
  // earnings lines for that column:
  dates: [
    { label: '31 Dec 2025', asOf: '2025-12-31', fiscalYearStart: '2025-01-01' },
    { label: '31 Dec 2026', asOf: '2026-12-31', fiscalYearStart: '2026-01-01' },
  ],
});

const [myr] = position.sections;
myr.retainedEarnings; // computed P&L result before each column's fiscal year
myr.currentEarnings;  // computed result inside it — never booked entries
myr.balancedByDate;   // the accounting equation, checked per column
`;

const TAXONOMY_EXAMPLE = `
import { createAccountTaxonomy } from '@cynco/statements';

const taxonomy = createAccountTaxonomy({
  overrides: {
    // Contra asset: still an asset, but credit-normal — accumulated
    // depreciation stops flagging as abnormal.
    'Assets:Fixed:Accumulated-Depreciation': { contra: true },
    // Subtrees outside the root convention can be typed wholesale;
    // descendants inherit, nearest ancestor wins per field.
    'Clearing:Card-Settlements': { type: 'asset' },
  },
});

taxonomy.classify('Assets:Fixed:Accumulated-Depreciation');
// { type: 'asset', contra: true, normalBalance: 'credit',
//   statement: 'balance-sheet' }
taxonomy.classify('Suspense:Pending-Query');
// null — unclassified. Statements flag it; they never guess.
`;

const LOCALIZED_ROOTS = `
// rootTypes replaces (not merges with) the default map, so a localized
// chart states its own complete convention:
const bahasaMalaysia = createAccountTaxonomy({
  rootTypes: {
    Aset: 'asset',
    Liabiliti: 'liability',
    Ekuiti: 'equity',
    Hasil: 'income',
    Belanja: 'expense',
  },
});
`;

const TOOLBOX_EXAMPLE = `
import {
  checkBalanceAssertions,
  createOpeningBalanceEntry,
  getCurrencyExponent,
} from '@cynco/statements';

// Opening balances are ordinary balanced entries: one posting per line
// plus one equity offset per currency, balanced by construction.
const opening = createOpeningBalanceEntry({
  id: 'opening-2025',
  date: '2025-01-01',
  lines: [
    { account: 'Assets:Current:Cash-Maybank', amount: 5_000_000, currency: 'MYR' },
    { account: 'Liabilities:Current:SST-Payable', amount: -80_000, currency: 'MYR' },
  ],
  // equityAccount defaults to 'Equity:Opening-Balances'
});

// Imports and migrations prove themselves with declared balance facts;
// a failed assertion reports the exact difference and changes nothing.
const results = checkBalanceAssertions(store, [
  {
    account: 'Assets:Current:Cash-Maybank',
    date: '2025-01-01',
    amount: 5_000_000,
    currency: 'MYR',
  },
]);
results[0]; // { ok: true, actual: 5_000_000, difference: 0, … }

getCurrencyExponent('MYR'); // 2 — sen
getCurrencyExponent('JPY'); // 0 — yen has no minor unit
`;

export default function StatementsDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <h1>Statements</h1>
            <p>
              <code>@cynco/statements</code> is trial balance and financial
              statement renderers derived from ledger entries — derive and
              render from one package, with the data engine inlined at build
              time. Statements render as semantic tables inside a{' '}
              <code>&lt;statements-container&gt;</code> shadow root, one table
              per currency (currencies are never mixed into one column), keyed
              by canonical colon-delimited account paths. Everything the numbers
              claim — the debit/credit tie, the accounting equation — is
              computed and shown; nothing is asserted, guessed, or plugged.
            </p>
            <TrialBalanceDemo />

            <h2 id="installation">Installation</h2>
            <p>
              Install with the package manager of your choice. React is an
              optional peer dependency required only by the <code>/react</code>{' '}
              entry; the engine (<code>@cynco/ledger-core</code>) is inlined
              into the published bundle, so there are no runtime dependencies.
            </p>
            <CodeBlock code="pnpm add @cynco/statements" />
            <table>
              <thead>
                <tr>
                  <th>Entry point</th>
                  <th>What it exports</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>@cynco/statements</code>
                  </td>
                  <td>
                    The derivations (<code>deriveTrialBalance</code>,{' '}
                    <code>deriveIncomeStatement</code>,{' '}
                    <code>deriveBalanceSheet</code>),{' '}
                    <code>createAccountTaxonomy</code>, the vanilla{' '}
                    <code>TrialBalance</code> / <code>IncomeStatement</code> /{' '}
                    <code>BalanceSheet</code> views, the pure HTML renderers,
                    utilities (<code>createOpeningBalanceEntry</code>,{' '}
                    <code>checkBalanceAssertions</code>,{' '}
                    <code>getCurrencyExponent</code>), and the types
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>@cynco/statements/react</code>
                  </td>
                  <td>
                    <code>&lt;TrialBalance /&gt;</code>,{' '}
                    <code>&lt;IncomeStatement /&gt;</code>, and{' '}
                    <code>&lt;BalanceSheet /&gt;</code>
                  </td>
                </tr>
              </tbody>
            </table>

            <h2 id="vanilla-api">Vanilla API</h2>
            <p>
              Derive, then render: derivations are pure report-time queries (one
              linear pass over plain entries — no store, no index rebuilds), and
              each view class only manages DOM lifecycle around a shared string
              renderer, so client output and any future SSR preload can never
              drift apart.
            </p>
            <CodeBlock code={VANILLA_API} />
            <p>
              The view options are named <code>TrialBalanceViewOptions</code> /{' '}
              <code>IncomeStatementViewOptions</code> /{' '}
              <code>BalanceSheetViewOptions</code> because the package also
              re-exports the engine&rsquo;s <code>TrialBalanceOptions</code>{' '}
              (and friends) — the options bags of the derivations — and the two
              surfaces must not collide.
            </p>

            <h2 id="react-api">React API</h2>
            <p>
              The React components wrap the vanilla views one-to-one and take
              the same derived data. <code>colorScheme</code> pins how the
              built-in <code>light-dark()</code> colors resolve — the shadow
              stylesheet follows the user&rsquo;s OS preference by default, so
              sites with their own light/dark toggle should pin{' '}
              <code>light</code> / <code>dark</code> or scope a{' '}
              <code>color-scheme</code> on the host element.
            </p>
            <CodeBlock code={REACT_API} />

            <h2 id="trial-balance">Trial balance</h2>
            <p>
              <code>deriveTrialBalance</code> reports every account with direct
              postings at its signed closing balance, positive in the debit
              column and negative in the credit column, with the totals proof
              line computed per section. <code>asOf</code> bounds the balances
              (inclusive); <code>accountPaths</code> prints zero-activity chart
              accounts so the statement shows the full chart, not just accounts
              that saw postings; and <code>adjustments</code> — any{' '}
              <code>EntryFilter</code>, conventionally{' '}
              <code>&#123; tag: &apos;adjustment&apos; &#125;</code> — switches
              on the six-column working trial balance.
            </p>
            <CodeBlock code={TRIAL_BALANCE_DERIVE} />
            <p>
              Rows sort in statement convention — assets, liabilities, equity,
              income, expenses, then the unclassified residue last so the
              flagged rows are always visible at the bottom. An account holding
              the opposite of its normal balance (an asset in credit, income in
              debit) flags <code>abnormal</code> — the classic review flag on a
              printed trial balance.
            </p>

            <h2 id="income-statement">Income statement</h2>
            <p>
              <code>deriveIncomeStatement</code> reports period activity — the
              net movement of each income and expense account inside each
              period, one column per period. Cumulative balances never appear
              here; that is the balance sheet&rsquo;s job. Amounts are
              presentation-signed by <em>section</em>: income lines flip so
              revenue reads positive, and because the flip follows the section
              rather than the account, contra income (sales returns) naturally
              reads negative inside its section.
            </p>
            <IncomeStatementDemo />
            <CodeBlock code={INCOME_STATEMENT_DERIVE} />

            <h2 id="balance-sheet">Balance sheet</h2>
            <p>
              <code>deriveBalanceSheet</code> reports the cumulative position of
              asset, liability, and equity accounts through each as-of date. The
              retained-earnings problem is solved <em>virtually</em>: income and
              expense accounts never physically close in this suite, so each
              column carries computed earnings lines — the cumulative P&amp;L
              result folded into equity at derivation time, computed and clearly
              marked, never booked. A column&rsquo;s{' '}
              <code>fiscalYearStart</code> splits that result into retained
              earnings (before the fiscal year) and current-year earnings
              (inside it); without one, everything reports as retained earnings.
            </p>
            <BalanceSheetDemo />
            <CodeBlock code={BALANCE_SHEET_DERIVE} />

            <h2 id="taxonomy">Account taxonomy</h2>
            <p>
              <code>createAccountTaxonomy</code> classifies account paths into
              the five fundamental types and derives the presentation facts
              (normal balance, statement role) the statements are built on. The
              default convention maps the five plural English roots —{' '}
              <code>Assets</code>, <code>Liabilities</code>, <code>Equity</code>
              , <code>Income</code>, <code>Expenses</code> — plus{' '}
              <code>Revenue</code> as a widely-used synonym root for income.
              Every opinion has an escape hatch: per-path overrides inherit
              through subtrees with the nearest ancestor winning{' '}
              <em>per field</em>, so an override may set only{' '}
              <code>contra</code> and let <code>type</code> fall through.
            </p>
            <CodeBlock code={TAXONOMY_EXAMPLE} />
            <CodeBlock code={LOCALIZED_ROOTS} />
            <p>
              A path with no root mapping and no override classifies to{' '}
              <code>null</code> — unclassified. That is a flag, never a guess:
              the trial balance sorts it last and labels it, the income
              statement and balance sheet list it outside every total, and no
              statement ever invents a type to make output look complete.
              Classification is memoized per instance (O(path depth) once, then
              O(1)), so <code>classify</code> is safe in per-row render loops.
            </p>

            <h2 id="honesty-rules">Honesty rules</h2>
            <p>
              The derivations inherit the suite-wide rule that the data layer
              never invents meaning:
            </p>
            <ul>
              <li>
                <strong>Per-currency sections.</strong> Every statement renders
                one table per currency touched — mixing currencies in one column
                would be a lie, and cross-currency translation is an explicit,
                separate feature, never a silent default.
              </li>
              <li>
                <strong>Computed, never asserted.</strong> The trial
                balance&rsquo;s debit/credit tie and the balance sheet&rsquo;s
                accounting equation are checked and reported per section — an
                out-of-balance ledger renders honestly with the exact
                difference, no plug booked to make it tie.
              </li>
              <li>
                <strong>Void is excluded from meaning.</strong> Entries flagged{' '}
                <code>void</code> contribute to no balance, in any derivation.
              </li>
              <li>
                <strong>Unclassified is surfaced.</strong> Accounts the taxonomy
                cannot place are listed and flagged, excluded from every total,
                and never guessed into a section.
              </li>
              <li>
                <strong>Integer minor units end to end.</strong> Amounts format
                via digit-string slicing — no float ever touches a monetary
                value, and a negative zero can never leak into output.
                Aggregates that cross 2<sup>53</sup> flag{' '}
                <code>hasOverflow</code> on the section instead of silently
                losing precision.
              </li>
            </ul>

            <h2 id="toolbox">Also in the box</h2>
            <p>
              Three engine utilities re-exported for the workflows around
              statements:
            </p>
            <ul>
              <li>
                <code>checkBalanceAssertions</code> — declarative &ldquo;this
                account held exactly this balance on this date&rdquo; checks,
                the mechanism imports and migrations use to prove themselves. A
                failed assertion reports the discrepancy and changes nothing.
              </li>
              <li>
                <code>createOpeningBalanceEntry</code> — opening balances are
                not a special mechanism, just an ordinary balanced day-one
                entry; this builds it with one equity offset per currency so it
                balances by construction.
              </li>
              <li>
                <code>getCurrencyExponent</code> — the ISO 4217 minor-unit
                registry (with caller overrides), for formatting integer minor
                units in currencies that don&rsquo;t carry two decimals.
              </li>
            </ul>
            <CodeBlock code={TOOLBOX_EXAMPLE} />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
