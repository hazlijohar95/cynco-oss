// Cynco's mark: a bold, closed-terminal "C" split by a centered balance bar —
// the ledger zero-line every entry settles on, and the currency stroke of
// finance, nested in the initial. It stays unmistakably a C from 16px favicon
// up, and inherits the current text color so it themes automatically.
//
// `size` is the square glyph edge. `duotone` renders the balance bar at 40%
// opacity, echoing the debit-solid / credit-muted pairing the packages render;
// the default monotone reads cleanest in dense chrome. Pure SVG with no
// client hooks, so server components can render it without a client boundary.
export function CyncoMark({
  size = 20,
  duotone = false,
}: {
  size?: number;
  duotone?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10c3.28 0 6.19-1.58 8.01-4.02l-3.2-2.4A6 6 0 1 1 12 6c1.94 0 3.68.92 4.78 2.35l3.2-2.4A9.98 9.98 0 0 0 12 2Z"
      />
      <rect
        x="11"
        y="11"
        width="9"
        height="2"
        rx="1"
        fill="currentColor"
        opacity={duotone ? 0.4 : 1}
      />
    </svg>
  );
}
