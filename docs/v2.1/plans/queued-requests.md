# Queued v2.1 requests

Not yet planned. Add to `SPEC.md` as P197-P199 after streams A-C land (touch Stream C's ADE files). Each needs an Opus plan first.

- P197: workflow editor, right-click a stage to skip it.
- P198: Agents module, right-click context menu on a task with useful controls (decide set during planning).
- P199: Kira Space MCP server exposed to agents, enabled per workflow in workflow config. Tools: declare repos a task touches; request a branch with an agent-chosen name. Kira Space records repos and branches per task. Removes manual branch creation.
- P200: Kira Studio Docker module, built as a shared package (packages/) so Kira Space can adopt it later. Browse containers and related entities (images, volumes, networks). Start/stop containers, view logs, exec into a container (terminal). Show per-container CPU and RAM usage. Clean, modern UI, not Docker Desktop's. Touches Studio module registration and `main.go` (Stream A files): plan after A-C land. Plan decides engine access (Docker Engine API over socket via Go client vs CLI).
