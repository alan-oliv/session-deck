# Handoff: Projects sidebar, branch filters and row branch links

## Overview
This replaces the **repository tree** in the Session Manager (Minimal, option 2a) with a flat **Projects** sidebar. Branches and worktrees move out of the tree and become **filter chips above the session list**. Each session row gains a **clickable branch link**.

### Why it changed
Claude Code stores sessions by **working directory only**: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. A branch is just a string recorded on each message (`gitBranch`). This has four consequences:

- One session can span several branches.
- Branch names are historical; the branch may already be merged or deleted.
- Deleting a branch never loses a session.
- A worktree has its own cwd, so it gets its own storage folder.

A repo › branch › session tree misrepresents this, and in real data it turns into a long tail. One repository had 47 sessions across 17 branches, and 14 of those branches had only one or two sessions. People find a session by what they did, then by project; branch is a secondary filter.

### What replaces it
- **Sidebar**: All sessions, Needs you, then one flat **Projects** list (repositories and plain folders together, newest activity first).
- **Branch chips**: inside a project, chips for the branches and worktrees worth filtering by.
- **Row branch link**: on each session row; clicking it filters the list to that branch.

## About the Design Files
The files in this bundle are **design references created in HTML**. They are prototypes that show the intended look and behaviour, not production code to copy. Recreate them in the target codebase's environment (Electron + React, Tauri, SwiftUI…) using its established patterns and libraries. If no codebase exists yet, choose the most suitable desktop stack.

`session-manager-minimal.dc.html` is a single "Design Component": the template is the markup, and `class Component` at the bottom is the logic. The relevant pieces:

- `cVals`: builds the sidebar projects, the Needs you entry, the scope, the filter chips and the list title.
- `brVm`: builds the row branch link.
- `fits`, inside `cVals`: the scope filter.

## Fidelity
**High fidelity.** Colours, type, spacing and interactions are final and use the Linear Design System (Dark) tokens. Recreate them pixel-accurately.

**Supersedes**: the Tree sidebar sections of `design_handoff_session_manager_minimal/README.md` and section 3b ("Tree sidebar: Folders section") of `design_handoff_resume_folders_header/README.md`.

---

## Screens / Views

### 1. Sidebar
- **Size**: width 220px by default, resizable from 160 to 360px. Drag the 5px right-edge handle; double-click it to reset.
- **Look**: background `#191a23`, with a hairline on the right edge (`inset -1px 0 0 rgba(89,89,116,.25)`).
- **Structure** (flex column):
  1. Traffic-lights row: 38px tall, padding 0 14px.
  2. Scroll area: `flex:1; overflow-y:auto`, padding 6px 8px 16px, a column with a 16px gap between blocks.
  3. Settings row: pinned at the bottom; see `design_handoff_settings/`.

#### 1a. Nav row (shared by every sidebar row)
- **Size and shape**: height 28px, padding 0 8px, radius 4px, gap 8px, Inter 13px.
- **States**:
  - Default: text `#d2d3e0`, transparent background.
  - Hover: background `rgba(149,149,189,.125)`, text `#eeeffc`.
  - Selected: background `#393a4b`, text `#eeeffc`.
- **Contents**, left to right:
  - Icon or marker: a 14px slot, `#858699`.
  - Label: flex 1, single line with ellipsis.
  - Count: 12px `#858699`, right-aligned.

#### 1b. All sessions
- Icon `AllItems` 14px.
- Label "All sessions".
- Count: every non-archived session.

#### 1c. Needs you
- **Placement**: directly under All sessions, with no gap. The prototype uses `margin-top:-15px` to cancel the 16px block gap and leave 1px.
- **Marker**: a 6px dot in `#f2c94c`, centred in the 14px icon slot.
- **Label and tooltip**: label "Needs you"; tooltip "Waiting for you, interrupted or failed".
- **Count**: sessions with status `waiting`, `interrupted` or `failed`.
- **Visibility**: shown only when the count is above 0, or while it's the current scope, so the row doesn't vanish under the cursor.

#### 1d. Projects
- **Section header**: "Projects", 12px/16px `#858699`, padding 0 8px 6px.
- **Rows**: a column with a 1px gap. One row per project with at least one session. **No chevrons and no children.**
- **What a project is**: either a **repository**, or a **folder** (a working directory that isn't inside any git repo, e.g. `~/code`).

| Type | Icon | Label | Tooltip |
|---|---|---|---|
| Repository | `Box` 14px | repo name, Inter 13px | repo root path |
| Folder | `Storage` 14px | path, monospace (`ui-monospace, SFMono-Regular, Menlo, monospace`) 12px | "`<path>` (not a git repository)" |

- **Order**: by the most recent session start in the project, newest first. Repositories and folders are mixed together.
- **Count**: sessions in the project. For a repository this includes sessions in its worktrees.
- **Selected state**: a repository row stays selected while the list is filtered to one of its branches or worktrees.

### 2. List header (changed)
- **Container**: padding 14px 16px 10px, a column with a 12px gap.
- **Row 1** (baseline-aligned, gap 8px):
  - Title: 15px/500 `#eeeffc`, ellipsis.
    - Inside a project, the title is the **project name**, even while a branch or worktree chip is active. The chip shows the narrower filter.
    - Otherwise it's "All sessions", "Needs you" or the folder path.
  - Count: 12px `#858699`, e.g. "4 sessions". It counts the filtered list.
  - The ⌘⇧P key cap.
- **Row 2**: filter chips (2a). Only shown inside a repository that has something to filter.
- **Row 3**: view switcher. Only under All sessions; unchanged.

#### 2a. Branch and worktree filter chips
- **Container**: flex, `flex-wrap:wrap`, gap 4px.
- **Chip**:
  - Size and shape: `flex-shrink:0`, `max-width:100%`, height 24px, padding 0 8px, radius 4px, gap 5px, 12px/500.
  - Contents: an optional 10px icon in `#858699`, the label, then the count.
    - Label: single line; ellipsis only for names wider than the row.
    - Count: weight 400, `#858699`, tabular numbers.
- **Chip states**:
  - Default: background `#1d1e2b`, border `inset 0 0 0 1px #2c2d3c`, text `#d2d3e0`.
  - Hover: text `#eeeffc`.
  - Selected: background `#393a4b`, border `inset 0 0 0 1px #393a4b`, text `#eeeffc`.
- **Chips, in order:**
  1. **All**: no icon; count = every session in the repo. Tooltip: "Includes N branches with one session", only when N > 0.
  2. **Branch chips**: icon `Branch`. One per branch that **2 or more** sessions ended on, sorted by count, highest first. Tooltip: "Sessions that ended on `<branch>`".
     - If the current filter is a one-session branch (reached from a row link), its chip is added as well so the selection stays visible.
  3. **Worktree chips**: icon `Layers`. One per worktree of this repo that has sessions. Tooltip: the worktree path, plus " (removed)" if it's gone.
     - A removed worktree's label is struck through (`text-decoration:line-through`).
- **Visibility**: the row is hidden when the repo has no branch with 2+ sessions and no worktree. In that case "All" would be the only chip.
- **Clicking a chip**:
  - An inactive chip makes that filter active.
  - Clicking the active branch or worktree chip returns to **All**.
  - Clicking **All** keeps All selected.

### 3. Session row: branch link (new)
- **Row line 2** becomes flex, centred, gap 8px, 12px/16px `#858699`, `min-width:0`:
  - **Location** (`flex:0 1 auto`, ellipsis): `<repo> · <folder>` for repository sessions, just `<folder>` for folder sessions. Add " · N forks" when forked. In the Repository view the repo prefix is dropped.
  - **Branch link** (`flex:0 2 auto`, `min-width:24px`): it gives up space twice as fast as the location, so the path stays readable.
    - Size and shape: flex, gap 4px, padding 0 4px, margin 0 −4px (so the hover fill doesn't shift text), radius 3px.
    - Contents: `Branch` icon 10px, then the branch name with ellipsis.
    - Hover: text `#eeeffc`, background `rgba(149,149,189,.125)`.
    - Tooltip: "Last branch in this session. Click to show every session that ended on `<branch>`."
- **Hidden when**: the session isn't in a repository, has no branch, or the branch is `HEAD` (detached).
- **Click**: stops propagation, so it doesn't select the row. It sets the scope to `{ type: 'branch', id: <branch>, repo: <repo> }`. As a result:
  - the sidebar selects the repository
  - the chips appear with that branch active, added as a chip even for a one-session branch
  - the list shows only sessions that ended on that branch

---

## Interactions & Behavior
- **Scope transitions**:
  - Sidebar row → `all` / `needs` / `repo` / `folder`.
  - Chip → `repo` (All) / `branch` / `wt`.
  - Row branch link → `branch`.
- **Selection**: if the selected session falls out of the filtered list, the first row is selected.
- **View switcher**: only under All sessions; any other scope uses List.
- **Animation**: none (the design system defines no motion).
- **Empty**: "No sessions here." (13px `#858699`, centred, padding 48px 12px).

## State Management
```ts
type Scope =
  | { type: 'all' }
  | { type: 'needs' }
  | { type: 'repo'; id: string }
  | { type: 'branch'; id: string; repo: string }
  | { type: 'wt'; id: string }        // worktree id
  | { type: 'folder'; id: string };   // absolute/home-relative path
```
- `scope: Scope`, default `{ type: 'all' }`.
- Derived **project** for the selected scope:
  - `repo` → its `id`.
  - `branch` → its `repo`.
  - `wt` → the worktree's repo.
  - Any other scope → none.
- **Filter rules**:
  - all → every session
  - needs → `status ∈ {waiting, interrupted, failed}`
  - repo → `session.repo === id` (worktree sessions included)
  - branch → `session.repo === repo && session.branch === id` (worktree sessions included)
  - wt → `session.worktree === id`
  - folder → the session isn't in a repo, and `folder(session) === id`

### Data requirements (production)
- **Project key**:
  - Resolve each session's cwd with `git -C <cwd> rev-parse --show-toplevel`.
  - For a worktree, map it to its main repo via `git worktree list` or the `.git` file.
  - A cwd outside any repo is a **folder** project.
- **Branch**: use the **last** `gitBranch` value in the session's JSONL. That's "where the work ended up", which is what matters when picking a session to resume.
  - Keep the distinct set too, so the detail pane can later show "also touched main".
  - Treat the literal `HEAD` as detached and show no branch link.
- **Worktree**: the cwd differs from the repo root and is listed as a worktree.
  - Mark it **removed** when the directory no longer exists.
  - Its sessions are still on disk and still resumable; Claude Code resumes them in the current folder.
- **Moved or renamed repos**: an old cwd folder stays orphaned under `~/.claude/projects/`. Show it as its own project with its old path until the user re-links it. Re-linking isn't designed yet.

## Design Tokens
**Surfaces**
- sidebar `#191a23`
- chip `#1d1e2b`
- selected `#393a4b`

**Overlays**
- hover wash `rgba(149,149,189,.125)`

**Borders**
- default `#2c2d3c`
- strong `#393a4b`
- divider `rgba(89,89,116,.25)`

**Text**
- primary `#eeeffc`
- secondary `#d2d3e0`
- tertiary `#858699`

**Status**
- needs-you dot `#f2c94c`

**Type**
- Inter 400/500.
- 12px for chips, counts, row line 2 and section headers; 13px for nav rows; 15px for the list title.
- Monospace 12px for folder paths.

**Radii**
- 3px: row branch link.
- 4px: nav rows and chips.

**Spacing**
- Sidebar padding 6px 8px 16px, 16px between blocks, 1px between rows.
- Chip gap 4px.
- List header padding 14px 16px 10px.

## Assets
- **Icons** from the Linear DS icon set (`Icon` component, `currentColor`): AllItems, Box, Storage, Branch, Layers.
- No images.

## Files
- `session-manager-minimal.dc.html`: the prototype.
- `sessions-data.js`: sessions, repos and worktrees.
- `transcripts-data.js`: needed by the prototype to load.
- `support.js`: the runtime that renders the prototype in a browser.
- `_ds/linear-design-system-dark-…/`: design-system tokens and components.

To view it, serve this folder over HTTP (e.g. `npx serve .`) and open `session-manager-minimal.dc.html`. Then:

- Click **meetnotes** under Projects to see the chips.
- Click a branch on any row to filter by it.
- Click `~/code` to see a folder project.
