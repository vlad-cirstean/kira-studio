const SHORT_SHA_LENGTH = 7;

/** The 7-character abbreviation shown for a commit id everywhere in the UI. */
export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}
