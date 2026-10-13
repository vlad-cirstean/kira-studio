---
title: Install and update
description: Install Kira Studio or Kira Space with one command, and update from inside the app.
sources:
  - README.md
  - apps/kira-space/README.md
  - scripts/install.sh
  - docs/PACKAGING.md
  - internal/appupdate/checker.go
sidebar:
  order: 1
---

## Install

Run this in Terminal to install Kira Studio:

```sh
curl -fsSL https://raw.githubusercontent.com/vlad-cirstean/kira-studio/main/scripts/install.sh | sh -s -- --app=studio
```

Use `--app=space` to install Kira Space instead. The same command replaces an older copy.

The script:

1. Downloads the latest release's disk image.
2. Moves the app into `/Applications`.
3. Opens the app, with no Gatekeeper prompt.

A disk image downloaded through a browser does trigger Gatekeeper. The script avoids that.

Failures land in `~/Library/Logs/<app name>/install.log`.

## Keychain prompt

:::caution
Builds are ad-hoc signed, not notarized. Each new build counts as a different app to the Keychain. The first launch after an update may ask to use "confidential information stored in…". Choose **Always Allow** once for that build.
:::

## Update

The app checks GitHub for a newer release and offers to update. Nothing installs until you click **Update**. The app never updates itself silently.

## Build from source

Building is the developer path. See [Build and test](../../develop/build-and-test/).
