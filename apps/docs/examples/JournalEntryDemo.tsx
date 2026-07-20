'use client';

import { type ColorScheme, journalsThemeVariables } from '@cynco/journals';
import { JournalEntry } from '@cynco/journals/react';
import { dark, darkSoft, light, lightSoft, type Roles } from '@cynco/theme';
import { Check, ChevronDown, Hash, Monitor, Moon, Sun } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';

import { PAYROLL_ENTRY } from './entries';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SwitchPill } from '@/components/ui/switch-pill';

type LightThemeName = 'cynco-light' | 'cynco-light-soft';
type DarkThemeName = 'cynco-dark' | 'cynco-dark-soft';

const LIGHT_THEMES: Record<LightThemeName, Roles> = {
  'cynco-light': light,
  'cynco-light-soft': lightSoft,
};

const DARK_THEMES: Record<DarkThemeName, Roles> = {
  'cynco-dark': dark,
  'cynco-dark-soft': darkSoft,
};

// Zips the light and dark role palettes into one variable set where every
// `--journals-theme-*` value is a `light-dark()` pair, so the component's
// colorScheme pin (or the page theme, on `system`) picks the side — exactly
// the mechanism the package's built-in defaults use.
function mergedThemeVariables(
  lightRoles: Roles,
  darkRoles: Roles
): Record<string, string> {
  const lightVariables = journalsThemeVariables(lightRoles);
  const darkVariables = journalsThemeVariables(darkRoles);
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(lightVariables)) {
    merged[name] = `light-dark(${value}, ${darkVariables[name]})`;
  }
  return merged;
}

export interface JournalEntryDemoProps {
  /** Shadow-root HTML from `preloadJournalEntryHTML` (line numbers on). */
  ssrHTML: string;
}

// Interactive entry card: theme pickers choose the light/dark role palettes
// (Default or Soft), the segmented control pins the resolved mode, and the
// switch pill toggles the posting-number gutter.
export function JournalEntryDemo({ ssrHTML }: JournalEntryDemoProps) {
  const [lightTheme, setLightTheme] = useState<LightThemeName>('cynco-light');
  const [darkTheme, setDarkTheme] = useState<DarkThemeName>('cynco-dark');
  const [colorScheme, setColorScheme] = useState<ColorScheme>('system');
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  const themeStyle = useMemo<CSSProperties>(
    () =>
      mergedThemeVariables(
        LIGHT_THEMES[lightTheme],
        DARK_THEMES[darkTheme]
      ) as CSSProperties,
    [lightTheme, darkTheme]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-full gap-3 md:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="min-w-[180px] flex-1 justify-start"
              >
                <Sun size={16} />
                {lightTheme}
                <ChevronDown
                  size={14}
                  className="text-muted-foreground ml-auto"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(Object.keys(LIGHT_THEMES) as LightThemeName[]).map((name) => (
                <DropdownMenuItem
                  key={name}
                  selected={lightTheme === name}
                  onClick={() => {
                    setLightTheme(name);
                    setColorScheme('light');
                  }}
                >
                  {name}
                  {lightTheme === name && (
                    <Check size={14} className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="min-w-[180px] flex-1 justify-start"
              >
                <Moon size={16} />
                {darkTheme}
                <ChevronDown
                  size={14}
                  className="text-muted-foreground ml-auto"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(Object.keys(DARK_THEMES) as DarkThemeName[]).map((name) => (
                <DropdownMenuItem
                  key={name}
                  selected={darkTheme === name}
                  onClick={() => {
                    setDarkTheme(name);
                    setColorScheme('dark');
                  }}
                >
                  {name}
                  {darkTheme === name && (
                    <Check size={14} className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ButtonGroup
          value={colorScheme}
          aria-label="Color scheme"
          onValueChange={setColorScheme}
        >
          <ButtonGroupItem value="system">
            <Monitor size={16} />
            Auto
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

        <SwitchPill
          icon={<Hash size={16} />}
          label="Line numbers"
          checked={showLineNumbers}
          onCheckedChange={setShowLineNumbers}
        />
      </div>

      <div className="demo-container" style={themeStyle}>
        <JournalEntry
          entry={PAYROLL_ENTRY}
          options={{ showLineNumbers }}
          colorScheme={colorScheme}
          ssrHTML={ssrHTML}
        />
      </div>
    </div>
  );
}
