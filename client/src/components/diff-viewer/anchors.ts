/* DOM anchors the diff viewer stamps on its output, and the lookups a caller
   uses to scroll to them. The viewer owns both halves, so a route that scrolls
   to a file or line (Files changed, from the PR Brief) never spells an
   attribute name itself. */

/** On each file card: the file's path. */
export const DIFF_FILE_ATTR = "data-diff-file";

/** On each line row that exists in the new file: its new-side line number. */
export const NEW_LINE_ATTR = "data-new-line";

/** The rendered card for `path` under `root`. Attributes are compared, not
    interpolated into a selector, so a path never needs CSS escaping. */
export function findFileCard(root: ParentNode | null | undefined, path: string): Element | null {
  for (const el of root?.querySelectorAll(`[${DIFF_FILE_ATTR}]`) ?? []) {
    if (el.getAttribute(DIFF_FILE_ATTR) === path) return el;
  }
  return null;
}

/** The row for new-side `line` inside a file card; null when that line is not shown. */
export function findNewLine(card: ParentNode, line: number): Element | null {
  return card.querySelector(`[${NEW_LINE_ATTR}="${line}"]`);
}
