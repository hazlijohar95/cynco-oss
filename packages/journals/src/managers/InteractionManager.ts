export interface InteractionManagerOptions {
  /**
   * Fired when a row is clicked. The index is the value of the row's
   * `data-row-index` attribute; the owning component maps it back to data.
   */
  onRowSelect?(index: number): void;
  /** Fired when the hovered row changes; `null` when the pointer leaves. */
  onRowHover?(index: number | null): void;
}

// Row hover/selection wiring for Register sections. Uses event delegation on
// a single root element (the section inside the shadow root) instead of
// per-row listeners: virtualized rows are constantly created and destroyed,
// and delegation makes listener lifetime independent of row lifetime.
export class InteractionManager {
  private root: HTMLElement | undefined;
  private hoveredRow: HTMLElement | undefined;

  constructor(private options: InteractionManagerOptions = {}) {}

  setOptions(options: InteractionManagerOptions): void {
    this.options = options;
  }

  setup(root: HTMLElement): void {
    if (this.root === root) {
      return;
    }
    this.cleanUp();
    this.root = root;
    root.addEventListener('pointerover', this.handlePointerOver);
    root.addEventListener('pointerout', this.handlePointerOut);
    root.addEventListener('click', this.handleClick);
  }

  cleanUp(): void {
    if (this.root != null) {
      this.root.removeEventListener('pointerover', this.handlePointerOver);
      this.root.removeEventListener('pointerout', this.handlePointerOut);
      this.root.removeEventListener('click', this.handleClick);
    }
    this.root = undefined;
    this.hoveredRow = undefined;
  }

  private handlePointerOver = (event: Event): void => {
    const row = getRowFromEvent(event);
    if (row == null || row === this.hoveredRow) {
      return;
    }
    this.hoveredRow?.removeAttribute('data-hovered');
    row.setAttribute('data-hovered', '');
    this.hoveredRow = row;
    this.options.onRowHover?.(getRowIndex(row));
  };

  private handlePointerOut = (event: Event): void => {
    const row = getRowFromEvent(event);
    if (row == null || row !== this.hoveredRow) {
      return;
    }
    row.removeAttribute('data-hovered');
    this.hoveredRow = undefined;
    this.options.onRowHover?.(null);
  };

  private handleClick = (event: Event): void => {
    const row = getRowFromEvent(event);
    if (row == null) {
      return;
    }
    const index = getRowIndex(row);
    if (index != null) {
      this.options.onRowSelect?.(index);
    }
  };
}

// Events inside a shadow root have their target retargeted at the shadow
// boundary only for outside listeners; our listeners live inside, so
// closest() from the raw target resolves the row element directly.
function getRowFromEvent(event: Event): HTMLElement | undefined {
  const { target } = event;
  if (!(target instanceof Element)) {
    return undefined;
  }
  const row = target.closest('[data-row]');
  return row instanceof HTMLElement ? row : undefined;
}

function getRowIndex(row: HTMLElement): number | null {
  const raw = row.getAttribute('data-row-index');
  if (raw == null) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}
