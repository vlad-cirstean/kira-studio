# P168 findings routed from Stream C (Part 10)

Fixes need files owned by another Part. Stream C did not edit them.

## From Part 10 F6 (Part 6, Stream A: `apps/kira-studio/internal/bridge/collections.go`)

- Id: P168 Part 10 F6, low.
- File: `apps/kira-studio/internal/bridge/collections.go`, `GetRequest` and `GetGrpcRequest`.
- Issue: both wrap every failure in `ipcerr.InternalResult`. Renderer `apiSavedRequestQueryOptions` and
  `apiSavedGrpcRequestQueryOptions` (`frontend/src/api/state/apiQueries.ts`) cannot tell not-found
  from a transient bridge/DB error, so they map every error to `null` (confirmed orphan) and cache it
  with `staleTime: Infinity`. `CollectionsTree.vue` `onOpen` then opens a default empty request bound
  to a row that has content.
- Fix: return a typed not-found code (for example `ipcerr.NotFoundResult`) when the row does not exist.
  Then Stream C renderer side returns `null` only for that code and rethrows other errors, so the query
  lands in error state and retries on next read. Renderer change waits on this code.

## From Part 10 F18 (Go HTTP bridge, Part 6 or owner of `HttpDeleteCookie`)

- Id: P168 Part 10 F18, low (Go half only; renderer half fixed).
- Issue: `control.httpDeleteCookie(url, name)` deletes by name only. Two cookies with one name on
  different paths or domains are indistinguishable, so Remove is ambiguous. The renderer now keys rows
  by name, domain, path and index but still sends only the name.
- Fix: accept domain and path in `HttpDeleteCookie`, delete the exact cookie. Then pass `c.domain` and
  `c.path` from `CookiesPane.vue` `onRemove` through `useCookiesStore.deleteCookie`.
