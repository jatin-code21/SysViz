/**
 * Wraps each `## heading` and the content that follows it into
 * <section class="concept-section"> so every section renders as its own
 * panel (numbered via CSS counters) without authors writing any markup.
 *
 * Runs on the root of the document only; ESM nodes (imports in MDX) and
 * content before the first h2 are left at the root untouched.
 */
export default function rehypeSections() {
  return (tree) => {
    const out = [];
    let current = null;

    for (const node of tree.children) {
      if (node.type === 'mdxjsEsm') {
        out.push(node);
        continue;
      }
      if (node.type === 'element' && node.tagName === 'h2') {
        current = {
          type: 'element',
          tagName: 'section',
          properties: { className: ['concept-section'] },
          children: [node],
        };
        out.push(current);
        continue;
      }
      if (current) {
        current.children.push(node);
      } else {
        out.push(node);
      }
    }

    tree.children = out;
  };
}
