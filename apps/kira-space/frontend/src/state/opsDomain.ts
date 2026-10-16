import { opLogRecordSchema } from '@shared/domain/ops';
import { z } from 'zod';

// P132 Part 2: Kira Space's git op record — the shared op-log base plus the repo, origin and
// cancellability the Go ring (internal/oplog) adds. Type only: the bridge trusts the wire shape,
// like every sibling method.
const spaceOpRecordSchema = /*#__PURE__*/ opLogRecordSchema.extend({
  repoRoot: z.string(),
  repoName: z.string(),
  source: z.string(),
  cancellable: z.boolean(),
});
export type SpaceOpRecord = z.infer<typeof spaceOpRecordSchema>;
