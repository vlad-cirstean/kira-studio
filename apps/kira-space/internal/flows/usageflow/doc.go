// Package usageflow drives the Claude Code usage limits (P239) through the real composition root:
// a statusline payload goes through the generated --settings wrapper and the hooks socket, a
// headless run's stream goes through the ADE board, and the snapshot is read from the bound
// service.
package usageflow
