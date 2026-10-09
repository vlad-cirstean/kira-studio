//go:build !server

package main

import "github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"

func platformLocator() gitclient.Locator { return gitclient.NewPlatformLocator() }
