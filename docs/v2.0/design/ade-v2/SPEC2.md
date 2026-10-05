# Agent Task Planner — SPEC 2 (changes on top of SPEC.md)

This file contains **only what changes** relative to `SPEC.md`. Everything in `SPEC.md` still applies unless it's replaced here: layout rules (facts first, titles last; all labels and buttons in the left action column), activity icons, Claude dialog behaviour (editable message, busy check + override, push switch, "ask if unclear"), archive safety, rich text notes, days/weekends/day off/overflow/history, colors, conflict computation in memory with a native Go git library.

`mockup.html` is updated in place to this version.

---

## 1. Why

Agentic work often spans repos (an API change plus the UI using it), but it's still **one piece of work**. v1 tied everything to a repo tab and planned per branch. v2 plans **tasks** and lets git facts stay per repo.

## 2. Model

| Concept | What it is |
|---|---|
| **Task** | The unit you plan. Title, Jira ticket, **status**, **phase**, **pipeline**, estimate, day, notes, color. Owns any number of **branches in any repos**. |
| **Workflow** | A reusable, configurable list of **stages** (defined on the **Workflows** page). A task picks one and moves through its stages in order ("dark factory"). Defaults: *Standard feature* (Spec › Implement › Review › Release), *Bugfix* (Triage › Fix › Release), *Maintenance* (Update › Release). |
| **Stage** | **User** (you do it; optionally opens an interactive Claude Code session with the stage's own prompt), **agent** (a list of AI **steps** that run in the background with `claude -p`), or **script** (runs a shell command, e.g. a release script). Each stage also says which **task status** it means. |
| **Run** | One execution of a step (or script stage) **for one branch**. `each repo` steps have one run per branch, so repos progress independently. Progress counts workflow steps only; no agent todo progress (user decision, P158). |
| **Branch** | Unchanged from v1 (one worktree each), but now belongs to a task and carries its **repo**. Git facts (stacks, conflicts, behind, rebases, pushes) are computed **per repo**. |
| **Step** | One step of an agent stage. Run states: `pending`, `running`, `stuck` (needs a decision it can't make headless), `failed`, `back` (failed and sent back to an earlier step), `done`. A step's state is the worst of its runs (stuck > failed > running/back > pending; done when all are done). |
| **Session** | A Claude Code process, `tui` (interactive; spec work, debugging, release fixes) or `headless` (`claude -p`, one per pipeline step per branch). Any headless session can be **opened in the TUI** (`claude --resume <id>`). |
| **Integration branches** | Per repo, besides `main`: e.g. `develop`, `staging`. Configured per repo. The app tracks whether each feature branch is merged into them and whether that merge is stale. |
| **Prepare-worktree script** | Per repo. Runs in every new worktree (e.g. `pnpm install`, copy env files) before any agent may start there. |
| **Environment** | Per repo, e.g. `preview`, `staging`, `prod`, each with a script that prints the git SHA deployed there right now. |
| **Review item** | Someone else's branch you added. Shown as its own box (read-only), placed right above the task that builds on it or conflicts with it. |
| **Parked task** | Not merging (spike etc.). Same as v1's not-merging work, now at task level. |

**Base marker (doesn't start from main).** Any branch whose base isn't `main` gets a small mono chip right after its repo label, so you see at a glance that it depends on something else:
- base **in the same task** (the row just above, already shown by the indent/elbow): just `⑂`, no name;
- base **outside the task** (another task's branch): `⑂ <base, without its feat/ prefix>`, grey chip, max ~110px;
- base is **someone else's branch**: same, in blue (`⑂ search-schema`).
Tooltip: `starts from li/search-schema (li's branch), not main`. The old second-line text `on <branch>` is dropped (the marker replaces it); new work not yet created shows `no branch yet · from <base>`.

Relationships across tasks still come from git: a branch whose base is another task's branch (same repo) shows `on <branch>`; a branch that shares files with another task's branch that merges earlier (same repo) gets `↻ <branch>` + Rebase.

## 3. Navigation

- Tab bar, left: **`Backlog`** (grey count badge before the label) · **`Needs you`** (amber count badge) · **`Plan`**. Right-aligned: the capture box, **`+ Add task`** right next to it (opens the Add popover below the tab bar, from any screen; adding a task switches to the Plan and selects it), then **`Workflows`** · **`Repos`** (configuration, used less often). No repo tabs.
- **Capture box** on the right of the tab bar, on every screen: `+ Add to backlog… (Enter)`. Enter adds the text to the top of the Backlog and shows `added to backlog` briefly; nothing else changes on screen.
- Plan header (sticky): the big **Refresh all** button **first, on the left**, then one **repo chip** per repo **used by a task on the plan** (repos the app manages but no task touches don't appear; Refresh all only fetches these): `[web-app] 4m ago ↻`. Click the name to **show/hide** that repo's branches (tasks with no visible branch hide). `↻` fetches that repo only. Autofetch stays off by default. After a fetch the chip reads e.g. `just now · 3 refs changed · 1 merged into develop`.
- (The Add button moved to the tab bar.)

## 4. Timeline

Days, weekends, days off, capacity/overflow, overdue, history and Later work exactly as in SPEC.md, but **per task**:
- `plan.day[taskId]`, `plan.order[]` of task ids. A task's estimate sets its span; it merges on its last day; merge order sorts tasks by (merge day, start day, position).
- **Only the first 10 work items are shown** (in plan order, review items included). Days after the 10th item are hidden too. At the bottom: a dashed full-width button **`↓ Load all items · N more`**; once expanded, a small `Show only the first 10 again`.
- **History works the same way:** a dashed full-width button at the top, **`↑ Load history · 5 archived tasks in the last 2 weeks`**. No pull-to-load or scroll gestures: you click.
- **Dragging a task box only changes the plan; it applies directly with no Claude dialog.** Any git consequence shows up as tags (`↻ X` + Rebase) and is handled explicitly. (Changed from v1, where a drag opened the Claude dialog.)
- Splitting a stack across days (v1) is replaced by tasks: put work on different days by putting it in different tasks.

### 4.1 Task box (a clearly delimited card)
- **Card:** 10px radius, 1px `#3a3e48` border, **4px left edge in the task color** (review items blue, parked dashed), dark body `#17181c`, a soft shadow, and **10px between cards**, so each task reads as one object.
- **Task row = card header (68px, two lines):** tinted with the task color (~11% alpha), separated from the branch rows by a 1px line.
  - **Line 1, facts:** color square · **stage progress** · `!` if something needs you · muted meta `[3d → Mon 28 · ]PAY-102 · api · web-app` (truncates first).
  - **Line 2, the title:** full card width, bold 13px, **wraps to at most two lines**, then ellipsis; full title in the tooltip and the panel.
  - **Stage progress:** one small segment per stage of the task's workflow (wider for agent stages; green done, amber current, red if a step is stuck/failed, grey todo) followed by **one label for the current stage**: `Spec`, `Implement 2/5` (agent stage: done/total steps), `Review`, `Done`, then for agent/script stages a **precise progress bar + percent** (`▬▬▭ 42%`): the average over steps, where each step counts the share of its repos whose run is done. Tooltip on the bar: per step, per repo (`2. Implement: api ✓, web-app running`). Tooltip: the whole workflow, e.g. `Standard feature: ✓ Spec (user) › ▸ Implement (agent) › Review (user) › Release (script)`.
  - **Needs you:** only an **amber `!` circle** (with a soft ring), no text. Tooltip lists what needs you; click goes there (stuck run → **Take over**; interactive question → its terminal). No other agent states on cards.
- **Branch rows:** each row also shows **its own progress** at the start of the second line during agent/script stages: one tiny segment per step colored for *this branch* + `<current step>` (amber), `· stuck`/`· failed` (red), `· waiting`, `↩ sent back`, `· fix 1` (send-back round), or `<stage> ✓` (green). This is how you see `api` is done while `web-app` is still going.
- **Branch rows (line 1):** repo label · **base marker** (only when the branch doesn't start from `main`, see below) · `!` circle (only if a session on that branch needs you) · owner pill (review) · **branch name**, then a **quiet second line** (11px, muted, no backgrounds) holding, in this order: the context text if any (`no branch yet · from main`, `on li/search-schema`, the PR title for review items) · where it's merged (`dev ✓  stg ⚠`) · a thin divider · where it's deployed (`▲staging ✓  ▲prod ⚠`). Merged/deployed use muted grey (grey-green for merges, grey-blue for deploys), **amber when stale**. They live on line 2 so they never take width from the branch name. The `▲` marks environments so `stg` (a branch) and `▲staging` (an environment) can't be confused.

### 4.2 Left action column (one line per row, as in SPEC.md)
- **Task row** (68px cell, matching the header): task **status** tag (derived, see §5) · then the **stage action** (first match):
  - everything merged / workflow finished → `✓ merged` + **Archive**
  - user stage with an interactive session configured, none running yet → **▶ <Stage>** (e.g. `▶ Spec`, `▶ Review`)
  - user stage otherwise → **Done ›** (tooltip `Spec is done; move to Implement`); last stage → **Finish ✓**
  - agent stage: a step stuck/failed → **Take over** (red) · next step waits for approval → **Approve** · nothing run yet → **▶ Run** · all steps done → **Done ›**
  - script stage: not run → **▶ Run** · failed → **Retry** (red) · done → **Done ›**
  - Archive appears only once the workflow is **finished** (not merely because branches merged).
- **Branch rows:** the git tag + action from SPEC.md, first match: `not created` · `⚙ preparing 3m 40s` (blue; no actions) · `✕ setup failed` + **See error** (red) · `✓ merged` · `not merging` · review `✕ conflict`/`review` · `✕ conflict` + **Queue after** · `↑ not pushed` + **Force push** · `↓N main` + **Rebase** · `↻ <branch>` + **Rebase** (onto that branch; never offered for a branch based on someone else's branch) · `⏳ <owner>` · `base behind` / `base conflict` · `CI failing` · `✓ clean`. Plus **▶ Start** on a branch that never had a session.

## 5. Workflows, stages, sessions

**Task status** is still set by you (5 values) and independent of Jira.

**User stages.** If the stage opens an interactive session, `▶ <Stage>` opens the Claude dialog with the stage's prompt (variables filled) plus task context: Jira, and either the branches/worktrees (if they exist) or the repos' main checkouts read-only. Example for *Spec*:
```
Let's write the spec for: Export invoices as CSV
- Jira: PAY-121 https://acme.atlassian.net/browse/PAY-121
- Repo: api (read only, in ~/code/api)
- Repo: web-app (read only, in ~/code/web-app)
- Notes: Reuse the invoice line items from usage billing.
Ask me questions until the spec is clear. Do not change any code.
```
You finish any user stage with **Done ›** (the next stage becomes current) or, on the last one, **Finish ✓**.

**Agent stages.** The stage's steps run one by one, **headless** (`claude -p --output-format stream-json`), one run per branch for `each repo` steps (one total for `once`). `▶ Run` opens the dialog (branch name per repo to create, optional; editable message = task, Jira, branches/worktrees, then `Step 1/5: <name>` and the step's prompt with variables filled). Steps then advance by themselves; a step whose gate is **wait for my approval** shows **Approve**. A run that needs a decision becomes **stuck**; a run that exhausts its retries becomes **failed**. Both turn the stepper red and surface **Take over**.

**Take over** (UI label; technically it opens the run in the TUI). Spawns an interactive Claude Code session that resumes the headless one (`claude --resume <session id>`) in the same worktree, adds it as a `TUI … (resumed)` tab in Sessions and selects it. Available on every running headless session (Sessions tab bar, step rows, All agents) and on finished/stopped ones.

**Release** (a user stage with id `release`) additionally lists each branch with `main ✓/—` and its merged-into/deploy state. Finishing the last stage makes Archive appear.

**Task status is derived, not set by hand** (the panel shows it read-only: `Blocked · follows the workflow: a step is stuck or failed`):
- workflow finished → `Done`
- any run stuck/failed, or a worktree setup failed → `Blocked`
- first stage, nothing started yet → `To do`
- otherwise the current stage's configured status (defaults: Spec/Implement `In progress`, Review/Release `In review`).

**Per-repo runs.** For `each repo` / `only <repo>` steps every branch has its own run with its own state, loop count and note. In the panel, a started step lists one line per repo: `state glyph · repo · state · [Log] [Take over] [Output] [Retry] · agent icon · note`. Steps that haven't started stay one line.

**Send back on failure.** A step's **On failure** can be `stop`, `retry 1`, `retry 2`, or **`↩ send back to <earlier step>`**. When it fails for a branch, the backend **resumes that earlier step's own session on that branch** (`claude -p --resume <session id>`) with the failure output appended, e.g. `Write tests failed on feat/push-settings: 2 failing tests in Push.test.tsx. Fix the implementation.`, so the agent keeps its context. The failing step's run shows `↩ sent back`; the earlier step runs again (`· fix 1`, note `sent back by Write tests: …`); afterwards the chain continues from there. Max **3 rounds** per step and branch, then the step is `failed`.

**Script stages.** Run a command (multi-line allowed; variables `{task} {jira} {repo} {branch} {worktree}`) in each target branch's worktree, `once` / `each repo` / `only <repo>`, with timeout and `stop | retry 1 | retry 2`. Non-zero exit = failed. Each run keeps its full output: **Output** opens it inline (error lines red), **Retry** reruns. The default *Release* stage of every workflow is a script (`./scripts/release.sh --branch {branch}`).

## 5.1 Workflows page
Left: list of workflows (`name`, its stages `Spec › Implement › Review › Release`, `used by N`, `+ New`) and a short explanation. Right: editor.
- Workflow **name**; prompt variables `{task} {jira} {repo} {branch} {worktree}`.
- One card per **stage**: `n.` · type badge (`user` blue / `agent` amber / `script` green) · name · type select (`user` | `agent (background)` | `script`) · **Task status** select (`To do`, `In progress`, `In review`, `Done`) · ↑ ↓ ✕.
  - **Script:** **Command** textarea (`runs in each branch's worktree; non-zero exit = failed`), **Runs on**, **On failure** (`stop`, `retry 1`, `retry 2`, `↩ send back to <any earlier step of this stage>`), **Timeout**.
  - **Manual:** switch **Opens an interactive Claude Code session**; when on, a prompt textarea (the session's first message).
  - **Automated:** nested step cards `2.1, 2.2…`: name · ↑ ↓ ✕, then **Runs on** (`once`, `each repo`, `only <repo>`), **Before it** (`start automatically` | `wait for my approval`), **On failure** (`stop`, `retry 1`, `retry 2`, `↩ send back to <any earlier step of this stage>`), **Timeout**, **Prompt**. `+ Add step`.
- `+ Add stage`. Changes apply to tasks using the workflow from their next stage/step on.
- In the task panel, **Workflow** has a select (switching workflow restarts at its first stage) and `Edit workflows ↗`; below it one block per stage (`done | now | next` · actions · name · `2/5` for agent stages · `user · interactive Claude Code` / `agent · background claude -p` / `script` / `user`), agent blocks listing their steps.

## 5.1.1 Workflows are YAML files

Stage kinds are named after **who does the work**: `user` (you), `agent` (background Claude Code agents), `script` (a command). The reader also accepts the old names `manual` / `automated`.

Every workflow **is** a YAML file, so it's portable and easy to share, version and reuse: `~/.config/agent-planner/workflows/<id>.yaml` (defaults in `handoff/workflows/`: `standard.yaml`, `bugfix.yaml`, `chore.yaml`). The Workflows page edits that file.
- Header: **Form | YAML** switch · file path (mono, truncates) · **Copy YAML**. Left list: **Import YAML** (new workflow, opens in YAML mode) and **+ New**.
- **Form** and **YAML** edit the same file; switching shows the current content. Form edits rewrite the YAML.
- **YAML** mode: one mono textarea. On every edit it's parsed and validated; valid → `✓ valid · the form and the plan use this file`; invalid → red `✕ line 11: unexpected content here (check the indentation)` / `✕ stage 4: kind must be user, agent or script` and **the last valid version stays in use**.
- The app watches the folder: files added or changed outside the app (git pull, copy from a colleague) show up immediately.

Schema:
```yaml
id: standard
name: Standard feature
stages:
  - id: spec
    name: Spec
    kind: user              # user | agent | script
    status: In progress     # task status while in this stage: To do | In progress | In review | Done
    session: true           # user: open an interactive Claude Code session
    prompt: |               # user + session: first message
      Let's write the spec for {task} ({jira}). Ask me questions until it is clear. Do not change any code.
  - id: impl
    name: Implement
    kind: agent
    status: In progress
    steps:
      - id: tests
        name: Write tests
        runs_on: each repo   # once | each repo | only <repo>
        before: auto         # auto | approval
        on_failure: back:impl  # stop | retry 1 | retry 2 | back:<earlier step id>
        timeout: 1h
        prompt: |
          Add or update tests for the changes on {branch}.
  - id: release
    name: Release
    kind: script
    status: In review
    runs_on: each repo
    on_failure: stop
    timeout: 15m
    command: |
      ./scripts/release.sh --branch {branch}
```
Prompt/command variables: `{task} {jira} {repo} {branch} {worktree}`.

## 5.1.2 How the app knows a step is done: `finish_step`

Background runs get an MCP tool from the app, **`finish_step(status, summary)`** with `status` = `done` | `failed` | `needs_input`. **Every agent step's prompt automatically ends with:**
```
When this step is done, call the finish_step tool with status "done" and a one-line summary. If it failed, call it with status "failed" and say what failed. If you need a decision from me, call it with status "needs_input" and your question.
```
- It is **not** written in the YAML and can't be removed; the editor shows `+ finish_step instruction is added to this prompt automatically` under each step prompt (full text on hover), and it appears in the Claude dialog's message.
- `done` → the run is done, the next step starts (or waits for approval); `failed` → the step's `on_failure` rule applies (retry / send back / stop); `needs_input` → the run becomes **stuck** (`! needs you`, **Take over**).
- If the process exits without calling it, the run is `failed` with `ended without finish_step`; timeouts are `failed` too.
- Script stages don't use it: exit code 0 = done, anything else = failed.

## 5.2 Long text everywhere

Titles, branch names and Jira summaries get long. Rules, everywhere:
- **Facts never share a line with a long title.** Card headers put facts on line 1 and the title on line 2; panel headers put the status chip before a title that **wraps to two lines**.
- **Task titles:** wrap to 2 lines (cards, panel header), then ellipsis. Full text in the tooltip and in the Name field.
- **Branch names:** one line, ellipsis at the end, full name in the tooltip; in the branch panel header the name **wraps** (break anywhere) instead of being cut.
- **Secondary lines** (meta, merged-into, deploys, PR titles): one line, truncate first, tooltips.
- **Lists** (Needs you, Backlog, All sessions): one line per field, fixed-width facts first, the long text last and truncating.
- **Stage labels** max ~150px (`Implement 2/5`), truncating.

## 6. Merged into other branches (integration tracking)

For every branch of mine and every integration branch `T` of its repo, the backend computes (in memory, native Go git; on startup, on Refresh for changed refs, and after any agent action):
- **merged**: every commit of the branch is in `T` (tip is an ancestor of `T`, or all its patch-ids are present in `T` for squash/cherry-pick/rebase cases).
- **stale**: it **was** merged into `T` (some of its patches are in `T`, or the app recorded the merge) but the branch now has commits not in `T`: new commits since, or a rebase that rewrote them.
- **not merged**: none of its patches in `T`.

Display:
- **In the row:** quiet text on the branch row's second line: `dev ✓` (muted, merged and up to date) or `dev ⚠` (amber, stale). Nothing when not merged. Abbreviations: develop→`dev`, staging→`stg`, release→`rel`, else the name. Tooltip: `merged into develop, up to date` / `stale in develop: 2 commits since it was merged. Right-click to re-merge.`
- **Right-click a branch row → fix menu:** `Re-merge into develop (stale)` / `Merge into staging` (for each target not merged) · `Rebase onto main` (if behind) · `Rebase onto <branch>` (if it must follow other work) · `Force push` (if not pushed). Empty → `Nothing to fix`.
- **Branch panel → Details → "Merged into":** one row per target: `status chip (merged | stale | not merged) · [Merge | Re-merge] · target · detail` (`up to date`, `2 commits since it was merged`, `rebased since it was merged`).
- **After a rebase**, every target the branch was merged into becomes **stale** (the commits were rewritten).

Merge dialog (Claude; same dialog rules as rebase: agent choice, editable message, push switch here labelled **Also push develop**, default off):
```
Merge feat/oauth-login into develop (repo web-app).
1. git fetch origin
2. Use the develop worktree at ~/wt/web-app/_develop (create it if missing: git worktree add ~/wt/web-app/_develop origin/develop -B develop)
3. In ~/wt/web-app/_develop: git merge feat/oauth-login
Resolve any conflicts. Do not push.
If anything is unclear, ask me before changing anything.
```

## 6.1 Worktree setup (prepare script)

- When a worktree is created (a pipeline run creating branches, Start, Take over in a new worktree, Add existing branch), the backend runs the repo's **prepare-worktree script** in it, with its timeout. Until it finishes, nothing else runs there: pipeline steps for that branch wait, Start/Take over aren't offered.
- **States:** `preparing` (running; elapsed time shown), `ready` (exit 0), `failed` (non-zero exit or timeout). Stored per worktree with the full output.
- **Graph:** the branch's action cell shows `⚙ preparing 3m 40s` (blue) or `✕ setup failed` + **See error** (red). The work status in the panel header shows the same (`preparing` / `setup failed`).
- **Branch panel → Details → Worktree setup:** `status chip · [Retry setup] · 1m 12s · prepare-worktree script of web-app`, and for running/failed the **log** below it (mono, scrollable, error lines red). The header action becomes **Retry setup** when failed. Once ready, the log is hidden and normal actions (▶ Start agent…) return.
- **Needs you:** `setup failed` (red) · took 1m 12s · **See error** · repo · `Worktree setup failed for feat/search-ui`.

## 6.2 Deployments

- Each repo lists **environments**; each has a script that **prints the git SHA deployed there**. Scripts run on startup, on Refresh (per repo / all) and on the repo's chip refresh.
- For every branch of mine and every environment, the backend compares the branch to the deployed SHA (in memory, native Go git, same approach as §6):
  - **deployed**: the deployed SHA contains all of the branch's changes (its tip is an ancestor, or all its patch-ids are present).
  - **stale**: some of the branch's changes are in the deployed SHA but not all (new commits since, or a rebase rewrote them), or the environment moved back to an older SHA.
  - **not deployed**: none of its changes are there.
- **Graph:** on the branch row's second line after the merges: `▲staging ✓` (muted) / `▲prod ⚠` (amber). Nothing for not deployed. Tooltip: `deployed: staging runs aa01bb2, which contains this branch` / `stale on prod: prod runs 71e0c3a: 1 commit of this branch is missing`.
- **Branch panel → Details → Deployed to:** one row per environment: `deployed | stale | not deployed` chip · env · `runs <sha>, contains this branch` / the stale note.
- Deploying is outside this app; it only reports.

## 6.3 Repos page (settings)

The app manages repos added one by one or imported from folders. Every repo has a **nickname** shown everywhere instead of its (often long) real name.

Left column:
- **Folders** (`Every git repo inside is imported.`): rows `path · N repos · watch switch · ✕`. **watch** = also import repos that appear in the folder later. `[~/code/oss] + Add folder` imports every git repo found inside.
- **Repos:** rows `nickname chip / full repo name (mono, truncates) / 3 envs · 1 integration branches`. `[~/code/some-repo] + Add repo` adds a single repo.

Right, for the selected repo:
- **Nickname** (editable; `Shown everywhere instead of the repo name.`), **Repo** (full name), **Path**, **Source** (`imported from ~/code/acme` / `added individually` · `used by tasks on the plan` / `not on the plan`).
- **Prepare worktree:** script (mono textarea, multi-line) + **Timeout**. Help: `Runs in every new worktree of this repo before any agent starts. Non-zero exit = setup failed.`
- **Integration branches:** comma-separated (`develop, staging`). Help: `Besides main. Branches are checked for being merged / stale in these.`
- **Environments:** rows `name · deployed-SHA script · ✕`, `+ Add environment`. Help: `Each script must print the git SHA currently deployed there. Run on Refresh.`

Where repos are picked (Add → New task, the task panel's **+ Add repo…** select, workflow step scope), all managed repos are offered as `nickname · full name`. The task panel uses a **select** (`+ Add repo…`) instead of one button per repo, since there can be many.

## 7. Panel

Resizable, default half width (unchanged). Two modes:

**Task selected** — header: color square · status chip · title (truncates); mono line `Today–Wed 23 · 3 branches in api, web-app · 1/5 steps`; actions: the phase action (§4.2) and `Archive` (primary purple when everything merged).

**Sessions tab** (task: spec sessions + all its runs; branch: that branch's): tab strip with a badge per session, `TUI` (Claude orange) or `claude -p` (dashed), interactive first. A headless tab shows a status bar `headless run · step Implement · stuck · needs you · 4m ago` with **Take over**, a **read-only log** (stream of the run: commands, edits, commits, state) and the note `Read-only log of a headless run. Use Take over to take over interactively.` A TUI tab shows the terminal with an input. Below: `Finished / stopped` with **Take over** per entry.
Tabs: **Task** · **Notes** · **Sessions N**. The **Notes** tab holds only the rich text editor, filling the whole panel height. Task tab, top to bottom:
- `Name` (empty = default title) · `Status` (5 toggle buttons) · `Jira` (status chip, key link, title, copy; or paste field) · `Estimate` (number + hours|days).
- **Workflow**: three phase blocks (`done | now | next` · action buttons · title · `1/5` for Implementation · `user · interactive Claude Code` / `agent · background claude -p`). The current block is amber-outlined. Implementation also has a **Pipeline** select + `Edit workflows ↗`, and one row per step: `state box · status text (done | running | stuck · needs you | failed | pending | waiting for approval) [· N runs] · [Log] [Take over] [Approve] [Retry] · agent icon · n. · step name · scope · needs approval`. Release lists branches with `main ✓/—` and merged-into chips.
- **Branches**: `git status chip · repo · merged-into · branch name` per branch (click → branch view), then `+ <repo>` buttons for repos the task doesn't touch yet (adds a new branch to create on start) and **+ Add branch** (opens Add → Existing branch, targeted at this task).
- (Notes moved to their own **Notes** tab; still per task.)

**Branch selected** — a `← <task title>` link back; header: outlined task-color square · git status chip · branch name; mono line `repo · base X · ↑a ↓b`; actions: Force push / Rebase onto main / Rebase onto X / Queue after / Re-merge into T / ▶ Start agent. Tabs: **Details** (Branch + PR rows with status chips, then **Worktree setup**, **Merged into**, **Deployed to**) · **Changes** (unchanged) · **Sessions N** (this branch's).

## 8. Add

- **New task**: Title · Jira · **Repos** (toggle chips; at least one) · Notes → **Add to Later**. Creates a task with one *new branch* per selected repo (`no branch yet · from main`).
- **Existing branch**: searches **all repos**, newest first: `time · author · repo · branch`. From the main Add button it creates a new task containing that branch (someone else's → a review item). From a task's **+ Add branch** it attaches to that task (header shows `adding to: <task>`).

## 9. Starting work (superseded by §5 for tasks; kept for single branches)

**Start task** creates the missing branches and starts the first pending step. The dialog has one optional **branch name** input per repo to create (empty = Claude picks), then the editable message:
```
Task: Export invoices as CSV
- Jira: PAY-121 https://acme.atlassian.net/browse/PAY-121
- Notes: Reuse the invoice line items from usage billing.
- Create a branch from origin/main in each repo, each in its own new worktree:
  - api: pick a short descriptive branch name; worktree under ~/wt/api/
  - web-app: branch feat/csv-export, worktree ~/wt/web-app/csv-export
Step: Export endpoint
```
**Start step** on an existing branch:
```
Task: Usage-based billing
- Jira: PAY-102 https://acme.atlassian.net/browse/PAY-102
- Repo: api · Branch: feat/usage-metering · Worktree: ~/wt/api/usage-metering
Step: Metering endpoints
```
Rebase/queue messages now name the repo: `Rebase feat/usage-billing (repo web-app) onto …`. Worktree paths are `~/wt/<repo>/<branch last segment>`.

## 10. Archive (per task)

Archive acts on the whole task: stops all its agents and deletes **all its worktrees** after the same safety check as v1, now listing every branch at risk:
```
Task "Usage-based billing" is being archived and its worktrees will be deleted.
- web-app · feat/usage-billing · ~/wt/web-app/usage-billing · uncommitted: src/payments/invoice.ts · commits not merged into main: 5
Before they are deleted:
```
History shows archived tasks with their repos: `✓ merged · archived  web-app · api  Audit log for admin actions`.

## 11. Needs you (replaces All agents)

The cards only say *that* something needs you; this page is where you **clear it**, across all tasks, in one pass.
- **Rows** (one line, facts first, task last): `kind` chip · age · **one action** · repo (or `spec` / step scope) · what it is, over a muted line with the task color square and task title.
- **Kinds and actions**, most urgent first, then oldest first:
  - `stuck run` (red): a background step needs a decision → **Take over**
  - `failed` (red): a step exhausted its retries → **Retry**
  - `question` (amber): an interactive session is waiting for your answer → **Open** (jumps to its terminal)
  - `approval` (amber): the next pipeline step waits for you → **Approve**
  - `setup failed` (red): the prepare-worktree script failed → **See error**
  - `stale merge` (grey): a branch is stale in an integration branch → **Re-merge**
- Empty state: `Nothing needs you right now.`
- Footer, one quiet line: `10 background runs · 2 waiting on CI · 2 interactive sessions` and an **All sessions** toggle that reveals the full session list (grouped by task, as the old All agents page) for finding older sessions. Stopped sessions also remain in each task's Sessions tab; archived ones through History.
- The tab badge counts these items.

## 11.1 Backlog (capture now, order later)

Named **Backlog** (was *Inbox*): an ordered list of things you might do, not on the plan yet. "Inbox" suggested things arriving for you, which is what **Needs you** is.

A place to throw things out of your head. Backlog items are **not on the plan**: no repo, day, pipeline or branch. But they already carry context.
- **Layout:** list on the left, a **right panel** for the selected item (same look as the task panel, 520px).
- **Capture** from the tab-bar box anywhere, or the input at the top of the Backlog (Enter adds to the top).
- **List row:** `↑` `↓` (order = priority; top is most important) · **→ Task** · `✕` · when added · the text (editable in place) · at the end, quietly, what it already has: `PAY-140 · issue web-app#882 · notes`. Click a row to select it.
- **Panel:** chip `backlog · not planned` · title · `captured today`; actions **→ Plan as task** and **Delete**. Fields: **Title**, **Jira** (paste link or key → status chip + key link + title after sync, copy, ✕ to remove), **GitHub** (paste a PR or issue link → `PR`/`issue` chip + `issue web-app#882`, copy, ✕), **Notes** (the same rich text editor as tasks).
- **→ Plan as task / → Task:** creates a task in **Spec**, unscheduled (**Later**), no repos yet, carrying over the **title, Jira, GitHub link and notes**; removes the item; opens the task. Add repos there with `+ <repo>`, or attach existing branches with `+ Add branch`.
- Stored locally; order is preserved.

The **task panel** gets the same **GitHub** row (task-level link to an issue or PR) under Jira.

## 12. Data model (replaces SPEC.md §6 where different)

```ts
interface Folder { path: string; watch: boolean; }
interface Repo { name: string; nickname: string; path: string; source: 'added' | string /* folder path */; integrationBranches: string[] /* besides main */; prepareScript: string; prepareTimeout: string; environments: { name: string; deployedShaScript: string }[]; }
interface UiState2 { showAllItems: boolean; showHistory: boolean; }
interface WorktreeSetup { state: 'running' | 'ready' | 'failed'; startedAt: string; finishedAt?: string; exitCode?: number; log: string; }
interface Deployment { env: string; deployedSha: string; checkedAt: string; status: 'deployed' | 'stale' | 'not deployed'; missingCommits?: number; }
interface Task {
  id: string; kind: 'task' | 'review' | 'parked';
  title?: string; owner?: string;                       // owner: review items
  jira?: { key: string; title: string; status: string; url: string } | null;
  workflowId: string; stageId: string /* or 'done' */;
  githubUrl?: string;   // task-level issue/PR link
  runs: Run[];   // per step × branch
  // status is derived (§5), not stored
  est?: string; notes?: string /* Markdown */; color: number /* palette index, never reassigned */;
  branchIds: string[];
}
interface BacklogItem { id: string; text: string; addedAt: string; jira?: string; githubUrl?: string; notes?: string /* Markdown */; }   // ordered list = priority
interface Workflow { id: string; name: string; stages: Stage[]; }   // persisted as YAML, see §5.1.1
interface Stage { id: string; name: string; kind: 'user' | 'agent' | 'script'; status: 'To do' | 'In progress' | 'In review' | 'Done';
  tui?: boolean; prompt?: string;                       // user
  steps?: PipelineStep[];                               // agent
  command?: string; scope?: string; onFail?: string; timeout?: string;   // script
}
interface Run { taskId: string; stepId: string; branchId: string; state: 'pending' | 'running' | 'stuck' | 'failed' | 'back' | 'done'; loops: number; note?: string; sessionId?: string; output?: string; }
interface PipelineStep { id: string; name: string; scope: 'once' | 'each repo' | `only ${string}`; gate: 'auto' | 'approve'; onFail: 'stop' | 'retry 1' | 'retry 2' | `back:${string}` /* step id */; timeout: string; prompt: string /* with {task} {jira} {repo} {branch} {worktree} */; }
interface Session { id: string; mode: 'tui' | 'headless'; state: 'running' | 'stopped'; activity?: 'input' | 'working' | 'waiting' | 'idle'; stepId?: string; resumes?: string /* headless id this TUI resumed */; taskId: string; branchId?: string; lastActive: string; }
interface Branch {
  id: string; repo: string; taskId: string;
  name: string | null;                                   // null until created (new work)
  kind: 'mine' | 'review' | 'parked'; owner?: string;
  base: string; ahead: number; behind: number;
  mergedIntoMain: boolean;
  setup: WorktreeSetup | null;            // null until the worktree exists
  deployments: Deployment[];
  into: Record<string /* integration branch */, 'merged' | 'stale'>; intoNote?: Record<string, string>;
  pr?: { num: number; title: string; state: string; url: string } | null;
  sessions: Session[]; files: [string, string][]; commits: [string, string][]; dirty: [string, string][];
}
interface Plan { day: Record<string /* taskId */, string /* ISO date */>; order: string[] /* taskIds */; queuedAfter: Record<string, string>; unpushed: Record<string, true>; }
```

## 13. Not carried over yet / dropped

- **Dropped:** workflows stored only in the app (now YAML files); manually set task status (now derived from the workflow); one state per step for all repos (now per branch); scroll-to-load history (now a button); one `+ repo` button per repo in the task panel (now a select); Add in the plan header (now in the tab bar); fixed Spec/Implementation/Release phases and separate pipelines (now workflows with configurable stages); the `! needs you` text pill (now just `!`); the All agents page as a main tab (now behind **All sessions** on Needs you); per-state agent icons on cards (only `! needs you` remains); merged-into chips styled like repo labels; the UI label "Open in TUI" (now **Take over**); repo tabs; per-branch days and splitting a stack across days; drag-and-drop through the Claude dialog; notes per branch (now per task).
- **Dropped in this iteration:** hand-made steps per task (replaced by pipelines); the steps list with Start/Open/Retry per manual step.
- **Not yet ported** to v2 (keep from SPEC.md when implementing unless we decide otherwise): the selection **ripple** highlight (`↻ rebases` outline on boxes that must rebase when the selected work merges) and the "On merge" line.
