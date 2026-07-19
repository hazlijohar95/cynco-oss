import '@/app/prose.css';
import type { Metadata } from 'next';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Footer } from '@/components/Footer';

const docsTitle = 'Theming docs';
const docsDescription =
  'Documentation for @cynco/theming: the runtime theme controller ' +
  '(light / dark / system), persistence, theme catalogs, DOM application ' +
  'helpers, the React hook, and the CVD-safe role sets from @cynco/theme.';

export const metadata: Metadata = {
  title: docsTitle,
  description: docsDescription,
};

const VANILLA_QUICKSTART = `
import {
  connectThemeController,
  createThemeController,
  defaultCatalog,
} from '@cynco/theming';

const controller = createThemeController({
  catalog: defaultCatalog,
  storageKey: 'my-app-theme', // persists the selection in localStorage
});

// Applies --journals-theme-* / --accounts-theme-* variables plus a
// color-scheme pin to the element, now and on every change.
const disconnect = connectThemeController(
  controller,
  document.getElementById('app')!
);

controller.setMode('dark');     // 'light' | 'dark' | 'system'
controller.setTheme('darkSoft'); // assigns to the slot the theme belongs to

// The published state — frozen and reference-stable until the next change:
const { mode, resolvedScheme, themeName, roles } = controller.getSnapshot();

controller.subscribe(() => rerenderPicker(controller.getSnapshot()));
controller.destroy(); // detaches the OS listener, drops subscribers
`;

const APPLY_CONTRACT = `
import { applyThemeToElement } from '@cynco/theming';

applyThemeToElement(element, controller.getSnapshot(), {
  prefixes: ['journals', 'accounts'], // the default
});
`;

const REACT_HOOK = `
import { createThemeController, defaultCatalog } from '@cynco/theming';
import { useThemeController } from '@cynco/theming/react';

const controller = createThemeController({ catalog: defaultCatalog });

function ThemePicker() {
  const { mode, themeName, resolvedScheme, catalog } =
    useThemeController(controller);
  return (
    <select
      value={themeName}
      onChange={(event) => controller.setTheme(event.target.value)}
    >
      {catalog.list().map((entry) => (
        <option key={entry.name} value={entry.name}>
          {entry.label}
        </option>
      ))}
    </select>
  );
}
`;

const PERSISTENCE_ADAPTER = `
// The persisted shape is names only — { mode, light, dark } — never
// resolved role objects, so stored data can't go stale against a newer
// catalog. A custom ThemePersistence adapter takes precedence over
// storageKey:
const controller = createThemeController({
  catalog: defaultCatalog,
  persistence: {
    load: () => readSelectionFromCookie(), // ThemeSelection | null
    save: (selection) => writeSelectionToCookie(selection),
  },
});
`;

const CATALOG_EXAMPLE = `
import { createThemeCatalog } from '@cynco/theming';
import { dark, light } from '@cynco/theme';

const catalog = createThemeCatalog(
  [
    { name: 'day', label: 'Day', scheme: 'light', roles: light },
    { name: 'night', label: 'Night', scheme: 'dark', roles: dark },
  ],
  { light: 'day', dark: 'night' }
);

catalog.get('day');        // ThemeCatalogEntry | null (graceful for input)
catalog.list();            // readonly ThemeCatalogEntry[]
catalog.defaultFor('dark'); // always resolves — validated at creation
`;

const COLOR_SCIENCE = `
import {
  contrastRatio,
  deltaE2000,
  parseHex,
  simulateCvd,
} from '@cynco/theme';

const debit = parseHex('#199f43')!; // Rgb | null on malformed input
const credit = parseHex('#d5393e')!;

deltaE2000(debit, credit); // CIEDE2000 — ~2-3 is "just noticeable"
deltaE2000(
  simulateCvd(debit, 'deuteranopia'), // Machado et al. (2009), severity 1.0
  simulateCvd(credit, 'deuteranopia')
);
contrastRatio(debit, parseHex('#ffffff')!); // WCAG 2.x ratio
`;

const CVD_CATALOG = `
// defaultCatalog already includes the accessible sets; assigning one is a
// single setTheme call — no custom catalog required:
controller.setTheme('lightCvd');  // protanopia/deuteranopia-safe light slot
controller.setTheme('darkTritan'); // tritanopia-safe dark slot
`;

const SSR_EXAMPLE = `
// Server: the controller resolves headlessly ('system' → 'light', no
// persistence), and useThemeController's server snapshot is the same
// getSnapshot. For server-rendered inline styles, serialize the roles:
import { themeToCSSVariables } from '@cynco/theme';

const snapshot = controller.getSnapshot();
const style = themeToCSSVariables('journals', snapshot.roles);
// { '--journals-theme-bg-editor': '#ffffff', ... }
`;

export default function ThemingDocsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <DocsLayout>
        <div className="min-w-0 space-y-8">
          <section className="docs-prose contain-layout">
            <h1>Theming</h1>
            <p>
              <code>@cynco/theming</code> is runtime theming for the ledger
              components: a framework-agnostic theme controller (light / dark /
              system with OS-preference tracking), pluggable persistence, DOM
              application helpers, and a React hook. It pairs with the role sets
              and CSS variable convention from <code>@cynco/theme</code> that{' '}
              <code>@cynco/journals</code> and <code>@cynco/accounts</code>{' '}
              consume.
            </p>

            <h2 id="installation">Installation</h2>
            <p>
              Install with the package manager of your choice. React is an
              optional peer dependency required only by the <code>/react</code>{' '}
              entry.
            </p>
            <CodeBlock code="pnpm add @cynco/theming" />
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
                    <code>@cynco/theming</code>
                  </td>
                  <td>
                    <code>createThemeController</code>,{' '}
                    <code>createThemeCatalog</code> +{' '}
                    <code>defaultCatalog</code>,{' '}
                    <code>applyThemeToElement</code> /{' '}
                    <code>connectThemeController</code>, and the types (
                    <code>ThemeController</code>, <code>ThemeCatalog</code>,{' '}
                    <code>ThemePersistence</code>, …)
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>@cynco/theming/react</code>
                  </td>
                  <td>
                    The <code>useThemeController</code> hook
                  </td>
                </tr>
              </tbody>
            </table>

            <h2 id="vanilla-api">Vanilla API</h2>
            <p>
              The controller is the store: it owns the mode, the per-scheme
              theme choice, persistence, and the{' '}
              <code>prefers-color-scheme</code> subscription (attached only
              while the mode is <code>system</code>).{' '}
              <code>connectThemeController</code> binds it to an element — apply
              now, re-apply on every change.
            </p>
            <CodeBlock code={VANILLA_QUICKSTART} />
            <p>
              <code>setTheme</code> records the choice for that theme&rsquo;s
              scheme slot — a light theme name and a dark theme name are kept
              independently — so switching modes, or an OS flip while in{' '}
              <code>system</code> mode, always lands on the right theme. Unknown
              names are a documented no-op: pickers often feed persisted or user
              strings, and crashing the host over a stale name would be worse
              than keeping the current theme.
            </p>
            <CodeBlock code={APPLY_CONTRACT} />
            <ul>
              <li>
                Sets{' '}
                <code>--&lt;prefix&gt;-theme-&lt;group&gt;-&lt;token&gt;</code>{' '}
                inline custom properties for each prefix (via{' '}
                <code>@cynco/theme</code>&rsquo;s{' '}
                <code>themeToCSSVariables</code>) and pins the element&rsquo;s
                inline <code>color-scheme</code> to the resolved scheme — the
                pin lives in the outer tree, so it beats the components&rsquo;
                shadow <code>:host</code> rule.
              </li>
              <li>
                Tracks the properties it applied per element and removes stale
                ones on the next apply, so switching themes never leaves old
                variables behind.
              </li>
              <li>
                <code>connectThemeController</code>&rsquo;s disconnect function
                only unsubscribes — the applied variables are deliberately left
                in place, because stripping them would flash unthemed UI on
                teardown.
              </li>
            </ul>

            <h2 id="react-api">React API</h2>
            <p>
              <code>useThemeController</code> is a pure{' '}
              <code>useSyncExternalStore</code> wrapper with no state of its own
              — mode, persistence, and system tracking all live in the
              controller, so vanilla hosts share the exact same behavior. The
              snapshot is frozen and reference-stable between changes, which is
              precisely the contract <code>useSyncExternalStore</code> needs.
            </p>
            <CodeBlock code={REACT_HOOK} />

            <h2 id="persistence">Persistence</h2>
            <p>
              Pass <code>storageKey</code> for the built-in adapter: one
              localStorage JSON entry holding only the selection names. Corrupt
              JSON, unknown theme names, or unavailable storage all degrade to
              the catalog defaults — nothing throws at runtime. Persistence is
              loaded exactly once, at creation; loaded values win over the{' '}
              <code>initialMode</code> / <code>initialTheme</code> options, and
              every field degrades independently.
            </p>
            <CodeBlock code={PERSISTENCE_ADAPTER} />

            <h2 id="catalogs">Theme catalogs</h2>
            <p>
              <code>defaultCatalog</code> wraps every role set{' '}
              <code>@cynco/theme</code> ships — <code>light</code> /{' '}
              <code>dark</code>, the contrast-compressed <code>lightSoft</code>{' '}
              / <code>darkSoft</code>, and the accessible <code>lightCvd</code>{' '}
              / <code>darkCvd</code> / <code>lightTritan</code> /{' '}
              <code>darkTritan</code> variants — with entry names matching the{' '}
              <code>@cynco/theme</code> export names. Build your own with{' '}
              <code>createThemeCatalog</code>:
            </p>
            <CodeBlock code={CATALOG_EXAMPLE} />
            <p>
              Catalog construction is the one deliberate exception to graceful
              degradation: duplicate names, unknown default names, or a default
              pointing at the wrong scheme are programmer errors and throw with
              a clear message at creation time.
            </p>

            <h2 id="cvd-accessibility">CVD-safe themes</h2>
            <p>
              The base themes map debit to green and credit to red — mirror diff
              semantics — and that is exactly the axis protanopia and
              deuteranopia collapse (together the large majority of color vision
              deficiency, roughly 8% of men). Measured with the Machado et al.
              (2009) severity-1.0 simulation and CIEDE2000: <code>light</code>{' '}
              debit vs credit is ΔE₀₀ 72.8 normally → <strong>4.8</strong> under
              deuteranopia; <code>dark</code> is 69.1 → <strong>4.5</strong>.
              ΔE₀₀ ≈ 2–3 is &ldquo;just noticeable&rdquo; — a deuteranope
              reading the base themes cannot reliably tell a debit from a
              credit.
            </p>
            <p>
              The four accessible sets fix that on the axes each deficiency
              preserves — blue ↔ orange for <code>lightCvd</code> /{' '}
              <code>darkCvd</code>, teal ↔ vermillion for the tritan sets —
              while chrome (<code>bg</code>, <code>fg</code>,{' '}
              <code>border</code>, <code>accent</code>) stays identical to the
              base themes, so the variants still look like Cynco. A permanent
              test gate simulates every gated color at full dichromacy and
              asserts on the <em>simulated</em> colors: ΔE₀₀(debit, credit) ≥ 20
              (measured 47.4–54.5 for the CVD sets, 59.6–63.8 for the tritan
              sets) and simulated debit/credit contrast on the simulated
              background ≥ 3.0 (WCAG SC 1.4.11, measured 4.16–10.91). See{' '}
              <a
                href="https://github.com/hazlijohar95/cynco-oss/blob/main/packages/theme/ACCESSIBILITY.md"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-link"
              >
                ACCESSIBILITY.md
              </a>{' '}
              for the full numbers.
            </p>
            <CodeBlock code={CVD_CATALOG} />
            <p>
              The science behind the gate is exported from{' '}
              <code>@cynco/theme</code> as pure, dependency-free helpers:
            </p>
            <CodeBlock code={COLOR_SCIENCE} />

            <h2 id="ssr">SSR</h2>
            <p>
              The controller is SSR-safe: no <code>window</code>,{' '}
              <code>matchMedia</code>, or <code>localStorage</code> access
              happens at module scope, and every browser access is guarded. On
              the server (or any headless runtime) <code>system</code> mode
              resolves to <code>light</code> and persistence no-ops; the client
              re-resolves against the real OS preference and stored selection on
              hydration.
            </p>
            <CodeBlock code={SSR_EXAMPLE} />
          </section>
        </div>
      </DocsLayout>
      <Footer />
    </div>
  );
}
