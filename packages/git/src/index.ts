export type { GitCapabilities, RepoCapabilities } from "./capabilities.ts";
export { CapabilitiesCache, capabilitiesForVersion } from "./capabilities.ts";
export type {
  GitResolution,
  GitVersion,
  LocateGitOptions,
  RepoIdentityResolution,
  ResolvedGit,
} from "./discovery.ts";
export {
  MINIMUM_GIT_VERSION,
  compareVersions,
  locateGit,
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
export { GitCancelled, GitError, GitSpawnFailed, classifyGitError } from "./errors.ts";
export { NodeProcessRunner, ProcessSpawnError } from "./nodeProcessRunner.ts";
export type { NameStatusEntry, NumstatEntry } from "./parse/diffTree.ts";
export {
  nameStatusArgs,
  numstatArgs,
  parseNameStatusRecords,
  parseNumstatRecords,
} from "./parse/diffTree.ts";
export { LOG_FORMAT, logArgs, parseLogRecord, showMetadataArgs } from "./parse/log.ts";
export type { LogArgsOptions } from "./parse/log.ts";
export { mergeTreeArgs, parseMergeTreeOutput } from "./parse/mergeTree.ts";
export { REFS_FORMAT, REFS_RECORD_DELIMITER, parseRefRecord, refsArgs } from "./parse/refs.ts";
export { STASH_FORMAT, parseStashRecord, stashListArgs } from "./parse/stash.ts";
export { parseStatus, statusArgs } from "./parse/status.ts";
