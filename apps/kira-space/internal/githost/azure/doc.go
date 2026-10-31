// Package azure is the githost provider for Azure Repos, driven by the `az` CLI and its azure-devops
// extension. A githost.Repo is {Host: "dev.azure.com", Owner: "<org>/<project>", Name: "<repo>"}:
// Azure signs in per organization and names a repository by project.
//
// Azure keeps no pull request update time, so sync orders and watermarks by creation (sync.go).
package azure
