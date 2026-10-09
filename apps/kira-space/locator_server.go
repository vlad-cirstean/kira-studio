//go:build server

package main

import "github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"

// The -tags server build is test and sandbox only, never shipped: it uses the macOS probe order
// (configured path, PATH, Homebrew) so real git resolves on Linux.
func platformLocator() gitclient.Locator { return gitclient.NewDarwinLocator() }
