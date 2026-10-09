// Package claudeheadless runs headless Claude Code (`claude -p`) for ADE v2 pipeline steps: it builds the
// launch, parses the stream-json output into log lines, and serves the
// `finish_step` MCP tool a run reports its outcome through. It depends on neither the ade engine
// nor storage.
package claudeheadless
