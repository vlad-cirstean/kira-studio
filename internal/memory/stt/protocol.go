package stt

// Host to worker, one JSON object per line on the worker's stdin.
const (
	msgStart  = "start"  // Glossary, SID
	msgAudio  = "audio"  // PCM: base64 s16le mono 16 kHz
	msgStop   = "stop"   // finish the session; reply final
	msgCancel = "cancel" // abandon the session
)

type request struct {
	Type     string   `json:"type"`
	SID      int      `json:"sid,omitempty"`
	Glossary []string `json:"glossary,omitempty"`
	PCM      string   `json:"pcm,omitempty"`
}

// Worker to host, one JSON object per line on the worker's stdout.
const (
	replyText  = "text"  // Text so far, Stable UTF-16 units of it that will not change
	replyFinal = "final" // Text; ends the session
	replyError = "error" // Error; ends the session
)

type reply struct {
	Type   string `json:"type"`
	SID    int    `json:"sid,omitempty"`
	Text   string `json:"text,omitempty"`
	Stable int    `json:"stable,omitempty"`
	Error  string `json:"error,omitempty"`
}

type hello struct {
	Ready bool   `json:"ready,omitempty"`
	Model string `json:"model,omitempty"`
	Error string `json:"error,omitempty"`
}
