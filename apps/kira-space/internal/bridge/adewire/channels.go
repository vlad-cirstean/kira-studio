package adewire

// Push channels of AdeTaskService. Payload-free channels invalidate the matching queries.
const (
	ChannelBoard       = "kira:adetask:board"
	ChannelBacklog     = "kira:adetask:backlog"
	ChannelWorkflows   = "kira:adetask:workflows"
	ChannelRepos       = "kira:adetask:repos"
	ChannelRuns        = "kira:adetask:runs" // RunsChangedEvent
	ChannelLog         = "kira:adetask:log"  // LogEvent
	ChannelSessions    = "kira:adetask:sessions"
	ChannelOpenSession = "kira:adetask:open-session" // OpenSessionEvent, EmitTo
)
