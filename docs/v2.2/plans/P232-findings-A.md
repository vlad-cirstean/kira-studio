# P232 findings, Stream A (API: httpflow, grpcflow, apiflow, e2e-real)

## A-1 Describe hangs 20 s against a silent server
- Test: grpcflow `TestDescribeSilentServer` (skipped "P232 finding A-1")
- Failure: `describe_test.go:169: Describe took 20s, want an error within 10s`. Returns `E_GRPC_TRANSPORT` after 20.1 s.
- Repro: `flowharness.Silent(t)` (TCP accept, never write); `GrpcService.Describe{reflection, target}`.
- Suspected cause: `grpcclient/reflect.go:250` bounds reflection at `defaultReflectionTimeout` (30 s), but the HTTP/2 handshake never completes, so gRPC's own connect timeout (20 s default, `MinConnectTimeout`) ends it first. `Describe` has no `opId`, so the user has no cancel path (`bridge/grpc.go:139`). Found by read; observed 20.10 s.
- Proposed fix: bound dial+handshake in `grpcclient.dialConn` (`grpc.WithConnectParams` with `MinConnectTimeout` ~5 s, or a short connect deadline in `resolveReflection`), and consider an `opId` on `Describe` so Stop works.
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
