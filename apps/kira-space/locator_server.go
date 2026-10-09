//go:build server

package main

import "github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"

// The -tags server build is test and sandbox only, never shipped: it resolves real git off macOS too.
func platformLocator() gitclient.Locator { return gitclient.NewHostLocator() }
