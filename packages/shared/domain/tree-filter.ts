import { z } from 'zod';
import { nodeKindSchema } from './tree';

// P28 D10-D13: the tree's persisted filter is a set of exclusions, not a rule list. A path or
// kind absent from both arrays is visible — including one fetched for the first time after this
// was saved — and hiding a container never writes entries for what is beneath it (D13): the
// renderer never walks into a row it does not render.
export const treeVisibilitySchema = /*#__PURE__*/ z.object({
  hiddenKinds: /*#__PURE__*/ z.array(nodeKindSchema),
  /** Encoded node paths, relative to the connection — the same strings `TreeNode.path` and
   *  `rowKey()` already use. */
  hiddenPaths: /*#__PURE__*/ z.array(z.string()),
});
export type TreeVisibility = z.infer<typeof treeVisibilitySchema>;

export const EMPTY_VISIBILITY: TreeVisibility = { hiddenKinds: [], hiddenPaths: [] };
