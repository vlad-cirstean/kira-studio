// Wire types of HostViewService (apps/kira-space/internal/bridge/hostview.go) and the githost
// detail contract (internal/githost/detail.go).

interface HostInfo {
  id: string;
  label: string;
  changeRequest: string;
  changeRequestNoun: string;
  changeRequestShort: string;
  cli: string;
}

export interface ChangeRequestTarget {
  kind: 'changeRequest';
  url: string;
  provider: string;
  host: HostInfo;
  repo: string;
  number: number;
}

export type HostViewTarget = ChangeRequestTarget;

export interface HostViewOpen {
  key: string;
  opened: boolean;
}

interface HostStatus {
  kind: string;
  reason?: string;
  host?: string;
  account?: string;
  site?: string;
}

export type ReviewerState = 'approved' | 'changesRequested' | 'rejected' | 'commented' | 'pending';
export type CheckState = 'success' | 'failure' | 'error' | 'pending' | 'skipped' | 'neutral';
type ThreadKind = 'comment' | 'review' | 'code';

interface Person {
  login: string;
  name?: string;
}

interface Label {
  name: string;
  color?: string;
}

interface Reviewer {
  person: Person;
  team?: boolean;
  state: ReviewerState;
  required?: boolean;
}

export interface Check {
  name: string;
  state: CheckState;
  url?: string;
  detail?: string;
  required?: boolean;
}

interface Comment {
  id: string;
  author: Person;
  body: string;
  createdAt: number;
  updatedAt?: number;
  url?: string;
}

export interface Thread {
  id: string;
  kind: ThreadKind;
  reviewState?: ReviewerState;
  path?: string;
  line?: number;
  resolved?: boolean;
  outdated?: boolean;
  comments: Comment[];
  commentsTruncated?: boolean;
}

interface DiffStats {
  commits: number;
  files: number;
  additions: number;
  deletions: number;
}

type ChangeRequestState = 'open' | 'draft' | 'merged' | 'closed';

export interface ChangeRequestDetail {
  number: number;
  title: string;
  url: string;
  state: ChangeRequestState;
  headRef: string;
  baseRef: string;
  updatedAt: number;
  reviewDecision?: string;
  checksState?: string;
  author: Person;
  body: string;
  createdAt: number;
  closedAt?: number;
  labels: Label[];
  assignees: Person[];
  reviewers: Reviewer[];
  checks: Check[];
  checksTruncated?: boolean;
  threads: Thread[];
  threadsTruncated?: boolean;
  stats?: DiffStats;
  mergeable?: 'mergeable' | 'conflicting';
}

type HostViewResultKind = 'ok' | 'unavailable' | 'gone';

export interface HostViewChangeRequest {
  kind: HostViewResultKind;
  detail?: ChangeRequestDetail;
  status: HostStatus;
}
