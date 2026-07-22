'use client';

import { JournalEntry } from '@cynco/journals/react';
import {
  applyThemeToElement,
  createThemeController,
  defaultCatalog,
} from '@cynco/theming';
import { useThemeController } from '@cynco/theming/react';
import {
  Check,
  ChevronDown,
  Monitor,
  Moon,
  Paintbrush,
  Sun,
} from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { Footnote } from '@/components/Footnote';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SwitchPill } from '@/components/ui/switch-pill';
import { PAYROLL_ENTRY } from '@/examples/entries';

type ColorMode = 'light' | 'dark' | 'system';

// A one-off override on an ancestor: the top layer of the resolution chain,
// beating whatever theme role the controller applies below it.
const ACCENT_OVERRIDE_STYLE: CSSProperties = {
  ['--journals-accent-override' as string]: '#009fff',
};

export interface ThemeControllerDemoProps {
  /** Shadow-root HTML from `preloadJournalEntryHTML` for the sample card. */
  entryHTML: string;
}

// Live @cynco/theming controller driving a server-rendered journal entry:
// the mode control and theme picker call setMode/setTheme on a real
// createThemeController over defaultCatalog, and every snapshot change is
// written onto the host element by applyThemeToElement — the same
// `--journals-theme-*` variables plus color-scheme pin any host would get.
// No storageKey: the docs demo must not fight the site's own theme toggle
// across visits.
export function ThemeControllerDemo({ entryHTML }: ThemeControllerDemoProps) {
  const [controller] = useState(() =>
    createThemeController({ catalog: defaultCatalog })
  );
  useEffect(() => () => controller.destroy(), [controller]);

  const snapshot = useThemeController(controller);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [accentOverride, setAccentOverride] = useState(false);

  // Re-apply on every snapshot change. applyThemeToElement owns the inline
  // custom properties (and removes stale ones), so React must not also
  // manage a style prop on this element.
  useEffect(() => {
    const host = hostRef.current;
    if (host != null) {
      applyThemeToElement(host, snapshot, { prefixes: ['journals'] });
    }
  }, [snapshot]);

  const schemeThemes = snapshot.catalog
    .list()
    .filter((entry) => entry.scheme === snapshot.resolvedScheme);
  const activeLabel =
    snapshot.catalog.get(snapshot.themeName)?.label ?? snapshot.themeName;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ButtonGroup<ColorMode>
          value={snapshot.mode}
          aria-label="Color mode"
          onValueChange={(mode) => controller.setMode(mode)}
        >
          <ButtonGroupItem value="system">
            <Monitor size={16} />
            System
          </ButtonGroupItem>
          <ButtonGroupItem value="light">
            <Sun size={16} />
            Light
          </ButtonGroupItem>
          <ButtonGroupItem value="dark">
            <Moon size={16} />
            Dark
          </ButtonGroupItem>
        </ButtonGroup>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="min-w-[220px] justify-start">
              <Paintbrush size={16} />
              {activeLabel}
              <ChevronDown
                size={14}
                className="text-muted-foreground ml-auto"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {schemeThemes.map((entry) => (
              <DropdownMenuItem
                key={entry.name}
                selected={snapshot.themeName === entry.name}
                onClick={() => controller.setTheme(entry.name)}
              >
                {entry.label}
                {snapshot.themeName === entry.name && (
                  <Check size={14} className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <SwitchPill
          icon={<Paintbrush size={16} />}
          label="Accent override"
          checked={accentOverride}
          onCheckedChange={setAccentOverride}
        />
      </div>

      <div ref={hostRef}>
        <div
          className="demo-container"
          style={accentOverride ? ACCENT_OVERRIDE_STYLE : undefined}
        >
          <JournalEntry entry={PAYROLL_ENTRY} ssrHTML={entryHTML} />
        </div>
      </div>
      <Footnote>
        mode <code>{snapshot.mode}</code> → resolved{' '}
        <code>{snapshot.resolvedScheme}</code> → theme{' '}
        <code>{snapshot.themeName}</code>. The override switch sets{' '}
        <code>--journals-accent-override</code> on an ancestor — the top of the
        override → theme role → built-in default chain, so it beats every theme
        the controller applies.
      </Footnote>
    </div>
  );
}
