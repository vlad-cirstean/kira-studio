# P232 findings, Stream A (API: httpflow, grpcflow, apiflow, e2e-real)

## A-1 Describe hangs 20 s against a silent server
- Test: grpcflow `TestDescribeSilentServer` (skipped "P232 finding A-1")
- Failure: `describe_test.go:169: Describe took 20s, want an error within 10s`. Returns `E_GRPC_TRANSPORT` after 20.1 s.
- Repro: `flowharness.Silent(t)` (TCP accept, never write); `GrpcService.Describe{reflection, target}`.
- Suspected cause: `grpcclient/reflect.go:250` bounds reflection at `defaultReflectionTimeout` (30 s), but the HTTP/2 handshake never completes, so gRPC's own connect timeout (20 s default, `MinConnectTimeout`) ends it first. `Describe` has no `opId`, so the user has no cancel path (`bridge/grpc.go:139`). Found by read; observed 20.10 s.
- Proposed fix: bound dial+handshake in `grpcclient.dialConn` (`grpc.WithConnectParams` with `MinConnectTimeout` ~5 s, or a short connect deadline in `resolveReflection`), and consider an `opId` on `Describe` so Stop works.
- Requirement (user): Describe against a server that accepts TCP but never answers must fail well under 20 s. Bound connect + HTTP/2 handshake + reflection by one deadline, default about 5 s, overridable by the request's own timeout if the UI has one. Return a clear timeout error (a timeout code and a sentence naming the target and the wait), not `E_GRPC_TRANSPORT` with a bare `error reading server preface: raw-read tcp ... use of closed network connection`.
- Same defect in Call and ServerStream: probed against `Silent`, both block 20.00 s then return the same bare `E_GRPC_TRANSPORT`. Skipped test `TestCallSilentServer` (10 s budget) covers both; same fix applies in the shared dial path.
- Call has no first-response deadline once connected. By read, `grpcclient/call.go` sets none: a server that completes the handshake but never replies blocks until the user presses Stop (the call has an `opId`, so Stop works). Not probed (the harness has no handshake-then-silent server; `Slow` replies eventually). Proposed: keep unbounded for streams by design, but give unary a configurable deadline with a visible default, and surface `E_TIMEOUT`.
- Class: product bug

## A-2 Harness: unary methods skip the server interceptor
- Test: none skipped; worked around (grpcflow reaches the server with streaming calls where it must observe the server side).
- Failure: `GRPCServer.Calls()` stays empty after a unary `Call`; `WithRequiredMetadata` is not enforced on unary methods (only streams and reflection).
- Suspected cause: `flowharness/servers/grpc.go` `flowSvc.unary` registers `grpc.MethodDesc` handlers that ignore the `grpc.UnaryServerInterceptor` argument (`func(_ any, ctx, dec, _ grpc.UnaryServerInterceptor)`); grpc-go passes the interceptor to the handler, which must call it. Streams are wrapped by grpc itself, so those work.
- Proposed fix (Commit 0 follow-up, harness file, not touched here): in the handler, when the interceptor is non-nil, `return interceptor(ctx, in, &grpc.UnaryServerInfo{Server: nil, FullMethod: "/kira.flow.v1.Flow/"+name}, func(ctx, req) (any, error) { ... })`. Then un-restrict the stream-only server-side assertions in grpcflow (`TestDescribeProtoAndCall`, `TestTLSTargets`, `TestClientAndBidiRefused` already holds).
- Class: harness bug (not product)

## Notes (not findings)
- Studio resolves only secret variables at the IPC boundary (`apivars.Resolver`, `repos.VariablesRepo.SecretsFor`). Plain variables, active-environment choice and dynamic values (`{{$uuid}}`) are resolved by the renderer (stage 1). Plan flows H1, D2 and D5 are therefore asserted at the IPC layer through secret variables (environment secret beats collection secret) and the dynamic reference reaching the wire verbatim; the plain-variable precedence belongs to the TS unit tier.
- `api.disableCookieJar` defaults to true, so default settings keep no cookie jar; `TestCookieJar` asserts that, then enables the jar through `SettingsService.Set`.
- Default `api.httpVersion` is "2": default sends to HTTPS arrive as HTTP/2.0.
- Reflection schema mode reads `reflection-v1`; `Service.Name` is the short name (`Flow`), `Method.FullName` is dotted (`kira.flow.v1.Flow.Unary`).

## A-3 (product bug): UI gRPC Call fails for any service in a proto package

- Where: `apps/kira-studio/internal/grpcclient/descriptors.go:410` (`projectService` sets `Service.Name` to `sd.Name()`, the short name) vs `descriptors.go:462` (`resolveMethod` looks up `FindDescriptorByName` with the full name) and `bridge/grpc.go:217,233` (`args.Service + "/" + args.Method`).
- Observed: browser spec `api-grpc-real.spec.ts`: Describe lists service `Flow`; picking `Unary` and pressing Call shows `service Flow not found in the resolved schema: proto: not found`. Go flow tests pass because they send the full name `kira.flow.v1.Flow` by hand.
- Cause: the UI stores `schema.services[].name` as the call's service. Short name works only for services without a package.
- Fix: project the full name into `Service.Name` (keep the short name for display), or build `Call` from `Method.FullName`.
- Status: unary and server-stream UI specs are `test.fixme('P232 finding A-3 ...')`. Written against the expected fix; not run past the failing step.
