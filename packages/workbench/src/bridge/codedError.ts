// Turns whatever a transport threw (a Wails RuntimeError, an HTTP error body) into one Error
// carrying ipcerr.Error's `code` and optional `details`. No Wails import: the mobile web app
// shares it.

export type CodedError = Error & { code?: string; details?: unknown };

// Wails delivers a bound method's error as a RuntimeError whose .message is ipcerr.Error's own
// JSON encoding and whose .cause is that same {code, message} as an object. Unwrapped once, here,
// so every consumer keeps reading `err.message` for display and `err.code` for branching.
export function toCodedError(err: unknown): CodedError {
  const e = err as { message?: string; cause?: unknown };
  const cause = e.cause as { code?: unknown; message?: unknown; details?: unknown } | undefined;
  let code = 'E_INTERNAL';
  let message = e.message ?? String(err);
  let details: unknown;
  if (cause && typeof cause === 'object' && typeof cause.code === 'string') {
    code = cause.code;
    message = typeof cause.message === 'string' ? cause.message : message;
    details = cause.details;
  } else {
    // Belt and braces: a Wails change that stops populating `cause` still leaves the same JSON
    // in `.message`, because ipcerr.Error.Error() is what CallError.Message is built from.
    try {
      const parsed = JSON.parse(message) as {
        code?: unknown;
        message?: unknown;
        details?: unknown;
      };
      if (typeof parsed.code === 'string') {
        code = parsed.code;
        if (typeof parsed.message === 'string') message = parsed.message;
        details = parsed.details;
      }
    } catch {
      // not our JSON — E_INTERNAL with the raw text is the right answer
    }
  }
  const out: CodedError = new Error(message);
  out.code = code;
  out.details = details;
  return out;
}
