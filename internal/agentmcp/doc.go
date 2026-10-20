// Package agentmcp serves Kira's MCP tool server for agent runs: the `finish_step` outcome tool,
// the Space, git and review tools, and the run-outcome mapping. It is agent-neutral: the
// provider in internal/harness launches the agent and renders the server into its MCP config.
// It depends on neither the ade engine nor storage.
package agentmcp
