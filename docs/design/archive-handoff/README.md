# Handoff: Archive sessions

## Overview
Archiving lets the user hide finished or irrelevant Claude Code sessions without deleting anything. An archived session:

- disappears from All sessions, Needs you, its project, branch and worktree filters, and command-bar search results
- keeps its transcript file on disk, untouched
- can be restored at any time from the **Archived** section

This is part of the Session Manager (Minimal, option 2a). It adds:

- an **Archived** sidebar row
- three ways to archive or restore: the row hover button, the Resume menu, and the command bar
- a confirmation toast with **Undo**

## About the Design Files
The files in this bundle are **design references created in HTML**. They are prototypes that show the intended look and behaviour, not production code to copy. Recreate them in the target codebase's environment (Electron + React, Tauri, SwiftUI…) using its established patterns and libraries. If no codebase exists yet, choose the most suitable desktop stack.

`session-manager-minimal.dc.html` is a single "Design Component": the template is the markup, and `class Component` at the bottom is the logic. Relevant methods:

- `isArc(s)`: whether a session is archived.
- `setArc(s, v)`: archive or restore a session, and show the toast.
- `cVals(all, arc)`: builds the list and the `archived` scope.
- `rmVm`: the Resume menu item.
- `pVals`: the command bar action.
- Row view model in `viewVm`: the hover button.

## Fidelity
**High fidelity.** Colours, type, spacing and interactions are final and use the Linear Design System (Dark) tokens. Recreate them pixel-accurately.

Prototype-only behaviour:

- Archive state lives in memory and resets on reload.
- The two oldest completed sessions start archived so the section isn't empty.

---

## Screens / Views

### 1. Sidebar: Archived row
- **Placement**: directly under **All sessions**, with no gap. The prototype uses `margin-top:-15px` to cancel the sidebar's 16px block gap, leaving 1px.
  - Order: All sessions → Archived → Needs you (when shown) → Repositories → Folders.
- **Row**: the same nav row as All sessions.
  - Size and shape: height 28px, padding 0 8px, radius 4px, gap 8px, Inter 13px/400.
  - Default: text `#d2d3e0`, transparent background.
  - Hover: background `rgba(149,149,189,.125)`, text `#eeeffc`.
  - Selected: background `#393a4b`, text `#eeeffc`.
- **Contents**, left to right:
  - Icon `Archive`, 14px, `#858699`.
  - Label "Archived", flex 1.
  - Count: 12px `#858699`, the number of archived sessions.
- **Tooltip**: "Sessions you archived. Their files are kept."
- **Visibility**: always shown, even at 0, so users know where archived sessions go.

### 2. Session list in the Archived scope
- **Header title**: "Archived" (15px/500 `#eeeffc`). The count reads e.g. "2 sessions".
- **Rows**: archived sessions, newest first, with the same row design as everywhere else.
- **Hidden in this scope**: the view switcher (List / Timeline / Repository / Worktree / Calendar) and the branch chips.
- **Empty state**: "No sessions here." (13px `#858699`, centred, padding 48px 12px).
- **Detail pane**: works as normal. Resume, Branch, Rename and the transcript all still work for archived sessions.

### 3. Row hover archive button
- **Visibility**: shown only while the pointer is over a row, in every list scope and view mode.
- **Position**: absolute, top 6px, right 8px, z-index 1. The row itself is `position:relative`.
- **Button**:
  - Size and shape: 24×24px, radius 4px, flex-centred.
  - Background `#292a35`, border `inset 0 0 0 1px #393a4b`.
  - Icon `Archive` 14px, colour `#d2d3e0`.
  - Hover: background `#2c2d42`, icon `#eeeffc`.
- **Time label**: while the row is hovered, the relative time ("9:12 AM", "1d") gets `visibility:hidden`. It keeps its space, so the title doesn't reflow and the button sits where the time was.
- **Tooltip**: "Archive" in normal scopes, "Restore from archive" in the Archived scope.
- **Click**: stops propagation (the row isn't selected), clears the hover state, then archives or restores and shows the toast.
  - The row leaves the current list immediately. If it was selected, the first remaining row becomes selected.

### 4. Resume menu item
At the end of the Resume split-button menu, after a separator below "Open folder":

| State | Icon | Label | Sub-line | Key |
|---|---|---|---|---|
| Not archived | `Archive` | Archive | Hides it from All sessions. Nothing is deleted. | E |
| Archived | `Archive` | Restore from archive | Moves it back to All sessions. | E |

- **Look**: the same item style as the rest of the menu.
  - Item: padding 7px 8px, radius 4px, gap 10px. Label 13px/16px `#eeeffc`. Sub-line 12px/16px `#858699`.
  - Key cap: 11px/18px, padding 0 5px, radius 4px, background `#292a35`, border `inset 0 0 0 1px #393a4b`, text `#858699`.
- **Keyboard**: pressing **E** while the menu is open runs the item.
- **After running**: the menu closes.

### 5. Command bar action
In the Actions kind (⌘⇧P, then `>`), under "Actions on '<title>'":

- Not archived: **Archive session** (icon `Archive`).
- Archived: **Restore from archive** (icon `Archive`).

Running either closes the command bar and shows the toast.

**Search scope**: command-bar searches (Sessions, Ask, Files, Artifacts, PRs, In repo, Status, Time) search **non-archived sessions only**. The action works on the session selected in the list, which can be archived when you're in the Archived scope.

### 6. Toast with Undo
- **Position**: absolute inside the app window: `left:50%; bottom:20px; transform:translateX(-50%)`, z-index 25.
- **Box**:
  - Size and shape: height 36px, padding 0 8px 0 14px, radius 5px, gap 12px.
  - Background `#202128`, shadow `inset 0 0 0 1px #393a4b, 0 7px 24px rgba(0,0,0,.35)` (`--shadow-lg`).
  - Text 13px `#eeeffc`, no wrapping.
- **Copy**: `Archived “<title>”` or `Restored “<title>”`, with curly quotes.
- **Undo**: a text button with padding 4px 8px, radius 4px, 12px/500 `#6c79ff`, hover background `rgba(149,149,189,.125)`.
  - Clicking it reverses the last archive or restore, hides the toast and selects that session again.
- **Duration**: the toast auto-hides after **2.4s**. A new archive or restore replaces the current toast and restarts the timer.
- **Animation**: none (the design system defines no motion). Show and hide instantly, or with a short opacity fade of 120ms or less.

---

## Interactions & Behavior
- **Archiving** sets the session as archived. It is removed from:
  - All sessions and its count
  - Needs you and its count
  - Repositories / Folders project counts
  - branch and worktree chips and their counts
  - every view mode (Timeline, Repository, Worktree, Calendar dots)
  - command-bar searches
- **Restoring** reverses all of the above.
- **Selection**: if the selected session leaves the visible list, select the first remaining row. If the list becomes empty, the detail pane shows its empty state.
- **Undo** is single-level: only the most recent archive or restore can be undone, and only while its toast is visible.
- **Hover button**: tracked per row with mouse enter and leave. Only one row shows it at a time.
- **Keyboard**: E (with the Resume menu open). Optional for production: E on the focused list row when no menu is open; this isn't wired in the prototype.

## State Management
- `archived: Record<sessionId, boolean>`: the user's overrides.
  - A session is archived if `archived[id] === true`, or if it has no override and its stored status is `archived`.
- `scope`: adds `{ type: 'archived' }` to the existing Scope union.
- `hoveredRowId: string | null`
- `toast: string`
- `lastArchive: { id: string; archived: boolean } | null`: used for Undo.
- A toast timer that is cleared and restarted on each action.

### Persistence (production)
- Claude Code has **no archive concept**, so archive state belongs to this app. Store it in the app's own data, for example `~/Library/Application Support/<app>/archive.json` or the app's SQLite index, keyed by session UUID with an archived-at timestamp.
- **Never move or rename** `~/.claude/projects/<cwd>/<session-id>.jsonl`. Moving it breaks `claude --resume`.
- **Retention**: Claude Code deletes transcripts after 30 days by default (`cleanupPeriodDays`), whether they're archived or not. When an archived session's file is gone, drop it from the archive index, or show it as "Deleted by cleanup" if you want to keep a record.
- **Deleting** is a separate, destructive action and isn't part of this feature.

## Design Tokens
**Surfaces**
- sidebar `#191a23`
- elevated (button) `#292a35`
- hover `#2c2d42`
- selected `#393a4b`
- modal / toast `#202128`

**Overlays**
- hover wash `rgba(149,149,189,.125)`

**Borders**
- strong `#393a4b`

**Text**
- primary `#eeeffc`
- secondary `#d2d3e0`
- tertiary `#858699`
- link `#6c79ff`

**Shadows**
- toast `inset 0 0 0 1px #393a4b, 0 7px 24px rgba(0,0,0,.35)`

**Type**
- Inter 400/500.
- 11px key caps; 12px counts, sub-lines and Undo; 13px rows, menu labels and toast; 15px list title.

**Radii**
- 4px: rows, buttons, menu items, key caps.
- 5px: toast.

## Assets
- **Icons** from the Linear DS icon set (`Icon` component, `currentColor`): `Archive`.
- No images.

## Files
- `session-manager-minimal.dc.html`: the prototype.
- `sessions-data.js`: session records.
- `transcripts-data.js`: needed by the prototype to load.
- `support.js`: the runtime that renders the prototype in a browser.
- `_ds/linear-design-system-dark-…/`: design-system tokens and components.

To view it, serve this folder over HTTP (e.g. `npx serve .`) and open `session-manager-minimal.dc.html`. Then:

- Hover any row and click the archive button.
- Click **Undo** in the toast.
- Open **Archived** in the sidebar and restore a session.
