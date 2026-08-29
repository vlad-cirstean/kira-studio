package enginehost

// Op is one of ENGINE_OP's string values (src/shared/protocol/engine-ops.ts:9-19), confirmed
// against that file for this plan (P55 §2 D12) rather than inferred. Every call site in
// internal/connections, internal/tree and internal/oplog reads its op name from here — the
// single place that check needs to happen instead of once per call site.
const (
	OpConnect        = "adapter:connect"    // ENGINE_OP.connect
	OpDisconnect     = "adapter:disconnect" // ENGINE_OP.disconnect
	OpChildren       = "adapter:children"   // ENGINE_OP.children
	OpDescribe       = "adapter:describe"   // ENGINE_OP.describe
	OpDefinition     = "adapter:definition" // ENGINE_OP.definition
	OpTest           = "adapter:test"       // ENGINE_OP.test
	OpCancel         = "adapter:cancel"     // ENGINE_OP.cancel
	OpConfigureCache = configureCacheOp     // ENGINE_OP.configureCache — config.go's existing constant
)

// Event topics, from ENGINE_EVENT (src/shared/protocol/engine-ops.ts:21-25). EventEngineDown
// (host.go) is enginehost's own synthetic topic, not one of these three engine-published ones.
const (
	EventOpStart         = "op:start"         // ENGINE_EVENT.opStart
	EventOpEnd           = "op:end"           // ENGINE_EVENT.opEnd
	EventConnectionState = "connection:state" // ENGINE_EVENT.connectionState — no Go consumer (P55 §1.2)
)
