import type { IconName } from './icons';

export type AppId = 'studio' | 'space';

export interface ShotDef {
  readonly id: string;
  readonly app: AppId;
  readonly title: string;
  readonly alt: string;
  readonly caption: string;
  readonly icon: IconName;
  readonly label: string;
}

// Files: screenshots/framed/<id>.png and screenshots/<id>-detail.png (bun run screenshots).
export const SHOTS: readonly ShotDef[] = [
  {
    id: 'studio-data-grid',
    app: 'studio',
    title: 'Data grid',
    alt: 'Kira Studio data grid showing an orders table with one row selected.',
    caption: 'Data grid. Filter, sort, edit and commit rows.',
    icon: 'table',
    label: 'Data grid',
  },
  {
    id: 'studio-sql-console',
    app: 'studio',
    title: 'SQL console',
    alt: 'Kira Studio SQL console with a join query and its result grid.',
    caption: 'SQL console. Run a statement or the whole script.',
    icon: 'code',
    label: 'SQL console',
  },
  {
    id: 'studio-api',
    app: 'studio',
    title: 'Api mode',
    alt: 'Kira Studio Api mode showing an HTTP request and its JSON response.',
    caption: 'Api mode. HTTP and gRPC requests with a JSON response.',
    icon: 'globe',
    label: 'Api mode',
  },
  {
    id: 'space-git-graph',
    app: 'space',
    title: 'Git graph',
    alt: 'Kira Space commit graph with branches, tags and the commit detail pane open.',
    caption: 'Git graph. Branches, tags and commit detail.',
    icon: 'git-branch',
    label: 'Git graph',
  },
  {
    id: 'space-agents-board',
    app: 'space',
    title: 'Agents board',
    alt: 'Kira Space agents board with tasks across stages and live runs.',
    caption: 'Agents board. Tasks across stages, runs live.',
    icon: 'robot',
    label: 'Agents board',
  },
  {
    id: 'space-memory',
    app: 'space',
    title: 'Memory',
    alt: 'Kira Space memory list showing each fact with its origin and scope.',
    caption: 'Memory. Every fact shows origin and scope.',
    icon: 'lightbulb',
    label: 'Memory',
  },
];
