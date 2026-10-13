---
title: Automations and smart scripts
description: Run scripts and Claude Code prompts from collections, on demand or on a schedule.
sources:
  - README.md
  - apps/kira-space/README.md
  - packages/workbench/src/automations
  - internal/scriptruns
  - internal/scripts
  - packages/theme/src/i18n/en.json
sidebar:
  order: 1
---

Automations exist in both apps. Scripts group in collections. Each script runs in its own folder and keeps a run history with status, exit code and result.

## Scripts

- Create a script with **New script**.
- Choose the run folder: the automations folder under the app home (**Use automations folder**), or **Choose folder…**.
- Add parameters. A parameter reaches the command as a variable.
- Open terminals beside the run history.

## Smart scripts

A smart script runs a prompt in headless Claude Code instead of a shell command. Create one with **New smart script**.

A smart script sets:

- Parameters of type text, select, multi-select or secret. Use a token in the prompt. A secret reaches the run as a variable only, never in the prompt.
- A model, a budget in dollars and a timeout. The budget must be above 0.
- A list of tools and MCP servers the script may use. Bash commands take patterns such as `git status:*`.

The run history lists denied tools.

Kira adds a closing instruction to the prompt so the run reports through `finish_step`. See [Prompts](../../reference/prompts/).

## Schedules

A script can run on a cron schedule. Choose **Run on a schedule**, then set a repeat or a cron expression (minute, hour, day, month, weekday) and a timezone.

- A due run asks for confirmation by default. Choose **Run without asking** to skip the popup.
- A script with a secret parameter always asks, because a schedule never stores a secret.
- Runs happen only while the app is open. A missed run is skipped, never replayed.
- A run that is still going, or still waiting for your answer, makes the next run skip.

## In Kira Space

Kira Space adds two more triggers:

- Run a script on a task or branch from Agents. **Run in the task's worktree when started from ADE** picks the worktree as run folder.
- Use a script as a workflow step.
