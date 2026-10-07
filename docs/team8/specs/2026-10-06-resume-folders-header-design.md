# Resume button, folders and session header — design

Replaces the detail pane's four action buttons with the handoff's Resume split button and menu, adds inline rename on the session title with a confirmation toast, and gives the terminal launcher a "new window" option. The Folders pieces of the handoff already exist; only their menu item is new.

Sources:
- `docs/design/design_handoff_resume_folders_header/README.md`: the UI, high fidelity. `Session Manager Minimal.dc.html` (methods `rmVm`, `rnVm`, `cmd`) is the reference for anything the README leaves out.
- `docs/team8/specs/2026-10-06-session-deck-design.md` and `2026-10-06-session-detail-transcript-design.md`: the app this extends; their constraints hold.

## 1. Scope

In: the split button and menu (§2), the launcher flag (§3), inline rename and the toast (§4), the Open folder menu item (§5). Out: the Folders tree section, list sub-lines, group labels and the Folder fact, which §3 of the handoff describes and the app already has; background sessions.

Decisions taken with the user: the resume handle is always the session id (names can repeat); plain Resume opens a new tab in iTerm's frontmost window and a new window elsewhere.

## 2. Resume split button and menu

**Items** come from a pure list in `src/shared/resume.ts`:

```ts
export type ResumeAction = 'resume' | 'resumeWindow' | 'fork' | 'rename' | 'copy' | 'openFolder'
export interface ResumeItem {
  action: ResumeAction
  icon: IconName          // ArrowRight, Layout, Branch, Edit, Clipboard, Storage
  label: string
  sub: string | null
  key: string | null      // '↵', 'B', 'R'
  command: string         // tooltip: the exact command, or '' for rename
  disabled: boolean
}
export type ResumeRow = ResumeItem | 'separator'
export function resumeItems(s: Session): ResumeRow[]
```

| Action | Icon | Label | Sub-line | Key | Tooltip |
|---|---|---|---|---|---|
| resume | ArrowRight | Resume | Opens in your terminal, in the session's original folder. | ↵ | `claude --resume <id>` |
| resumeWindow | Layout | Resume in a new terminal window | — | — | `claude --resume <id>` |
| separator | | | | | |
| fork | Branch | Branch conversation | Starts a new session from this point. The original stays as it is. | B | `claude --resume <id> --fork-session` |
| rename | Edit | Rename… | Give it a name so you can resume by name. (sub-line only while `!s.named`; the item is always there) | R | — |
| separator | | | | | |
| copy | Clipboard | Copy resume command | — | — | `claude --resume <id>` |
| openFolder | Storage | Open folder | `tildify(cwd)`, or "Folder no longer exists" when `!s.cwdExists` (then `disabled`) | — | — |

**Component** `ResumeMenu.tsx`, props `{ session, open, copied: boolean, onToggle(), onClose(), onAction(a: ResumeAction) }`:
- Split button: height 28px, radius 4px, background `--app-brand`, shadow `0 1px 1px rgba(0,0,0,.15)`, `overflow: hidden`. Main part padding 0 12px, 13px/500 white, label "Resume" or "Copied" while `copied`; hover wash `rgba(255,255,255,.08)`. Divider 1px `rgba(255,255,255,.2)`. Chevron part 26px wide, `ChevronDown2` 10px white, tooltip "More ways to resume", hover `.08`, open `.12`.
- Main part click → `onAction('resume')`. Chevron click → `onToggle()`.
- Menu: absolute, top 34px, left 0, z-index 21; panel 300px, padding 4px, radius 8px, background `--app-modal` (`#202128`), shadow `inset 0 0 0 1px #393a4b, 0 7px 24px rgba(0,0,0,.35)`. Dismiss layer `position: fixed; inset: 0; z-index: 20`, click → `onClose()`.
- Item: flex, `align-items: flex-start`, gap 10px, padding 7px 8px, radius 4px, hover wash; icon 14px `--app-text-3` with 1px top padding; label 13px/16px `--app-text`; sub-line 12px/16px `--app-text-3` 3px below; key cap on the right reusing `.keycap`. Disabled: opacity .5, no hover, no click. Separator: 1px `--app-divider`, margin 4px −4px. Choosing an item closes the menu then fires `onAction`.
- Keys while open (window listener): Enter → resume, B → fork, R → rename (when the item exists), Escape → close. Each `preventDefault`s. No shortcuts while closed.

**Copied** is true for 1.6s after a launch failed and the command was copied (today's fallback), the same `CopiedKey` with `what: 'resume' | 'fork'`.

The PR link stays after the button, unchanged. The Copy command, Fork and Open folder buttons are removed.

## 3. Terminal launcher

`Api.resumeSession(id, opts: { fork: boolean; newWindow?: boolean })`. Main rejects a present non-boolean `newWindow` and treats a missing one as `false` (optional so callers compile before and after the renderer passes it). The renderer passes `true` only for "Resume in a new terminal window".

`launch(terminal, s, fork, newWindow)`:
- iTerm, `newWindow: false`: `itermTabScript(cmd)`:
  ```
  tell application "iTerm"
    activate
    if (count of windows) = 0 then
      set w to (create window with default profile)
    else
      tell current window to create tab with default profile
      set w to current window
    end if
    tell current session of w to write text "<cmd>"
  end tell
  ```
- iTerm, `newWindow: true`: today's `itermScript`.
- Terminal and Warp: unchanged either way (no scriptable new tab).

`resumeCommand` and `terminalCommand` are unchanged; the handle is the id.

## 4. Inline rename and the toast

**State** in `Deck`: `renaming: boolean` (for the selected session), `menuOpen: boolean`, `toast: string | null`. Both `renaming` and `menuOpen` reset when the selection changes.

**Detail** props gain `renaming`, `onStartRename()`, `onRename(title: string | null)` (null = cancel), plus `menuOpen`, `onMenuToggle()`, `onMenuClose()`, `onResumeAction(a)`; `onCopy`, `onFork`, `onOpenFolder` and `onResume` go.
- Title `h2` gets `title="Double-click to rename"` and `onDoubleClick → onStartRename`.
- While renaming, the title is replaced by `<input className="rename-input">`: height 36px, margin 0 −8px, padding 0 8px, radius 4px, background `--app-surface`, focus `inset 0 0 0 1px --app-focus`, 22px/500 `--app-text`, placeholder "Session name", `autoFocus`, selected on mount. Below, 6px gap, the hint 12px `--app-text-3`: "Enter to save · Esc to cancel. A name lets you resume from any folder with claude --resume <name>."
- Enter and blur → `onRename(value.trim())`; Escape → `stopPropagation` and `onRename(null)`. `Deck` treats empty or unchanged as cancel.
- Save calls `window.api.renameSession(id, title)` (appends the same custom-title record `/rename` writes; rejected while live). Success → toast `Renamed. Resume with claude --resume "<name>"`. Rejection → toast with `errorText(e)`.

**Entry points**: the title double-click; the menu's Rename… (closes the menu, starts renaming); the command bar's Rename session action, which now emits `{ type: 'startRename', id }`: `Deck` selects the session, sets the tab to Overview, closes the bar and starts renaming. The `rename` search kind, its `BarAction` and the "Can't rename a running session" footer case are removed from `search.ts` and `CommandBar.tsx`.

**Toast** `Toast.tsx`: `{ text }` rendered by `Deck` when `toast` is set; `position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%)`, padding 8px 12px, radius 4px, background `--app-modal`, shadow `inset 0 0 0 1px --app-border-strong, --app-shadow-panel`, 13px `--app-text`, `user-select: text`, z-index 30. Cleared after 3s; a new toast restarts the timer. Launch and copy failures that today set the bar's `note` when the bar is closed go to the toast instead; the bar's own `note` keeps serving bar-initiated actions.

## 5. Open folder

The menu item (§2) calls `window.api.openFolder(id)` as before; a rejection goes to the toast. The command bar's Open folder action is unchanged.

## 6. Errors

- `renameSession` rejection (live session, bad title): toast with the error text; the title stays as it was.
- `resumeSession` returning `needsTerminal`: the "Resume in" picker opens as today, with the pending resume carrying `newWindow`.
- Launch failure: command copied, "Copied" on the button, toast "Couldn't open the terminal, so the command was copied. <error>".
- `openFolder` rejection: toast.
- Menu open when the session changes or is deselected: closed.

## 7. Deviations from the handoff

- Handle is always the id.
- Rename persists by appending the custom-title record (no CLI rename exists outside a session); live sessions cannot be renamed.
- Shortcuts work only while the menu is open; the pane has no focus model.
- Terminal.app and Warp open a window for both Resume items.
- Toast spec (size, position, 3s) is this document's, the handoff only asks for "a short toast".

## 8. Tests

In-source, named by behaviour:
- `resume.ts`: items in order with keys and tooltips; Rename… only when unnamed; Open folder disabled with the "no longer exists" sub-line when the cwd is gone; the id in every command.
- `terminal.ts`: the iTerm tab script falls back to a window when none is open; the window script unchanged; `launch` picks the tab script only for iTerm with `newWindow: false`.
- `api.ts`/`index.ts`: `resumeSession` rejects a non-boolean `newWindow`.
- `search.ts`: no `rename` kind; the Rename session action activates to `startRename`.
- Renderer static renders: the split button with "Resume" and "Copied"; the open menu's six items, two separators and three key caps; the disabled folder item; `Detail` renaming shows the input with the hint and no `h2`; `Toast` renders its text; `CommandBar` without the rename kind.

## 9. Files

```
src/shared/api.ts              resumeSession opts, 'Layout' icon name
src/shared/resume.ts           resumeItems (new, pure)
src/shared/search.ts           remove the rename kind; action 'rename' → startRename
src/main/terminal.ts           itermTabScript, launch newWindow
src/main/index.ts              validate newWindow
src/renderer/src/icons.tsx     Layout
src/renderer/src/ResumeMenu.tsx, ResumeMenu.css   (new)
src/renderer/src/Toast.tsx, Toast.css             (new)
src/renderer/src/Detail.tsx, Detail.css           header, rename input, menu mount
src/renderer/src/CommandBar.tsx                   drop rename kind handling
src/renderer/src/App.tsx                          renaming, menuOpen, toast, startRename flow
```
