import type { AppId } from './shots';

export interface AppContent {
  readonly id: AppId;
  readonly name: string;
  readonly summary: string;
  readonly features: readonly string[];
}

// Facts come only from README.md and apps/kira-space/README.md.
export const SITE = {
  title: 'Kira Studio and Kira Space',
  tagline: 'Two native macOS apps. Databases and APIs. Git and coding agents.',
  availability: 'Free and open source. macOS 14+ on Apple Silicon.',
  description:
    'Kira Studio is a database and API client. Kira Space is a git client with coding agents. Native macOS, free and open source.',
} as const;

export const APPS: readonly AppContent[] = [
  {
    id: 'studio',
    name: 'Kira Studio',
    summary: 'Database client for ten engines. HTTP and gRPC client. One button switches modes.',
    features: [
      'Ten engines: PostgreSQL, MariaDB, MySQL, SQLite, ClickHouse, MongoDB, Redis, Kafka, SQS, S3.',
      'Data grid: virtualized, server-side filter and sort, staged SQL edits.',
      'SQL console: run a statement or all, saved queries, EXPLAIN plans.',
      'Api mode: HTTP and gRPC requests, collections, environments, curl import.',
      'Automations: scripts and smart scripts run by headless Claude Code.',
      'Docker: containers, images, volumes, networks, logs and exec terminals.',
      'Database MCP server: local, off by default, per-connection permissions.',
      'Credentials stay encrypted in the macOS Keychain.',
    ],
  },
  {
    id: 'space',
    name: 'Kira Space',
    summary: 'Git client and code workspace with coding agents, memory and a terminal.',
    features: [
      'Git graph: virtualized commit log, detail pane, diffs, search and branch review.',
      'Code workspace: file tree, Monaco viewer, diffs, repository search, inline blame.',
      'Agents: task planner with workflows, runs and interactive Claude Code sessions.',
      'Memory: MCP server for Claude Code with keyword and semantic search.',
      'Terminal and automations: scripts with run history, cron schedules.',
      'Phone view: serves the agents board to a phone on your home network.',
    ],
  },
];

export const INSTALL = {
  command: (app: AppId) =>
    `curl -fsSL https://raw.githubusercontent.com/vlad-cirstean/kira-studio/main/scripts/install.sh | sh -s -- --app=${app}`,
  steps:
    'Run the command in Terminal. It installs a fresh copy or replaces an older one, then opens the app.',
  note: 'Both apps are beta. Builds are ad-hoc signed, not notarized. The first launch after an update may ask to use confidential information in the Keychain. Choose Always Allow once for that build.',
  source: 'Build from source: see the README on GitHub.',
} as const;
