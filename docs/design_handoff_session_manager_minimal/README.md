# Handoff: Session Manager (Minimal, option 2a)

## Overview
A desktop app for developers who run many Claude Code sessions across repositories, folders and git worktrees. It answers three questions quickly: *which session was that*, *where does it live*, and *how do I get back into it*. Layout: a repository tree on the left, a session list in the middle, a quiet detail pane on the right, plus a Raycast-style command bar (⌘⇧P) with several kinds of search.

## About the Design Files
The files in this bundle are **design references created in HTML**. They are prototypes that show the intended look and behaviour, not production code to copy. The task is to **recreate this design in the target codebase's environment** (for example Electron + React, Tauri, SwiftUI) using its established patterns and libraries. If no environment exists yet, choose the most appropriate desktop stack and implement it there.

The prototype is a single "Design Component" file (`Session Manager Minimal.dc.html`) that runs in the browser with `support.js`. Its template is the markup; the `class Component` block at the bottom is the logic. Sample data lives in `sessions-data.js`.

## Fidelity
**High fidelity.** Colours, type, spacing, radii and interactions are final and follow the Linear Design System (Dark) tokens listed below. Recreate it pixel-accurately with the codebase's own components.

Data fidelity is mixed: session titles, relative dates, sizes and PR links come from the user's real `claude --resume` list; file lists, commits, summaries, artifacts and most usage numbers are illustrative. The `live-meeting` usage numbers come from the user's real status line.

---

## Screens / Views

The app is one window: **1360 × 820 px** in the prototype, radius 8px, background `#181921`, border `inset 0 0 0 1px #2c2d3c`, shadow `0 16px 70px rgba(0,0,0,.5)`. Three columns in a horizontal flex, plus an overlay.

### 1. Tree sidebar (left)
- **Width** 220px, fixed. Background `#191a23`. Right hairline `inset -1px 0 0 rgba(89,89,116,.25)`.
- **Traffic lights row**: height 38px, padding 0 14px, gap 8px, three 12px circles `#ff5f57`, `#febc2e`, `#28c840`.
- **Scroll area**: padding 6px 8px 16px, vertical gap 16px between blocks.
- **"All sessions" item**: height 28px, padding 0 8px, radius 4px, gap 8px. Icon `AllItems` 14px `#858699`, label 13px, count 12px `#858699` right-aligned.
- **Section header** ("Repositories", "Folders"): 12px/16px `#858699`, padding 0 8px 6px.
- **Repository row**: height 28px, padding 0 8px 0 2px, gap 6px, radius 4px, 13px.
  - Chevron toggle: 16×16 hit area with `ChevronDown2` 10px. Rotated −90° when collapsed; 30% opacity when the repo has no children.
  - Icon `Box` 14px, label, count.
- **Children** (branches and worktrees): indented with margin-left 17px and padding-left 8px, plus a 1px left guide line in `rgba(89,89,116,.25)`.
  - Row: height 26px, padding 0 8px, gap 8px, 12px text.
  - Icon `Branch` (branch) or `Layers` (worktree), 12px.
  - Removed worktrees use `text-decoration: line-through`; the tooltip shows the full path and "(removed)".
- **Folder row** (non-repo working dirs such as `~/code`): like a repo row without the chevron. Icon `Storage`, label in monospace 12px.
- **States**:
  - Default: text `#d2d3e0`.
  - Hover: background `rgba(149,149,189,.125)`, text `#eeeffc`.
  - Selected: background `#393a4b`, text `#eeeffc`.

### 2. Session list (middle)
- **Width** 380px, fixed. Right hairline `inset -1px 0 0 rgba(89,89,116,.25)`.
- **Header**: padding 14px 16px 10px, vertical gap 12px.
  - Row 1, baseline-aligned, gap 8px:
    - Scope title, 15px/500 `#eeeffc`, ellipsis. Values: "All sessions", the repo name, "meetnotes / live-meeting", "transcriptions worktree", or a folder path.
    - Count, 12px `#858699`, e.g. "12 sessions".
    - Key cap `⌘⇧P` that opens the command bar.
  - Row 2 (**only when "All sessions" is selected**): view switcher.
    - Container: padding 2px, gap 2px, radius 5px, background `#1d1e2b`, border `inset 0 0 0 1px #2c2d3c`.
    - Five segments: List (`ViewList`), Timeline (`Timeline`), Repository (`Box`), Worktree (`Layers`), Calendar (`CalendarEmpty`). Each is height 28px, padding 0 10px, radius 4px, 13px/500.
    - The active segment shows icon + label, background `#393a4b`, text `#eeeffc`, and flexes to fill the space.
    - Inactive segments are icon-only in `#858699`, with the label as a tooltip.
- **List body**: scrolls, padding 0 8px 16px.
- **Group header** (non-List views): padding 14px 10px 6px, label 12px/500 `#d2d3e0`, count 12px `#858699`. An optional note in 11px `#f2c94c` reads "removed" for deleted worktrees.
- **Session row**: padding 10px, radius 4px, vertical gap 5px.
  - Line 1, gap 8px:
    - Optional 6px status dot.
    - Title, 13px/16px/500 `#eeeffc`, single line with ellipsis.
    - Relative time, right-aligned, 12px `#858699`: "9:12 AM" today, "1d", "3d".
  - Line 2: 12px/16px `#858699`, ellipsis. Content is `repo · /path/to/cwd`, or just the path for non-repo sessions, plus " · 1 fork" when forked.
  - Timeline view instead uses a 58px left column with the start time ("9:12 AM", tabular numbers) and drops the relative time.
  - States: hover `rgba(149,149,189,.125)`; selected `#393a4b`.
- **Status dot colours**, shown only when the session needs attention:
  - Running: `#4cb782`.
  - Waiting for you: `#f2c94c`.
  - Interrupted: `#f2c94c`.
  - Failed: `#eb5757`.
  - Completed and paused sessions show no dot.
- **Calendar view**: a block above the groups, padding 4px 8px 12px.
  - Header: month title 13px/500, then previous and next buttons (`ArrowRight` 12px, the previous one rotated 180°).
  - Grid: 7 columns. Weekday initials 11px `#858699`.
  - Day cell: height 38px, radius 4px. Number 12px, with up to three 4px dots in the session status colour (`#858699` when there's no status).
  - Selected day: `#393a4b`. Today, when not selected: `inset 0 0 0 1px #393a4b`. Days outside the month: `#6b6f76`.
  - The list below shows only the selected day's sessions under one group header ("Tue, Oct 6").
- **Empty state**: "No sessions here.", 13px `#858699`, centred, padding 48px 12px.

### 3. Detail pane (right)
- **Size and layout**: flex 1. Padding 72px 56px 40px. Content max-width 560px, vertical gap 28px.
- **Title**: 22px/28px/500 `#eeeffc`, `text-wrap: pretty`.
  - Sub-line: 13px `#858699`, "Today, 9:12 AM · Opus 5.5 · 6.1MB" (relative time · model · transcript size).
- **Actions** (gap 8px, all Linear `Buttons` size "sm"):
  - **Resume**: primary, background `#575bc7`.
  - **Copy command**: secondary. The label changes to "Copied" for 1.6s after clicking.
  - **Fork**: secondary, also shows "Copied".
  - **Open folder**: secondary.
  - When the session has a PR, a text link follows in 12px `#6c79ff`: "All sessions for #27".
- **Facts grid**: two columns (96px label | value), row gap 12px, column gap 16px, 13px/18px.
  - Labels are `#858699`; values are `#d2d3e0`.
  - Mono values (paths, IDs) use 12px `ui-monospace, SFMono-Regular, Menlo, monospace` with `word-break: break-all`. Prose values use `word-break: normal` and `text-wrap: pretty`.
  - Rows, in order:
    - **Folder**: the working directory.
    - **Repository**: name · branch, when the session is in a repository.
    - **Worktree**: name, plus "(removed Oct 2)" if it's gone.
    - **Pull request**: "alan-oliv/meetnotes#27 Meetnotes improvements".
    - **Title**: "Generated from the first prompt. Rename to resume it by name." or "Named. Resumes by name from any folder."
    - **Forks**: "1 branch of this conversation", when the session has forks.
    - **Resuming**: "Over 100k tokens. After an hour idle, Claude offers to continue from a summary.", when the session is over 100k tokens.
    - **Kept until**: "Nov 5, then deleted by the 30-day cleanup".
    - **Session ID**: the UUID, in monospace.
- **Usage block**, vertical gap 14px:
  - Header row: "Usage" 12px `#858699`, then right-aligned the model name 12px `#d2d3e0` and an effort chip. The chip is 11px, padding 0 6px, radius 4px, border `inset 0 0 0 1px #393a4b`, e.g. "xhigh".
  - Context meter:
    - Text row: "Context" 13px `#d2d3e0`, then right-aligned "263k / 1M" `#eeeffc` and "26%" `#858699`, both with tabular numbers.
    - Bar: 6px tall, radius 3px, track `#292a35` with border `inset 0 0 0 1px #2c2d3c`.
    - Fill colour: `#575bc7` below 60%, `#f2c94c` from 60% to 79%, `#f2994a` at 80% and above.
    - Under the bar, for the running session only: "32.9% of plan used · resets in 4h 7m", 12px `#858699`.
  - Tile grid: four rows of three equal columns, inside a container with radius 4px and border `inset 0 0 0 1px #2c2d3c`.
    - Row and column separators: 1px `rgba(89,89,116,.25)`.
    - Tile: padding 10px 12px. Label 12px/14px `#858699`; value 15px/18px `#eeeffc` with tabular numbers. An optional sub-value sits beside it in 12px `#858699`.
    - Row 1: In | Out | Total.
    - Row 2: Cache hit (%) | Cache read (with share %) | Cache write (with share %).
    - Row 3: Cost ($0.00) | Duration (40m, or 1h 8m) | Lines (+524 −131).
    - Row 4: Mode (e.g. "Bypass permissions") | Compactions | Output style, with "3 agents" as the sub-value. When there's no output style, the third tile is Agents.
- **Where it stopped**: label 12px `#858699`, then a paragraph in 13px/20px `#d2d3e0`, made of summary.did + summary.state.
- **Next** (optional): label, then one line per step in 13px/20px `#d2d3e0`.
- **Files changed** (optional): label "9 files changed", then one monospace path per line in 12px/18px `#d2d3e0` with ellipsis.

### 4. Command bar (overlay, ⌘⇧P)
- **Scrim**: covers the whole window with `rgba(29,30,43,.498)`. Clicking it closes the bar. The panel is centred horizontally, 96px from the top.
- **Panel**: 780 × 500px, radius 8px, background `#202128`, border `inset 0 0 0 1px #393a4b`, shadow `0 16px 70px rgba(0,0,0,.5)`.
- **Input row**: height 56px, padding 0 16px, gap 10px, bottom hairline.
  - Left element: `Search1` 16px `#858699`, or a **kind chip** when a search kind is active. The chip is height 24px, padding 0 8px, radius 4px, background `#393a4b`, 12px text, and shows the kind's icon and label. Clicking it removes the kind.
  - Input: 15px, transparent, no border. Placeholder `#858699`: "Search sessions, or type / for search kinds", or the kind's own hint when a kind is active.
  - Right: an `esc` key cap.
- **Body**: two columns.
  - Results column: 380px wide, padding 6px, right hairline.
    - Group label: 12px `#858699`, padding 10px 10px 6px.
    - Result row: padding 8px 10px, radius 4px, gap 10px. Icon 14px. Title 13px `#eeeffc`; sub-line 12px `#858699` (monospace for file and commit results). Optional right side: either a prefix key cap or meta text (e.g. "92%", "+141", "#27").
    - The highlighted row uses `#393a4b`. Moving the mouse over a row highlights it.
  - Preview column: flex 1, padding 20px 22px. It shows one of four things, depending on the highlighted row.
    - **Kind**: icon, name (15px/500), description (13px/20px `#d2d3e0`), and a "Try" list of example query chips. Each chip has padding 5px 8px, radius 4px, background `#1d1e2b`, border `#2c2d3c`, and 12px monospace text. Clicking an example fills the input.
    - **Session**: title (15px/500), when · size, an optional match-reason box, facts (Folder, Repo, PR) and the summary state.
      - The reason box has a `Bolt` icon in `#6c79ff`, background `#1d1e2b` and border `#2c2d3c`, e.g. "Changed meetnotes/src/transcribe/diarize.ts".
    - **Artifact**: name, type · size · source session, full path, and a `<pre>` content preview (background `#1d1e2b`, 12px/18px monospace).
    - **Action**: "Runs on", the session title, and the exact command.
- **Footer**: height 40px, top hairline, 12px `#858699`.
  - Left: the current kind's icon and name. After a copy it changes to "Copied resume command" with a check icon.
  - Right: primary verb + `↵` (Resume, Choose or Run), a divider, "Search kinds /" and "Actions >".

#### Search kinds
Typing a prefix in the plain input converts it to a chip.

| Kind | Prefix | Behaviour |
|---|---|---|
| Sessions | (none) | Every word must appear in title, repo, path, branch, prompt, summary, concepts, file paths, PR or commits. |
| Ask | `?` | Natural-language search. Drops stop words, lightly stems, then scores the share of query tokens found in files, artifacts, PR, prompt, summary and concepts. Keeps matches of 50% or more. Shows `%` and a "why it matched" reason. **Production: replace with embeddings.** |
| Files | `file:` | One result per changed file: basename as title, folder · session as sub, `+additions` on the right. |
| Artifacts | `art:` | One result per artifact, matched on name, type, path or content. Preview shows the content. |
| PRs and commits | `pr:` | PR number or title (`#` optional) and commit hash or message. |
| Repository | `in:` | First token picks a repo or folder, and the rest searches inside it. Shows suggestions until the first token matches exactly. |
| Status | `is:` | running, interrupted, paused, completed. Shows options with counts. |
| Time | `when:` | today, yesterday, week. |
| Actions | `>` | Runs on the session selected in the list: Resume, Copy resume command, Fork into a new session, Open folder, Open PR, All sessions for PR #n, Show repo in the tree, Rename session, Archive session. |

Empty input shows **Search kinds** (all except Sessions, each with its prefix as a key cap) and **Recent** (the three newest sessions). Typing `/` shows only the kinds.

---

## Interactions & Behavior
- **Tree**: clicking a node sets the scope and filters the list. Clicking a chevron expands or collapses the repo without changing the scope. By default meetnotes and team8 are expanded and the scope is All sessions.
- **List selection**: clicking a row selects it and fills the detail pane. If the selected session leaves the filtered list, the first row is selected automatically.
- **View switcher**: only visible in All sessions. The view persists while you stay in that scope; other scopes always use List.
- **Calendar**: arrows move between months (the prototype clamps to Sep–Oct 2026). Clicking a day filters the list to that day. It opens on the most recent day with sessions.
- **Copy / Resume**: writes to the clipboard and shows "Copied" for 1.6s. In production, Resume should open the user's terminal and run the command.
  - Resume command: `claude --resume <name>` for named sessions, `claude --resume <session-id>` for unnamed ones. This works from any folder since Claude Code v2.1.223.
  - Fork: `claude --resume <name|id> --fork-session`.
  - PR: `claude --from-pr <number>`.
- **Command bar keyboard**:
  - Global ⌘⇧P (Ctrl+Shift+P on Windows and Linux) toggles the bar.
  - ↑ and ↓ move the highlight.
  - ↵ activates the highlighted row: a kind opens that kind, a session resumes (copies the command, selects it, closes the bar), an action runs.
  - Esc clears the kind first, then closes the bar.
  - Backspace on an empty input clears the kind.
  - Clicking a session row selects it and closes the bar without resuming.
- **Transitions**: none. The design system defines no motion, so state changes are instant.
- **Not wired in the prototype**: Open folder, Open PR, Rename, Archive. They only close the bar. Implement them with the OS shell and `gh`, or by setting the name through Claude Code.

## State Management
- `scope`: `{ type: 'all' | 'repo' | 'branch' | 'wt' | 'folder', id, repo? }`
- `expanded`: map of repo id → boolean
- `viewMode`: `'list' | 'timeline' | 'repo' | 'worktree' | 'calendar'`
- `calendarMonth`, `calendarDay` (`yyyy-m-d` key)
- `selectedSessionId`
- `palette`: `{ open, kind, query, highlightIndex }`
- `copiedKey`: `sessionId` or `sessionId:fork|pr`, cleared after 1.6s

### Data requirements
Each session needs these fields:
- **Identity and status**: `sid` (UUID), `title`, `auto` (true if the title was generated rather than named), `status`.
- **Location**: `cwd`, `repo` (inferred from git or PR remote), `branch`, `worktree?` (path, plus whether it still exists).
- **Time**: start time and duration.
- **Model**: model and effort.
- **Transcript**: size, forks count.
- **Git**: `pr?` (owner/repo, number, title), commits, `fileList` (path, additions, deletions).
- **Content**: artifacts (name, type, path, size, preview), summary (`did`, `state`, `next[]`), prompt, concepts.
- **Usage**: context used and max, input, output, total, cache read, cache write, cached, cost, compactions, agents, permission mode, output style. For the running session, also plan usage % and reset time.

### Implementation notes from the Claude Code docs (code.claude.com/docs/en/sessions)
- **Storage**: transcripts live at `~/.claude/projects/<cwd-with-non-alphanumerics-as-dashes>/<session-id>.jsonl`. The JSONL format is internal and changes between releases. Prefer `/export`, hooks (`transcript_path`), or `claude -p --resume <id> --fork-session --output-format json "<summarize prompt>"` to derive summaries without touching the original session.
- **Retention**: 30 days by default (`cleanupPeriodDays`). This is where "Kept until" comes from.
- **Hidden sessions**: `-p`, Agent SDK and `/loop`-first sessions are hidden from Claude's own picker. Consider a "Show hidden" filter.
- **Background sessions**: these are marked `bg` and resumed via `claude attach <id>`. Not modelled in the prototype yet.

## Design Tokens (Linear Design System, Dark)
**Surfaces**
- app `#181921`
- sidebar `#191a23`
- surface / input `#1d1e2b`
- elevated `#292a35`
- hover `#2c2d42`
- selected `#393a4b`
- modal `#202128`
- canvas behind the window `#151621`

**Borders**
- default `#2c2d3c`
- strong `#393a4b`
- hover `#444556`
- divider `rgba(89,89,116,.25)`
- hover wash `rgba(149,149,189,.125)`
- scrim `rgba(29,30,43,.498)`

**Text**
- primary `#eeeffc`
- secondary `#d2d3e0`
- tertiary `#858699`
- disabled `#6b6f76`
- link `#6c79ff` (hover `#7477f0`)
- on primary `#ffffff`

**Brand**
- primary `#575bc7`
- focus ring `#5e6ad2` (1px inset)

**Status**
- green `#4cb782`
- yellow `#f2c94c`
- orange `#f2994a`
- red `#eb5757`
- blue `#4ea7fc`
- violet `#bb87fc`

**Type**
- Inter 400/500 only.
- Sizes: 11px key caps, 12px meta, 13px body, 15px input and tiles, 22px detail title, 24px page title.
- Line-height is mostly 100% to 16px for single lines, 18–20px for prose.
- Monospace: `ui-monospace, SFMono-Regular, Menlo, monospace`. The design system has none; use the platform default.

**Spacing**
- Scale: 4 / 8 / 12 / 16 / 24 / 32px.
- Rows have 10px padding.
- The detail pane has 72px top padding and 56px side padding.

**Radii**
- 4px: rows, buttons, chips, inputs.
- 5px: the segmented control track.
- 8px: the window and the command bar panel.
- 3px: the meter.

**Shadows**
- Borders are drawn as `inset 0 0 0 1px`.
- Window and command bar: `0 16px 70px rgba(0,0,0,.5)`.

**Key cap**
- 11px/18px, padding 0 5px, radius 4px.
- Background `#292a35`, border `inset 0 0 0 1px #393a4b`.

## Assets
- **Icons**: all from the Linear Design System icon set (`components/icons/icon-data.js`, rendered by the `Icon` component, 16px viewBox, `currentColor`). Names used:
  - Tree and list: AllItems, Box, Branch, Layers, Storage, ChevronDown2.
  - Search and command bar: Search1, Bolt, Document, Attachment2, Loader, ClockOutline, Code, Code2.
  - Views and navigation: ViewList, Timeline, CalendarEmpty, ArrowRight.
  - Actions: Clipboard, Link, Edit, Archive, Check.
- **Buttons**: the Linear `Buttons` component, primary and secondary, size "sm".
- No images. The traffic lights are plain coloured circles standing in for the native window controls.

## Files
- `Session Manager Minimal.dc.html` — the 2a prototype (template + logic).
- `sessions-data.js` — sample data (12 sessions, repos, worktrees). Shows the expected data shape.
- `support.js` — the runtime that renders the `.dc.html` file in a browser. Only needed to view the prototype.
- `_ds/linear-design-system-dark-…/` — design-system tokens (CSS) and component bundle used by the prototype.

To view the prototype, serve this folder over HTTP (e.g. `npx serve .`) and open `Session Manager Minimal.dc.html`.
