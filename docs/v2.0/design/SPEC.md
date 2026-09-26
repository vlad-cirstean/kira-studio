# Agent Merge Queue — UI spec

Desktop-only Vue 3 app for one developer running many Claude Code CLI agents in parallel, across several repos. Every branch lives in its own git worktree. The app answers at a glance:

1. In what order will my work merge, and on which day?
2. How is each stack related to the others (stacked, waiting on someone else, sharing files, conflicting, clean)?
3. What needs an action right now, and which agent does it?

`mockup.html` is the approved mockup as a standalone page (Vue 3 from a CDN; open in a browser). It has the exact markup, styles, mock data and logic (`Component.renderVals()`, `sendDialog()`). **This document wins where they differ.** Scope: UI only, mock data behind a typed data layer.

Every label on screen is a fixed short template filled from data. No free-form explanations.

**Layout rule: facts first, titles last.** In every row, header and list, put the short, fixed-width, important information (status, activity icons, counts, dates, actions) **before** the title, and let the title take the remaining space and truncate with an ellipsis at the end. Titles (and branch names) can be very long; a long title must never push status or actions out of view, and you should never have to scan to the far right of a row to learn its state. When adding any new row or header, follow this order.

---

## 1. Concepts

| Term | Meaning |
|---|---|
| Repo | A project's main worktree. One tab per repo. |
| Branch / work | One unit of work in its own worktree. `kind`: `mine`, `review` (someone else's, read-only, never rebased), `parked` (not merging). |
| New work (draft) | Work added from a Jira ticket or just a written title, with **no branch yet**. It has a title and/or Jira key, a *start-from* branch (`main` or any branch in the queue), optional notes and an estimate. It's planned like any work. **Claude creates the branch and worktree when you press Start**; from then on it's a normal branch. |
| Title | Display name of the work. User-set name, else the title typed when adding new work, else Jira title, else PR title, else branch name. |
| Stack | A branch plus everything built on it. Derived from git base, never from user-named groups. |
| Queued after | User choice to put a stack after a review branch it conflicts with (parent override). |
| Session | A Claude Code CLI process, `running` or `stopped`, tied to one branch/worktree. The app knows every session ever started on this machine. |
| Activity | For a running session: `needs input` (waiting for me), `working`, `waiting on monitor` (sleeping until a monitor wakes it, e.g. CI), `idle`. |
| Estimate | `30m`, `2h`, `1d`, `3d`, `1w`. Workday = 6h (configurable). `1d` = a full day. `≥2d` means the work **spans** at least that many working days (merging on the last) and reserves **half a day** on each of them (configurable). `1w` = 5 working days. |
| Work color | Each branch gets its own color from a fixed 20-color palette, assigned once and never changed. |
| Plan | Per repo. **Every branch has its own day** (calendar date) plus a position. A child can't be scheduled before its parent; without its own day it follows its parent. |
| Merged | A branch whose commits landed on `main` (detected on Refresh). |
| Archive | Stop the branch's agents, **delete its worktree**, and hide it from the queue. The branch, sessions, notes, links and estimate are kept; it appears in History. |
| Day off | A day the user marked off: visible but greyed, blocks drops, skipped by spans and automatic moves. |
| Weekend | Sat/Sun are off by default: greyed, skipped by spans and automatic moves, but **manual drops are allowed**. Right-click → `Work this day` makes one a working day. |

---

## 2. Layout

### 2.0 Activity icons (used everywhere)
One small, **static** icon per running session (nothing animates), same set in the queue rows, the Agents tab and the All agents page. Sorted by urgency: needs input > working > waiting > idle.

| Activity | Icon |
|---|---|
| needs input | amber filled circle with `!` (row gets an amber tint on the All agents page) |
| working | solid green dot with a soft green halo |
| waiting on monitor | blue ring with `z` |
| idle | grey hollow dot |
| stopped | small grey square |

### 2.1 Repo tab bar (40px, top)
- **Pinned first tab: `All agents`**, then one tab per repo (`web-app`, `api`, …). Selected tab: amber top border.
- Tabs show **only the needs-input count**, placed **before** the name (`! 2 web-app`), hidden when zero. The pinned tab totals all repos. Long repo names truncate.
- **Refresh is per project**, at the top of each repo view (see 2.3), not in the tab bar.

### 2.2 All agents view (pinned tab)
- Segmented filter: **Active N** (running sessions, default) / **Older N** (stopped sessions). Next to it (Active only), the aggregated activity: `! 3 needs input · ● 6 working · z 2 waiting on monitor` (same icons as §2.0).
- Sessions grouped by repo (mono repo header), sorted by urgency within a repo.
- Row: color bar · activity icon · activity label (colored) · last active · **Open/Start** · `claude <id>` · then **title** over `branch  worktree` (mono, muted), truncating.
- Archived branches' sessions are stopped and listed under Older (`stopped · archived`).
- Active → **Open** (goes to the repo tab, selects the branch, opens its Agents tab on that session). Older → **Start** (Claude dialog with `same worktree` / `new worktree` and the editable message).
- Needs-input rows get a faint amber background.
- Content max-width ~1040px.

### 2.3 Repo view
Queue (flexible) + **resizable detail panel**: default width = half the window (720px at 1440), drag the vertical handle between them (min 340px).

**Project header** (sticky, first row of the queue): project name (mono) · fetch status (`fetched 4m ago · autofetch off`, `fetching…`, or `just now · 3 refs changed · 1 merged · conflicts rechecked`) · spacer · a prominent filled **`↻ Refresh`** button (28px). **Autofetch is off by default**, so this is the main way to update. Refresh fetches *this project* in the background, reruns the conflict check for every ref that moved (§3.1), and detects merged branches.

**`main` line** (sticky, under the project header): `main` · `N stacks behind` / `all stacks current` · **Rebase all** (only if something is behind; Claude dialog). **Add branch** sits next to it.

**Add** (button next to the `main` line) opens a popover with two tabs:
- **New work** (default): `Title` · `Jira` (paste link or key, optional) · `Start from` (select: `main` or any non-draft branch in the queue) · `Notes` (context for Claude, optional) · **Add to Later**. Needs a title or a Jira key. Hint: `No branch yet. Claude creates it on Start.` The new item is selected in the panel.
- **Existing branch**: search + list of branches not yet in the queue, **newest first**: relative time · author (`you`, or the owner in blue) · branch name. Mine → `mine` (lands in `Later`, shows Start if it never had a session); someone else's → `review`. No typing branch names by hand.
- If *Start from* is a branch in the queue, the new work is stacked on it (indented under it, follows its day, may split onto a later day).

**Timeline** (ruler 60px). One continuous vertical list, oldest at the top:
- **History is hidden by default.** The top of the scroll area is **current work** (the oldest day that still has work on the board, e.g. a leftover or merged-but-not-archived branch, otherwise Today); scrolling up naturally stops there. Above it sits a dashed row: `↑ History · 6 archived in the last 2 weeks`.
  - To open it you have to mean it: keep scrolling up while already at the top. The row fills in purple and reads `Keep scrolling up to open history` → `Release to open history`; after enough wheel distance (~400px) history opens. The pull resets if you stop for ~0.7s. Clicking the row also opens it.
  - When it opens, the view stays where it was; history is one scroll above. Past days show work archived that day as compact read-only rows (`✓ merged · archived <title> <branch>`, purple tint).
  - While scrolled into history, a sticky **History** bar appears under the `main` line: **Go to [date]** · **Hide history** · **Current work ↓**. Switching repo tabs hides history again.
- **Past days with unmerged work** (overdue) are tinted amber with `N stacks not merged` + **Move to today**: moves them to the front of today (or the next working day if today is off) in their existing order (applies directly, no Claude dialog).
- **Today and the future**: calendar days, labelled `Today`, `Wed 23`, … with the month on the first day of a new month (`Thu 1 Oct`). **Weekends are shown greyed and hatched** (compact rows). Solid separator on Mondays and above Today. The next 2 weeks are shown by default; empty days collapse to a thin row. **`+ week`** / **`or date`** under the last day extend the range. Any day with work is always shown.
- **Capacity**: each working day holds 6h (`Later` has no capacity). When a day's total goes over, its hours turn red and a strip appears: `1h over 6h · [Move to Wed 23 · <title>]` (or `Move to Wed 23 · N branches`). It moves the **last branches that start that day** (in merge order) until the day fits; anything stacked on them follows. The target is the next working day (skipping weekends and days off). If that day now overflows, it shows its own button, and so on. Applies directly (no Claude dialog).
- **`Later`** is the last section: unscheduled work.
- **Day off** (right-click a weekday → `Mark as day off` / `Mark as working day`; right-click a weekend day → `Work this day` / `Mark as weekend (off)`): the row turns hatched grey, the label is struck through with `off` under it, it doesn't accept drops, and multi-day work skips it. If work was planned to start that day, a confirm asks `Move N branches planned for that day to <next working day>?` → **Move to Fri 25** / **Leave it**. Past days can't be marked.
- The whole day row is a drop target (not past days, not days off). Day totals show hours (`8h`).

**Splitting a stack across days.** Every row is draggable on its own; the box is draggable as a whole.
- Drag a **row** to another day to split it off: that branch (and anything stacked on it that has no later day of its own) moves; the rest of the stack stays. Dropping a branch before its parent's day is refused.
- A stack that spans several days renders as **one box per day** (a "segment"). Later segments have a dashed border, a grey `↳ stacked` tag with `from <parent's day>` next to it; the first row's elbow is dashed to show the link to the previous day.
- Dragging a **box** moves every branch in that segment.

**Multi-day work** (estimate ≥ 2 days, or hours that exceed a workday):
- The stack box sits on its **start day** (where it's planned). Its action column shows `3d → Mon 28` (span and merge day) in a free cell.
- Each following day of the span shows a thin dashed continuation row: `↳ day 2/3 <title>`, and on the last day `↳ day 3/3 · merges <title>` (amber). Clicking a continuation selects the stack and scrolls to its start day. It's the same work, not a copy.
- Merge-order logic uses the **merge (last) day**: the stack is ordered, and rebases, after work that merges before it (so a 3-day task is the one rebasing on other work).
- Day totals include the span: a `3d` task adds 3h (half a day) to each of its 3 days.

**Work colors.** Each branch shows its color as a 10px rounded square before its title (filled for my work, outlined for review branches, dashed outline for not-merging). The same color is used for continuation rows (left edge), the detail panel header, and the All agents rows (thin left bar). Assignment rules:
- Palette of 20 colors (`#e07a4f #e3a53c #c9c23a #8cc152 #4db86c #35b5a0 #38a8cc #4a8ee6 #6e79ea #9a6ee2 #c566d8 #e062a8 #e35f79 #b88458 #94a35a #58a08e #7b92b8 #a57ec0 #d58c8c #a3aab4`).
- New work (no branch) shows its color square hatched. A branch gets a color the first time it appears in a repo: the first palette slot not used by any other visible branch in that repo; if all 20 are in use, the least-used slot.
- Once assigned it's **persisted and never changes**, whatever happens to order, days, names or stacks. Archived branches keep theirs (visible in History); their slot becomes free for new work.

**Someone else's work** (`review`) must be unmistakable, because you can't change it:
- In the graph: the row has a faint blue diagonal-striped background, a blue title, an outlined color square, and a blue pill with a lock icon and the owner (`🔒 sara`) before the title. It isn't draggable. Its box's position comes from the work that depends on or conflicts with it.
- In the panel: an outlined color square in the header, the mono line `<branch> · <owner> · review`, and a blue banner with a lock: `<owner>'s work. Read-only here: you can run agents on it and keep your own notes.`
- What you **can** do: run/resume Claude Code sessions (e.g. to review it), write notes, copy links, Archive (remove it from the view).
- What you **can't**: rename it, edit or paste Jira/PR links (shown read-only; `—` if missing), set an estimate (the row is hidden), rebase or move it.

**Merged work** is made obvious in the graph: the box gets a purple border, the merged row a faint purple background, and its action cell shows `✓ merged` plus a solid purple **Archive** button. Merged work is never counted as overdue and has no Start button.

**Action column** (210px, right-aligned, left of each box). **All labels and buttons for work live here, never inside a box.** It has one cell per row, exactly one row tall (40px, aligned with the row), holding one line: `tag` · `button(s)`.
- First row of a box: the stack tag (§3) + its action (`Rebase`, `Queue after`, `Force push`), or that row's own action if the stack has none.
- Any row: its own action on its own line: merged → `✓ merged` + **Archive**; genuinely new work → **▶ Start**.
- Extra facts go in free cells, in this order: span (`3d → Mon 28`), where a split stack continues from (`from Wed 23`). If no cell is free they go in the tag tooltip.
- Tags max ~120px and truncate; buttons never wrap.

**Stack box** (fills the width up to 560px, 3px left edge in tag color, 40px rows). Each row shows only, and **no buttons**:
indent/elbow · **work color square** (see Work colors) · **agents pill** · owner pill (someone else's work) · then, last, **title** (line 1, sans 13px/600) over **branch name** (line 2, mono 11px, muted; omitted if equal to title; for new work: italic `no branch yet · from <start branch>`). The whole row selects on click; the title is also a button for keyboard users.
- **Agents pill**: running sessions are grouped in a small dark capsule (22px tall, `#0f1013` background, `#34373f` border, rounded) that starts with the Claude Code icon, then one activity icon per session. This keeps them visually separate from the work color square. Omitted when nothing runs.
- Each activity icon is a button. **Hover/focus** shows a tooltip right away: `claude <id>` / `<activity> · <last active>` (activity in its color). **Click** selects the branch and opens that session's terminal in the Agents tab.
- Boxes must not clip overflow, so tooltips can extend outside them.
- The selected row has a 3px amber left border and a lighter background. Rows are 40px; a row is also a drag handle (see Splitting).

**Not merging** (`parked`) branches live on the same timeline (`Later` when unscheduled) and keep their hatched, dashed look with a grey `not merging` tag. They never take part in merge logic (no merge position, conflicts, shares or ripple), but can be dragged to any day so their work is planned and monitored; their estimates count toward day totals. Moving them changes only the plan, so it applies directly with no Claude dialog.

### 2.4 Detail panel (resizable, default half width)
**Header:** work color square · work status chip (§3) · title (truncates). Mono line: `<start day>[–<merge day>] #<merge position> · <branch>`; `merged` once merged; review branches: `<owner> · review`; not-merging: `<day> · not merging`. Actions: `Force push (N)` (when the stack has unpushed branches), `Rebase onto main` / `Rebase onto <branch>`, `Archive` (primary purple when merged; otherwise a secondary button, e.g. to drop abandoned work or finished review branches), `Rebase stack`, `Queue after <branch>`, `▶ Start agent` (new work only), `Merge` (ready only). All git actions go through the Claude dialog. **Archive** tooltip: `Stop its agents, delete its worktree and hide it. The branch, notes and links are kept; it stays in history.`

**Archiving safely.** Before deleting the worktree the app checks it:
- **Nothing at risk** (no uncommitted changes, and no commits missing from main, e.g. it's merged) → archive immediately.
- **Something at risk** → a dialog `Archive: work would be lost` with one amber line (`1 uncommitted file · 5 commits not merged into main. Tell Claude what to do with it, or delete the worktree anyway.`), the usual agent choice, and the editable message:
  ```
  This branch is being archived and its worktree will be deleted.
  - Branch: feat/usage-billing
  - Worktree: ~/wt/web-app/usage-billing
  - Uncommitted changes: src/payments/invoice.ts     ← only if any
  - Commits not merged into main: 5                  ← only if any
  Before it is deleted: <you type what you want, e.g. commit to a wip branch and push>
  ```
  Buttons: `Cancel` · **`Just delete`** (red outline: skip the agent, delete the worktree now, uncommitted changes are lost) · **`Send to Claude, then archive`** (the agent handles it; the app deletes the worktree and archives once the agent reports done).
- New work without a branch and someone else's branches have nothing at risk and archive immediately.
- Restarting an archived session from All agents only offers `new worktree`.

**Tabs:** `Details` · `Changes` · `Agents <running count>`.

**Details** is a dense label/value grid, 28px rows, no cards. **Status comes first**, in a fixed-width column so refs line up:
```
Name      [Usage-based billing           ]   ← input; empty shows the default title as placeholder
Branch    conflict     feat/usage-billing                    ⧉
Jira      In progress  PAY-102  Usage-based billing        ⧉ ✎
PR        Open         #1427    Usage-based billing        ⧉ ✎
Estimate  [5] [hours|days]   spans 3 days
Notes     [B I </> H • 1. ☐ 🔗]  rich text editor filling the rest
```
- Status chips are read-only. Branch row (git state vs `main` only, distinct from the header's work status; first match): `not created` (grey, new work) · `merged` (purple) · `rebasing` / `pushing` (amber) · `conflict` (red) · `not pushed` (amber) · `base conflict` (amber) · `↓N behind` (amber) · `base behind` (amber) · `read-only` (blue, review branches) · `up to date` (green). CI results belong to the PR, not the branch. Jira `To do` (grey) / `In progress` (amber) / `In review` (blue) / `Done` (green); PR `Draft` (grey) / `Open` / `Approved` (green) / `Changes requested` (red) / `Merged` (purple) / `Closed` (grey). Pasted links show `syncing` until the API fills title and status.
- For new work the Branch row is `not created` (grey) · `from [select]` (change the start-from branch) · `branch created on Start`. The header mono line reads `no branch yet · <day> #<pos>` and the work status is `not started`. Worktree in Changes: `created on Start`.
- The Branch ref links to the branch on GitHub (`/tree/<branch>`). The ref (`feat/…`, `PAY-102`, `#1427`) is a real `<a>` (right-click → copy link works); the title follows, truncated. ⧉ copies the URL (✓ briefly). ✎ turns the row into an input.
- Missing Jira/PR → the row is an inline dashed input (`paste Jira link` / `paste GitHub PR link`) + Save. Parse `ABC-123` / `/pull/123`.
- **Notes** are a **WYSIWYG rich text editor**, per branch, filling the rest of the tab. It formats as you type, like any rich text editor; there is no Markdown source view and no Edit/Preview switch.
  - Toolbar: **Bold** · *Italic* · Code (inline) · Heading · Bulleted list · Numbered list · Checklist · Link. Buttons don't steal focus from the text. Link opens a small inline URL field in the toolbar (`https://`, Enter to apply, Esc to cancel); it links the selection or inserts the URL.
  - Checklist items have a clickable box; done items are struck through. The Checklist button turns the current list into a checklist (or back), or starts a new one.
  - Standard shortcuts (Ctrl/Cmd+B, I) work. Links open in a new tab with Ctrl/Cmd+click.
  - **Storage is Markdown** (headings `##`, `-`, `1.`, `- [ ]`/`- [x]`, `**`, `*`, `` ` ``, `[text](url)`); the user never sees it. Load = Markdown → rich content; every edit = rich content → Markdown.
  - Implementation: use **TipTap** (ProseMirror) with a Markdown serializer (e.g. `tiptap-markdown`) and the task-list extension. The mockup uses `contenteditable` + `execCommand` only to demonstrate the behaviour.
  - Notes are editable for someone else's work too.
- **Estimate** is a number plus an `hours | days` toggle. Switching the toggle keeps the number and changes the unit (`3` hours ↔ `3` days). `spans N days` appears when it does.

**Changes:** Base + ↑ahead ↓behind · Worktree path (+ `N uncommitted`) · On merge (`rebase a, b` / `nothing to rebase`) · Conflicts (branch · files) · Shares (branch · file) · Uncommitted list · Commits · Files (conflicting files red).

**Agents:** one terminal tab per running session (activity icon + `claude <id>`) + `+` (new session → Claude dialog). Under the tabs, a one-line status strip for the selected session (icon · activity · last active; amber tint when it needs input). `xterm.js` terminal + input. **Stopped** list at the bottom: `claude <id> · last active · Resume`.

### 2.5 Icon
The mockup uses a generic terminal glyph in Claude orange. **Replace it with the official Claude Code icon asset** everywhere.

---

## 3. Rules (all derived from data)

**Conflict:** a `mine` branch shares a changed file with a `review` branch that isn't its ancestor.
**Shares (after):** the nearest stack above containing a `mine` branch that shares a changed file with this stack.
**Ripple (on selection):** the selected branch's descendants + all branches of stacks whose "after" is the selected branch.
**Behind:** a root's `behind` vs `main` (0 after rebase).

**Rebase targets.** Rebasing isn't always onto `main`:
- `↓N main` → rebase the stack onto `origin/main`.
- `↻ <branch>` (work that merges before it touches the same files) → rebase the stack onto **that branch**. Afterwards it's stacked on it (parent override, like "queued after"), so it moves into that branch's stack and follows its day.
- `✕ conflict` with a review branch → **Queue after** = rebase onto `origin/<review branch>`.
- Never offered when the stack's root is someone else's branch (you can't rebase their work; it waits until theirs merges).

**Push is a separate step.** A rebase is local by default. Afterwards every rebased branch is `not pushed` (Branch chip, work status, and the stack's `↑ not pushed` tag) with a **Force push** button in the graph and the panel (`Force push (3)` pushes the stack's unpushed branches). The app runs `git push --force-with-lease` directly when you press it; no agent involved. In the rebase dialog, a switch **Also force-push after rebasing** (default **off**) lets the agent push as part of the rebase instead.

### 3.1 How conflicts are computed (backend note)
The conflict / overlap check is a **diff run entirely in memory** (no worktree checkout, no temp files), implemented with a **native Go git library** (e.g. go-git) reading the repo's object database: compute each branch's changed paths against its merge base and, for conflict candidates, a three-way tree merge in memory. It runs on startup, after **Refresh** for every ref that changed, and after any Claude Code action that moves refs (rebase, queue after, move). The UI only consumes the results (`conflicts`, `shares`, `behind`). Git-changing work is done by Claude Code; the one exception is **Force push**, which the backend runs directly when you press it.

**Work status** (the chip in the panel header; first match): merged → `merged` (purple) · parked → `not merging` · review → `conflict`/`review` · new work → `not started` · rebasing · pushing · conflict · not pushed · review → `conflict`/`review` · rebasing · has conflict → `conflict` · ancestor conflict → `base conflict` · behind → `↓N main` · ancestor behind → `base behind` · CI failing · no sessions ever → `new` · root is review → `waiting` · ready → `ready` · else `up to date`.

**Stack tag** (first match):

| Condition | Tag | Tone | Action | Tooltip |
|---|---|---|---|---|
| merged into main (after Refresh) | `✓ merged` | purple | **Archive** (in the action cell) | `landed on main` |
| not merging (parked) | `not merging` | grey | — | `kept out of the merge order; overlaps ignored` |
| any branch conflicts | `✕ conflict` | red | `Queue after` | `conflicts with <branch>: <files>` |
| in selected branch's ripple | `↻ rebases` + amber outline | amber | — | `rebase after <branch> merges` |
| rebased locally, not pushed yet | `↑ not pushed` | amber | **`Force push`** (app runs `git push --force-with-lease` for those branches) | `rebased locally; the remote still has the old commits` |
| root behind main | `↓N main` | amber | `Rebase` → onto **main** | `N commits behind main` |
| shares files with a stack above | `↻ <branch>` | amber | `Rebase` → onto **that branch** (only if the stack's root is mine) | `shares <file> with <branch>; merges after it` |
| later segment of a stack split across days | `↳ stacked` (+ `from <parent's day>` in a free cell) | grey | — | `continues the stack of <title> from <day>` |
| root is a review branch | `⏳ <owner>` | blue | — | `based on <branch>` |
| review-only, nothing depends on it | `unused` | grey | — | `nothing depends on it` |
| otherwise | `✓ clean` | green | — | `no shared files with stacks above` |

---

## 4. Claude Code dialog

All git-changing actions are performed by Claude Code, not by the app: **Rebase**, **Rebase stack**, **Rebase all**, **Queue after**, **drag-and-drop move**, **Start / Resume / new session**.

Dialog contents (nothing else; the message is the single source of truth):
- Title (`Rebase`, `Queue after <branch>`, `Move work`, `Start Claude Code`, `Resume Claude Code`, `Start new work`).
- **Branch name** (Start new work only): an **empty**, optional input, placeholder `optional, Claude picks one if empty`. Nothing is generated. If left empty, the message asks Claude to create a branch with a short descriptive name.
- **Target agent** per affected stack (not for Start new work, which always starts a new session):
  - exactly one running session → preselected (`claude 3f2e (only agent)`), the message is forwarded to it;
  - several → chips to choose one;
  - none → `new session`.
- **Worktree** choice (only when starting from All agents): `same worktree` / `new worktree`.
- **Busy check** (Rebase / Rebase all / Queue after / Rebase onto a branch): the app looks at **every branch the operation would rewrite** (the root and everything restacked on it). If any of them has a session that is `working` or `waiting on monitor`, the dialog shows a red alert at the top, `Agents are busy on branches this would rewrite. Wait until they're idle or need input.`, lists each one (`activity icon · branch · claude <id> · activity`), and **disables Send**. It re-evaluates live, so Send becomes available as soon as those sessions go idle or need input. `idle` and `needs input` sessions don't block.
  - **Override (deliberate extra step):** the alert has an `Override…` button. Pressing it changes the alert to `Override on: this will be sent even though these agents are busy.` (button becomes `Undo override`) and turns Send into a red **Send anyway**. Two clicks, so it can't happen by accident. The override resets every time the dialog opens.
- **Also force-push after rebasing** switch (Rebase / Queue after only), **default off**. Off: the message says `Do not push.` On: `Then push each rebased branch with: git push --force-with-lease`.
- **Message to Claude**: an editable mono textarea prefilled with the exact prompt. It's generated from a fixed template until you edit it; after that your text is kept and a **Reset** link restores the template. Changing the branch name regenerates it only while unedited. There is no separate summary line or "extra instructions" box: type additions straight into the message.
- `Cancel` / `Send to Claude` (or `Start`).

**Templates.** Messages only use data the app really has: **branch names, worktree paths, Jira key + URL**, plus text the user typed (new-work notes). No test commands, file lists, PR steps or other invented details. Each branch lives in its own worktree, so a stack is restacked worktree by worktree (a single `--update-refs` can't move branches checked out elsewhere).

Rebase (onto `origin/main`, onto another branch of mine, or onto `origin/<review branch>` for Queue after):
```
Rebase feat/oauth-login onto main, then restack the branches built on it:
1. In ~/wt/web-app/oauth-login: git fetch origin && git rebase origin/main
2. In ~/wt/web-app/oauth-login-ui: git rebase feat/oauth-login
3. In ~/wt/web-app/oauth-e2e: git rebase feat/oauth-login-ui
Resolve any conflicts. Do not push.
If anything is unclear, ask me before changing anything.
```
Onto a branch of mine: `…git rebase feat/billing-dashboard`. Queue after a review branch: `…git rebase origin/sara/payments-refactor`, plus the line `Do not modify sara/payments-refactor.` Drafts (no branch) are never part of a restack.

Move:
```
Planned merge order changed: feat/deps-bump (~/wt/web-app/deps-bump) now merges on Mon 5 Oct, before feat/search-index.
No git changes for now.
```
Start new work:
```
Start new work: Export invoices as CSV
- git fetch origin, then create a new branch from feat/usage-billing (pick a short descriptive name) in a new worktree under ~/wt/web-app/
    ← with a branch name typed: "…create branch <name> from <base> in a new worktree at ~/wt/<repo>/<last segment>"
- Jira: PAY-121 https://acme.atlassian.net/browse/PAY-121      ← only if there is one
- Notes: Reuse the invoice line items from usage billing.     ← only if typed
```
Start existing branch:
```
Work on Search results page.
- Branch: feat/search-ui
- Worktree: ~/wt/web-app/search-ui
- Jira: SRCH-42 https://acme.atlassian.net/browse/SRCH-42     ← only if there is one
```
Resume:
```
Resume session 51cd.
- Branch: feat/oauth-login
- Worktree: ~/wt/web-app/oauth-login          ← or "create a new worktree for it"
```
On Start, new work becomes a normal branch with the name Claude created (or the one you gave).

Drag-and-drop of my work opens the dialog on drop (target day shown in full, e.g. `Mon 5 Oct`); the plan changes only when sent. Moving not-merging work skips the dialog (no git work).

---

## 5. Ordering
1. Parent = git base, unless overridden by "queued after". Stacks = trees of parents.
2. Each branch's **effective day** = its own day if set, else its parent's; never earlier than its parent's (max of the two). Unset all the way up = `Later`. Review branches take the earliest day of the branches built on them.
3. A stack is split into **segments**: one per effective day, members in DFS order.
4. Segment span = the largest estimate span of its members; merge day = the last working day of that span (weekends/days off skipped).
5. Sort segments by (merge day, start day, position in `order[]`). This is the merge order; it's what "after", ripple and rebase logic use.
6. A review-only stack that conflicts with one of my segments sits directly above it (same day); other review-only stacks → `Later`.
7. Merge position = index among my branches in the flattened order.
8. Drop a **box** → every branch in that segment gets the target day. Drop a **row** → only that branch (split). Drop on another box → insert before it and take its day; on empty day space → append.
9. Parked branches use the same plan but are skipped for merge positions, conflicts, shares and ripple.
10. Days are stored as ISO dates; the mockup uses calendar-day offsets from a fixed "today".

---

## 6. Data model

```ts
interface Session { id: string; state: 'running' | 'stopped'; activity?: 'input' | 'working' | 'waiting' | 'idle'; lastActive: string; worktree: string; }
interface Branch {
  id: string; repo: string;
  name: string;                         // "feat/usage-billing"
  kind: 'mine' | 'review' | 'parked';
  owner?: string;                       // review only
  base: string;                         // parent id or 'main'
  ahead: number; behind: number;
  est?: string;            // '2h', '3d', …
  ready?: boolean; ciFailing?: boolean; merged?: boolean; archivedAt?: string;
  jira: { key: string; title: string; status: 'To do' | 'In progress' | 'In review' | 'Done' | string; url: string } | null;
  pr: { num: number; title: string; state: 'Draft' | 'Open' | 'Approved' | 'Changes requested' | 'Merged' | 'Closed'; url: string } | null;
  sessions: Session[];
  files: [path: string, delta: string][];
  commits: [sha: string, message: string][];
  dirty: [code: 'M' | '??' | 'D', path: string][];
}
interface CandidateBranch { name: string; author: string; lastCommitAt: string; } // for Add → Existing branch
interface NewWork { id: string; repo: string; title?: string; jira?: string /* link or key */; startFrom: string /* 'main' or branch id */; notes?: string; est?: string; branchName?: string /* set when started */; }
interface RepoPlan { day: Record<string /* branch id */, string /* ISO date */>; order: string[]; queuedAfter: Record<string, string> /* parent overrides: review branch or my branch it was rebased onto */; unpushed: Record<string, true>; }  // per-branch days; the mockup uses calendar-day offsets
interface ColorMap { [repoAndBranchId: string]: number /* palette index, never reassigned */ }
interface UiPrefs { historyOpen: boolean /* default false, resets per repo tab */; panelWidth: number; allAgentsFilter: 'active' | 'older'; horizonDays: number /* 14 */; historyDays: number /* 14 */; extraDays: string[]; offDays: string[]; workWeekendDays: string[]; workdayHours: number /* 6 */; spanDayShare: number /* 0.5 */; autofetch: boolean /* default false */; }
interface UserMeta { /* notes stored as Markdown, edited as rich text */ names: Record<string, string>; links: Record<string, { jira?: string | null; pr?: string | null }>; est: Record<string, string /* '5h' | '3d' */>; notes: Record<string, string>; }
```
Everything else (stacks, conflicts, shares, ripple, statuses, tags, positions, titles, day totals) is computed. Keep it in a pure `useQueue()` composable with unit tests (port from `renderVals()`).

---

## 7. Visual tokens
IBM Plex Sans / IBM Plex Mono. Dark: bg `#121316`, tab bar `#0e0f12`, panel `#16171b`, box `#1a1c21`, borders `#2a2d35`/`#3a3e48`, text `#e8e6e1`/`#c9c7c2`/`#9a9ca5`. Tones `[tint, text, solid]`: green `rgba(108,197,138,.14) #7fd49b #6cc58a` · amber `rgba(232,163,61,.14) #f0b85c #e8a33d` · red `rgba(239,107,91,.14) #f28b7d #ef6b5b` · blue `rgba(122,167,255,.14) #93b6ff #7aa7ff` · grey `#23252b #b4b6bd #6b6f7a`. Claude accent `#d97757`.

## 8. UI libraries
`vue-draggable-plus` (drag stacks), `xterm.js` (terminals), TipTap + `tiptap-markdown` (notes), Reka UI (tabs, tooltips, popover, dialog, combobox for the branch picker), Tailwind or UnoCSS.

## 9. Decisions to keep
Rejected along the way: git-graph lanes and long connector lines; columns by named category; full-width bars; separate merge-order strip; numeric priority next to merge numbers; on-screen legends; sentence-length statuses; a Markdown notes editor with Edit/Preview; buttons inside boxes (all actions live in the left action column); loose activity icons next to color squares; a dialog that repeats the operation as a summary plus a preview; auto-generated branch names; agents pushing by default; invented steps in agent messages (tests, PRs, file lists); always rebasing onto main; a global page/top bar (the per-project header stays); Jira/PR tabs (links live in Details instead); per-agent names ("Agent 1/2/3"); typing branch names by hand; extra details on queue rows (rows show title, branch, activity icons, Start only); a fixed-width panel; a separate `Not merging` row on the timeline; a fixed 4-day ruler; a small refresh icon hidden in the main line; a global refresh in the tab bar; history always visible above today; preset estimate chips; status after the title in link rows; animated activity icons; card-style link blocks; listing every session ever on the All agents page by default.
