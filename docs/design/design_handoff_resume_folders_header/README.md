# Handoff: Resume button, folders and session header

## Overview
Three pieces of the Session Manager (Minimal, option 2a), handed off on their own:

1. **Session header**: the top of the detail pane, with the session title (renamable in place), the sub-line, and the actions row.
2. **Resume button**: the split button and its menu (Resume, Resume in a new terminal window, Branch conversation, Rename, Copy resume command, Open folder).
3. **Folders**: how working folders appear and behave:
   - the **Folders** section of the tree sidebar
   - the **Open folder** menu item
   - the **Folder** row in the session facts
   - folder grouping in the list

Everything else (window, list, Transcript, usage, command bar) is documented in `design_handoff_session_manager_minimal/` and `design_handoff_session_detail/`.

## About the Design Files
The files in this bundle are **design references created in HTML**. They are prototypes that show the intended look and behaviour, not production code to copy. Recreate them in the target codebase's environment (Electron + React, Tauri, SwiftUI…) using its established patterns and libraries. If no codebase exists yet, choose the most suitable desktop stack.

`Session Manager Minimal.dc.html` is a single "Design Component": the template is the markup, and `class Component` at the bottom is the logic. The relevant logic methods:

- `rmVm`: the Resume menu.
- `rnVm`: rename.
- `copy`, `cmd`: command strings.
- `path`, `isRepo`: folder resolution.
- `cVals`: the tree, including `folders`.
- `selVm`: facts.

## Fidelity
**High fidelity.** Colours, type, spacing and interactions are final and use the Linear Design System (Dark) tokens. Recreate them pixel-accurately.

---

## 1. Session header
**Placement**: the first block of the detail pane's Overview tab.
- The tab bar above it is 44px tall.
- The body has padding 40px 56px; content is a column with max-width 560px.
- The header is followed by the facts grid, with a 28px gap.

#### 1a. Title block (gap 8px)
- **Title**: `h2`, 22px/28px/500 `#eeeffc`, `text-wrap:pretty`, tooltip "Double-click to rename". Double-clicking it starts renaming (see 2d).
- **Rename field** (replaces the title while renaming):
  - Input: height 36px, margin 0 −8px, padding 0 8px, radius 4px, background `#1d1e2b`, focus ring `inset 0 0 0 1px #5e6ad2`, no outline. Text 22px/500 `#eeeffc`, placeholder "Session name".
  - Hint below (gap 6px), 12px `#858699`: "Enter to save · Esc to cancel. A name lets you resume from any folder with claude --resume <name>."
- **Sub-line**: 13px `#858699`. Format: `{relative start} · {model without "Claude "} · {transcript size}`, e.g. "Today, 9:12 AM · Opus 5.5 · 6.1MB".

#### 1b. Actions row (flex, centred, gap 8px)
1. **Resume split button + menu**: see section 2.
2. **PR link**: only when the session has a PR.
   - Margin-left 6px, 12px `#6c79ff`, underlined on hover. Tooltip "Copies claude --from-pr".
   - Copy: "All sessions for #30". After clicking it reads "Copied" for 1.6s.

---

## 2. Resume button and menu

#### 2a. Resume split button
- **Container**: height 28px, radius 4px, background accent `--brand` (default `#575bc7`), shadow `0 1px 1px rgba(0,0,0,.15)`, `overflow:hidden`.
- **Main part**: padding 0 12px, 13px/500 `#ffffff`, hover `rgba(255,255,255,.08)` wash.
  - Label "Resume". It shows "Copied" for 1.6s after Branch conversation runs, confirming the fork command went out.
- **Divider**: 1px wide, `rgba(255,255,255,.2)`, full height.
- **Chevron part**: 26px wide, centred `ChevronDown2` 10px in white, tooltip "More ways to resume".
  - Hover: `rgba(255,255,255,.08)`. While the menu is open: `rgba(255,255,255,.12)`.
- Clicking the **main part** resumes (same as the first menu item). Clicking the **chevron** toggles the menu.

#### 2b. Resume menu
- **Position and panel**: absolute, top 34px, left 0 (aligned to the button's left edge), z-index 21.
  - Panel: width 300px, padding 4px, radius 8px, background `#202128`, shadow `inset 0 0 0 1px #393a4b, 0 7px 24px rgba(0,0,0,.35)`.
- **Dismiss layer**: a transparent `position:fixed; inset:0; z-index:20` layer behind the menu. Clicking anywhere outside closes it.
- **Item**:
  - Flex, `align-items:flex-start`, gap 10px, padding 7px 8px, radius 4px. Hover `rgba(149,149,189,.125)`. Tooltip: the exact command the item runs.
  - Contents, left to right:
    - Icon 14px `#858699` (padding-top 1px, to align with the label).
    - Label 13px/16px `#eeeffc`.
    - Optional sub-line 12px/16px `#858699` (gap 3px below the label).
    - Optional key cap on the right: 11px/18px, padding 0 5px, radius 4px, background `#292a35`, border `inset 0 0 0 1px #393a4b`, text `#858699`.
- **Separator**: 1px `rgba(89,89,116,.25)`, margin 4px −4px (runs edge to edge).
- **Items, in order:**

| Icon | Label | Sub-line | Key | Runs |
|---|---|---|---|---|
| ArrowRight | Resume | Opens in your terminal, in the session's original folder. | ↵ | `claude --resume <handle>` |
| Layout | Resume in a new terminal window | none | none | `claude --resume <handle>` in a new window |
| (separator) | | | | |
| Branch | Branch conversation | Starts a new session from this point. The original stays as it is. | B | `claude --resume <handle> --fork-session` |
| Edit | Rename… | Give it a name so you can resume by name. *(only when the title was generated)* | R | opens the inline rename (2d) |
| (separator) | | | | |
| Clipboard | Copy resume command | none | none | copies `claude --resume <handle>` |
| Storage | Open folder | the working-directory path | none | reveals the folder in Finder |

**`<handle>`**: the session name if it was named (renamed), otherwise the session UUID.

#### 2d. Rename
- **Entry points**:
  - Double-click the title.
  - **Rename…** in the Resume menu.
  - **Rename session** in the command bar's Actions (`>`). This also switches to the Overview tab and selects the session.
- **On start**: the title is replaced by the input (1a), pre-filled with the current title, focused and fully selected.
- **Saving and cancelling**:
  - **Enter** or **blur** saves.
  - **Esc** cancels; it stops propagation so it doesn't also close other layers.
  - An empty or unchanged value cancels.
- **On save**: the new name takes effect everywhere at once: the list row, detail title, Transcript title, the command bar's "Actions on '…'" header and preview, and the resume handle. A named session resumes by name, so the Title fact switches to "Named. Resumes by name from any folder."
- **Confirmation**: the prototype sets the toast text "Renamed. Resume with claude --resume "<name>"" but doesn't render a toast. Production should show it as a short toast.
- **Persistence**: the prototype keeps names in memory (`names: { [sessionId]: string }`). Production should store the name where Claude Code reads it, so `claude --resume <name>` works in the terminal too. That means using Claude Code's own rename (`/rename` in the session) or whatever mechanism the current CLI exposes. Don't hand-edit the JSONL.

#### 2e. Branch conversation
- **Runs**: `claude --resume <handle> --fork-session`. The original session isn't modified; the new session gets its own ID.
- **Prototype**: copies the command and shows "Copied" on the main button for 1.6s.
- **Production**:
  - Open the user's terminal running the command.
  - The new session should appear at the top of the list.
  - The parent's **Forks** fact and the list row's " · N forks" suffix should go up by one.

### Command reference
| Action | Command |
|---|---|
| Resume / Copy resume command | `claude --resume <name>` or `claude --resume <session-id>` (works from any folder since Claude Code v2.1.223) |
| Branch / Fork | `claude --resume <name|id> --fork-session` |
| All sessions for a PR | `claude --from-pr <number>` |
| Background session (not modelled yet) | `claude attach <id>` |

---

## 3. Folders

### 3a. Folder resolution
Every session has one **folder**: the directory Claude Code ran in. It's resolved in this order:

1. The worktree path, if the session ran in a git worktree.
2. The session's recorded `cwd`.
3. The repository's root path.

A session counts as **in a repository** when its folder is inside a git repo. Sessions that ran outside any repo are **folder-only** sessions; in the user's data these are `~/code` and `~` (home).

> Production: Claude Code groups transcripts by working directory (`~/.claude/projects/<cwd-with-non-alphanumerics-as-dashes>/`). The real `cwd` comes from the transcript. Work out repo membership with `git -C <cwd> rev-parse --show-toplevel`. A missing directory means the folder or worktree was removed.

### 3b. Tree sidebar: Folders section
- **Placement**: below the **Repositories** section in the 220px tree sidebar. The two sections are separated by the scroll area's 16px block gap.
- **Section header**: "Folders", 12px/16px `#858699`, padding 0 8px 6px.
- **Rows**: a column with a 1px gap, one row per distinct folder-only path, in first-seen order (newest session first).
- **Row**: height 28px, padding 0 8px, radius 4px, gap 8px, 13px.
  - Icon `Storage` 14px `#858699`.
  - Label: the path in monospace (`ui-monospace, SFMono-Regular, Menlo, monospace`) 12px, single line with ellipsis, e.g. `~/code`.
  - Count: number of sessions, 12px `#858699`, right-aligned.
  - No chevron and no children; this differs from repository rows.
- **States**:
  - Default: text `#d2d3e0`.
  - Hover: background `rgba(149,149,189,.125)`, text `#eeeffc`.
  - Selected: background `#393a4b`, text `#eeeffc`.
- **Click**: sets the scope to `{ type: 'folder', id: <path> }`. The list shows only sessions whose folder equals that path, and the list title becomes the path. The view switcher is hidden (it only shows in All sessions).
- **Section visibility**: hide the whole section if there are no folder-only sessions.

### 3c. Folders in the session list
- **Row sub-line**: 12px `#858699` with ellipsis.
  - Repository sessions: `<repo> · <folder>`, e.g. "meetnotes · ~/code/meetnotes".
  - Folder-only sessions: just `<folder>`.
  - Forked sessions add " · 1 fork" / " · N forks".
  - In the Repository view, the repo prefix is dropped (the group header already names it).
- **Repository view**: folder-only sessions are grouped under the folder, with the header "~/code (not a repository)".
- **Worktree view**: sessions not in a worktree are grouped as "<repo> · main checkout", or under the folder path for folder-only sessions.

### 3d. Folder fact (Overview)
- **Placement**: the first row of the facts grid, under the session header.
- **Format**: label "Folder" (13px `#858699`, 96px column), then the path in monospace 12px `#d2d3e0`, `word-break:break-all`.
- **Repository row**: when the session is in a repository, the next row is "Repository" with `<repo> · <branch>` (Inter 13px).
- **Worktree row**: shown when the session ran in a worktree. The value is the worktree name, plus " (removed Oct 2)" if the directory no longer exists.

### 3e. Open folder (Resume menu)
- **Menu item**: the last item in the Resume menu, below the second separator. Icon `Storage`, label "Open folder", sub-line = the folder path (12px/16px `#858699`).
- **Action**: reveal the folder in Finder (Electron `shell.openPath`, or `NSWorkspace.shared.open`).
- **If the folder no longer exists**:
  - Disable the item at 50% opacity, with the sub-line "Folder no longer exists".
  - Keep Resume enabled: Claude Code resumes a session whose worktree is gone in the current folder.
  - The prototype doesn't model this state.
- **Same action elsewhere**: the command bar (⌘⇧P → `>`) has the same action, "Open folder".

---

## Interactions & Behavior
- **Resume (main part)**:
  - Prototype: copies the resume command and shows "Copied" for 1.6s.
  - Production: open the user's terminal and run `claude --resume <handle>`. Folder doesn't matter: since v2.1.223, resume works from any folder.
- **Chevron**: toggles the menu. Clicking outside (a transparent full-window layer at z-index 20) or choosing an item closes it.
- **Shortcuts**: the key caps ↵, B and R are hints. In production, wire them while the menu is open and while the detail pane has focus.
- **Rename**:
  - Start by double-clicking the title, choosing Rename… in the menu, or using the command bar.
  - Enter or blur saves; Esc cancels; an empty or unchanged value cancels.
  - The new name updates the list, the header, the transcript title and the resume handle together.
- **Branch conversation**: copies or runs `claude --resume <handle> --fork-session`. Afterwards, the new session appears in the list and the parent's fork count goes up by one.
- **Folder scope**: clicking a folder in the tree filters the list. Clicking "All sessions" or a repository changes scope again. If the selected session leaves the filtered list, the first row is selected.
- **Animation**: none (the design system defines no motion).

## State Management
- `selectedSessionId`
- `scope`: `{ type: 'all' | 'repo' | 'branch' | 'wt' | 'folder', id, repo? }`
- `resumeMenuOpen`: boolean
- `renamingId`: sessionId or null
- `renameValue`: string
- `names`: `Record<sessionId, string>`, user-set names
- `copiedKey`: `sessionId` or `sessionId:fork|pr`, cleared after 1.6s

### Fields read
```ts
type Session = {
  id: string; sid: string;        // app id, Claude session UUID
  title: string; auto: boolean;   // auto = generated from the first prompt
  start: string; model: string; size: string;
  cwd?: string;                   // working directory
  repo?: string; branch?: string;
  worktree?: { name: string; path: string; removedAt?: string };
  pr?: { n: number; title: string; repoFull: string };
  forks?: number;
};
```

## Design Tokens (used here)
**Surfaces**
- app `#181921`
- surface `#1d1e2b`
- elevated `#292a35`
- selected `#393a4b`
- hover wash `rgba(149,149,189,.125)`

**Borders**
- default `#2c2d3c`
- divider `rgba(89,89,116,.25)`

**Text**
- primary `#eeeffc`
- secondary `#d2d3e0`
- tertiary `#858699`
- link `#6c79ff`

**Brand and status**
- brand `#575bc7`
- focus `#5e6ad2`
- green `#4cb782`
- red `#eb5757`
- diff add background `rgba(76,183,130,.12)`
- diff delete background `rgba(235,87,87,.12)`

**Type**
- Inter 400/500 at 12, 13 and 15px.
- Monospace: `ui-monospace, SFMono-Regular, Menlo, monospace` at 12px.

**Radii**
- 3px: inline code.
- 4px: rows and boxes.
- 5px: segmented track.
- 8px: prompt bubble and end bar.
- Accent: user-configurable through Appearance; drives `--brand` and `--focus-ring`. Swatches: `#575bc7` (default), `#4ea7fc`, `#bb87fc`, `#26b5ce`, `#4cb782`, `#f2994a`, `#eb5757`.
- White wash on the brand button: hover `rgba(255,255,255,.08)`, open `rgba(255,255,255,.12)`, divider `rgba(255,255,255,.2)`.
- Menu shadow: `inset 0 0 0 1px #393a4b, 0 7px 24px rgba(0,0,0,.35)`.
- Accent (`--brand`) is user-configurable through Appearance. Swatches: `#575bc7` (default), `#4ea7fc`, `#bb87fc`, `#26b5ce`, `#4cb782`, `#f2994a`, `#eb5757`.
- White wash on the brand button: hover `rgba(255,255,255,.08)`, open `rgba(255,255,255,.12)`, divider `rgba(255,255,255,.2)`.
- Menu panel: `#202128`, shadow `inset 0 0 0 1px #393a4b, 0 7px 24px rgba(0,0,0,.35)`.

## Assets
- **Icons** from the Linear DS icon set (`Icon` component, `currentColor`): ChevronDown2, ArrowRight, Layout, Branch, Edit, Clipboard, Storage.
- No images.

## Files
- `Session Manager Minimal.dc.html`: the prototype.
- `sessions-data.js`: session, repo and worktree records.
- `transcripts-data.js`: needed by the prototype to load.
- `support.js`: the runtime that renders the prototype in a browser.
- `_ds/linear-design-system-dark-…/`: design-system tokens and components.

To view it, serve this folder over HTTP (e.g. `npx serve .`), open `Session Manager Minimal.dc.html` and select **live-meeting**. Then:

- Click the chevron beside Resume to see the menu.
- Double-click the title to rename.
- Click `~/code` under **Folders** in the tree to see folder scope.
