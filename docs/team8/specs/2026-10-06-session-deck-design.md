# Session Deck — design

A macOS desktop app that indexes local Claude Code sessions and answers three questions: *which session was that*, *where does it live*, and *how do I get back into it*. It shows sessions by repository (branches, worktrees) and by folder, and searches them through a command bar.

Sources:
- `docs/electron-architecture.md`: the foundation (stack, layout, IPC pattern, tests, packaging).
- `docs/design_handoff_session_manager_minimal/README.md`: the UI, high-fidelity. `Session Manager Minimal.dc.html` is the reference for any detail the README does not state.

## 1. Scope

v1 is the whole handoff: the tree, all five list views (List, Timeline, Repository, Worktree, Calendar), the detail pane with usage, and the command bar with every search kind and action. Every field comes from real data on disk; nothing is illustrative. Deviations are listed in §12.

Out of v1: embeddings for Ask (it uses the handoff's lexical scorer), background sessions (`claude attach`).

## 2. Foundation

`docs/electron-architecture.md` steps 1–4, 7 and 8, with these changes:
- **Dropped:** step 5 (the blur addon) and step 6 (safeStorage / API key). The window is opaque.
- **Tracer bullet:** `listSessions()` from renderer → preload → main → disk and back, in place of the settings/API-key screen.
- **Window:** `titleBarStyle: 'hiddenInset'`, `backgroundColor: '#181921'`, not transparent, 1360×820, min 1000×600, `show: false` + `ready-to-show` + 3 s fallback.
- **Fonts:** Inter 400 and 500 from `@fontsource/inter`, imported in `main.tsx`, so the app renders offline.
- **Names:** `{{APP_NAME}}` = `Session Deck`, `{{APP_ID}}` = `dev.alanoliv.session-deck`, `{{SIGNING_IDENTITY}}` = `Apple Development: alanbruno@gmail.com (8ENKTPJ3B3)`.

Stack: Electron 44, electron-vite 5 (Vite 7), `@vitejs/plugin-react`, TypeScript 7 strict, React 19, plain CSS with `--app-*` tokens, Vitest 5 in-source tests, electron-builder 26.

## 3. Layout

```
src/shared/api.ts         IPC contract + Session/Settings types (single source of truth)
src/shared/format.ts      relative time, sizes, tokens, durations, resume commands   (pure)
src/shared/tree.ts        sessions → Repositories (branches, worktrees) + Folders; scope filter (pure)
src/shared/views.ts       grouping for List/Timeline/Repository/Worktree/Calendar     (pure)
src/shared/search.ts      kinds, prefix parsing, matchers, Ask scorer, actions list   (pure)
src/shared/fixtures.ts    makeSession() for in-source tests
src/main/index.ts         app, window, handler wiring
src/main/paths.ts         every ~/.claude and Warp path
src/main/ipc.ts           registerIpc loop + broadcast
src/main/transcript.ts    JSONL record → aggregate reducer, finalize → Session        (pure)
src/main/git.ts           cwd → repo root/name, worktree, removed
src/main/live.ts          ~/.claude/sessions/*.json + tee files → live state
src/main/indexer.ts       tail-parse by byte offset, index.json cache, fs.watch
src/main/settings.ts      userData/settings.json
src/main/terminal.ts      resume/fork in iTerm | Warp | Terminal
src/main/statusline.ts    install/remove the status-line tee
src/preload/index.ts
src/renderer/index.html
src/renderer/src/         main.tsx, App.tsx, hooks.ts, env.d.ts, css.d.ts, icons.tsx, tokens.css,
                          Button.tsx, Sidebar.tsx, SessionList.tsx, Calendar.tsx, Detail.tsx,
                          Usage.tsx, CommandBar.tsx, each component with its own .css
build/entitlements.mac.plist · electron-builder.yml   (no custom icon yet: Electron's default)
electron.vite.config.ts · vitest.config.ts · tsconfig.json · tsconfig.node.json · tsconfig.web.json
```

## 4. IPC contract

```ts
export interface Api {
  listSessions(): Promise<Session[]>
  getSettings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<Settings>
  resumeSession(id: string, opts: { fork: boolean }): Promise<ResumeResult>
  openFolder(id: string): Promise<void>
  openPr(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>   // rejects while live
  setArchived(id: string, archived: boolean): Promise<void>
  setStatusTee(enabled: boolean): Promise<void>
  onSessionsChanged(cb: () => void): () => void
  onSettingsChanged(cb: () => void): () => void
}
```
Uses the doc's `API_METHODS` / `API_EVENTS` lists with the compile-time completeness check. Every call names a session by ID. Main validates the ID (UUID regex, present in the index) and resolves paths itself. No renderer string becomes a file path or shell argument unchecked.

## 5. Data model

```ts
type Status = 'running' | 'waiting' | 'interrupted' | 'failed' | 'completed'
type Terminal = 'iterm' | 'warp' | 'terminal'
interface Settings { terminal: Terminal | null; archived: string[]; statusTee: boolean }

interface Session {
  id: string; title: string; named: boolean
  cwd: string; cwdExists: boolean; hidden: boolean; archived: boolean
  repo: { name: string; root: string } | null
  branch: string | null
  worktree: { name: string; path: string; removedSeen: string | null } | null
  start: string; end: string; sizeBytes: number; keptUntil: string
  model: string | null; effort: string | null; permissionMode: string | null
  status: Status; live: boolean
  pr: { repo: string; number: number; url: string } | null
  forkedFrom: string | null; forks: number
  prompts: string[]
  summary: { did: string; next: string[] } | null
  files: { path: string; added: number; removed: number }[]
  commits: { sha: string; msg: string; at: string }[]
  artifacts: { name: string; kind: string; path: string; bytes: number; preview: string }[]
  usage: Usage
}
interface Usage {
  contextUsed: number; contextMax: number
  input: number; output: number; total: number
  cacheRead: number; cacheWrite: number; cacheHitPct: number
  cost: number | null; durationMs: number
  linesAdded: number; linesRemoved: number
  compactions: number; agents: number
  outputStyle: string | null
  plan: { usedPct: number; resetsAt: string } | null
}
```

Field sources, all from records verified in `~/.claude/projects`:

| Field | Source |
|---|---|
| `title`, `named` | last `custom-title` record (`customTitle`). Without one, the first prompt's first line (≤ 80 chars), `named: false` |
| `hidden` | first `entrypoint` starts with `sdk` |
| `cwd`, `branch` | last `cwd` / `gitBranch` on any record |
| `start`, `end` | first / last `timestamp` |
| `model`, `effort` | last assistant `message.model` (skipping `<synthetic>`), last assistant `effort` |
| `permissionMode` | last `permission-mode` record |
| `pr` | last `pr-link` (`prRepository`, `prNumber`, `prUrl`) |
| `forkedFrom` | `forkedFrom.sessionId` on the first records. `forks` = count of sessions whose `forkedFrom` is this id |
| `prompts` | user records, not `isMeta`, text not starting with `[Request interrupted`; tagged slash commands kept as `/name args` when they have args, other `<…>` text dropped; at most 30, each ≤ 300 chars (every `listSessions()` ships all sessions) |
| `summary` | last `system`/`away_summary` `content`, " (disable recaps in /config)" removed, split at the first `Next` followed by `:` or `,` into `did` and `next: [rest]` |
| `files` | `Edit` (+lines of `new_string`, −lines of `old_string`), `MultiEdit` (sum of `edits`), `Write` (+lines of `content`), keyed by `file_path`, shown relative to the repo root or cwd |
| `commits` | `tool_result` text matching `^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$` (multiline) |
| `artifacts` | `Write` calls whose extension is md, markdown, json, html, csv, yaml, yml, txt or svg; preview = first 40 lines, ≤ 4 KB; the last write to a path wins |
| `status` | live → `busy` = running, `idle` = waiting. Otherwise last user/assistant event: user text `[Request interrupted…` = interrupted, assistant `isApiErrorMessage` = failed, else completed |
| `usage` totals | last `cost-state`: `totalCostUSD`, `totalDuration`, `totalLinesAdded/Removed`, `modelUsage` summed over models. Without it: assistant `usage` summed with consecutive same-`message.id` records counted once, `cost: null`, duration = end − start, lines = sum of `files` |
| `contextUsed` | last non-sidechain assistant usage: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; for live sessions, the tee's `context_window.total_input_tokens` when present |
| `contextMax` | tee `context_window.context_window_size`; else 1 000 000 for model ids starting `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5` or containing `[1m]`; else 200 000; raised to 1 000 000 if `contextUsed` exceeds it |
| `cacheHitPct` | `cacheRead / (input + cacheRead + cacheWrite) × 100` |
| `compactions` | count of `system`/`compact_boundary` records |
| `agents` | count of `*.jsonl` in `<project dir>/<id>/subagents/` |
| `outputStyle`, `plan` | tee file only: `output_style.name`, `rate_limits.five_hour.used_percentage` and `.resets_at` (Unix seconds) |
| `keptUntil` | `end` + `cleanupPeriodDays` from `~/.claude/settings.json` (default 30) days |
| `archived` | id is in `Settings.archived` |

## 6. Main process

**Indexer.** Top-level `~/.claude/projects/*/*.jsonl` only; subagent transcripts are never parsed.
- **Cache.** `userData/index.json` stores `{ version, files: { [path]: { size, mtimeMs, offset, agg } }, git: { [cwd]: GitInfo } }`.
- **Incremental parse.** Per file: same size → skip; grew → parse from `offset`; shrank → reset and parse from 0. `offset` advances only past the last complete line.
- **Cheap skip.** Lines whose `"type"` is `file-history-snapshot`, `file-history-delta`, `attachment` (unless it carries `forkedFrom`), `queue-operation` or `atis-latch` are skipped before `JSON.parse`.
- **First run.** Parsing is async (streamed); `sessionsChanged` fires after every 50 files, so the list fills in progressively.
- **Reindex triggers.** A bumped cache `version` forces a full reindex. A corrupt `index.json` triggers a rebuild.
- **Watching.** `fs.watch(recursive)` on `~/.claude/projects`, `~/.claude/sessions` and the tee dir, debounced at 300 ms → incremental reindex → `sessionsChanged`.

**Git.** Filesystem only, no `git` processes. Resolved once per unique cwd and cached.
- Walk up to the nearest `.git`:
  - directory → repo root;
  - file → `gitdir:` → worktree; main root = the text before `/.git/worktrees/`.
- Repo name = basename of the main root. Worktree name = basename of the worktree root.
- Missing cwd: the cached info wins. Otherwise the nearest existing ancestor decides:
  - inside a repo, with a `worktrees/` or `.worktrees/` segment in the path → a removed worktree named by that segment;
  - inside a repo, without one → a removed folder inside that repo;
  - not inside a repo → a removed plain folder.
- `removedSeen` is set to the first time the indexer saw the cwd missing.

**Live.** `~/.claude/sessions/<pid>.json` (`sessionId`, `status`). Live only if `process.kill(pid, 0)` succeeds.

**Status-line tee** (opt-in, `setStatusTee`).
- On enable:
  - Write `~/.claude/session-deck/statusline-tee.sh`. It saves stdin to `~/.claude/session-deck/status/<session_id>.json` atomically (tmp + mv), then pipes the same stdin into the original command.
  - Save the original `statusLine` object to `~/.claude/session-deck/statusline-original.json`.
  - Set `statusLine.command` to `sh ~/.claude/session-deck/statusline-tee.sh`, keeping the other keys.
- On disable: restore the original (or delete `statusLine` if there was none), but only if the current command is still ours.

**Terminal** (`resumeSession`).
- Command: `claude --resume <id>`, plus ` --fork-session` for Fork. If the cwd exists, it is prefixed with `cd '<cwd>' && `, using single-quote shell escaping.
- iTerm: `osascript` creates a window with the default profile and runs `write text`.
- Terminal: `do script`.
- Warp: write `~/.warp/launch_configurations/session-deck-resume.yaml` and `open warp://launch/<encoded path>`.
- Scripts run through `execFile('osascript', ['-e', script])` with AppleScript string escaping, never a shell.
- Any failure copies the command to the clipboard and returns `{ ok: false, copied: true }`.
- `terminal: null` returns `{ ok: false, needsTerminal: true }` without running anything.

**Rename.** Rejected while live. Otherwise it appends `{"type":"custom-title","customTitle":<title>,"sessionId":<id>}` plus a newline to the transcript, the same record `/rename` writes. The title is trimmed, 1–120 chars, with no newlines.

**Archive.** Toggles the id in `Settings.archived`.

**Open folder / PR.** `shell.openPath(cwd)`; `shell.openExternal(pr.url)` only if it starts with `https://github.com/`.

## 7. UI

Pixel values, colours and copy come from the handoff README, verbatim. No transitions.

- **Sidebar.**
  - Contents: "All sessions" with a count; **Repositories** with chevrons, whose children are branches from the main checkout and worktrees (removed ones struck through, tooltip `<path> (removed)`); **Folders**, which are cwds outside any repo, in monospace.
  - Clicking a node sets the scope; clicking a chevron only toggles the repo.
  - The two most recently active repos start expanded.
  - The 38 px top row is the window drag region (`-webkit-app-region: drag`) under the native traffic lights.
- **Session list.**
  - Header: scope title, `N sessions`, `⌘⇧P` key cap.
  - The view switcher appears only in All sessions; the chosen view persists while the scope stays All. Other scopes use List.
  - Rows: status dot (running, waiting, interrupted, failed), title, relative time, and line 2 `repo · cwd` plus ` · N fork(s)`.
  - Timeline: day groups with a 58 px start-time column.
  - Repository: groups per repo, then per folder.
  - Worktree: main checkout and each worktree, with a "removed" note.
  - Calendar: a month grid with ≤ 3 status dots per day. It opens on the latest day with sessions; navigation is clamped to the first and last months with sessions; the selected day's sessions sit under one header like "Tue, Oct 6".
  - If the selected session leaves the list, the first row is selected. Empty state: "No sessions here."
  - Hidden and archived sessions never appear in the tree or the list; only `is:hidden` and `is:archived` reach them.
- **Detail pane.**
  - Title and sub-line `<relative> · <model> · <size>`.
  - Actions: Resume (primary), Copy command, Fork, Open folder. "Copied" shows for 1.6 s.
  - The PR link "All sessions for #N" copies `claude --from-pr N`.
  - Facts in handoff order; rows without data are omitted.
  - Usage: header with model and effort chip; context meter (fill `#575bc7` < 60 %, `#f2c94c` 60–79 %, `#f2994a` ≥ 80 %); the plan line "X% of plan used · resets in Hh Mm" when live with tee data; a "Show plan usage" link (→ `setStatusTee(true)`) when live without the tee; 4×3 tiles.
  - Then "Where it stopped", "Next", and "N files changed".
- **Command bar** (`⌘⇧P` while the app is focused): the handoff's panel, kinds, previews (Kind, Session with match reason, Artifact, Action), footer and keyboard. Two internal kinds reuse it:
  - **Resume in:** iTerm, Warp, Terminal. Opened when a resume returns `needsTerminal`, or by `> Change terminal`. ↵ saves the choice and runs the pending resume.
  - **Rename:** the input becomes the new title, prefilled. ↵ calls `renameSession`. While live, the footer reads "Can't rename a running session" and ↵ does nothing.

## 8. Search kinds

| Kind | Prefix | Behaviour |
|---|---|---|
| Sessions | none | every word (case-insensitive) appears in title, repo name, cwd, branch, prompts, summary, file paths, PR (`repo#n`), commit messages/shas, artifact names |
| Ask | `?` | the prototype's `sem()` verbatim: lowercase, replace chars outside `[a-z0-9#./_\-\s]` with spaces, drop its stop words, strip `(ing\|ed\|er\|es\|s)$` from tokens longer than 4; score = share of tokens found in changed files, artifacts, PR, prompts, summary, title + repo; keep ≥ 0.5; show `round(58 + score × 36)%` and the first matching field's reason ("Changed …", "Created …", "PR …", "Prompt: “…”", "Summary: …") |
| Files | `file:` | one result per changed file: basename, `folder · session title`, `+added` |
| Artifacts | `art:` | one result per artifact, matched on name, kind, path, preview |
| PRs and commits | `pr:` | PR number (`#` optional) or `repo#n`; commit sha prefix or message words |
| Repository | `in:` | first token picks a repo name or folder path exactly; the rest searches inside it; suggestions until the first token matches |
| Status | `is:` | running, waiting, interrupted, failed, completed, hidden, archived, each with a count |
| Time | `when:` | today, yesterday, week (last 7 days) |
| Actions | `>` | on the selected session: Resume, Copy resume command, Fork into a new session, Open folder, Open PR, All sessions for PR #n, Show repo in the tree, Rename session, Archive / Unarchive session, Change terminal, Show / Hide plan usage |

Empty input shows **Search kinds** (all except Sessions, each with its prefix key cap) and **Recent** (the three newest sessions). `/` shows only the kinds.

## 9. Errors

- Malformed JSONL lines are skipped.
- An unreadable transcript is logged and skipped.
- A corrupt `index.json` is rebuilt.
- A missing `~/.claude/projects` gives the empty state.
- A failed terminal launch copies the command and the footer or button says so.
- A failed rename or tee change shows its error text in the command-bar footer.
- A failed `~/.claude/settings.json` parse leaves the file untouched and rejects `setStatusTee`.

## 10. Tests

In-source `if (import.meta.vitest)` blocks, named by behaviour. Pure logic carries them: `transcript.ts` (fixture lines for every field in §5), `git.ts` (temp-dir repos, worktrees and removed worktrees), `format.ts`, `tree.ts`, `views.ts`, `search.ts` (each kind), `terminal.ts` (command building, quoting, AppleScript escaping), `statusline.ts` (settings rewrite and restore as pure functions), `settings.ts` (normalization). At least one renderer test. After `npm run build`, `grep -r "import.meta.vitest" out/` finds nothing.

## 11. Packaging

`electron-builder.yml` per the architecture doc, with these settings:
- `appId: dev.alanoliv.session-deck`, `productName: Session Deck`, `mac.target: dir`, `mac.identity: 'Apple Development: alanbruno@gmail.com (8ENKTPJ3B3)'`.
- No `extraResources` (no blur addon).
- Entitlements: `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory`, `com.apple.security.cs.disable-library-validation`, and `com.apple.security.automation.apple-events`, with `NSAppleEventsUsageDescription: "Session Deck opens your terminal to resume Claude sessions."` in `mac.extendInfo`.

Done when `npm run package` produces `dist/mac-arm64/Session Deck.app`, `codesign -dv` names the identity, and the packaged app lists your sessions and resumes one in iTerm.

## 12. Deviations from the handoff

- **Resume command uses the session id, never the name.** Custom names can repeat; the id is always unambiguous and also works from any folder.
- **Status set.** running, waiting, interrupted, failed, completed. "Paused" has no signal on disk.
- **Not on disk, dropped:** `concepts` (search uses prompts and summary instead) and PR titles (the PR shows as `owner/repo#n`).
- **New `>` actions:** Change terminal, Show/Hide plan usage, and Unarchive.
- **Command bar flows.** The terminal choice and rename happen inside the command bar; no extra dialogs.
- **Sidebar defaults.** The two most recently active repos start expanded, in place of the prototype's hard-coded two.
