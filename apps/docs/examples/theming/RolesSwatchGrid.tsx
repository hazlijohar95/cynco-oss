import { dark, light, type Roles } from '@cynco/theme';

// Every role token @cynco/theme ships, rendered as real swatches — the
// values are read from the exported `light` / `dark` role objects at build
// time, never copied by hand, so the grid can't drift from the package.
// Pure server component: the whole grid is static HTML in the export.

interface SwatchRow {
  token: string;
  lightValue: string;
  darkValue: string;
}

interface SwatchGroup {
  group: string;
  rows: SwatchRow[];
}

// Flattens the two role sets in parallel. The Roles type guarantees both
// sets share one shape, so iterating `light` and indexing `dark` is total.
function buildGroups(lightRoles: Roles, darkRoles: Roles): SwatchGroup[] {
  const groups: SwatchGroup[] = [];
  for (const [group, tokens] of Object.entries(lightRoles)) {
    const darkTokens = darkRoles[group as keyof Roles] as Record<
      string,
      string
    >;
    groups.push({
      group,
      rows: Object.entries(tokens as Record<string, string>).map(
        ([token, lightValue]) => ({
          token,
          lightValue,
          darkValue: darkTokens[token],
        })
      ),
    });
  }
  return groups;
}

function Swatch({
  value,
  scheme,
}: {
  value: string;
  scheme: 'light' | 'dark';
}) {
  return (
    <span
      className="flex items-center gap-1.5"
      // Each chip sits on its own scheme's editor background so a
      // near-white light token and a near-black dark token both stay
      // visible regardless of the page theme.
      style={{
        backgroundColor: scheme === 'light' ? light.bg.editor : dark.bg.editor,
      }}
    >
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 border border-black/15"
        style={{ backgroundColor: value }}
      />
      <code
        className="!bg-transparent text-[11px]"
        style={{ color: scheme === 'light' ? light.fg.fg3 : dark.fg.fg3 }}
      >
        {value}
      </code>
    </span>
  );
}

export function RolesSwatchGrid() {
  const groups = buildGroups(light, dark);
  return (
    <div className="demo-container grid gap-x-8 gap-y-5 p-4 font-mono sm:grid-cols-2 lg:grid-cols-3">
      {groups.map(({ group, rows }) => (
        <div key={group} className="min-w-0">
          <div className="text-muted-foreground mb-1.5 flex items-baseline justify-between text-[11px] tracking-wide uppercase">
            <span>{group}</span>
            <span className="normal-case">light · dark</span>
          </div>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {rows.map(({ token, lightValue, darkValue }) => (
              <li
                key={token}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 text-[12px]"
              >
                <span className="truncate">{token}</span>
                <Swatch value={lightValue} scheme="light" />
                <Swatch value={darkValue} scheme="dark" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
