/**
 * Minimal element stand-in for applyThemeToElement tests. The function's
 * element contract is deliberately narrow — only `style.setProperty` /
 * `style.removeProperty` — so a Map-backed fake covers it exactly and the
 * suite stays jsdom-free like the rest of the theme-layer packages.
 */

export interface FakeElementHandle {
  element: HTMLElement;
  /** Inline style declarations by property name. */
  styles: Map<string, string>;
}

export function makeFakeElement(): FakeElementHandle {
  const styles = new Map<string, string>();
  const element = {
    style: {
      setProperty(property: string, value: string): void {
        styles.set(property, value);
      },
      removeProperty(property: string): void {
        styles.delete(property);
      },
      getPropertyValue(property: string): string {
        return styles.get(property) ?? '';
      },
    },
  } as unknown as HTMLElement;
  return { element, styles };
}
