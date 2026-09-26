/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract, plus
   the line-rendering vocabulary (the `Line` shape and its add/del row styles)
   so other surfaces can render a diff that looks like this one — the skill
   version history does. Parsing stays private: `parsePatch` reads git patches,
   which is not where every diff comes from. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi, DiffFindingApi } from "./comments";
export type { Line } from "./helpers";
export { lineRowFor, lineSignFor } from "./styles";
