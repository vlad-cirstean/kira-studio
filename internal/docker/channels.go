package docker

// Push channels. Only Docker emits them, so they live here, not in appevent.
const (
	ChannelChanged = "kira:docker:changed"
	ChannelStatus  = "kira:docker:status"
	ChannelStats   = "kira:docker:stats"
	ChannelLogs    = "kira:docker:logs"
	ChannelExec    = "kira:docker:exec"
)
