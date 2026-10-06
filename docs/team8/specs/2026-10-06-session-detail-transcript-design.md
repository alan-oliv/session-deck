# Session detail: Overview and Transcript tabs — design

Adds a second tab to Session Deck's detail pane: a readable version of the Claude Code conversation, grouped by turn, with tool calls, diffs, errors, recaps and PR links folded until clicked. Also adds a Focus toggle that hides the tree and list, and makes the tree, the list and the command bar's results column resizable.

Sources:
- `docs/design/design_handoff_session_detail_transcript/README.md`: the UI, high fidelity. `Session Manager Minimal.dc.html` (methods `dtVm`, `txData`, `txVm`, `spans`, `sp`, `rzVals`, `rzSet`, `rzStart`) is the reference for any detail the README does not state.
- `docs/team8/specs/2026-10-06-session-deck-design.md`: the app this extends. Its constraints (main owns state, ids only over IPC, tokens, in-source tests) hold here.

## 1. Scope

Everything in the handoff that has a source on disk: the tab bar, the Transcript tab with filters, step groups, expand/collapse, lazy output loading, live tailing, the end bar, Focus mode, and three resizable panes with persistence. Deviations are listed in §9.

Out: subagent transcripts (an `Agent` call is a plain tool row), the handoff's fallback transcript, and the plan label.

## 2. Data shape

In `src/shared/api.ts`:

```ts
export type DiffSign = ' ' | '+' | '-'
export type DiffLine = [lineNo: number, sign: DiffSign, text: string]
export type Item =
  | { k: 'text'; md: string }
  | {
      k: 'tool'
      tool: string            // raw name: Bash, Edit, MultiEdit, Grep, Glob, Read, Write, Skill, Agent, …
      name: string            // shown: Edit/MultiEdit → Update, Grep/Glob → Search, otherwise `tool`
      arg: string             // command, path, pattern, skill, query, prompt, url or description
      out?: string[]          // first 3 lines of the result
      more?: number           // lines not included (output or diff)
      err?: boolean
      a?: number; d?: number  // diff stat
      diff?: DiffLine[]
      link?: string           // GitHub PR URL from a `gh pr create` result
    }
export interface Turn { prompt: string; items: Item[]; footer?: string; recap?: string }
export interface Transcript { cli: string; turns: Turn[] }
```

Icons by raw name (`Transcript.tsx`): Bash → `Code`, Grep and Glob → `Search1`, Read → `Document`, Edit and MultiEdit → `Edit`, Write → `Edit2`, Skill → `Bolt`, anything else → `Code`. `Edit2` and `Expand` join `ICON_NAMES`; their SVG bodies come from the handoff's `_ds_bundle.js` icon map (same `{ viewBox, body }` format as `icons.tsx`).

## 3. Reducer (`src/main/turns.ts`, pure)

Same shape as the facts reducer in `transcript.ts`: `emptyTurnsAgg(id)`, `reduceTurnLine(agg, line)`, `finalizeTurns(agg): Transcript`. The aggregate keeps full outputs; `finalizeTurns` caps them for the payload.

| Record | Effect |
|---|---|
| `user`, text content, not `isMeta`, not `isSidechain`, not starting `[Request interrupted` | starts a turn; prompt = `promptText(text)` (exported from `transcript.ts`): slash commands become `/name args`, other tagged text is dropped, and a dropped prompt starts no turn |
| `assistant` `text` block, not sidechain | text item; empty after trim → skipped |
| `assistant` `thinking` block | skipped |
| `assistant` `tool_use` block | tool item keyed by `id`, `tool` = `name`, `arg` = first non-empty string among `input.command, file_path, pattern, skill, query, prompt, url, description`, else `''` |
| `user` `tool_result` block | fills the item with that `tool_use_id`; unmatched results are dropped. Text = string content, or the `text` of each block joined with `\n`. Lines split on `\n`; up to 2,000 kept in the aggregate; `is_error` → `err`. For Edit, MultiEdit and Write with a non-empty `toolUseResult.structuredPatch`: hunks concatenated in order into `diff`; line number = old line for `-`, new line for ` ` and `+`; `a` = count of `+`, `d` = count of `-`. A Write that creates a file records an empty patch with the text in `toolUseResult.content` (`type: 'create'`): its `diff` is every content line as `+`, numbered from 1. For Bash whose `arg` starts with `gh pr create` and whose result text contains `https://github.com/<owner>/<repo>/pull/<n>`: `link` |
| `system` / `turn_duration` | footer of the current turn: `Worked for <duration> · done <Weekday> <h:mm AM/PM>` from `durationMs` and `timestamp`; duration is `Hh Mm Ss` dropping zero leading units, e.g. `30m 42s`, `1h 2m 5s`, `12s` |
| `system` / `away_summary` | recap of the current turn: `content` with the ` (disable recaps in /config)` suffix removed (shared helper with `splitSummary`) |
| any record with `version` | `cli = "Claude Code v" + version` (last wins) |
| everything else, malformed JSON, the cheap-skip types | ignored |

Items before the first prompt (e.g. after a compaction) attach to a turn with an empty prompt, which the view renders without a bubble.

`finalizeTurns` payload caps: `out` = first 3 lines, `more` = remaining lines; `diff` = first 400 lines, `more` = remaining diff lines (a tool has either a diff or an output in the payload, diff winning). `getToolOutput` returns the full kept lines (up to 2,000).

## 4. Main

**`src/main/lines.ts`**: `tailLines(path, offset, onLine): Promise<number>` — the indexer's `parseFrom` generalized: streams from `offset`, calls `onLine` per complete line, returns the new offset. The indexer uses it.

**`src/main/transcripts.ts`**: `createTranscriptStore(transcriptPath: (id) => string | undefined)` with:
- `get(id): Promise<Transcript>` — stats the file; new path or shrunk file → fresh aggregate from offset 0; grown → tail from the saved offset; unchanged → cached. Keeps the four most recently used sessions (`{ path, size, offset, agg }`), evicting the oldest.
- `output(id, turn, item): Promise<string[]>` — `get` then the item's full lines; throws `Unknown tool call` when the indices are out of range or the item has no output.

**`src/main/index.ts`**: two handlers, each through `sessionFor(id)` first. `getToolOutput` checks both indices are non-negative integers before the lookup.

**IPC** (`api.ts`, `API_METHODS`): `getTranscript(id: string): Promise<Transcript>`, `getToolOutput(id: string, turn: number, item: number): Promise<string[]>`.

## 5. Detail pane

- **Tab bar** (44px, bottom hairline): tabs Overview and Transcript (28px, active `--app-selected` / `--app-text`, inactive `--app-text-3`), the Transcript count = total items (hidden until loaded), spacer, Focus button (`Expand` icon 12px + "Focus" / "Exit focus", tooltips "Hide the tree and list" / "Show the tree and list again", hover wash).
- **Scroll body**: each tab owns its own scroll body (flex 1, `overflow-y: auto`): the Overview's `.detail-body` with padding `40px 56px` and unchanged content, and the Transcript component's root `.tx` with padding `24px 40px 48px`, max-width 820px, gap 24px.
- `detailTab` and `focus` live in `Deck` and survive session changes.
- **Loading**: `Detail` calls `getTranscript` when the selected id changes, whatever the tab. While `session.live`, it calls again on every `sessionsChanged`. A stale response (id changed meanwhile) is dropped.

## 6. Transcript tab

**View-model** (`src/shared/transcriptView.ts`, pure), the prototype's `txVm` ported:

```ts
type Filter = 'all' | 'msg' | 'tools' | 'edits' | 'errors'
interface ViewState { filter: Filter; expandAll: boolean; openRows: Record<string, boolean>; openGroups: Record<string, boolean> }
transcriptView(t: Transcript, s: ViewState): {
  counts: Record<Filter, number>
  turns: { index: number; label: string; meta: string; prompt: string | null; rows: Row[]; footer: string | null; recap: string | null }[]
  empty: boolean
}
```
- Edits = tool items with `diff` or `a` defined. Errors = `err`. Messages = text items.
- Row kinds: `text`, `tool` (with `key = "turn:item"`, `open`, `hasBody`, `inGroup`), `group` (`key = "turn:g<firstItem>"`, `label "N steps"`, `summary "Bash ×5 · Search"` in order of first appearance, `failed` count, `open`, members as tool rows when open).
- Groups: three or more consecutive tool items, All filter only. A group's open state is its map entry, else `expandAll`. A row's open state is `expandAll || openRows[key]`.
- Turn meta: `"<tools> steps"` plus `" · <n> edit(s)"` when any. Prompt and recap show under All and Messages. Footer under All only. A turn with no rows and no prompt to show is dropped. `empty` = no rows at all and the filter is Tools, Edits or Errors.
- Expand all / Collapse all toggles `expandAll` and clears both maps.

**Rendering** (`Transcript.tsx`, `Transcript.css`), per the handoff's C1–C4: header (title 15px/500, meta line `Claude Code v2.1.283 · Opus 5.5 · xhigh effort · ~/code/meetnotes`, segmented filter with counts, Expand all / Collapse all), turn divider, prompt bubble, assistant rows (6px brand dot), tool rows (icon, name, mono arg with ellipsis, diff stat or meta "+108 lines" / "failed", chevron rotated −90° when closed and invisible without a body), expanded bodies (output box, diff grid `40px 16px minmax(0,1fr)` with add/delete backgrounds, PR link block), step groups with the 1px guide when open, turn footer with `ClockOutline`, recap box, empty state "Nothing matches this filter.", end bar.

- A tool row has a body when it has `out`, `diff` or `link`. Expanding a row whose `more > 0` and has no diff calls `getToolOutput` and replaces `out` with the full lines for that row; the "N more lines in the session file" note shows only while the full lines are not loaded or when the diff was capped.
- Hover tooltip on a tool row: the full `arg`.
- **End bar**: dot `--app-green` and "Waiting for your next message" while `session.live`; otherwise `--app-text-3` and `Session ended ${agoLong(end, now)}`. Resume = the Overview's `onResume`.
- **Links** (PR link, markdown links) are `<a target="_blank">`; the main window's open handler already sends https URLs to the browser and denies the rest.

**Markdown**: `react-markdown@10` with `remark-gfm@4`, rendered inside `.md` for text items and the recap. Styles: paragraphs 13px/21px `--app-text-2` with 8px gaps; strong weight 500 `--app-text`; inline code mono 12px on `--app-elevated`, padding 1px 4px, radius 3px; links `--app-link`; list items with an en dash marker in `--app-text-3` for bullets and the number for ordered lists, tightened by −4px; headings as 13px/500 `--app-text`; fenced code and tables in the output-box style (`--app-surface`, 1px `--app-border`, mono 12px/18px). No images: the `img` component renders its alt text.

**Scrolling**: the scroll body keeps `pinned = scrollHeight − clientHeight − scrollTop ≤ 64` on each scroll event; after a transcript update it scrolls to the bottom only if pinned. The last 30 turns render; scrolling within 48px of the top adds 30 older turns and restores the previous offset (`scrollTop += scrollHeight − previousScrollHeight`). Switching session resets to the last 30, pinned.

## 7. Focus and resizable panes

- **Focus** unmounts `Sidebar` and `SessionList`. The drag strip's left edge is `0` in focus, otherwise `side + list`.
- **`Resize.tsx`** (`ResizeHandle` moved out of `Sidebar.tsx`): props `width, min, max, defaultWidth, label, onWidth`. 5px strip at the pane's right edge, `cursor: col-resize`, z-index above the pane's content; hover, active and focus-visible show `box-shadow: inset -2px 0 0 var(--app-focus)`. Pointer drag with window listeners ending on release, blur or a buttonless move; while dragging, `document.body` gets `cursor: col-resize; user-select: none`. Double-click → `defaultWidth`. Arrow keys step 16px. `role="separator"` with the aria values.
- **Limits** (default / min / max): tree 220 / 160 / 360; list 380 / 280 / 600; command bar results 380 / 260 / 520. For the tree and list, max = `min(max, window.innerWidth − 360 − other pane)`, recomputed on `resize`. The clamp lives in `src/shared/panes.ts` (pure): `PANES`, `paneMax(key, other, windowWidth)`, `clampPane(key, w, other, windowWidth)`, `readPaneWidths(raw, windowWidth)`.
- **Persistence**: `localStorage.paneWidths = { side, list, pal }`, read once on mount and clamped; written on change. The old `sidebarWidth` key is no longer read.
- `SessionList` and `.bar-results` take their width from a prop; the CSS width rules go.

## 8. Errors

- `getTranscript` rejection → transcript body shows "Couldn't read the session file." and the count stays hidden.
- `getToolOutput` rejection → the row keeps its first lines and note.
- Unknown id, bad indices → the handler throws, as the other handlers do.
- Malformed lines, unknown records and unmatched results are skipped, never thrown.
- A missing `structuredPatch` on an edit leaves the row as a plain tool row.

## 9. Deviations from the handoff

- No plan label ("Claude Max"): not on disk.
- No fallback transcript or its note: every indexed session has a readable JSONL by construction.
- Tool rows show the CLI's labels (Update, Search); the raw name stays in the data for the icon and filters.
- Full markdown (react-markdown + remark-gfm) instead of the line-by-line subset.
- Read rows show output when the result carries it; the handoff's "Read with no captured output" case had none.
- Tree minimum 160 (was 180 in the app).
- Pane widths persist under `paneWidths`, replacing `sidebarWidth`.
- Diff payload capped at 400 lines, tool output kept up to 2,000 lines, with the handoff's "more lines" note covering both.

## 10. Tests

In-source, named by behaviour:
- `turns.ts`: every row of the table in §3, including a slash-command prompt, a dropped meta prompt, interrupt text, an unmatched result, structuredPatch with two hunks, the 400-line cap, a PR link, footer wording for `12s`, `30m 42s` and `1h 2m 5s`, the recap suffix, `cli`.
- `transcriptView.ts`: counts per filter; grouping only under All and only for runs ≥ 3; open keys stable across filters; expand-all precedence; the turn meta line; prompt/footer/recap visibility per filter; `empty`.
- `transcripts.ts`: tails appended lines without reparsing, resets on shrink, evicts beyond four, `output` range errors.
- `lines.ts`: a line split across chunks; a multibyte character across a chunk boundary.
- `panes.ts`: clamps, the detail-pane floor, reading a bad stored value.
- Renderer static renders: tab bar with count and Focus label; a tool row with hidden-output meta, the diff grid, a group row, the two end-bar labels; `Detail` on the Transcript tab in focus. Focus hiding the two panes is checked by hand in the verification task, since static renders cannot set `Deck` state.
- `npm run typecheck` clean; after `npm run build`, `grep -r "import.meta.vitest" out/` finds nothing.

## 11. Files

```
src/shared/api.ts              Transcript types, getTranscript/getToolOutput, Edit2 + Expand icon names
src/shared/transcriptView.ts   view-model (new, pure)
src/shared/panes.ts            pane limits and clamps (new, pure)
src/main/lines.ts              tailLines (new)
src/main/turns.ts              JSONL → Transcript reducer (new, pure)
src/main/transcripts.ts        tail cache + output lookup (new)
src/main/transcript.ts         export promptText, stripRecapSuffix
src/main/indexer.ts            parseFrom → tailLines
src/main/index.ts              two handlers
src/renderer/src/Resize.tsx, Resize.css          shared handle (new)
src/renderer/src/Transcript.tsx, Transcript.css  (new)
src/renderer/src/Detail.tsx, Detail.css          tab bar, scroll body, padding
src/renderer/src/Sidebar.tsx, Sidebar.css        use Resize
src/renderer/src/SessionList.tsx, SessionList.css width prop, handle
src/renderer/src/CommandBar.tsx, CommandBar.css   results width prop, handle
src/renderer/src/App.tsx, App.css                detailTab, focus, paneWidths, drag strip
src/renderer/src/icons.tsx, tokens.css           Edit2, Expand; --app-diff-add, --app-diff-del
package.json                   react-markdown@10, remark-gfm@4 (devDependencies, bundled by Vite)
```
