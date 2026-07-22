// Local rehype plugin for the docs MDX pipeline. Turbopack requires loader
// options to be serializable, so next.config.ts references this file by
// absolute path (a string) instead of passing the function; @next/mdx's
// loader resolves and imports it at compile time.
//
// Three jobs, one tree walk each page:
//
// 1. Heading ids. Docs headings carry explicit ids so deep links survive
//    rewording — authored as a trailing `\{#id\}` marker (escaped braces,
//    since bare `{…}` is an MDX expression). The marker is stripped from
//    the rendered text and becomes the element id.
// 2. Table of contents. Every identified h2/h3 is collected (h3s nested
//    under their h2) and injected as `export const tableOfContents`, so the
//    sidebar reads build-time data instead of querying the DOM.
// 3. Fence meta. remark-rehype parks a fence's meta string (```ts
//    title="register.ts") on the code element's data; it is copied to a
//    `data-meta` attribute so the CodeBlock component can read it as a prop.

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4']);
const ID_MARKER = /\s*\{#([A-Za-z][\w-]*)\}\s*$/;

/** Depth-first walk over hast element nodes. */
function walk(node, visitor) {
  if (node.type === 'element') visitor(node);
  const children = node.children ?? [];
  for (const child of children) walk(child, visitor);
}

/** Concatenated text content of a hast node. */
function textOf(node) {
  if (node.type === 'text') return String(node.value);
  let text = '';
  for (const child of node.children ?? []) text += textOf(child);
  return text;
}

/**
 * Finds the heading's last text node (markers are authored at the end of
 * the heading line), extracts the `{#id}` marker, and strips it from the
 * rendered text. Returns the id or null.
 */
function extractHeadingId(heading) {
  for (let i = heading.children.length - 1; i >= 0; i -= 1) {
    const child = heading.children[i];
    if (child.type !== 'text') continue;
    const match = ID_MARKER.exec(child.value);
    if (match === null) return null;
    child.value = child.value.slice(0, match.index);
    if (child.value === '') heading.children.splice(i, 1);
    return match[1];
  }
  return null;
}

/** Minimal JSON-value → estree expression (strings, arrays, plain objects). */
function valueToEstree(value) {
  if (Array.isArray(value)) {
    return { type: 'ArrayExpression', elements: value.map(valueToEstree) };
  }
  if (value !== null && typeof value === 'object') {
    return {
      type: 'ObjectExpression',
      properties: Object.entries(value).map(([key, entry]) => ({
        type: 'Property',
        key: { type: 'Literal', value: key },
        value: valueToEstree(entry),
        kind: 'init',
        method: false,
        shorthand: false,
        computed: false,
      })),
    };
  }
  return { type: 'Literal', value };
}

/** `export const tableOfContents = <toc>` as an MDX ESM node. */
function tocExport(toc) {
  return {
    type: 'mdxjsEsm',
    value: '',
    data: {
      estree: {
        type: 'Program',
        sourceType: 'module',
        body: [
          {
            type: 'ExportNamedDeclaration',
            specifiers: [],
            source: null,
            declaration: {
              type: 'VariableDeclaration',
              kind: 'const',
              declarations: [
                {
                  type: 'VariableDeclarator',
                  id: { type: 'Identifier', name: 'tableOfContents' },
                  init: valueToEstree(toc),
                },
              ],
            },
          },
        ],
      },
    },
  };
}

export default function rehypeDocs() {
  return (tree) => {
    const toc = [];

    walk(tree, (node) => {
      if (HEADING_TAGS.has(node.tagName)) {
        const id = extractHeadingId(node);
        if (id === null) return;
        node.properties = { ...node.properties, id };
        const text = textOf(node).trim();
        if (node.tagName === 'h2') {
          toc.push({ id, text, children: [] });
        } else if (node.tagName === 'h3' && toc.length > 0) {
          toc[toc.length - 1].children.push({ id, text, children: [] });
        }
        return;
      }

      if (node.tagName === 'code' && typeof node.data?.meta === 'string') {
        node.properties = { ...node.properties, 'data-meta': node.data.meta };
      }
    });

    tree.children.unshift(tocExport(toc));
  };
}
