import type { FragmentElement } from "../shared/fragment-elements.ts";

const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export const isHtmlElement = (element: Element): boolean => element.namespaceURI === HTML_NAMESPACE;

/** Reject version-skewed or overlapping runtime markers instead of guessing their semantics. */
export const hasOnlyZoganAttributes = (element: Element, allowed: ReadonlySet<string>): boolean =>
  [...element.attributes].every((attribute) => {
    const name = attribute.name.toLowerCase();
    return !name.startsWith("data-zogan-") || allowed.has(name);
  });

/** Collect matching root elements and descendants without scanning outside the supplied nodes. */
export const collect = (nodes: readonly Node[], selector: string): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.matches(selector)) found.push(node);
    found.push(...node.querySelectorAll(selector));
  }
  return found;
};

type ContextWrapper = { readonly open: string; readonly close: string; readonly depth: number };

const CONTEXT_WRAPPERS: Partial<Record<FragmentElement, ContextWrapper>> = {
  caption: { open: "<table><caption>", close: "</caption></table>", depth: 2 },
  colgroup: { open: "<table><colgroup>", close: "</colgroup></table>", depth: 2 },
  optgroup: { open: "<select><optgroup>", close: "</optgroup></select>", depth: 2 },
  select: { open: "<select>", close: "</select>", depth: 1 },
  table: { open: "<table>", close: "</table>", depth: 1 },
  tbody: { open: "<table><tbody>", close: "</tbody></table>", depth: 2 },
  td: { open: "<table><tbody><tr><td>", close: "</td></tr></tbody></table>", depth: 4 },
  tfoot: { open: "<table><tfoot>", close: "</tfoot></table>", depth: 2 },
  th: { open: "<table><tbody><tr><th>", close: "</th></tr></tbody></table>", depth: 4 },
  thead: { open: "<table><thead>", close: "</thead></table>", depth: 2 },
  tr: { open: "<table><tbody><tr>", close: "</tr></tbody></table>", depth: 3 },
};

/** Parse HTML as children of the receiving element so table rows and options are preserved. */
export const parseHTMLFragment = (html: string, contextTag?: FragmentElement): Node[] => {
  const template = document.createElement("template");
  const wrapper = contextTag === undefined ? undefined : CONTEXT_WRAPPERS[contextTag];

  if (wrapper === undefined) {
    template.innerHTML = html;
    return [...template.content.childNodes];
  }

  template.innerHTML = `${wrapper.open}${html}${wrapper.close}`;
  let node: Node = template.content;
  for (let depth = 0; depth < wrapper.depth; depth += 1) {
    const child = [...node.childNodes].find((candidate) => isElement(candidate));
    if (child === undefined) return [];
    node = child;
  }
  return [...node.childNodes];
};
