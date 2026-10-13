---
title: Docker
description: Manage containers, images, volumes and networks from Docker mode.
sources:
  - README.md
  - packages/docker-ui/src
  - internal/docker
  - packages/theme/src/i18n/en.json
sidebar:
  order: 5
---

Docker mode manages the local engine or a saved context.

## What you can do

- List containers, images, volumes and networks.
- Restart a container.
- Read live container logs.
- Watch live container stats.
- Open an exec terminal into a running container.

## Remote engines

A remote `tcp://` engine without TLS works. The UI flags it as insecure.
