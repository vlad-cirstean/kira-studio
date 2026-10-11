import type { Exemption } from './allowlist';

/** Permanent check-copy exemptions: text the guard flags that is not user-facing wording. */
export const EXEMPTIONS: readonly Exemption[] = [
  {
    rule: 'U67',
    path: 'packages/shared/protocol/frame.ts',
    reason: 'protocol decode diagnostic, same class as backend error text (P266)',
  },
  {
    rule: 'U67',
    path: 'packages/theme/src/components/ui/button/index.ts',
    reason: '`title` is a button variant name, not text',
  },
  {
    rule: 'U67',
    path: 'apps/kira-studio/frontend/src/fonts.ts',
    reason: 'font family names (system and installed typefaces are proper names, not wording)',
  },
  {
    rule: 'U67',
    path: 'apps/kira-studio/frontend/src/views/console/completion.ts',
    reason: 'Redis command syntax hints (command grammar, not wording)',
  },
  {
    rule: 'U67',
    path: 'apps/kira-studio/frontend/src/views/grpcrequest/GrpcMetadataTable.vue',
    reason: 'HTTP auth scheme tokens inserted verbatim (protocol vocabulary, not wording)',
  },
  {
    rule: 'U67',
    path: 'apps/kira-studio/frontend/src/views/shared/document/ejson.ts',
    reason: 'EJSON shell-literal syntax (ObjectId(...), ISODate(...)), not wording',
  },
  {
    rule: 'U64',
    path: 'apps/kira-space/frontend/src/ade/v2/AdeActivityIcon.vue',
    reason: '`z` is the waiting-on-monitor glyph, not text',
  },
  {
    rule: 'U64',
    path: 'packages/workbench/src/automations/run/RunPreview.vue',
    reason: '`--tools` and `--allowedTools` are claude CLI flag names, shown as the command line',
  },
  {
    rule: 'U64',
    path: 'packages/workbench/src/automations/smart/ToolsField.vue',
    reason: '`--allowedTools` is a claude CLI flag name, shown as the command line',
  },
];
