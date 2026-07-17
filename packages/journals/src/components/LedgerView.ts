import {
  DEFAULT_HEADER_HEIGHT,
  DEFAULT_LINE_HEIGHT,
  JOURNALS_TAG_NAME,
} from '../constants';
import type { RegisterDensity, RegisterRowData } from '../types';
import { Register } from './Register';
import { Virtualizer } from './Virtualizer';
import { JournalsContainerLoaded } from './web-components';

export interface LedgerSection {
  /** Canonical colon-delimited account path for this register section. */
  account: string;
  rows: readonly RegisterRowData[];
}

export interface LedgerViewOptions {
  /** Row density shared by every section. Default `comfortable`. */
  density?: RegisterDensity;
  /** See {@link Register} — must match `--journals-line-height`. Default 20. */
  lineHeight?: number;
  /** See {@link Register} — must match the header CSS min-height. Default 44. */
  headerHeight?: number;
  /** Extra rows rendered above/below the window per section. Default 10. */
  overscanRows?: number;
  /** Fired when any row is clicked, with the owning account path. */
  onRowSelect?(account: string, row: RegisterRowData, index: number): void;
}

export interface LedgerViewRenderProps {
  sections: readonly LedgerSection[];
  /** Existing `<journals-container>` to render into; created when omitted. */
  container?: HTMLElement;
  /** Parent to append the container to when it is not already mounted. */
  parentNode?: HTMLElement;
}

// The CodeView analog, v1 scope: one scroll container stacking a Register
// per account with sticky section headers, all driven by a single shared
// Virtualizer. Section offsets are estimated from row counts (fixed row
// heights make estimates exact), so no layout reads are needed to place
// windows, and scrollTop is preserved across data updates.
export class LedgerView {
  static LoadedCustomComponent: boolean = JournalsContainerLoaded;

  private container: HTMLElement | undefined;
  private scroller: HTMLElement | undefined;
  private content: HTMLElement | undefined;
  private registers: Register[] = [];
  private virtualizer: Virtualizer | undefined;
  private sections: readonly LedgerSection[] = [];
  /**
   * Estimated pixel offset of each section top within the scroll content:
   * offsets[i] = Σ over j<i of (headerHeight + rowCount(j) * rowHeight).
   * Precomputed once per data update so per-frame window math is O(1) per
   * section instead of re-summing (no accidental O(n²)).
   */
  private sectionOffsets: number[] = [];

  constructor(
    public options: LedgerViewOptions = {},
    private isContainerManaged = false
  ) {}

  setOptions(options: LedgerViewOptions | undefined): void {
    if (options == null) return;
    this.options = options;
  }

  render({ sections, container, parentNode }: LedgerViewRenderProps): void {
    container =
      container ?? this.container ?? document.createElement(JOURNALS_TAG_NAME);
    if (parentNode != null && container.parentNode !== parentNode) {
      parentNode.appendChild(container);
    }
    this.container = container;
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    if (this.scroller == null || this.scroller.parentNode !== shadowRoot) {
      const scroller = document.createElement('div');
      scroller.setAttribute('data-scroller', '');
      scroller.setAttribute('data-ledger-view', '');
      const content = document.createElement('div');
      content.setAttribute('data-journals-content', '');
      scroller.appendChild(content);
      shadowRoot.appendChild(scroller);
      this.scroller = scroller;
      this.content = content;
      this.virtualizer = new Virtualizer();
      this.virtualizer.setup(scroller, content);
    }
    this.setSections(sections);
  }

  // Replaces section data. Simple but correct scroll anchoring: capture
  // scrollTop before tearing down sections and restore it after — the
  // browser clamps it if the new content is shorter.
  setSections(sections: readonly LedgerSection[]): void {
    const { scroller, content, virtualizer } = this;
    if (scroller == null || content == null || virtualizer == null) {
      return;
    }
    const previousScrollTop = scroller.scrollTop;
    for (const register of this.registers) {
      register.cleanUp();
    }
    this.registers = [];
    content.replaceChildren();

    this.sections = sections;
    this.sectionOffsets = this.computeSectionOffsets(sections);

    for (const [index, section] of sections.entries()) {
      const sectionElement = document.createElement('section');
      content.appendChild(sectionElement);
      const register = new Register(
        {
          account: section.account,
          density: this.options.density,
          lineHeight: this.options.lineHeight,
          headerHeight: this.options.headerHeight,
          overscanRows: this.options.overscanRows,
          getOffsetTop: () => this.sectionOffsets[index],
          onRowSelect: (row, rowIndex) => {
            this.handleRowSelect(index, row, rowIndex);
          },
        },
        // Sections live inside our content element; Register must not remove
        // our nodes on cleanUp.
        true
      );
      register.mountSection(sectionElement, virtualizer);
      register.setRows(section.rows);
      this.registers.push(register);
    }

    if (previousScrollTop > 0) {
      scroller.scrollTop = previousScrollTop;
    }
    virtualizer.instanceChanged();
  }

  getRegisters(): readonly Register[] {
    return this.registers;
  }

  cleanUp(): void {
    for (const register of this.registers) {
      register.cleanUp();
    }
    this.registers = [];
    this.virtualizer?.cleanUp();
    this.virtualizer = undefined;
    if (!this.isContainerManaged) {
      this.container?.remove();
    }
    this.container = undefined;
    this.scroller = undefined;
    this.content = undefined;
    this.sections = [];
    this.sectionOffsets = [];
  }

  private computeSectionOffsets(sections: readonly LedgerSection[]): number[] {
    const {
      density = 'comfortable',
      lineHeight = DEFAULT_LINE_HEIGHT,
      headerHeight = DEFAULT_HEADER_HEIGHT,
    } = this.options;
    const rowHeight = density === 'compact' ? lineHeight : lineHeight * 2;
    const offsets: number[] = [];
    let offset = 0;
    for (const section of sections) {
      offsets.push(offset);
      offset += headerHeight + section.rows.length * rowHeight;
    }
    return offsets;
  }

  // Selecting a row in one section clears selection in every other section:
  // the ledger view models a single focused row across the whole document.
  private handleRowSelect(
    sectionIndex: number,
    row: RegisterRowData,
    rowIndex: number
  ): void {
    for (const [index, register] of this.registers.entries()) {
      if (index !== sectionIndex) {
        register.setSelectedRow(null);
      }
    }
    const section = this.sections[sectionIndex];
    if (section != null) {
      this.options.onRowSelect?.(section.account, row, rowIndex);
    }
  }
}
