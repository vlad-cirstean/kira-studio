// P12 D7: the package's real public surface — exactly what the app and its tests use. The
// eleven-plus file-local exports F22 found (and the ones this move surfaced fresh: toBuilderMethod,
// SplitUrl, DynamicName, the curl-flags internals, the raw/tokenize warning-kind internals, the
// dynamic generator internals) stay exported from their own file where a same-package importer
// still needs them, but do not appear here — a package's public surface is not everything it
// happens to export internally.

export { WELL_KNOWN_REQUEST_METADATA } from './grpc/metadata';
export { fromSavedGrpcRequest, isGrpcDirty, toSavedGrpcRequest } from './grpc/saved';
export {
  BODY_MODE_OPTIONS,
  bodyBadgeLabel,
  CODE_LANGUAGE_OPTIONS,
  contentTypeCaption,
  defaultContentTypeFor,
  editorLanguageForCode,
  type HttpBodySelection,
  hasRequestBody,
  userContentTypeHeader,
} from './http/body';
export { type CurlRequest, toCurl } from './http/curl/generate';
export { type ParsedCurl, parseCurl } from './http/curl/parse';
export { type CurlWarning, type CurlWarningKind, tokenize } from './http/curl/tokenize';
export {
  type EnvDiff,
  type EnvDiffAdd,
  type EnvDiffRemove,
  type EnvDiffUpdate,
  type EnvEntry,
  type EnvParseError,
  type EnvParseResult,
  type EnvRow,
  parseEnv,
  reconcileEnv,
  SECRET_MARKER,
  serializeEnv,
} from './http/dotenv';
export {
  ALIAS_TO_FAKE,
  DYNAMIC_NAMES,
  type DynamicName,
  FAKE_NAMES,
  type FakeName,
  isDynamicName,
  isFakeName,
  loadDynamicGenerator,
} from './http/dynamic/catalog';
export { goQueryEscape, goQueryEscapeLiteral } from './http/escape';
export { type HeaderCompletion, WELL_KNOWN_REQUEST_HEADERS } from './http/headers';
export {
  canEditAsRaw,
  generateRawRequest,
  generateRawRequestFromStored,
} from './http/raw/generate';
export { type ParsedRawRequest, parseRawRequest, type RawWarning } from './http/raw/parse';
export { fromSavedRequest, isDirty, toBuilderMethod, toSavedRequest } from './http/saved';
export {
  classifyReference,
  isDynamicReference,
  type ParsedReference,
  parseReference,
  type Reference,
  type ReferenceKind,
  resolve,
  type SubstitutionResult,
  sanitizeUrlSpan,
  splitTemplateSpans,
  type TemplateSpan,
} from './http/substitute';
export {
  applySecretValues,
  type ResolvedRequest,
  substituteBody,
} from './http/substituteRequest';
export {
  applyPipeline,
  isTransformName,
  TRANSFORM_NAMES,
  type TransformName,
} from './http/transforms';
export {
  buildQuery,
  httpRequestTitle,
  parseQuery,
  type QueryPair,
  type SplitUrl,
  splitUrl,
} from './http/url';
