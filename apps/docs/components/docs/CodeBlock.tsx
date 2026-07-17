export interface CodeBlockProps {
  /** Raw source text; rendered verbatim in a mono block. */
  code: string;
}

// Plain, dependency-free code block: prose.css gives `pre` the panel
// treatment (border, radius, subtle tint) and resets inline-code metrics.
export function CodeBlock({ code }: CodeBlockProps) {
  return (
    <pre>
      <code>{code.trim()}</code>
    </pre>
  );
}
