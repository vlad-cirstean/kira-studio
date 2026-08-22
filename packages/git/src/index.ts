export type { GitCapabilities, RepoCapabilities } from "./capabilities.ts";
export { CapabilitiesCache, capabilitiesForVersion } from "./capabilities.ts";
export type { CatFileResult, CatFileSessionOptions } from "./catFile.ts";
export { openCatFileSession } from "./catFile.ts";
export type {
  GitResolution,
  GitVersion,
  LocateGitOptions,
  RepoIdentityResolution,
  ResolvedGit,
} from "./discovery.ts";
export {
  compareVersions,
  locateGit,
  MINIMUM_GIT_VERSION,
  meetsMinimumVersion,
  parseGitVersion,
  resolveRepoIdentity,
} from "./discovery.ts";
export type {
  CatFileSession,
  Disposable,
  GitDriver,
  GitRead,
  GitWriteResult,
  OpenGitDriverOptions,
  ReadOptions,
  WriteOptions,
} from "./driver.ts";
export { buildGitArgv, buildGitEnv, openGitDriver } from "./driver.ts";
export type { GitErrorKind } from "./errors.ts";
export { classifyGitError, GitCancelled, GitError, GitSpawnFailed } from "./errors.ts";
export type { LogSession, LogSessionOptions, PageOutcome, ReadPageOptions } from "./logSession.ts";
export { openLogSession } from "./logSession.ts";
export { NodeProcessRunner, ProcessSpawnError } from "./nodeProcessRunner.ts";
export type { NameStatusEntry, NumstatEntry } from "./parse/diffTree.ts";
export {
  nameStatusArgs,
  numstatArgs,
  parseNameStatusRecords,
  parseNumstatRecords,
} from "./parse/diffTree.ts";
export type { LogArgsOptions } from "./parse/log.ts";
export {
  LOG_FORMAT,
  logArgs,
  logSessionArgs,
  logSessionSkipArgs,
  parseLogRecord,
  revSetArgs,
  showMetadataArgs,
} from "./parse/log.ts";
export { mergeTreeArgs, parseMergeTreeOutput } from "./parse/mergeTree.ts";
export { parseRefRecord, REFS_FORMAT, REFS_RECORD_DELIMITER, refsArgs } from "./parse/refs.ts";
export { parseStashRecord, STASH_FORMAT, stashListArgs } from "./parse/stash.ts";
export { parseStatus, statusArgs } from "./parse/status.ts";
export type { CommitDetailOptions, LogQueryOptions } from "./queries.ts";
export {
  commitDetail,
  countCommits,
  log,
  predictMerge,
  refs,
  stashList,
  status,
} from "./queries.ts";
