# Session Deck Implementation Plan

> **For agentic workers:** this plan is executed by teammates that `team8:run` dispatches from the shared task list. Read your own task section. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A macOS Electron app that indexes local Claude Code sessions and shows them by repository and folder, with a detail pane, five list views and a command bar that searches and acts on them.

**Architecture:** Main owns all state. It tail-parses `~/.claude/projects/*/*.jsonl` by byte offset into a cached aggregate per file, resolves git locations and live state from the filesystem, and serves `Session[]` over a typed IPC contract. The renderer holds no data of its own: it derives the tree, views and search results with pure functions in `src/shared/` and renders the handoff's design with plain CSS tokens.

**Tech Stack:** Electron 44, electron-vite 5, Vite 7.3.6, @vitejs/plugin-react 5.2.0, TypeScript 7 (strict), React 19, Vitest 5 (in-source), electron-builder 26, @fontsource/inter 5.

**Spec:** `docs/team8/specs/2026-10-06-session-deck-design.md`. Read it with this plan. The UI source of truth is `docs/design_handoff_session_manager_minimal/README.md`. Its prototype `docs/design_handoff_session_manager_minimal/Session Manager Minimal.dc.html` has these line ranges:
- command bar: 36–130
- sidebar: 131–175
- session list: 176–240
- detail pane: 241–322
- logic: 323–633

## Global Constraints

- **Platform:** macOS arm64 only. Users install nothing; Electron 44 carries Node 24.
- **Exact dependencies, all of them devDependencies.** Vite bundles everything into `out/`, so the packaged app ships nothing from `node_modules`. No others:
  - `electron@44 electron-vite@5 vite@7.3.6 @vitejs/plugin-react@5.2.0 typescript@7 vitest@5 electron-builder@26 @types/node@24 @types/react@19 @types/react-dom@19 react@19 react-dom@19 @fontsource/inter@5`
- **No git.** The folder is not a git repository. Every "Commit" step in the template is replaced by "no commit". Do not run `git init`.
- **Tests:**
  - In-source: `if (import.meta.vitest) { const { it, expect } = import.meta.vitest; … }`, each `it` named by the behaviour it checks, in plain language.
  - `npm test` runs them.
  - After `npm run build`, `grep -r "import.meta.vitest" out/` must find nothing.
- **Main owns state and side effects.** The renderer names sessions only by id. Every IPC handler in main validates its arguments (`isSessionId`, index lookup, enum checks) before any file, shell or AppleScript use. No renderer string becomes a path or a shell argument.
- **Writes outside `userData` are limited to:**
  - appending one `custom-title` line to a non-live transcript (rename);
  - files under `~/.claude/session-deck/`;
  - the `statusLine` key of `~/.claude/settings.json`, only on explicit opt-in;
  - `~/.warp/launch_configurations/session-deck-resume.yaml`.
- **Styling:**
  - Colours, type, radii and shadows come only from `--app-*` tokens in `src/renderer/src/tokens.css`, with values copied from the handoff README.
  - No transitions or animations.
  - Copy strings are verbatim from the README, the prototype, or this plan.
- **Session time is `end`** (last activity) everywhere in the UI: ordering, relative time, timeline, calendar day.
- **Hidden and archived sessions** (`hidden: true` or `archived: true`) never appear in the tree, the list, or any command-bar kind except `is:hidden` and `is:archived`.
- **Comments:** only a non-obvious *why*. No comment restates code.
- **Typecheck:** `npm run typecheck` = `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`. It must exit 0 at the end of every task from Task 9 on. Before Task 9, `tsconfig.web.json` has no inputs, so Tasks 1–8 run only `npx tsc --noEmit -p tsconfig.node.json`.

## File structure

| File | Track | Responsibility |
|---|---|---|
| `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `vitest.config.ts` | A | toolchain |
| `src/shared/api.ts` | A | IPC contract, Session/Settings types, id check, resume commands |
| `src/main/paths.ts` | A | every `~/.claude` and Warp path |
| `src/main/ipc.ts` | A | `registerIpc`, `broadcast` |
| `src/main/index.ts` | A | app, window, handler wiring |
| `src/preload/index.ts` | A | `window.api` bridge |
| `src/main/transcript.ts` | A | JSONL line → aggregate → `Facts` (pure) |
| `src/main/git.ts` | A | cwd → repo root, worktree, removed |
| `src/main/live.ts` | A | live sessions + status-line tee files |
| `src/main/indexer.ts` | A | incremental parse, cache, watch, `toSession` |
| `src/main/settings.ts` | A | `userData/settings.json` |
| `src/main/terminal.ts` | A | iTerm / Warp / Terminal launch, quoting |
| `src/main/statusline.ts` | A | install/remove the status-line tee |
| `src/shared/format.ts` | B | dates, sizes, tokens, labels, status dots (pure) |
| `src/shared/tree.ts` | B | Scope, tree, scope filter (pure) |
| `src/shared/views.ts` | B | view grouping, calendar grid (pure) |
| `src/shared/fixtures.ts` | B | `makeSession()` for tests |
| `src/shared/search.ts` | B | kinds, matching, Ask, actions (pure) |
| `src/renderer/src/{env.d.ts, css.d.ts, tokens.css, icons.tsx, Button.tsx, Button.css, hooks.ts}` | R | renderer foundation |
| `src/renderer/src/{Sidebar.tsx, Sidebar.css}` | R | tree sidebar |
| `src/renderer/src/{SessionList.tsx, SessionList.css, Calendar.tsx, Calendar.css}` | D | middle column |
| `src/renderer/src/{Detail.tsx, Detail.css, Usage.tsx, Usage.css}` | D | detail pane |
| `src/renderer/src/{CommandBar.tsx, CommandBar.css}` | F | command bar |
| `src/renderer/index.html`, `src/renderer/src/{main.tsx, App.tsx, App.css}` | Z | composition, global keys, flows |
| `electron-builder.yml`, `build/entitlements.mac.plist` | Z | packaging |

---

### Task 1: Scaffold the toolchain, IPC contract and window

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `vitest.config.ts`
- Create: `src/shared/api.ts`, `src/main/paths.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/shared/api.ts`): `Status`, `Terminal`, `Settings`, `SettingsPatch`, `FileChange`, `Commit`, `Artifact`, `PullRequest`, `Usage`, `Session`, `ResumeResult`, `Api`, `API_EVENTS`, `EventName`, `EventChannel`, `ApiMethod`, `API_METHODS`, `SESSION_ID_RE`, `isSessionId(v: unknown): v is string`, `resumeCommand(id: string, fork: boolean): string`, `prCommand(n: number): string`, `ICON_NAMES`, `IconName`.
- Produces (`src/main/paths.ts`): `PATHS` with `home, projects, sessions, claudeSettings, deck, tee, teeScript, teeOriginal, warpConfig`.
- Produces (`src/main/ipc.ts`): `registerIpc(handlers: { [K in ApiMethod]: Api[K] }): void`, `broadcast(channel: EventChannel): void`.
- Produces: npm scripts `dev`, `build`, `test`, `typecheck`, `package`.

- [ ] **Step 1: Write `package.json` and install the exact dependencies**

```json
{
  "name": "session-deck",
  "productName": "Session Deck",
  "version": "0.1.0",
  "private": true,
  "description": "Find, inspect and resume local Claude Code sessions",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "package": "electron-vite build && electron-builder --mac --dir"
  }
}
```

Run:
```bash
npm install -D electron@44 electron-vite@5 vite@7.3.6 @vitejs/plugin-react@5.2.0 typescript@7 vitest@5 electron-builder@26 @types/node@24 @types/react@19 @types/react-dom@19 react@19 react-dom@19 @fontsource/inter@5
npx electron --version
```
Expected: the install succeeds, `package.json` has no `dependencies` key, and the last line prints `v44.x.y`. Do not add `"type": "module"`, because the sandboxed preload must build as CommonJS. If npm reports a peer conflict, keep `vite@7.3.6` (electron-vite 5 caps Vite at 7) and report the conflict.

- [ ] **Step 2: Write the three tsconfigs**

`tsconfig.json`:
```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["node", "vitest/importMeta"]
  },
  "include": ["src/main", "src/preload", "src/shared", "electron.vite.config.ts", "vitest.config.ts"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/importMeta"]
  },
  "include": ["src/renderer/src", "src/shared"]
}
```
`src/shared` is in both configs, so nothing in it may import Node modules.

- [ ] **Step 3: Write the build and test configs**

`electron.vite.config.ts`:
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const stripTests = { 'import.meta.vitest': 'undefined' }

export default defineConfig({
  main: { define: stripTests },
  preload: { define: stripTests },
  renderer: {
    define: stripTests,
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
  },
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { includeSource: ['src/**/*.{ts,tsx}'], environment: 'node' },
})
```

- [ ] **Step 4: Write the IPC contract with its tests**

`src/shared/api.ts`:
```ts
export type Status = 'running' | 'waiting' | 'interrupted' | 'failed' | 'completed'
export type Terminal = 'iterm' | 'warp' | 'terminal'

export interface Settings {
  terminal: Terminal | null
  archived: string[]
  statusTee: boolean
}
export type SettingsPatch = { terminal?: Terminal | null }

export interface FileChange { path: string; added: number; removed: number }
export interface Commit { sha: string; msg: string; at: string }
export interface Artifact { name: string; kind: string; path: string; bytes: number; preview: string }
export interface PullRequest { repo: string; number: number; url: string }

export interface Usage {
  contextUsed: number
  contextMax: number
  input: number
  output: number
  total: number
  cacheRead: number
  cacheWrite: number
  cacheHitPct: number
  cost: number | null
  durationMs: number
  linesAdded: number
  linesRemoved: number
  compactions: number
  agents: number
  outputStyle: string | null
  plan: { usedPct: number; resetsAt: string } | null
}

export interface Session {
  id: string
  title: string
  named: boolean
  cwd: string
  cwdExists: boolean
  hidden: boolean
  archived: boolean
  repo: { name: string; root: string } | null
  branch: string | null
  worktree: { name: string; path: string; removedSeen: string | null } | null
  start: string
  end: string
  sizeBytes: number
  keptUntil: string
  model: string | null
  effort: string | null
  permissionMode: string | null
  status: Status
  live: boolean
  pr: PullRequest | null
  forkedFrom: string | null
  forks: number
  prompts: string[]
  summary: { did: string; next: string[] } | null
  files: FileChange[]
  commits: Commit[]
  artifacts: Artifact[]
  usage: Usage
}

export type ResumeResult =
  | { ok: true }
  | { ok: false; needsTerminal: true }
  | { ok: false; copied: true; error: string }

export interface Api {
  listSessions(): Promise<Session[]>
  getSettings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<Settings>
  resumeSession(id: string, opts: { fork: boolean }): Promise<ResumeResult>
  openFolder(id: string): Promise<void>
  openPr(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  setStatusTee(enabled: boolean): Promise<void>
  onSessionsChanged(cb: () => void): () => void
  onSettingsChanged(cb: () => void): () => void
}

export const API_EVENTS = { onSessionsChanged: 'sessionsChanged', onSettingsChanged: 'settingsChanged' } as const
export type EventName = keyof typeof API_EVENTS
export type EventChannel = (typeof API_EVENTS)[EventName]
export type ApiMethod = Exclude<keyof Api, EventName>
export const API_METHODS = [
  'listSessions',
  'getSettings',
  'saveSettings',
  'resumeSession',
  'openFolder',
  'openPr',
  'renameSession',
  'setArchived',
  'setStatusTee',
] as const satisfies readonly ApiMethod[]

// Fails to compile if a method is added to Api but not to API_METHODS.
type Missing = Exclude<ApiMethod, (typeof API_METHODS)[number]>
export const _allMethodsListed: Missing extends never ? true : Missing = true

export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isSessionId = (v: unknown): v is string => typeof v === 'string' && SESSION_ID_RE.test(v)

// Always the id, never the custom name: names can repeat across sessions.
export const resumeCommand = (id: string, fork: boolean): string =>
  `claude --resume ${id}${fork ? ' --fork-session' : ''}`
export const prCommand = (n: number): string => `claude --from-pr ${n}`

// Linear Design System icons the app draws; src/renderer/src/icons.tsx holds their SVG bodies.
export const ICON_NAMES = [
  'AllItems', 'Box', 'Branch', 'Layers', 'Storage', 'ChevronDown2', 'Search1', 'Bolt', 'Document', 'Attachment2',
  'Loader', 'ClockOutline', 'Code', 'Code2', 'ViewList', 'Timeline', 'CalendarEmpty', 'ArrowRight', 'Clipboard',
  'Link', 'Edit', 'Archive', 'Check',
] as const
export type IconName = (typeof ICON_NAMES)[number]

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('resumes by session id, adding --fork-session only for forks', () => {
    const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
    expect(resumeCommand(id, false)).toBe(`claude --resume ${id}`)
    expect(resumeCommand(id, true)).toBe(`claude --resume ${id} --fork-session`)
  })
  it('accepts only UUID-shaped session ids', () => {
    expect(isSessionId('c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1')).toBe(true)
    expect(isSessionId('../../etc/passwd')).toBe(false)
    expect(isSessionId(42)).toBe(false)
  })
  it('builds the from-pr command from a PR number', () => {
    expect(prCommand(27)).toBe('claude --from-pr 27')
  })
}
```

- [ ] **Step 5: Run the contract tests**

Run: `npx vitest run src/shared/api.ts`
Expected: 3 tests PASS.

- [ ] **Step 6: Write paths, IPC plumbing, preload and the window**

`src/main/paths.ts`:
```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

const home = homedir()
const claude = join(home, '.claude')
const deck = join(claude, 'session-deck')

export const PATHS = {
  home,
  projects: join(claude, 'projects'),
  sessions: join(claude, 'sessions'),
  claudeSettings: join(claude, 'settings.json'),
  deck,
  tee: join(deck, 'status'),
  teeScript: join(deck, 'statusline-tee.sh'),
  teeOriginal: join(deck, 'statusline-original.json'),
  warpConfig: join(home, '.warp', 'launch_configurations', 'session-deck-resume.yaml'),
} as const
```

`src/main/ipc.ts`:
```ts
import { BrowserWindow, ipcMain } from 'electron'
import { API_METHODS, type Api, type ApiMethod, type EventChannel } from '../shared/api'

export function registerIpc(handlers: { [K in ApiMethod]: Api[K] }): void {
  for (const name of API_METHODS) {
    const handler = handlers[name] as (...args: unknown[]) => unknown
    ipcMain.handle(`api:${name}`, (_event, ...args: unknown[]) => handler(...args))
  }
}

export function broadcast(channel: EventChannel): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(`evt:${channel}`)
}
```

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import { API_EVENTS, API_METHODS } from '../shared/api'

const api: Record<string, unknown> = {}
for (const name of API_METHODS) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args)
}
for (const [name, channel] of Object.entries(API_EVENTS)) {
  api[name] = (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on(`evt:${channel}`, listener)
    return () => {
      ipcRenderer.removeListener(`evt:${channel}`, listener)
    }
  }
}
contextBridge.exposeInMainWorld('api', api)
```

`src/main/index.ts` (Tasks 4, 5 and 6 replace this file; the stubs exist only so every method is registered from the start):
```ts
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'

const notYet = async (): Promise<never> => {
  throw new Error('Not implemented yet')
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#181921',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  })
  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.once('ready-to-show', show)
  // A wedged renderer must not leave the window hidden forever.
  setTimeout(show, 3000)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  registerIpc({
    listSessions: async () => [],
    getSettings: async () => ({ terminal: null, archived: [], statusTee: false }),
    saveSettings: notYet,
    resumeSession: notYet,
    openFolder: notYet,
    openPr: notYet,
    renameSession: notYet,
    setArchived: notYet,
    setStatusTee: notYet,
  })
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 7: Typecheck the node side and prove the contract check bites**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0.

Then delete `'setStatusTee',` from `API_METHODS` and run the same command.
Expected: FAIL with an error on `_allMethodsListed`. Restore the line and run it again.
Expected: exit 0.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: 3 tests PASS. No commit, because this folder is not a git repository.

### Task 2: Reduce transcripts into session facts

**Files:**
- Create: `src/main/transcript.ts`

**Interfaces:**
- Consumes: `Session`, `Commit`, `Artifact`, `PullRequest` from `src/shared/api.ts`.
- Produces: `Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }`, `LastEvent = 'interrupt' | 'apiError' | 'normal'`, `Agg` (JSON-serializable), `Facts`, `emptyAgg(id: string): Agg`, `reduceLine(agg: Agg, line: string): void`, `finalize(agg: Agg): Facts | null`, `splitSummary(text: string): { did: string; next: string[] }`.

Record shapes this task relies on. All were verified in real transcripts on this machine (Claude Code 2.1.283), and each JSONL line is compact JSON:
- `user`: `{ type, timestamp, cwd, gitBranch, entrypoint, isMeta?, isSidechain?, message: { content: string | Block[] } }`, where a `tool_result` block's `content` is a string or `[{ type: 'text', text }]`
- `assistant`: `{ type, timestamp, cwd, effort?, isApiErrorMessage?, message: { id, model, usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }, content: Block[] } }`, where `tool_use` blocks carry `{ name, input }`. `Write.input = { file_path, content }`, `Edit.input = { file_path, old_string, new_string, replace_all }`, `MultiEdit.input = { file_path, edits: [{ old_string, new_string }] }`
- `custom-title`: `{ customTitle }`. `permission-mode`: `{ permissionMode }`. `pr-link`: `{ prNumber: string, prUrl, prRepository }`
- `cost-state`: `{ totalCostUSD, totalDuration, totalLinesAdded, totalLinesRemoved, modelUsage: { [model]: { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens } } }`, rewritten cumulatively, so the last one wins
- `system` with `subtype: 'away_summary'` and `content: string`, or `subtype: 'compact_boundary'`
- `forkedFrom: { sessionId, messageUuid }` on the first records of a forked transcript (seen on `attachment` records)
- `entrypoint`: `cli` or `sdk-cli`

- [ ] **Step 1: Write the failing tests**

Create `src/main/transcript.ts` with only the test block below and `export {}` above it.

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const base = { sessionId: id, cwd: '/Users/me/code/app', gitBranch: 'main', entrypoint: 'cli' }
  const user = (content: unknown, extra: object = {}) => ({
    type: 'user', timestamp: '2026-10-06T09:12:00.000Z', ...base, message: { role: 'user', content }, ...extra,
  })
  const assistant = (content: unknown[], extra: object = {}, msg: object = {}) => ({
    type: 'assistant', timestamp: '2026-10-06T09:40:00.000Z', ...base,
    message: { id: 'msg_1', model: 'claude-opus-5-5', content, ...msg }, ...extra,
  })
  const run = (...recs: unknown[]) => {
    const agg = emptyAgg(id)
    for (const r of recs) reduceLine(agg, typeof r === 'string' ? r : JSON.stringify(r))
    return finalize(agg)
  }

  it('takes the title from the last custom-title record and marks the session named', () => {
    const f = run(user('Fix the build'), { type: 'custom-title', customTitle: 'first', sessionId: id },
      { type: 'custom-title', customTitle: 'live-meeting', sessionId: id })
    expect(f?.title).toBe('live-meeting')
    expect(f?.named).toBe(true)
  })

  it('falls back to the first real prompt, skipping meta, bare commands and interrupts', () => {
    const f = run(
      user('<local-command-stdout>ok</local-command-stdout>'),
      user('Caveat: injected context', { isMeta: true }),
      user('<command-message>clear</command-message>\n<command-name>/clear</command-name>\n<command-args></command-args>'),
      user('[Request interrupted by user]'),
      user('<command-message>team8:plan</command-message>\n<command-name>/team8:plan</command-name>\n<command-args>build a session manager</command-args>'),
      user('second prompt'),
    )
    expect(f?.title).toBe('/team8:plan build a session manager')
    expect(f?.named).toBe(false)
    expect(f?.prompts).toEqual(['/team8:plan build a session manager', 'second prompt'])
  })

  it('cuts a long first-prompt title to 80 characters with an ellipsis', () => {
    const f = run(user('x'.repeat(200)))
    expect(f?.title).toBe(`${'x'.repeat(79)}…`)
  })

  it('keeps the latest cwd, branch, model, effort and permission mode, and the first and last timestamps', () => {
    const f = run(
      user('go'),
      { type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: id },
      assistant([{ type: 'text', text: 'ok' }], { effort: 'xhigh', gitBranch: 'live-meeting' }),
    )
    expect(f).toMatchObject({
      cwd: '/Users/me/code/app', branch: 'live-meeting', model: 'claude-opus-5-5', effort: 'xhigh',
      permissionMode: 'bypassPermissions', start: '2026-10-06T09:12:00.000Z', end: '2026-10-06T09:40:00.000Z',
    })
  })

  it('marks sessions started from the SDK as hidden', () => {
    expect(run(user('go', { entrypoint: 'sdk-cli' }))?.hidden).toBe(true)
    expect(run(user('go'))?.hidden).toBe(false)
  })

  it('counts changed lines per file and records doc-like writes as artifacts', () => {
    const f = run(user('go'), assistant([
      { type: 'tool_use', name: 'Edit', input: { file_path: '/Users/me/code/app/a.ts', old_string: 'a\nb', new_string: 'a\nb\nc' } },
      { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/Users/me/code/app/a.ts', edits: [{ old_string: 'x', new_string: 'y\nz' }] } },
      { type: 'tool_use', name: 'Write', input: { file_path: '/Users/me/code/app/docs/plan.md', content: '# Plan\n\nStep one' } },
      { type: 'tool_use', name: 'Write', input: { file_path: '/Users/me/code/app/b.ts', content: 'export {}' } },
    ]))
    expect(f?.files).toEqual([
      { path: '/Users/me/code/app/a.ts', added: 5, removed: 3 },
      { path: '/Users/me/code/app/docs/plan.md', added: 3, removed: 0 },
      { path: '/Users/me/code/app/b.ts', added: 1, removed: 0 },
    ])
    expect(f?.artifacts).toEqual([
      { name: 'plan.md', kind: 'markdown', path: '/Users/me/code/app/docs/plan.md', bytes: 16, preview: '# Plan\n\nStep one' },
    ])
  })

  it('reads commits from git commit output in tool results, once per sha', () => {
    const out = '[main 67e6e2c] Add the warp shortcut\n 1 file changed, 45 insertions(+)'
    const f = run(
      user([{ type: 'tool_result', content: out }]),
      user([{ type: 'tool_result', content: [{ type: 'text', text: out }] }]),
      user([{ type: 'tool_result', content: '[feat/x (root-commit) 1a2b3c4] Initial commit' }]),
    )
    expect(f?.commits).toEqual([
      { sha: '67e6e2c', msg: 'Add the warp shortcut', at: '2026-10-06T09:12:00.000Z' },
      { sha: '1a2b3c4', msg: 'Initial commit', at: '2026-10-06T09:12:00.000Z' },
    ])
  })

  it('counts a streamed assistant message once when consecutive records share its id', () => {
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 }
    const f = run(user('go'),
      assistant([{ type: 'text', text: 'a' }], {}, { id: 'msg_1', usage }),
      assistant([{ type: 'text', text: 'b' }], {}, { id: 'msg_1', usage: { ...usage, output_tokens: 7 } }),
      assistant([{ type: 'text', text: 'c' }], {}, { id: 'msg_2', usage }),
    )
    expect(f?.tokens).toEqual({ input: 20, output: 12, cacheRead: 2000, cacheWrite: 200 })
    expect(f?.context).toBe(1110)
    expect(f?.cost).toBeNull()
  })

  it('prefers the last cost-state over summed usage for totals, cost, duration and lines', () => {
    const cs = (cost: number) => ({
      type: 'cost-state', sessionId: id, totalCostUSD: cost, totalDuration: 2_400_000, totalLinesAdded: 524, totalLinesRemoved: 131,
      modelUsage: { 'claude-opus-5-5': { inputTokens: 150, outputTokens: 190_900, cacheReadInputTokens: 260_800, cacheCreationInputTokens: 2200 } },
    })
    const f = run(user('go'), cs(1), cs(5.08))
    expect(f).toMatchObject({ cost: 5.08, durationMs: 2_400_000, linesAdded: 524, linesRemoved: 131 })
    expect(f?.tokens).toEqual({ input: 150, output: 190_900, cacheRead: 260_800, cacheWrite: 2200 })
  })

  it('remembers whether the last turn was interrupted or failed', () => {
    expect(run(user('go'), assistant([]), user('[Request interrupted by user]'))?.lastEvent).toBe('interrupt')
    expect(run(user('go'), assistant([], { isApiErrorMessage: true }))?.lastEvent).toBe('apiError')
    expect(run(user('go'), assistant([], { isApiErrorMessage: true }), user('retry'))?.lastEvent).toBe('normal')
  })

  it('splits the last away summary into what was done and what is next', () => {
    const f = run(user('go'),
      { type: 'system', subtype: 'away_summary', content: 'old', timestamp: '2026-10-06T09:20:00.000Z', ...base },
      { type: 'system', subtype: 'away_summary', content: 'Built the import. Next: review PR #28. (disable recaps in /config)', timestamp: '2026-10-06T09:30:00.000Z', ...base })
    expect(f?.summary).toEqual({ did: 'Built the import.', next: ['Review PR #28.'] })
    expect(splitSummary('Nothing left to do.')).toEqual({ did: 'Nothing left to do.', next: [] })
    expect(splitSummary('Fixed it. Next, once the run ends, I tune.')).toEqual({ did: 'Fixed it.', next: ['Once the run ends, I tune.'] })
  })

  it('reads the PR link, the fork parent and the number of compactions', () => {
    const f = run(
      { type: 'attachment', forkedFrom: { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', messageUuid: 'x' }, ...base, timestamp: '2026-10-06T09:00:00.000Z' },
      user('go'),
      { type: 'pr-link', sessionId: id, prNumber: '28', prUrl: 'https://github.com/alan-oliv/meetnotes/pull/28', prRepository: 'alan-oliv/meetnotes' },
      { type: 'system', subtype: 'compact_boundary', ...base, timestamp: '2026-10-06T09:50:00.000Z' },
    )
    expect(f?.forkedFrom).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(f?.pr).toEqual({ repo: 'alan-oliv/meetnotes', number: 28, url: 'https://github.com/alan-oliv/meetnotes/pull/28' })
    expect(f?.compactions).toBe(1)
  })

  it('skips malformed lines and snapshot records without throwing', () => {
    const f = run('{not json', '{"type":"file-history-snapshot","messageId":"m","snapshot":{}}', '', user('go'))
    expect(f?.title).toBe('go')
  })

  it('returns null for a transcript with no timestamped records', () => {
    expect(run({ type: 'custom-title', customTitle: 'x', sessionId: id })).toBeNull()
  })
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/transcript.ts`
Expected: FAIL with `emptyAgg is not defined`.

- [ ] **Step 3: Implement the reducer above the test block**

Replace `export {}` with:

```ts
import { basename, extname } from 'node:path'
import type { Artifact, Commit, PullRequest } from '../shared/api'

export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number }
export type LastEvent = 'interrupt' | 'apiError' | 'normal'

export interface Agg {
  id: string
  customTitle: string | null
  firstPrompt: string | null
  prompts: string[]
  cwd: string | null
  branch: string | null
  entrypoint: string | null
  start: string | null
  end: string | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  pr: PullRequest | null
  forkedFrom: string | null
  awaySummary: string | null
  files: Record<string, { added: number; removed: number }>
  commits: Commit[]
  artifacts: Record<string, Artifact>
  lastEvent: LastEvent
  sum: Tokens
  lastMsgId: string | null
  lastMsgUsage: Tokens
  context: number
  compactions: number
  costState: { cost: number; durationMs: number; linesAdded: number; linesRemoved: number; tokens: Tokens } | null
}

export interface Facts {
  id: string
  title: string
  named: boolean
  cwd: string
  branch: string | null
  hidden: boolean
  start: string
  end: string
  model: string | null
  effort: string | null
  permissionMode: string | null
  pr: PullRequest | null
  forkedFrom: string | null
  prompts: string[]
  summary: { did: string; next: string[] } | null
  files: { path: string; added: number; removed: number }[]
  commits: Commit[]
  artifacts: Artifact[]
  lastEvent: LastEvent
  tokens: Tokens
  context: number
  compactions: number
  cost: number | null
  durationMs: number
  linesAdded: number
  linesRemoved: number
}

// Caps keep the IPC payload small: every listSessions() ships all sessions.
const MAX_PROMPTS = 30
const PROMPT_CHARS = 300
const TITLE_CHARS = 80
const PREVIEW_LINES = 40
const PREVIEW_CHARS = 4096
const ARTIFACT_KINDS: Record<string, string> = {
  md: 'markdown', markdown: 'markdown', json: 'json', html: 'html', csv: 'csv',
  yaml: 'yaml', yml: 'yaml', txt: 'text', svg: 'svg',
}
// These records start with their type and carry nothing we read, so skip them before JSON.parse.
const SKIP_HEAD = /"type":"(?:file-history-snapshot|file-history-delta|queue-operation|atis-latch)"/
const COMMIT_RE = /^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/gm

type Rec = Record<string, any>

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const lineCount = (s: unknown): number => (typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

export function emptyAgg(id: string): Agg {
  return {
    id, customTitle: null, firstPrompt: null, prompts: [], cwd: null, branch: null, entrypoint: null,
    start: null, end: null, model: null, effort: null, permissionMode: null, pr: null, forkedFrom: null,
    awaySummary: null, files: {}, commits: [], artifacts: {}, lastEvent: 'normal', sum: zero(),
    lastMsgId: null, lastMsgUsage: zero(), context: 0, compactions: 0, costState: null,
  }
}

export function reduceLine(agg: Agg, line: string): void {
  if (!line || SKIP_HEAD.test(line.slice(0, 120))) return
  if (line.includes('"type":"attachment"') && !line.includes('"forkedFrom"')) return
  let rec: unknown
  try {
    rec = JSON.parse(line)
  } catch {
    return
  }
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) reduceRecord(agg, rec as Rec)
}

function reduceRecord(agg: Agg, r: Rec): void {
  const ts = str(r.timestamp)
  if (ts) {
    agg.start ??= ts
    agg.end = ts
  }
  agg.cwd = str(r.cwd) ?? agg.cwd
  agg.branch = str(r.gitBranch) ?? agg.branch
  agg.entrypoint ??= str(r.entrypoint)
  agg.forkedFrom ??= str(r.forkedFrom?.sessionId)

  switch (r.type) {
    case 'custom-title': {
      const t = str(r.customTitle)?.trim()
      if (t) agg.customTitle = t
      break
    }
    case 'permission-mode':
      agg.permissionMode = str(r.permissionMode) ?? agg.permissionMode
      break
    case 'pr-link': {
      const n = num(r.prNumber)
      const url = str(r.prUrl)
      if (n > 0 && url) agg.pr = { repo: str(r.prRepository) ?? '', number: n, url }
      break
    }
    case 'cost-state':
      agg.costState = readCostState(r)
      break
    case 'system':
      if (r.subtype === 'away_summary' && str(r.content)) agg.awaySummary = r.content
      if (r.subtype === 'compact_boundary') agg.compactions++
      break
    case 'user':
      reduceUser(agg, r)
      break
    case 'assistant':
      reduceAssistant(agg, r)
      break
  }
}

function readCostState(r: Rec): NonNullable<Agg['costState']> {
  const tokens = zero()
  const usage = r.modelUsage && typeof r.modelUsage === 'object' ? Object.values(r.modelUsage as Rec) : []
  for (const m of usage) {
    tokens.input += num(m?.inputTokens)
    tokens.output += num(m?.outputTokens)
    tokens.cacheRead += num(m?.cacheReadInputTokens)
    tokens.cacheWrite += num(m?.cacheCreationInputTokens)
  }
  return {
    cost: num(r.totalCostUSD),
    durationMs: num(r.totalDuration),
    linesAdded: num(r.totalLinesAdded),
    linesRemoved: num(r.totalLinesRemoved),
    tokens,
  }
}

function reduceUser(agg: Agg, r: Rec): void {
  if (r.isSidechain) return
  const content = r.message?.content
  if (typeof content === 'string') {
    if (!r.isMeta) userText(agg, content)
    return
  }
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      if (!r.isMeta) userText(agg, block.text)
    } else if (block?.type === 'tool_result') {
      toolResult(agg, block, str(r.timestamp) ?? '')
    }
  }
}

function userText(agg: Agg, text: string): void {
  if (text.trimStart().startsWith('[Request interrupted')) {
    agg.lastEvent = 'interrupt'
    return
  }
  agg.lastEvent = 'normal'
  const prompt = promptText(text)
  if (!prompt) return
  agg.firstPrompt ??= prompt
  if (agg.prompts.length < MAX_PROMPTS) agg.prompts.push(prompt.slice(0, PROMPT_CHARS))
}

// Slash commands arrive wrapped in tags; keep "/name args" when there are args, drop everything else tagged.
function promptText(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (!t.startsWith('<')) return t
  const name = /<command-name>([^<]*)<\/command-name>/.exec(t)?.[1]?.trim()
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1]?.trim()
  return name && args ? `${name} ${args}` : null
}

function toolResult(agg: Agg, block: Rec, at: string): void {
  const c = block.content
  const text =
    typeof c === 'string' ? c
    : Array.isArray(c) ? c.map((x: Rec) => (typeof x?.text === 'string' ? x.text : '')).join('\n')
    : ''
  if (!text.includes('] ')) return
  for (const m of text.matchAll(COMMIT_RE)) {
    if (!agg.commits.some((x) => x.sha === m[2])) agg.commits.push({ sha: m[2], msg: m[3].trim(), at })
  }
}

function reduceAssistant(agg: Agg, r: Rec): void {
  if (r.isSidechain) return
  const m = r.message
  if (!m || typeof m !== 'object') return
  if (typeof m.model === 'string' && m.model !== '<synthetic>') agg.model = m.model
  agg.effort = str(r.effort) ?? agg.effort
  agg.lastEvent = r.isApiErrorMessage ? 'apiError' : 'normal'

  const u = m.usage
  if (u && typeof u === 'object') {
    const t: Tokens = {
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
    }
    const msgId = str(m.id)
    // Streamed chunks of one message repeat its usage; replace the earlier chunk's share instead of adding again.
    if (msgId && msgId === agg.lastMsgId) addTokens(agg.sum, agg.lastMsgUsage, -1)
    addTokens(agg.sum, t, 1)
    agg.lastMsgId = msgId
    agg.lastMsgUsage = t
    const ctx = t.input + t.cacheRead + t.cacheWrite
    if (ctx > 0) agg.context = ctx
  }
  if (Array.isArray(m.content)) for (const block of m.content) if (block?.type === 'tool_use') toolUse(agg, block)
}

function addTokens(into: Tokens, t: Tokens, sign: 1 | -1): void {
  into.input += sign * t.input
  into.output += sign * t.output
  into.cacheRead += sign * t.cacheRead
  into.cacheWrite += sign * t.cacheWrite
}

function toolUse(agg: Agg, block: Rec): void {
  const input = block.input
  const path = str(input?.file_path)
  if (!path) return
  if (block.name === 'Edit') {
    bump(agg, path, lineCount(input.new_string), lineCount(input.old_string))
  } else if (block.name === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const e of input.edits) bump(agg, path, lineCount(e?.new_string), lineCount(e?.old_string))
  } else if (block.name === 'Write' && typeof input.content === 'string') {
    bump(agg, path, lineCount(input.content), 0)
    const kind = ARTIFACT_KINDS[extname(path).slice(1).toLowerCase()]
    if (kind) {
      agg.artifacts[path] = {
        name: basename(path),
        kind,
        path,
        bytes: Buffer.byteLength(input.content),
        preview: input.content.split('\n').slice(0, PREVIEW_LINES).join('\n').slice(0, PREVIEW_CHARS),
      }
    }
  }
}

function bump(agg: Agg, path: string, added: number, removed: number): void {
  const f = (agg.files[path] ??= { added: 0, removed: 0 })
  f.added += added
  f.removed += removed
}

export function splitSummary(text: string): { did: string; next: string[] } {
  const clean = text.replace(/\s*\(disable recaps in \/config\)\s*$/, '').trim()
  const m = /\bNext[:,]\s*/.exec(clean)
  if (!m) return { did: clean, next: [] }
  const did = clean.slice(0, m.index).trim()
  const rest = clean.slice(m.index + m[0].length).trim()
  return { did, next: rest ? [rest[0].toUpperCase() + rest.slice(1)] : [] }
}

function titleFrom(prompt: string | null): string {
  const line = prompt?.split('\n').find((l) => l.trim())?.trim()
  if (!line) return 'Untitled session'
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line
}

export function finalize(agg: Agg): Facts | null {
  if (!agg.start || !agg.end || !agg.cwd) return null
  const cs = agg.costState
  const csTotal = cs ? cs.tokens.input + cs.tokens.output + cs.tokens.cacheRead + cs.tokens.cacheWrite : 0
  const files = Object.entries(agg.files).map(([path, f]) => ({ path, added: f.added, removed: f.removed }))
  return {
    id: agg.id,
    title: agg.customTitle ?? titleFrom(agg.firstPrompt),
    named: agg.customTitle !== null,
    cwd: agg.cwd,
    branch: agg.branch,
    hidden: agg.entrypoint?.startsWith('sdk') ?? false,
    start: agg.start,
    end: agg.end,
    model: agg.model,
    effort: agg.effort,
    permissionMode: agg.permissionMode,
    pr: agg.pr,
    forkedFrom: agg.forkedFrom,
    prompts: agg.prompts,
    summary: agg.awaySummary ? splitSummary(agg.awaySummary) : null,
    files,
    commits: agg.commits,
    artifacts: Object.values(agg.artifacts),
    lastEvent: agg.lastEvent,
    tokens: cs && csTotal > 0 ? cs.tokens : agg.sum,
    context: agg.context,
    compactions: agg.compactions,
    cost: cs ? cs.cost : null,
    durationMs: cs?.durationMs || Math.max(0, Date.parse(agg.end) - Date.parse(agg.start)),
    linesAdded: cs ? cs.linesAdded : files.reduce((n, f) => n + f.added, 0),
    linesRemoved: cs ? cs.linesRemoved : files.reduce((n, f) => n + f.removed, 0),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/transcript.ts && npx tsc --noEmit -p tsconfig.node.json`
Expected: 14 tests PASS, and tsc exits 0. `Rec = Record<string, any>` is deliberate: the records are untyped external JSON, and every field is narrowed where it is read. Task 4's smoke test runs this reducer over every real transcript. No commit (not a git repo).

### Task 3: Resolve git locations and live state

**Files:**
- Create: `src/main/git.ts`, `src/main/live.ts`

**Interfaces:**
- Consumes: nothing beyond Node.
- Produces (`git.ts`): `GitInfo = { repoRoot: string | null; worktree: { name: string; path: string } | null; removedSeen: string | null }`, `resolveGit(cwd: string, prev: GitInfo | undefined, nowIso: string): GitInfo`.
- Produces (`live.ts`): `LiveInfo = { status: string }`, `TeeInfo = { contextUsed: number | null; contextMax: number | null; outputStyle: string | null; plan: { usedPct: number; resetsAt: string } | null }`, `readLive(dir: string, alive?: (pid: number) => boolean): Map<string, LiveInfo>`, `parseTee(json: unknown): TeeInfo`, `readTee(dir: string): Map<string, TeeInfo>`.

Facts this task relies on:
- A git worktree's `.git` is a file containing `gitdir: <main>/.git/worktrees/<name>`.
- `~/.claude/sessions/<pid>.json` holds `{ pid, sessionId, status: 'busy' | 'idle', … }`. Next to it sit `<pid>.<hash>.key` files, which are secrets: never read them.
- The status-line input (docs: code.claude.com/docs/en/statusline) carries `session_id`, `context_window.total_input_tokens`, `context_window.context_window_size`, `output_style.name`, and `rate_limits.five_hour.used_percentage` / `.resets_at` (Unix seconds). Any of them may be absent.

- [ ] **Step 1: Write the failing git tests**

Create `src/main/git.ts` with the import lines from Step 3 and this block below them:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  // realpath because macOS tmpdir is a /var → /private/var symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-git-')))
  const repo = join(root, 'repo')
  const wt = join(repo, '.claude', 'worktrees', 'feat')
  mkdirSync(join(repo, '.git', 'worktrees', 'feat'), { recursive: true })
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(wt, { recursive: true })
  writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'feat')}\n`)
  mkdirSync(join(root, 'plain'), { recursive: true })

  it('finds the repo root from a subfolder', () => {
    expect(resolveGit(join(repo, 'src'), undefined, 'T')).toEqual({ repoRoot: repo, worktree: null, removedSeen: null })
  })
  it('resolves a worktree to its main repository', () => {
    expect(resolveGit(wt, undefined, 'T')).toEqual({ repoRoot: repo, worktree: { name: 'feat', path: wt }, removedSeen: null })
  })
  it('treats a folder outside any repository as a plain folder', () => {
    expect(resolveGit(join(root, 'plain'), undefined, 'T')).toEqual({ repoRoot: null, worktree: null, removedSeen: null })
  })
  it('keeps what it knew after the folder is deleted and stamps when it was first seen missing', () => {
    const before = resolveGit(wt, undefined, 'T0')
    rmSync(wt, { recursive: true })
    const first = resolveGit(wt, before, 'T1')
    expect(first).toEqual({ repoRoot: repo, worktree: { name: 'feat', path: wt }, removedSeen: 'T1' })
    expect(resolveGit(wt, first, 'T2').removedSeen).toBe('T1')
  })
  it('infers a removed worktree from a worktrees segment when it was never seen', () => {
    const gone = join(repo, '.worktrees', 'gone', 'sub')
    expect(resolveGit(gone, undefined, 'T')).toEqual({
      repoRoot: repo, worktree: { name: 'gone', path: join(repo, '.worktrees', 'gone') }, removedSeen: 'T',
    })
  })
  it('infers a removed folder inside a repo when the path has no worktrees segment', () => {
    expect(resolveGit(join(repo, 'scratch', 'old'), undefined, 'T')).toEqual({ repoRoot: repo, worktree: null, removedSeen: 'T' })
  })
  it('infers a removed plain folder outside any repository', () => {
    expect(resolveGit(join(root, 'plain', 'gone'), undefined, 'T')).toEqual({ repoRoot: null, worktree: null, removedSeen: 'T' })
  })
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/git.ts`
Expected: FAIL with `resolveGit is not defined`.

- [ ] **Step 3: Implement `git.ts` above the test block**

The file's top, imports included:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export interface GitInfo {
  repoRoot: string | null
  worktree: { name: string; path: string } | null
  removedSeen: string | null
}
type Location = Omit<GitInfo, 'removedSeen'>

function locate(start: string): Location {
  let dir = start
  for (;;) {
    const dotGit = join(dir, '.git')
    const st = statSync(dotGit, { throwIfNoEntry: false })
    if (st?.isDirectory()) return { repoRoot: dir, worktree: null }
    if (st?.isFile()) {
      const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
      const abs = gitdir ? resolve(dir, gitdir) : ''
      const i = abs.indexOf('/.git/worktrees/')
      if (i > 0) return { repoRoot: abs.slice(0, i), worktree: { name: basename(dir), path: dir } }
      return { repoRoot: dir, worktree: null }
    }
    const parent = dirname(dir)
    if (parent === dir) return { repoRoot: null, worktree: null }
    dir = parent
  }
}

function inferRemoved(cwd: string): Location {
  let dir = dirname(cwd)
  while (dir !== dirname(dir) && !existsSync(dir)) dir = dirname(dir)
  const near = locate(dir)
  if (!near.repoRoot || !cwd.startsWith(`${near.repoRoot}/`)) return near
  const rest = cwd.slice(near.repoRoot.length)
  const m = /\/\.?worktrees\/([^/]+)/.exec(rest)
  if (!m) return near
  return { repoRoot: near.repoRoot, worktree: { name: m[1], path: near.repoRoot + rest.slice(0, m.index + m[0].length) } }
}

export function resolveGit(cwd: string, prev: GitInfo | undefined, nowIso: string): GitInfo {
  if (existsSync(cwd)) return { ...locate(cwd), removedSeen: null }
  if (prev?.removedSeen) return prev
  const known = prev ? { repoRoot: prev.repoRoot, worktree: prev.worktree } : inferRemoved(cwd)
  return { ...known, removedSeen: nowIso }
}
```

- [ ] **Step 4: Run the git tests to verify they pass**

Run: `npx vitest run src/main/git.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Write the failing live and tee tests**

Create `src/main/live.ts` with the import lines from Step 7 and this block below them:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const a = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const b = '711a48a0-fc93-44b8-b71c-1c6e5b645970'

  it('lists only sessions whose process is still alive, ignoring key files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-live-'))
    writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: a, status: 'busy' }))
    writeFileSync(join(dir, '2.json'), JSON.stringify({ pid: 2, sessionId: b, status: 'idle' }))
    writeFileSync(join(dir, '1.abc.key'), 'secret')
    const live = readLive(dir, (pid) => pid === 1)
    expect([...live]).toEqual([[a, { status: 'busy' }]])
  })
  it('returns no live sessions when the folder is missing', () => {
    expect(readLive('/nonexistent/deck').size).toBe(0)
  })
  it('reads context, output style and the five-hour plan window from status-line input', () => {
    const t = parseTee({
      session_id: a, output_style: { name: 'architecture' },
      context_window: { total_input_tokens: 263000, context_window_size: 1000000 },
      rate_limits: { five_hour: { used_percentage: 32.9, resets_at: 1738425600 } },
    })
    expect(t).toEqual({
      contextUsed: 263000, contextMax: 1000000, outputStyle: 'architecture',
      plan: { usedPct: 32.9, resetsAt: new Date(1738425600 * 1000).toISOString() },
    })
  })
  it('treats the default output style and missing fields as unknown', () => {
    expect(parseTee({ output_style: { name: 'default' } })).toEqual({ contextUsed: null, contextMax: null, outputStyle: null, plan: null })
    expect(parseTee('nope')).toEqual({ contextUsed: null, contextMax: null, outputStyle: null, plan: null })
  })
  it('reads tee files keyed by session id and skips partial writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-tee-'))
    writeFileSync(join(dir, `${a}.json`), JSON.stringify({ output_style: { name: 'explain' } }))
    writeFileSync(join(dir, `${b}.json.tmp`), '{')
    expect([...readTee(dir).keys()]).toEqual([a])
    expect(readTee(dir).get(a)?.outputStyle).toBe('explain')
  })
}
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/main/live.ts`
Expected: FAIL with `readLive is not defined`.

- [ ] **Step 7: Implement `live.ts` above the test block**

The file's top, imports included:

```ts
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface LiveInfo { status: string }
export interface TeeInfo {
  contextUsed: number | null
  contextMax: number | null
  outputStyle: string | null
  plan: { usedPct: number; resetsAt: string } | null
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function jsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// Stale <pid>.json files survive crashes, so liveness is the process, not the file.
export function readLive(dir: string, alive: (pid: number) => boolean = isAlive): Map<string, LiveInfo> {
  const out = new Map<string, LiveInfo>()
  for (const name of jsonFiles(dir)) {
    const j = readJson(join(dir, name)) as Record<string, unknown> | null
    const pid = Number(j?.pid)
    if (typeof j?.sessionId === 'string' && Number.isInteger(pid) && pid > 0 && alive(pid)) {
      out.set(j.sessionId, { status: typeof j.status === 'string' ? j.status : 'idle' })
    }
  }
  return out
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseTee(json: unknown): TeeInfo {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, any>
  const five = j.rate_limits?.five_hour
  const usedPct = finite(five?.used_percentage)
  const resets = finite(five?.resets_at)
  const style = j.output_style?.name
  return {
    contextUsed: finite(j.context_window?.total_input_tokens),
    contextMax: finite(j.context_window?.context_window_size),
    outputStyle: typeof style === 'string' && style !== 'default' ? style : null,
    plan: usedPct !== null && resets !== null ? { usedPct, resetsAt: new Date(resets * 1000).toISOString() } : null,
  }
}

export function readTee(dir: string): Map<string, TeeInfo> {
  const out = new Map<string, TeeInfo>()
  for (const name of jsonFiles(dir)) {
    const j = readJson(join(dir, name))
    if (j) out.set(name.slice(0, -'.json'.length), parseTee(j))
  }
  return out
}
```

- [ ] **Step 8: Run both files' tests and the node typecheck**

Run: `npx vitest run src/main/git.ts src/main/live.ts && npx tsc --noEmit -p tsconfig.node.json`
Expected: 12 tests PASS, and tsc exits 0. Test-only fs helpers sit in the top-level imports on purpose. Top-level `await import` inside the test block would break the CommonJS main build. No commit (not a git repo).

### Task 4: Index transcripts incrementally and serve listSessions

**Files:**
- Create: `src/main/indexer.ts`, `src/main/settings.ts`
- Modify: `src/main/index.ts` (full replacement given)

**Interfaces:**
- Consumes: Task 2 (`emptyAgg`, `reduceLine`, `finalize`, `Agg`, `Facts`), Task 3 (`resolveGit`, `GitInfo`, `readLive`, `readTee`, `LiveInfo`, `TeeInfo`), Task 1 (`PATHS`, `registerIpc`, `broadcast`, api types).
- Produces (`indexer.ts`): `Indexer = { start(): Promise<void>; refresh(): Promise<void>; list(): Session[]; get(id: string): Session | undefined; transcriptPath(id: string): string | undefined; notify(): void; stop(): void }`, `createIndexer(opts: IndexerOptions): Indexer`, `toSession(f: Facts, x: SessionContext): Session`, `contextMaxFor(model: string | null, used: number, teeMax: number | null): number`, `readCleanupDays(path: string): number`.
- Produces (`settings.ts`): `isTerminal(v: unknown): v is Terminal`, `writeJsonAtomic(path: string, value: unknown): void`, `normalizeSettings(raw: unknown): Settings`, `SettingsStore = { get(): Settings; save(patch: Partial<Settings>): Settings }`, `createSettingsStore(path: string): SettingsStore`.

- [ ] **Step 1: Write the failing settings tests**

Create `src/main/settings.ts` with the import lines from Step 3 and this block:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  it('drops unknown terminals, non-session ids and duplicates', () => {
    expect(normalizeSettings({ terminal: 'kitty', archived: [id, id, '../x'], statusTee: 'yes' }))
      .toEqual({ terminal: null, archived: [id], statusTee: false })
    expect(normalizeSettings(null)).toEqual({ terminal: null, archived: [], statusTee: false })
  })
  it('persists saved settings and reads them back', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'deck-settings-')), 'nested', 'settings.json')
    createSettingsStore(path).save({ terminal: 'iterm', archived: [id] })
    expect(createSettingsStore(path).get()).toEqual({ terminal: 'iterm', archived: [id], statusTee: false })
  })
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/settings.ts`
Expected: FAIL with `normalizeSettings is not defined`.

- [ ] **Step 3: Implement `settings.ts` above the test block**

```ts
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isSessionId, type Settings, type Terminal } from '../shared/api'

const TERMINALS: readonly Terminal[] = ['iterm', 'warp', 'terminal']
export const isTerminal = (v: unknown): v is Terminal => TERMINALS.includes(v as Terminal)

export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    terminal: isTerminal(r.terminal) ? r.terminal : null,
    archived: Array.isArray(r.archived) ? [...new Set(r.archived.filter(isSessionId))] : [],
    statusTee: r.statusTee === true,
  }
}

export interface SettingsStore {
  get(): Settings
  save(patch: Partial<Settings>): Settings
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2))
  renameSync(`${path}.tmp`, path)
}

export function createSettingsStore(path: string): SettingsStore {
  let current = normalizeSettings(readJson(path))
  return {
    get: () => current,
    save(patch) {
      current = normalizeSettings({ ...current, ...patch })
      writeJsonAtomic(path, current)
      return current
    },
  }
}
```

Run: `npx vitest run src/main/settings.ts`
Expected: 2 tests PASS.

- [ ] **Step 4: Write the failing indexer tests**

Create `src/main/indexer.ts` with the import lines from Step 6 and this block:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const child = '711a48a0-fc93-44b8-b71c-1c6e5b645970'
  const facts = (over: Partial<Facts> = {}): Facts => ({
    id, title: 't', named: false, cwd: '/r/app/src', branch: 'main', hidden: false,
    start: '2026-10-06T09:00:00.000Z', end: '2026-10-06T10:00:00.000Z', model: 'claude-opus-5-5', effort: 'high',
    permissionMode: 'default', pr: null, forkedFrom: null, prompts: [], summary: null,
    files: [{ path: '/r/app/src/a.ts', added: 1, removed: 0 }, { path: '/tmp/x.md', added: 2, removed: 0 }],
    commits: [], artifacts: [], lastEvent: 'normal',
    tokens: { input: 10, output: 5, cacheRead: 980, cacheWrite: 10 }, context: 1000, compactions: 0,
    cost: 1.5, durationMs: 60_000, linesAdded: 3, linesRemoved: 0, ...over,
  })
  const ctx = (over: Partial<SessionContext> = {}): SessionContext => ({
    git: { repoRoot: '/r/app', worktree: null, removedSeen: null }, live: undefined, tee: undefined,
    archived: false, forks: 0, sizeBytes: 6_100_000, agents: 3, cleanupDays: 30, ...over,
  })

  it('derives the session status from live state first, then from the last turn', () => {
    expect(toSession(facts(), ctx({ live: { status: 'busy' } })).status).toBe('running')
    expect(toSession(facts(), ctx({ live: { status: 'idle' } })).status).toBe('waiting')
    expect(toSession(facts({ lastEvent: 'interrupt' }), ctx()).status).toBe('interrupted')
    expect(toSession(facts({ lastEvent: 'apiError' }), ctx()).status).toBe('failed')
    expect(toSession(facts(), ctx()).status).toBe('completed')
  })
  it('names the repo after its root and shows changed files relative to it', () => {
    const s = toSession(facts(), ctx())
    expect(s.repo).toEqual({ name: 'app', root: '/r/app' })
    expect(s.files.map((f) => f.path)).toEqual(['src/a.ts', '/tmp/x.md'])
  })
  it('marks a removed cwd and carries the removal stamp onto the worktree', () => {
    const s = toSession(facts(), ctx({ git: { repoRoot: '/r/app', worktree: { name: 'feat', path: '/r/app/.worktrees/feat' }, removedSeen: '2026-10-02T00:00:00.000Z' } }))
    expect(s.cwdExists).toBe(false)
    expect(s.worktree).toEqual({ name: 'feat', path: '/r/app/.worktrees/feat', removedSeen: '2026-10-02T00:00:00.000Z' })
  })
  it('keeps a session until the cleanup period after its last activity', () => {
    expect(toSession(facts(), ctx({ cleanupDays: 30 })).keptUntil).toBe('2026-11-05T10:00:00.000Z')
  })
  it('shows plan usage only while the session is live', () => {
    const tee = { contextUsed: 263_000, contextMax: 1_000_000, outputStyle: 'architecture', plan: { usedPct: 32.9, resetsAt: '2026-10-06T14:00:00.000Z' } }
    expect(toSession(facts(), ctx({ tee })).usage.plan).toBeNull()
    const live = toSession(facts(), ctx({ tee, live: { status: 'busy' } })).usage
    expect(live).toMatchObject({ plan: tee.plan, contextUsed: 263_000, contextMax: 1_000_000, outputStyle: 'architecture' })
  })
  it('computes totals and the cache hit share from tokens', () => {
    const u = toSession(facts(), ctx()).usage
    expect(u).toMatchObject({ total: 1005, cacheHitPct: 98, contextUsed: 1000, agents: 3, cost: 1.5 })
  })
  it('picks the context window from the tee, then the model, then the usage', () => {
    expect(contextMaxFor('claude-sonnet-4-5', 10, 400_000)).toBe(400_000)
    expect(contextMaxFor('claude-opus-5-5', 10, null)).toBe(1_000_000)
    expect(contextMaxFor('claude-haiku-4-5-20251001', 10, null)).toBe(200_000)
    expect(contextMaxFor('claude-haiku-4-5-20251001', 300_000, null)).toBe(1_000_000)
  })
  it('reads the cleanup period from Claude settings, defaulting to 30 days', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-cleanup-'))
    writeFileSync(join(dir, 's.json'), JSON.stringify({ cleanupPeriodDays: 14 }))
    expect(readCleanupDays(join(dir, 's.json'))).toBe(14)
    expect(readCleanupDays(join(dir, 'missing.json'))).toBe(30)
  })

  const line = (o: object) => `${JSON.stringify({ sessionId: id, cwd: '/r/app', entrypoint: 'cli', ...o })}\n`
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-index-'))
    const projects = join(dir, 'projects')
    mkdirSync(join(projects, '-r-app', id, 'subagents'), { recursive: true })
    writeFileSync(join(projects, '-r-app', id, 'subagents', 'agent-1.jsonl'), '')
    const file = join(projects, '-r-app', `${id}.jsonl`)
    writeFileSync(file, line({ type: 'user', timestamp: '2026-10-06T09:00:00.000Z', message: { content: 'first prompt' } }))
    writeFileSync(join(projects, '-r-app', `${child}.jsonl`),
      line({ type: 'attachment', sessionId: child, forkedFrom: { sessionId: id }, timestamp: '2026-10-06T11:00:00.000Z' }) +
      line({ type: 'user', sessionId: child, timestamp: '2026-10-06T11:00:00.000Z', message: { content: 'forked' } }))
    const opts = {
      projectsDir: projects, sessionsDir: join(dir, 'sessions'), teeDir: join(dir, 'tee'), cachePath: join(dir, 'index.json'),
      claudeSettingsPath: join(dir, 'settings.json'), getSettings: () => ({ terminal: null, archived: [child], statusTee: false }),
      onChange: () => {},
    }
    return { file, opts }
  }

  it('indexes transcripts, counts forks and subagents, and marks archived sessions', async () => {
    const { opts } = fixture()
    const idx = createIndexer(opts)
    await idx.refresh()
    const s = idx.get(id)
    expect(s).toMatchObject({ title: 'first prompt', forks: 1, archived: false })
    expect(s?.usage.agents).toBe(1)
    expect(idx.get(child)?.archived).toBe(true)
    idx.stop()
  })
  it('parses only appended lines, and starts over when a transcript shrinks', async () => {
    const { file, opts } = fixture()
    const idx = createIndexer(opts)
    await idx.refresh()
    appendFileSync(file, line({ type: 'custom-title', customTitle: 'renamed' }))
    await idx.refresh()
    expect(idx.get(id)?.title).toBe('renamed')
    writeFileSync(file, line({ type: 'user', timestamp: '2026-10-06T09:00:00.000Z', message: { content: 'fresh' } }))
    await idx.refresh()
    expect(idx.get(id)?.title).toBe('fresh')
    idx.stop()
  })
  it('reloads the saved cache without reparsing unchanged files', async () => {
    const { opts } = fixture()
    const a = createIndexer(opts)
    await a.refresh()
    a.stop()
    const b = createIndexer(opts)
    expect(b.get(id)?.title).toBe('first prompt')
    b.stop()
  })
  it.skipIf(!process.env.SESSION_DECK_SMOKE)('indexes the real ~/.claude/projects twice, the second time from cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-smoke-'))
    const opts = {
      projectsDir: PATHS.projects, sessionsDir: PATHS.sessions, teeDir: join(dir, 'tee'), cachePath: join(dir, 'index.json'),
      claudeSettingsPath: PATHS.claudeSettings, getSettings: () => ({ terminal: null, archived: [], statusTee: false }), onChange: () => {},
    }
    let t = Date.now()
    const first = createIndexer(opts)
    await first.refresh()
    const list = first.list()
    const coldMs = Date.now() - t
    first.stop()
    t = Date.now()
    const second = createIndexer(opts)
    await second.refresh()
    const warmMs = Date.now() - t
    const repos = new Set(list.map((s) => s.repo?.name).filter(Boolean))
    console.log(`sessions=${list.length} hidden=${list.filter((s) => s.hidden).length} repos=${repos.size} named=${list.filter((s) => s.named).length} withPr=${list.filter((s) => s.pr).length} withSummary=${list.filter((s) => s.summary).length} cold=${coldMs}ms warm=${warmMs}ms`)
    expect(list.length).toBeGreaterThan(0)
    expect(second.list().length).toBe(list.length)
    second.stop()
  }, 300_000)
}
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npx vitest run src/main/indexer.ts`
Expected: FAIL with `toSession is not defined`.

- [ ] **Step 6: Implement `indexer.ts` above the test block**

```ts
import {
  appendFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  statSync, watch, writeFileSync, type FSWatcher,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { Session, Settings, Status } from '../shared/api'
import { resolveGit, type GitInfo } from './git'
import { readLive, readTee, type LiveInfo, type TeeInfo } from './live'
import { PATHS } from './paths'
import { writeJsonAtomic } from './settings'
import { emptyAgg, finalize, reduceLine, type Agg, type Facts } from './transcript'

// Bump whenever transcript.ts changes what it extracts, so every file is reparsed.
export const CACHE_VERSION = 1
const DAY_MS = 86_400_000
const DEBOUNCE_MS = 300
// The cache can be tens of MB; write it at most this often, and on stop().
const SAVE_EVERY_MS = 15_000

interface FileEntry { size: number; mtimeMs: number; offset: number; agg: Agg; agents: number }
interface Cache { version: number; files: Record<string, FileEntry>; git: Record<string, GitInfo> }

export interface IndexerOptions {
  projectsDir: string
  sessionsDir: string
  teeDir: string
  cachePath: string
  claudeSettingsPath: string
  getSettings(): Settings
  onChange(): void
}

export interface Indexer {
  start(): Promise<void>
  refresh(): Promise<void>
  list(): Session[]
  get(id: string): Session | undefined
  transcriptPath(id: string): string | undefined
  notify(): void
  stop(): void
}

export interface SessionContext {
  git: GitInfo | undefined
  live: LiveInfo | undefined
  tee: TeeInfo | undefined
  archived: boolean
  forks: number
  sizeBytes: number
  agents: number
  cleanupDays: number
}

export function contextMaxFor(model: string | null, used: number, teeMax: number | null): number {
  if (teeMax && teeMax > 0) return teeMax
  // ponytail: model-name heuristic; the tee's context_window_size replaces it for live sessions.
  const big = !!model && (/^claude-(opus|sonnet|fable)-5/.test(model) || model.includes('[1m]'))
  const max = big ? 1_000_000 : 200_000
  return used > max ? 1_000_000 : max
}

export function readCleanupDays(path: string): number {
  try {
    const n = Number(JSON.parse(readFileSync(path, 'utf8')).cleanupPeriodDays)
    return Number.isFinite(n) && n > 0 ? n : 30
  } catch {
    return 30
  }
}

function statusOf(f: Facts, live: LiveInfo | undefined): Status {
  if (live) return live.status === 'busy' ? 'running' : 'waiting'
  if (f.lastEvent === 'interrupt') return 'interrupted'
  if (f.lastEvent === 'apiError') return 'failed'
  return 'completed'
}

export function toSession(f: Facts, x: SessionContext): Session {
  const root = x.git?.repoRoot ?? null
  const bases = [x.git?.worktree?.path, root, f.cwd].filter((b): b is string => !!b)
  const rel = (p: string) => {
    const base = bases.find((b) => p.startsWith(`${b}/`))
    return base ? p.slice(base.length + 1) : p
  }
  const t = f.tokens
  const contextUsed = (x.live && x.tee?.contextUsed) || f.context
  const hitBase = t.input + t.cacheRead + t.cacheWrite
  return {
    id: f.id,
    title: f.title,
    named: f.named,
    cwd: f.cwd,
    cwdExists: !x.git?.removedSeen,
    hidden: f.hidden,
    archived: x.archived,
    repo: root ? { name: basename(root), root } : null,
    branch: f.branch,
    worktree: x.git?.worktree ? { ...x.git.worktree, removedSeen: x.git.removedSeen } : null,
    start: f.start,
    end: f.end,
    sizeBytes: x.sizeBytes,
    keptUntil: new Date(Date.parse(f.end) + x.cleanupDays * DAY_MS).toISOString(),
    model: f.model,
    effort: f.effort,
    permissionMode: f.permissionMode,
    status: statusOf(f, x.live),
    live: !!x.live,
    pr: f.pr,
    forkedFrom: f.forkedFrom,
    forks: x.forks,
    prompts: f.prompts,
    summary: f.summary,
    files: f.files.map((c) => ({ ...c, path: rel(c.path) })),
    commits: f.commits,
    // Absolute on purpose: the command bar's artifact preview shows the full path.
    artifacts: f.artifacts,
    usage: {
      contextUsed,
      contextMax: contextMaxFor(f.model, contextUsed, x.tee?.contextMax ?? null),
      input: t.input,
      output: t.output,
      total: t.input + t.output + t.cacheRead + t.cacheWrite,
      cacheRead: t.cacheRead,
      cacheWrite: t.cacheWrite,
      cacheHitPct: hitBase > 0 ? Math.round((t.cacheRead / hitBase) * 1000) / 10 : 0,
      cost: f.cost,
      durationMs: f.durationMs,
      linesAdded: f.linesAdded,
      linesRemoved: f.linesRemoved,
      compactions: f.compactions,
      agents: x.agents,
      outputStyle: x.tee?.outputStyle ?? null,
      plan: x.live ? (x.tee?.plan ?? null) : null,
    },
  }
}

function loadCache(path: string): Cache {
  try {
    const c = JSON.parse(readFileSync(path, 'utf8'))
    if (c?.version === CACHE_VERSION && c.files && c.git) return c as Cache
  } catch {
    // Missing or corrupt cache: rebuild from scratch.
  }
  return { version: CACHE_VERSION, files: {}, git: {} }
}

function listTranscripts(projectsDir: string): string[] {
  let dirs: string[]
  try {
    dirs = readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  return dirs.flatMap((d) => {
    try {
      return readdirSync(join(projectsDir, d)).filter((n) => n.endsWith('.jsonl')).map((n) => join(projectsDir, d, n))
    } catch {
      return []
    }
  })
}

function countAgents(transcript: string): number {
  try {
    return readdirSync(join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents')).filter((n) => n.endsWith('.jsonl')).length
  } catch {
    return 0
  }
}

// Reads from entry.offset to EOF, advancing the offset only past complete lines.
async function parseFrom(path: string, entry: FileEntry): Promise<void> {
  let carry = Buffer.alloc(0)
  for await (const chunk of createReadStream(path, { start: entry.offset }) as AsyncIterable<Buffer>) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
    let from = 0
    let nl: number
    while ((nl = buf.indexOf(10, from)) !== -1) {
      reduceLine(entry.agg, buf.toString('utf8', from, nl))
      entry.offset += nl - from + 1
      from = nl + 1
    }
    carry = buf.subarray(from)
  }
}

export function createIndexer(o: IndexerOptions): Indexer {
  const cache = loadCache(o.cachePath)
  const watchers: FSWatcher[] = []
  let scanning: Promise<void> | null = null
  let dirty = false
  let scanTimer: NodeJS.Timeout | null = null
  let notifyTimer: NodeJS.Timeout | null = null
  let saveTimer: NodeJS.Timeout | null = null
  let byId = new Map<string, Session>()
  let pathById = new Map<string, string>()

  const save = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    try {
      writeJsonAtomic(o.cachePath, cache)
    } catch (e) {
      console.warn('[indexer] could not save cache', e)
    }
  }
  const scheduleSave = () => {
    saveTimer ??= setTimeout(save, SAVE_EVERY_MS)
  }

  function rebuild(): Session[] {
    const live = readLive(o.sessionsDir)
    const tee = readTee(o.teeDir)
    const archived = new Set(o.getSettings().archived)
    const cleanupDays = readCleanupDays(o.claudeSettingsPath)
    const rows: { f: Facts; path: string; entry: FileEntry }[] = []
    for (const [path, entry] of Object.entries(cache.files)) {
      const f = finalize(entry.agg)
      if (f) rows.push({ f, path, entry })
    }
    const forks = new Map<string, number>()
    for (const { f } of rows) if (f.forkedFrom) forks.set(f.forkedFrom, (forks.get(f.forkedFrom) ?? 0) + 1)
    const sessions = rows.map(({ f, entry }) =>
      toSession(f, {
        git: cache.git[f.cwd], live: live.get(f.id), tee: tee.get(f.id), archived: archived.has(f.id),
        forks: forks.get(f.id) ?? 0, sizeBytes: entry.size, agents: entry.agents, cleanupDays,
      }),
    )
    byId = new Map(sessions.map((s) => [s.id, s]))
    pathById = new Map(rows.map(({ f, path }) => [f.id, path]))
    return sessions
  }

  async function scanOnce(): Promise<void> {
    const files = listTranscripts(o.projectsDir)
    const present = new Set(files)
    for (const p of Object.keys(cache.files)) if (!present.has(p)) delete cache.files[p]
    let parsed = 0
    for (const path of files) {
      const st = statSync(path, { throwIfNoEntry: false })
      if (!st) continue
      let entry = cache.files[path]
      if (entry && entry.size === st.size && entry.mtimeMs === st.mtimeMs) continue
      // ponytail: assumes append-only; a same-size-or-larger rewrite would be misread until CACHE_VERSION bumps.
      if (!entry || st.size < entry.offset) {
        entry = { size: 0, mtimeMs: 0, offset: 0, agg: emptyAgg(basename(path, '.jsonl')), agents: 0 }
        cache.files[path] = entry
      }
      try {
        await parseFrom(path, entry)
      } catch (e) {
        console.warn('[indexer] skipped unreadable transcript', path, e)
        continue
      }
      entry.size = st.size
      entry.mtimeMs = st.mtimeMs
      entry.agents = countAgents(path)
      if (++parsed % 50 === 0) o.onChange()
    }
    const now = new Date().toISOString()
    const cwds = new Set(Object.values(cache.files).map((e) => e.agg.cwd).filter((c): c is string => !!c))
    for (const cwd of cwds) cache.git[cwd] = resolveGit(cwd, cache.git[cwd], now)
    scheduleSave()
    o.onChange()
  }

  function refresh(): Promise<void> {
    if (scanning) {
      dirty = true
      return scanning
    }
    scanning = (async () => {
      do {
        dirty = false
        await scanOnce()
      } while (dirty)
    })().finally(() => {
      scanning = null
    })
    return scanning
  }

  const scheduleScan = () => {
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(() => {
      scanTimer = null
      void refresh()
    }, DEBOUNCE_MS)
  }
  const notify = () => {
    if (notifyTimer) clearTimeout(notifyTimer)
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      o.onChange()
    }, DEBOUNCE_MS)
  }
  const watchDir = (dir: string, onFile: (file: string) => void) => {
    if (!existsSync(dir)) return
    try {
      watchers.push(watch(dir, { recursive: true }, (_event, file) => onFile(String(file ?? ''))))
    } catch (e) {
      console.warn('[indexer] cannot watch', dir, e)
    }
  }

  return {
    async start() {
      mkdirSync(o.teeDir, { recursive: true })
      // Only top-level <project>/<id>.jsonl; subagent transcripts live one level deeper.
      watchDir(o.projectsDir, (file) => {
        if (file.endsWith('.jsonl') && file.split('/').length === 2) scheduleScan()
      })
      watchDir(o.sessionsDir, (file) => {
        if (file.endsWith('.json')) notify()
      })
      watchDir(o.teeDir, (file) => {
        if (file.endsWith('.json')) notify()
      })
      await refresh()
    },
    refresh,
    list: () => rebuild(),
    get(id) {
      rebuild()
      return byId.get(id)
    },
    transcriptPath(id) {
      if (!pathById.has(id)) rebuild()
      return pathById.get(id)
    },
    notify,
    stop() {
      for (const w of watchers) w.close()
      watchers.length = 0
      for (const t of [scanTimer, notifyTimer]) if (t) clearTimeout(t)
      save()
    },
  }
}
```

- [ ] **Step 7: Run the indexer tests to verify they pass**

Run: `npx vitest run src/main/indexer.ts src/main/settings.ts`
Expected: 13 PASS and 1 skipped (the smoke test).

- [ ] **Step 8: Run the smoke test against the real transcripts**

Run: `SESSION_DECK_SMOKE=1 npx vitest run src/main/indexer.ts -t "real"`
Expected: PASS. It prints a line like `sessions=457 hidden=185 repos=… cold=…ms warm=…ms`, with `warm` far below `cold`. It only reads `~/.claude`; its cache goes to a temp dir. Record the printed line in your task report. If `sessions` is 0 or anything throws, stop and report: the reducer's assumptions about the real record shapes are wrong.

- [ ] **Step 9: Wire the indexer and settings into main**

Replace `src/main/index.ts` with:

```ts
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { SettingsPatch } from '../shared/api'
import { createIndexer } from './indexer'
import { broadcast, registerIpc } from './ipc'
import { PATHS } from './paths'
import { createSettingsStore, isTerminal } from './settings'

const notYet = async (): Promise<never> => {
  throw new Error('Not implemented yet')
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#181921',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  })
  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.once('ready-to-show', show)
  // A wedged renderer must not leave the window hidden forever.
  setTimeout(show, 3000)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const settings = createSettingsStore(join(userData, 'settings.json'))
  const indexer = createIndexer({
    projectsDir: PATHS.projects,
    sessionsDir: PATHS.sessions,
    teeDir: PATHS.tee,
    cachePath: join(userData, 'index.json'),
    claudeSettingsPath: PATHS.claudeSettings,
    getSettings: settings.get,
    onChange: () => broadcast('sessionsChanged'),
  })

  registerIpc({
    listSessions: async () => indexer.list(),
    getSettings: async () => settings.get(),
    saveSettings: async (patch: SettingsPatch) => {
      const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
      if (!('terminal' in p)) return settings.get()
      const terminal = p.terminal === null ? null : isTerminal(p.terminal) ? p.terminal : undefined
      if (terminal === undefined) throw new Error('Unknown terminal')
      const next = settings.save({ terminal })
      broadcast('settingsChanged')
      return next
    },
    resumeSession: notYet,
    openFolder: notYet,
    openPr: notYet,
    renameSession: notYet,
    setArchived: notYet,
    setStatusTee: notYet,
  })

  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
  app.on('before-quit', () => indexer.stop())
  void indexer.start()
})

app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 10: Run the suite and the node typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.node.json`
Expected: everything PASS (the smoke test skipped), and tsc exits 0. No commit (not a git repo).

### Task 5: Resume, open, rename and archive from main

**Files:**
- Create: `src/main/terminal.ts`
- Modify: `src/main/transcript.ts` (append `cleanTitle`, `customTitleLine` and their tests)
- Modify: `src/main/index.ts` (full replacement given)

**Interfaces:**
- Consumes: Task 4 (`Indexer.get`, `Indexer.transcriptPath`, `Indexer.refresh`, `SettingsStore`), Task 2 (`reduceLine`, `emptyAgg`, `finalize`), Task 1 (`resumeCommand`, `isSessionId`, `PATHS`, `ResumeResult`).
- Produces (`terminal.ts`): `shellQuote(s: string): string`, `appleScriptString(s: string): string`, `terminalCommand(s: Pick<Session, 'id' | 'cwd' | 'cwdExists'>, fork: boolean): string`, `itermScript(cmd: string): string`, `terminalAppScript(cmd: string): string`, `warpConfig(title: string, cwd: string, cmd: string): string`, `WARP_URI: string`, `launch(terminal: Terminal, s: Session, fork: boolean): Promise<void>`.
- Produces (`transcript.ts`): `cleanTitle(raw: unknown): string | null`, `customTitleLine(id: string, title: string): string`.
- Produces (IPC): `resumeSession`, `openFolder`, `openPr`, `renameSession` and `setArchived`, all implemented. Error messages the renderer shows verbatim: `Can't rename a running session`, `Titles are 1–120 characters on one line`, `This folder no longer exists`, `No pull request`.

- [ ] **Step 1: Write the failing terminal tests**

Create `src/main/terminal.ts` with the import lines from Step 3 and this block:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'

  it('quotes shell arguments so a single quote cannot end the string', () => {
    expect(shellQuote("/Users/me/it's here")).toBe(`'/Users/me/it'\\''s here'`)
  })
  it('changes into an existing cwd before resuming, and resumes from anywhere when it is gone', () => {
    expect(terminalCommand({ id, cwd: '/Users/me/my app', cwdExists: true }, false)).toBe(`cd '/Users/me/my app' && claude --resume ${id}`)
    expect(terminalCommand({ id, cwd: '/gone', cwdExists: false }, true)).toBe(`claude --resume ${id} --fork-session`)
  })
  it('escapes backslashes and quotes inside AppleScript strings', () => {
    expect(appleScriptString('say "hi" \\ ok')).toBe('"say \\"hi\\" \\\\ ok"')
  })
  it('writes the command into a new iTerm window and a new Terminal tab', () => {
    expect(itermScript("cd '/x' && claude")).toContain(`write text "cd '/x' && claude"`)
    expect(terminalAppScript('claude')).toContain('do script "claude"')
  })
  it('writes a Warp launch config with every value JSON-quoted', () => {
    const yaml = warpConfig('fix: "quotes"', '/Users/me/app', `claude --resume ${id}`)
    expect(yaml).toContain('      - title: "fix: \\"quotes\\""')
    expect(yaml).toContain('          cwd: "/Users/me/app"')
    expect(yaml).toContain(`            - exec: "claude --resume ${id}"`)
  })
  it.skipIf(!process.env.SESSION_DECK_LAUNCH)('opens a harmless echo in iTerm, Terminal and Warp', async () => {
    const echo = 'echo session-deck-check'
    await run('osascript', ['-e', itermScript(echo)])
    await run('osascript', ['-e', terminalAppScript(echo)])
    mkdirSync(dirname(PATHS.warpConfig), { recursive: true })
    writeFileSync(PATHS.warpConfig, warpConfig('session-deck-check', PATHS.home, echo))
    await run('open', [WARP_URI])
  }, 30_000)
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/terminal.ts`
Expected: FAIL with `shellQuote is not defined`.

- [ ] **Step 3: Implement `terminal.ts` above the test block**

```ts
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { promisify } from 'node:util'
import { resumeCommand, type Session, type Terminal } from '../shared/api'
import { PATHS } from './paths'

const run = promisify(execFile)

export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
export const appleScriptString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function terminalCommand(s: Pick<Session, 'id' | 'cwd' | 'cwdExists'>, fork: boolean): string {
  const cmd = resumeCommand(s.id, fork)
  return s.cwdExists ? `cd ${shellQuote(s.cwd)} && ${cmd}` : cmd
}

export const itermScript = (cmd: string): string =>
  [
    'tell application "iTerm"',
    '  activate',
    '  set w to (create window with default profile)',
    `  tell current session of w to write text ${appleScriptString(cmd)}`,
    'end tell',
  ].join('\n')

export const terminalAppScript = (cmd: string): string =>
  ['tell application "Terminal"', '  activate', `  do script ${appleScriptString(cmd)}`, 'end tell'].join('\n')

// A JSON string is a valid YAML scalar, so JSON.stringify quotes every value safely.
export const warpConfig = (title: string, cwd: string, cmd: string): string =>
  [
    '---',
    'name: session-deck-resume',
    'windows:',
    '  - tabs:',
    `      - title: ${JSON.stringify(title)}`,
    '        layout:',
    `          cwd: ${JSON.stringify(cwd)}`,
    '          commands:',
    `            - exec: ${JSON.stringify(cmd)}`,
    '',
  ].join('\n')

// Warp resolves the name inside ~/.warp/launch_configurations/. Warp has no run-command API besides launch configs.
export const WARP_URI = `warp://launch/${encodeURIComponent(basename(PATHS.warpConfig))}`

export async function launch(terminal: Terminal, s: Session, fork: boolean): Promise<void> {
  if (terminal === 'warp') {
    mkdirSync(dirname(PATHS.warpConfig), { recursive: true })
    writeFileSync(PATHS.warpConfig, warpConfig(s.title, s.cwdExists ? s.cwd : PATHS.home, resumeCommand(s.id, fork)))
    await run('open', [WARP_URI])
    return
  }
  const cmd = terminalCommand(s, fork)
  // execFile, never a shell: the script is a single argv entry.
  await run('osascript', ['-e', terminal === 'iterm' ? itermScript(cmd) : terminalAppScript(cmd)])
}
```

Run: `npx vitest run src/main/terminal.ts`
Expected: 5 PASS, 1 skipped.

- [ ] **Step 4: Write the failing rename-record tests in `transcript.ts`**

Append inside the existing `if (import.meta.vitest)` block of `src/main/transcript.ts`:

```ts
  it('accepts a trimmed single-line title of 1 to 120 characters', () => {
    expect(cleanTitle('  live-meeting  ')).toBe('live-meeting')
    expect(cleanTitle('')).toBeNull()
    expect(cleanTitle('a\nb')).toBeNull()
    expect(cleanTitle('x'.repeat(121))).toBeNull()
    expect(cleanTitle(7)).toBeNull()
  })
  it('writes a custom-title record that the reducer reads back as the name', () => {
    const agg = emptyAgg(id)
    reduceLine(agg, JSON.stringify(user('go')))
    reduceLine(agg, customTitleLine(id, 'audio-upload').trimEnd())
    expect(customTitleLine(id, 'x').endsWith('\n')).toBe(true)
    expect(finalize(agg)).toMatchObject({ title: 'audio-upload', named: true })
  })
```

Run: `npx vitest run src/main/transcript.ts`
Expected: FAIL with `cleanTitle is not defined`.

- [ ] **Step 5: Implement them in `transcript.ts`**

Add above the test block:

```ts
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length >= 1 && t.length <= 120 && !/[\r\n]/.test(t) ? t : null
}

// The same record Claude Code's /rename appends; the last one in the file wins.
export const customTitleLine = (id: string, title: string): string =>
  `${JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: id })}\n`
```

Run: `npx vitest run src/main/transcript.ts`
Expected: 16 tests PASS.

- [ ] **Step 6: Implement the action handlers in main**

Replace `src/main/index.ts` with:

```ts
import { app, BrowserWindow, clipboard, shell } from 'electron'
import { appendFileSync, closeSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isSessionId, type ResumeResult, type Session, type SettingsPatch } from '../shared/api'
import { createIndexer } from './indexer'
import { broadcast, registerIpc } from './ipc'
import { PATHS } from './paths'
import { createSettingsStore, isTerminal } from './settings'
import { launch, terminalCommand } from './terminal'
import { cleanTitle, customTitleLine } from './transcript'

const notYet = async (): Promise<never> => {
  throw new Error('Not implemented yet')
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#181921',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  })
  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.once('ready-to-show', show)
  // A wedged renderer must not leave the window hidden forever.
  setTimeout(show, 3000)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

// A transcript cut mid-line must not glue our record onto the partial one.
function appendLine(path: string, line: string): void {
  const size = statSync(path).size
  let lastByte = 10
  if (size > 0) {
    const fd = openSync(path, 'r')
    const b = Buffer.alloc(1)
    readSync(fd, b, 0, 1, size - 1)
    closeSync(fd)
    lastByte = b[0]
  }
  appendFileSync(path, (lastByte === 10 ? '' : '\n') + line)
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const settings = createSettingsStore(join(userData, 'settings.json'))
  const indexer = createIndexer({
    projectsDir: PATHS.projects,
    sessionsDir: PATHS.sessions,
    teeDir: PATHS.tee,
    cachePath: join(userData, 'index.json'),
    claudeSettingsPath: PATHS.claudeSettings,
    getSettings: settings.get,
    onChange: () => broadcast('sessionsChanged'),
  })

  const sessionFor = (id: unknown): Session => {
    if (!isSessionId(id)) throw new Error('Invalid session id')
    const s = indexer.get(id)
    if (!s) throw new Error('Unknown session')
    return s
  }

  registerIpc({
    listSessions: async () => indexer.list(),
    getSettings: async () => settings.get(),
    saveSettings: async (patch: SettingsPatch) => {
      const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
      if (!('terminal' in p)) return settings.get()
      const terminal = p.terminal === null ? null : isTerminal(p.terminal) ? p.terminal : undefined
      if (terminal === undefined) throw new Error('Unknown terminal')
      const next = settings.save({ terminal })
      broadcast('settingsChanged')
      return next
    },
    resumeSession: async (id, opts): Promise<ResumeResult> => {
      const s = sessionFor(id)
      const fork = opts?.fork === true
      const terminal = settings.get().terminal
      if (!terminal) return { ok: false, needsTerminal: true }
      try {
        await launch(terminal, s, fork)
        return { ok: true }
      } catch (e) {
        clipboard.writeText(terminalCommand(s, fork))
        return { ok: false, copied: true, error: e instanceof Error ? e.message : String(e) }
      }
    },
    openFolder: async (id) => {
      const s = sessionFor(id)
      if (!s.cwdExists) throw new Error('This folder no longer exists')
      const err = await shell.openPath(s.cwd)
      if (err) throw new Error(err)
    },
    openPr: async (id) => {
      const s = sessionFor(id)
      if (!s.pr || !s.pr.url.startsWith('https://github.com/')) throw new Error('No pull request')
      await shell.openExternal(s.pr.url)
    },
    renameSession: async (id, title) => {
      const s = sessionFor(id)
      if (s.live) throw new Error("Can't rename a running session")
      const clean = cleanTitle(title)
      if (!clean) throw new Error('Titles are 1–120 characters on one line')
      const path = indexer.transcriptPath(s.id)
      if (!path) throw new Error('Unknown session')
      appendLine(path, customTitleLine(s.id, clean))
      await indexer.refresh()
    },
    setArchived: async (id, archived) => {
      const s = sessionFor(id)
      const ids = new Set(settings.get().archived)
      if (archived === true) ids.add(s.id)
      else ids.delete(s.id)
      settings.save({ archived: [...ids] })
      broadcast('settingsChanged')
      broadcast('sessionsChanged')
    },
    setStatusTee: notYet,
  })

  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
  app.on('before-quit', () => indexer.stop())
  void indexer.start()
})

app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 7: Run the suite and the node typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.node.json`
Expected: all PASS (the gated tests skipped), and tsc exits 0.

- [ ] **Step 8: Check the three terminals by hand, once**

This opens three windows that print `session-deck-check`; tell the lead before you run it. macOS may ask whether your terminal app may control iTerm or Terminal. If that prompt appears and nobody approves it, report that check as "pending user approval" rather than failed.

Run: `SESSION_DECK_LAUNCH=1 npx vitest run src/main/terminal.ts -t "harmless"`, then `screencapture -x "$TMPDIR/deck-launch.png"` and read the image.
Expected: PASS. An iTerm window, a Terminal tab and a Warp window each show `session-deck-check`. If Warp opens without running the command, change `WARP_URI` to `` `warp://launch/${encodeURI(PATHS.warpConfig)}` `` (the absolute path), rerun, and record which form worked. Close the three windows afterwards. No commit (not a git repo).

### Task 6: Install the status-line tee

**Files:**
- Create: `src/main/statusline.ts`
- Modify: `src/main/index.ts` (full replacement given)

**Interfaces:**
- Consumes: Task 1 (`PATHS`), Task 5 (`shellQuote`), Task 4 (`SettingsStore`, `writeJsonAtomic`, `Indexer.notify`).
- Produces: `teeScript(original: string | null, teeDir: string): string`, `withTee(cfg: Record<string, unknown>, command: string): Record<string, unknown>`, `withoutTee(cfg: Record<string, unknown>, original: unknown, command: string): Record<string, unknown>`, `teeCommand(scriptPath: string): string`, `TeePaths`, `installTee(p?: TeePaths): void`, `removeTee(p?: TeePaths): void`.
- Produces (IPC): `setStatusTee`, implemented. Every method is now real, and `notYet` is gone.

This task edits the user's `~/.claude/settings.json`, so guard against data loss:
- Parse it first. If parsing fails, throw and write nothing.
- Back up the file before the first change.
- Keep every key other than `statusLine`.
- On removal, restore only when `statusLine.command` is still ours.

- [ ] **Step 1: Write the failing tests**

Create `src/main/statusline.ts` with the import lines from Step 3 and this block:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const temp = (): TeePaths => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-tee-'))
    const deck = join(dir, 'session-deck')
    return {
      claudeSettings: join(dir, 'settings.json'), deck, tee: join(deck, 'status'),
      teeScript: join(deck, 'statusline-tee.sh'), teeOriginal: join(deck, 'statusline-original.json'),
    }
  }

  it('saves the status-line input per session and still renders the original status line', () => {
    const p = temp()
    mkdirSync(p.deck, { recursive: true })
    writeFileSync(p.teeScript, teeScript('wc -c', p.tee))
    const input = JSON.stringify({ session_id: id, model: { id: 'claude-opus-5-5' } })
    const out = execFileSync('sh', [p.teeScript], { input }).toString().trim()
    expect(out).toBe(String(input.length))
    expect(readFileSync(join(p.tee, `${id}.json`), 'utf8')).toBe(input)
  })
  it('prints nothing when there was no original status line', () => {
    expect(teeScript(null, '/t').trimEnd().endsWith('fi')).toBe(true)
  })
  it('swaps in the tee command and keeps every other setting', () => {
    const cfg = { model: 'opus', statusLine: { type: 'command', command: 'ccstatusline', padding: 0, refreshInterval: 10 } }
    expect(withTee(cfg, 'sh tee')).toEqual({ model: 'opus', statusLine: { type: 'command', command: 'sh tee', padding: 0, refreshInterval: 10 } })
  })
  it('restores the original only while the tee is still the configured command', () => {
    const original = { type: 'command', command: 'ccstatusline', padding: 0 }
    expect(withoutTee({ a: 1, statusLine: { command: 'sh tee' } }, original, 'sh tee')).toEqual({ a: 1, statusLine: original })
    expect(withoutTee({ a: 1, statusLine: { command: 'sh tee' } }, null, 'sh tee')).toEqual({ a: 1 })
    const changed = { a: 1, statusLine: { command: 'mine' } }
    expect(withoutTee(changed, original, 'sh tee')).toBe(changed)
  })
  it('installs and removes the tee round trip, with a backup of the user settings', () => {
    const p = temp()
    const before = { model: 'opus', statusLine: { type: 'command', command: 'ccstatusline', padding: 0 } }
    writeFileSync(p.claudeSettings, JSON.stringify(before))
    installTee(p)
    const during = JSON.parse(readFileSync(p.claudeSettings, 'utf8'))
    expect(during.statusLine.command).toBe(teeCommand(p.teeScript))
    expect(during.model).toBe('opus')
    expect(JSON.parse(readFileSync(join(p.deck, 'claude-settings.backup.json'), 'utf8'))).toEqual(before)
    removeTee(p)
    expect(JSON.parse(readFileSync(p.claudeSettings, 'utf8'))).toEqual(before)
  })
  it('refuses to touch a settings file it cannot parse', () => {
    const p = temp()
    writeFileSync(p.claudeSettings, '{ broken')
    expect(() => installTee(p)).toThrow()
    expect(readFileSync(p.claudeSettings, 'utf8')).toBe('{ broken')
  })
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/statusline.ts`
Expected: FAIL with `teeScript is not defined`.

- [ ] **Step 3: Implement `statusline.ts` above the test block**

```ts
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATHS } from './paths'
import { writeJsonAtomic } from './settings'
import { shellQuote } from './terminal'

type Cfg = Record<string, unknown>
export type TeePaths = Pick<typeof PATHS, 'claudeSettings' | 'deck' | 'tee' | 'teeScript' | 'teeOriginal'>

export const teeCommand = (scriptPath: string): string => `sh ${shellQuote(scriptPath)}`

export function teeScript(original: string | null, teeDir: string): string {
  return [
    '#!/bin/sh',
    '# Written by Session Deck: saves the status-line input for the app, then runs your original status line.',
    'input=$(cat)',
    `sid=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([0-9a-fA-F-]*\\)".*/\\1/p' | head -n 1)`,
    'if [ -n "$sid" ]; then',
    `  dir=${shellQuote(teeDir)}`,
    '  mkdir -p "$dir"',
    `  printf '%s' "$input" > "$dir/$sid.json.tmp" && mv "$dir/$sid.json.tmp" "$dir/$sid.json"`,
    'fi',
    ...(original ? [`printf '%s' "$input" | ${original}`] : []),
    '',
  ].join('\n')
}

export function withTee(cfg: Cfg, command: string): Cfg {
  const prev = cfg.statusLine && typeof cfg.statusLine === 'object' ? (cfg.statusLine as Cfg) : {}
  return { ...cfg, statusLine: { ...prev, type: 'command', command } }
}

export function withoutTee(cfg: Cfg, original: unknown, command: string): Cfg {
  const current = cfg.statusLine as Cfg | undefined
  if (current?.command !== command) return cfg
  const { statusLine: _ours, ...rest } = cfg
  return original && typeof original === 'object' ? { ...rest, statusLine: original } : rest
}

function readClaudeSettings(path: string): Cfg {
  if (!existsSync(path)) return {}
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('~/.claude/settings.json is not a JSON object')
  return parsed as Cfg
}

export function installTee(p: TeePaths = PATHS): void {
  const cfg = readClaudeSettings(p.claudeSettings)
  const command = teeCommand(p.teeScript)
  const current = cfg.statusLine && typeof cfg.statusLine === 'object' ? (cfg.statusLine as Cfg) : null
  if (current?.command === command) return
  mkdirSync(p.tee, { recursive: true })
  if (existsSync(p.claudeSettings)) copyFileSync(p.claudeSettings, join(p.deck, 'claude-settings.backup.json'))
  writeFileSync(p.teeScript, teeScript(typeof current?.command === 'string' ? current.command : null, p.tee), { mode: 0o755 })
  writeJsonAtomic(p.teeOriginal, current)
  writeJsonAtomic(p.claudeSettings, withTee(cfg, command))
}

export function removeTee(p: TeePaths = PATHS): void {
  const cfg = readClaudeSettings(p.claudeSettings)
  let original: unknown = null
  try {
    original = JSON.parse(readFileSync(p.teeOriginal, 'utf8'))
  } catch {
    // No saved original: removing the tee leaves no status line, as before install.
  }
  const next = withoutTee(cfg, original, teeCommand(p.teeScript))
  if (next !== cfg) writeJsonAtomic(p.claudeSettings, next)
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/main/statusline.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Wire `setStatusTee` into main**

Replace `src/main/index.ts` with the Task 5 file, changed in three places:

1. Add this import below the `settings` import:
```ts
import { installTee, removeTee } from './statusline'
```
2. Delete the `notYet` constant.
3. Replace `setStatusTee: notYet,` with:
```ts
    setStatusTee: async (enabled) => {
      if (enabled === true) installTee()
      else removeTee()
      settings.save({ statusTee: enabled === true })
      broadcast('settingsChanged')
      indexer.notify()
    },
```

The rest of the file is exactly the Task 5 version: `createMainWindow`, `appendLine`, `sessionFor`, the other handlers, and the `activate` / `before-quit` / `window-all-closed` wiring.

- [ ] **Step 6: Run the suite and the node typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.node.json && grep -c notYet src/main/index.ts`
Expected: all PASS, tsc exits 0, and grep prints `0`. No commit (not a git repo).

### Task 7: Format values, build the tree and group the views

**Files:**
- Create: `src/shared/format.ts`, `src/shared/tree.ts`, `src/shared/views.ts`, `src/shared/fixtures.ts`

**Interfaces:**
- Consumes: Task 1 api types.
- Produces (`format.ts`): `daysAgo(iso: string, now: Date): number`, `clock(d: Date): string`, `agoShort(iso: string, now: Date): string`, `agoLong(iso: string, now: Date): string`, `shortDay(d: Date): string`, `monthDay(d: Date): string`, `compact(n: number): string`, `fileSize(bytes: number): string`, `durationLabel(ms: number): string`, `costLabel(n: number | null): string`, `modelLabel(id: string | null): string`, `modeLabel(m: string | null): string`, `tildify(p: string): string`, `resetsIn(iso: string, now: Date): string`, `plural(n: number, word: string): string`, `attention(s: Status): { color: string; label: string } | null`.
- Produces (`tree.ts`): `Scope`, `TreeChild`, `TreeRepo`, `TreeFolder`, `Tree`, `visible(all: Session[]): Session[]`, `buildTree(sessions: Session[]): Tree`, `inScope(s: Session, scope: Scope): boolean`, `sameScope(a: Scope, b: Scope): boolean`, `scopeTitle(scope: Scope, tree: Tree): string`, `defaultExpanded(tree: Tree): Record<string, boolean>`.
- Produces (`views.ts`): `ViewMode`, `Group`, `CalendarCell`, `byRecent(sessions: Session[]): Session[]`, `dayKey(d: Date | string): string`, `groupSessions(sessions: Session[], mode: ViewMode, now: Date): Group[]`, `listForView(sessions: Session[], mode: ViewMode, day: string | null): Session[]`, `monthRange(sessions: Session[]): { first: YearMonth; last: YearMonth } | null`, `calendarCells(sessions: Session[], ym: YearMonth, selected: string | null, today: Date): CalendarCell[]`, `latestDay(sessions: Session[]): Date | null`, `YearMonth = { year: number; month: number }` (month 0–11).
- Produces (`fixtures.ts`): `makeSession(over?: Partial<Session>): Session`.
- Produces (`tree.ts` types, exact):
  ```ts
  export type Scope =
    | { type: 'all' }
    | { type: 'repo'; repo: string }                    // repo root path
    | { type: 'branch'; repo: string; branch: string }
    | { type: 'wt'; repo: string; path: string }        // worktree path
    | { type: 'folder'; path: string }                  // cwd outside any repo
  export interface TreeChild { kind: 'branch' | 'worktree'; label: string; count: number; removed: boolean; title: string; scope: Scope }
  export interface TreeRepo { root: string; name: string; count: number; last: string; children: TreeChild[]; scope: Scope }
  export interface TreeFolder { path: string; label: string; count: number; scope: Scope }
  export interface Tree { all: number; repos: TreeRepo[]; folders: TreeFolder[] }
  ```
- Produces (`views.ts` types, exact): `Group = { key: string; label: string; note: string | null; sessions: Session[] }` (an empty `label` means no header), `CalendarCell = { key: string; day: number; inMonth: boolean; isToday: boolean; selected: boolean; hasSessions: boolean; dots: (Status | null)[] }`.

Everything here is pure and has no Node imports, because `src/shared` compiles in the renderer too. Test files import `makeSession` statically at the top: the bundler drops it with the stripped test block. Never use top-level `await import` (the main bundle is CommonJS). Tests build dates in **local** time (`new Date(2026, 9, 6, 9, 12)`), so they pass in any timezone.

- [ ] **Step 1: Write the test fixture**

`src/shared/fixtures.ts`:
```ts
import type { Session } from './api'

let n = 0

export function makeSession(over: Partial<Session> = {}): Session {
  n++
  const end = new Date(2026, 9, 6, 9, 12).toISOString()
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Session ${n}`,
    named: false,
    cwd: '/Users/me/code/app',
    cwdExists: true,
    hidden: false,
    archived: false,
    repo: { name: 'app', root: '/Users/me/code/app' },
    branch: 'main',
    worktree: null,
    start: new Date(2026, 9, 6, 8, 32).toISOString(),
    end,
    sizeBytes: 6_100_000,
    keptUntil: new Date(2026, 10, 5, 9, 12).toISOString(),
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    permissionMode: 'bypassPermissions',
    status: 'completed',
    live: false,
    pr: null,
    forkedFrom: null,
    forks: 0,
    prompts: [],
    summary: null,
    files: [],
    commits: [],
    artifacts: [],
    usage: {
      contextUsed: 263_000, contextMax: 1_000_000, input: 150, output: 190_900, total: 14_200_000,
      cacheRead: 260_800, cacheWrite: 2200, cacheHitPct: 99.2, cost: 5.08, durationMs: 2_400_000,
      linesAdded: 524, linesRemoved: 131, compactions: 0, agents: 3, outputStyle: null, plan: null,
    },
    ...over,
  }
}
```

- [ ] **Step 2: Write the failing format tests**

Create `src/shared/format.ts` with `import type { Status } from './api'` and this block:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const at = (d: number, h = 9, m = 12) => new Date(2026, 9, d, h, m).toISOString()

  it('formats clock times in 12-hour form', () => {
    expect(clock(new Date(2026, 9, 6, 9, 12))).toBe('9:12 AM')
    expect(clock(new Date(2026, 9, 6, 0, 5))).toBe('12:05 AM')
    expect(clock(new Date(2026, 9, 6, 13, 0))).toBe('1:00 PM')
  })
  it('shows the time for today and whole days for older sessions', () => {
    expect(agoShort(at(6), now)).toBe('9:12 AM')
    expect(agoShort(at(5, 23, 59), now)).toBe('1d')
    expect(agoShort(at(3), now)).toBe('3d')
    expect(agoLong(at(6), now)).toBe('Today, 9:12 AM')
    expect(agoLong(at(5), now)).toBe('Yesterday')
    expect(agoLong(at(1), now)).toBe('5 days ago')
  })
  it('names days and dates the way the prototype does', () => {
    expect(shortDay(new Date(2026, 9, 6))).toBe('Tue, Oct 6')
    expect(monthDay(new Date(2026, 10, 5))).toBe('Nov 5')
  })
  it('compacts token counts to k and M with one decimal', () => {
    expect(compact(150)).toBe('150')
    expect(compact(263_000)).toBe('263k')
    expect(compact(190_900)).toBe('190.9k')
    expect(compact(1_000_000)).toBe('1M')
    expect(compact(14_200_000)).toBe('14.2M')
  })
  it('formats sizes, durations and costs', () => {
    expect(fileSize(6_100_000)).toBe('6.1MB')
    expect(fileSize(48_200)).toBe('48KB')
    expect(fileSize(512)).toBe('512B')
    expect(durationLabel(2_400_000)).toBe('40m')
    expect(durationLabel(4_080_000)).toBe('1h 8m')
    expect(costLabel(5.08)).toBe('$5.08')
    expect(costLabel(null)).toBe('—')
  })
  it('names models and permission modes for people', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-fable-5-1[1m]')).toBe('Fable 5.1')
    expect(modelLabel('gpt-x')).toBe('gpt-x')
    expect(modelLabel(null)).toBe('Unknown model')
    expect(modeLabel('bypassPermissions')).toBe('Bypass permissions')
    expect(modeLabel('someNewMode')).toBe('Some new mode')
    expect(modeLabel(null)).toBe('Default')
  })
  it('shortens home paths and counts down to a plan reset', () => {
    expect(tildify('/Users/me/code/app')).toBe('~/code/app')
    expect(tildify('/Users/me')).toBe('~')
    expect(tildify('/tmp/x')).toBe('/tmp/x')
    expect(resetsIn(new Date(2026, 9, 6, 15, 7).toISOString(), now)).toBe('4h 7m')
    expect(resetsIn(new Date(2026, 9, 6, 11, 30).toISOString(), now)).toBe('30m')
  })
  it('pluralizes counts', () => {
    expect(plural(1, 'session')).toBe('1 session')
    expect(plural(12, 'session')).toBe('12 sessions')
  })
  it('gives a dot only to sessions that need attention', () => {
    expect(attention('running')).toEqual({ color: 'var(--app-green)', label: 'Running' })
    expect(attention('waiting')).toEqual({ color: 'var(--app-yellow)', label: 'Waiting for you' })
    expect(attention('interrupted')).toEqual({ color: 'var(--app-yellow)', label: 'Interrupted' })
    expect(attention('failed')).toEqual({ color: 'var(--app-red)', label: 'Failed' })
    expect(attention('completed')).toBeNull()
  })
}
```

Run: `npx vitest run src/shared/format.ts`
Expected: FAIL with `clock is not defined`.

- [ ] **Step 3: Implement `format.ts` above the test block**

```ts
import type { Status } from './api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

const midnight = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

// Calendar days, not 24-hour spans: 11pm yesterday is "1d" at 9am today.
export const daysAgo = (iso: string, now: Date): number => Math.round((midnight(now) - midnight(new Date(iso))) / DAY_MS)

export function clock(d: Date): string {
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export function agoShort(iso: string, now: Date): string {
  const n = daysAgo(iso, now)
  return n <= 0 ? clock(new Date(iso)) : `${n}d`
}

export function agoLong(iso: string, now: Date): string {
  const n = daysAgo(iso, now)
  if (n <= 0) return `Today, ${clock(new Date(iso))}`
  if (n === 1) return 'Yesterday'
  return `${n} days ago`
}

export const shortDay = (d: Date): string => `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
export const monthDay = (d: Date): string => `${MONTHS[d.getMonth()]} ${d.getDate()}`

export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(n))
}

export function fileSize(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)}KB`
  return `${bytes}B`
}

export function durationLabel(ms: number): string {
  const m = Math.round(ms / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export const costLabel = (n: number | null): string => (n === null ? '—' : `$${n.toFixed(2)}`)

export function modelLabel(id: string | null): string {
  if (!id) return 'Unknown model'
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id.replace(/\[1m\]$/, ''))
  if (!m) return id
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

const MODES: Record<string, string> = {
  bypassPermissions: 'Bypass permissions',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  default: 'Default',
  auto: 'Auto',
  dontAsk: "Don't ask",
}

export function modeLabel(m: string | null): string {
  if (!m) return 'Default'
  if (MODES[m]) return MODES[m]
  const words = m.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words[0].toUpperCase() + words.slice(1)
}

export const tildify = (p: string): string => p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~')

export function resetsIn(iso: string, now: Date): string {
  const m = Math.max(0, Math.round((Date.parse(iso) - now.getTime()) / 60_000))
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function attention(s: Status): { color: string; label: string } | null {
  switch (s) {
    case 'running':
      return { color: 'var(--app-green)', label: 'Running' }
    case 'waiting':
      return { color: 'var(--app-yellow)', label: 'Waiting for you' }
    case 'interrupted':
      return { color: 'var(--app-yellow)', label: 'Interrupted' }
    case 'failed':
      return { color: 'var(--app-red)', label: 'Failed' }
    default:
      return null
  }
}
```

Run: `npx vitest run src/shared/format.ts`
Expected: 9 tests PASS.

- [ ] **Step 4: Write the failing tree tests**

Create `src/shared/tree.ts` with the imports from Step 5 and this block:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const root = '/Users/me/code/app'
  const at = (d: number) => new Date(2026, 9, d, 9).toISOString()
  const main = makeSession({ branch: 'main', end: at(6) })
  const feat = makeSession({ branch: 'feat', end: at(5) })
  const head = makeSession({ branch: 'HEAD', end: at(4) })
  const wt = makeSession({ worktree: { name: 'transcriptions', path: `${root}/.worktrees/transcriptions`, removedSeen: null }, end: at(3) })
  const gone = makeSession({ worktree: { name: 'old', path: `${root}/.worktrees/old`, removedSeen: at(2) }, cwdExists: false, end: at(2) })
  const other = makeSession({ repo: { name: 'team8', root: '/Users/me/code/team8' }, end: at(1) })
  const folder = makeSession({ repo: null, branch: null, cwd: '/Users/me/code', end: at(6) })
  const all = [main, feat, head, wt, gone, other, folder]
  const tree = buildTree(all)

  it('puts repo sessions under branches and worktrees, and plain cwds under folders', () => {
    expect(tree.all).toBe(7)
    expect(tree.repos.map((r) => [r.name, r.count])).toEqual([['app', 5], ['team8', 1]])
    expect(tree.repos[0].children.map((c) => [c.kind, c.label, c.count, c.removed])).toEqual([
      ['branch', 'main', 1, false], ['branch', 'feat', 1, false],
      ['worktree', 'transcriptions', 1, false], ['worktree', 'old', 1, true],
    ])
    expect(tree.repos[0].children[3].title).toBe('~/code/app/.worktrees/old (removed)')
    expect(tree.folders).toEqual([{ path: '/Users/me/code', label: '~/code', count: 1, scope: { type: 'folder', path: '/Users/me/code' } }])
  })
  it('filters sessions by each kind of scope', () => {
    const ids = (scope: Scope) => all.filter((s) => inScope(s, scope)).map((s) => s.id)
    expect(ids({ type: 'all' })).toHaveLength(7)
    expect(ids({ type: 'repo', repo: root })).toEqual([main.id, feat.id, head.id, wt.id, gone.id])
    expect(ids({ type: 'branch', repo: root, branch: 'main' })).toEqual([main.id])
    expect(ids({ type: 'wt', repo: root, path: `${root}/.worktrees/transcriptions` })).toEqual([wt.id])
    expect(ids({ type: 'folder', path: '/Users/me/code' })).toEqual([folder.id])
  })
  it('titles each scope the way the prototype does', () => {
    expect(scopeTitle({ type: 'all' }, tree)).toBe('All sessions')
    expect(scopeTitle({ type: 'repo', repo: root }, tree)).toBe('app')
    expect(scopeTitle({ type: 'branch', repo: root, branch: 'feat' }, tree)).toBe('app / feat')
    expect(scopeTitle({ type: 'wt', repo: root, path: `${root}/.worktrees/transcriptions` }, tree)).toBe('transcriptions worktree')
    expect(scopeTitle({ type: 'folder', path: '/Users/me/code' }, tree)).toBe('~/code')
  })
  it('expands the two most recently active repositories', () => {
    expect(defaultExpanded(tree)).toEqual({ [root]: true, '/Users/me/code/team8': true })
  })
  it('compares scopes by value', () => {
    expect(sameScope({ type: 'branch', repo: root, branch: 'main' }, { type: 'branch', repo: root, branch: 'main' })).toBe(true)
    expect(sameScope({ type: 'all' }, { type: 'repo', repo: root })).toBe(false)
  })
  it('leaves hidden and archived sessions out', () => {
    const xs = [makeSession(), makeSession({ hidden: true }), makeSession({ archived: true })]
    expect(visible(xs)).toEqual([xs[0]])
  })
}
```

Run: `npx vitest run src/shared/tree.ts`
Expected: FAIL with `buildTree is not defined`.

- [ ] **Step 5: Implement `tree.ts` above the test block**

```ts
import type { Session } from './api'
import { makeSession } from './fixtures'
import { tildify } from './format'

export type Scope =
  | { type: 'all' }
  | { type: 'repo'; repo: string }
  | { type: 'branch'; repo: string; branch: string }
  | { type: 'wt'; repo: string; path: string }
  | { type: 'folder'; path: string }

export interface TreeChild { kind: 'branch' | 'worktree'; label: string; count: number; removed: boolean; title: string; scope: Scope }
export interface TreeRepo { root: string; name: string; count: number; last: string; children: TreeChild[]; scope: Scope }
export interface TreeFolder { path: string; label: string; count: number; scope: Scope }
export interface Tree { all: number; repos: TreeRepo[]; folders: TreeFolder[] }

export const visible = (all: Session[]): Session[] => all.filter((s) => !s.hidden && !s.archived)

export function inScope(s: Session, scope: Scope): boolean {
  switch (scope.type) {
    case 'all':
      return true
    case 'repo':
      return s.repo?.root === scope.repo
    case 'branch':
      return s.repo?.root === scope.repo && !s.worktree && s.branch === scope.branch
    case 'wt':
      return s.worktree?.path === scope.path
    case 'folder':
      return !s.repo && s.cwd === scope.path
  }
}

// Scopes are small literals built in one place each, so key order is stable.
export const sameScope = (a: Scope, b: Scope): boolean => JSON.stringify(a) === JSON.stringify(b)

const latest = (xs: Session[]): string => xs.reduce((m, s) => (s.end > m ? s.end : m), '')
const byLatest = <T extends [string, Session[]]>(a: T, b: T) => latest(b[1]).localeCompare(latest(a[1]))

function groupBy(xs: Session[], key: (s: Session) => string | null): Map<string, Session[]> {
  const out = new Map<string, Session[]>()
  for (const s of xs) {
    const k = key(s)
    if (k === null) continue
    const list = out.get(k)
    if (list) list.push(s)
    else out.set(k, [s])
  }
  return out
}

export function buildTree(sessions: Session[]): Tree {
  const repos = groupBy(sessions, (s) => s.repo?.root ?? null)
  const folders = groupBy(sessions, (s) => (s.repo ? null : s.cwd))
  const repoNodes = [...repos].sort(byLatest).map(([root, xs]): TreeRepo => {
    const branches = groupBy(xs, (s) => (!s.worktree && s.branch && s.branch !== 'HEAD' ? s.branch : null))
    const worktrees = groupBy(xs, (s) => s.worktree?.path ?? null)
    const children: TreeChild[] = [
      ...[...branches].sort(byLatest).map(([branch, bs]): TreeChild => ({
        kind: 'branch', label: branch, count: bs.length, removed: false, title: `Branch ${branch}`,
        scope: { type: 'branch', repo: root, branch },
      })),
      ...[...worktrees].sort(byLatest).map(([path, ws]): TreeChild => {
        const removed = !!ws[0].worktree?.removedSeen
        return {
          kind: 'worktree', label: ws[0].worktree?.name ?? path, count: ws.length, removed,
          title: `${tildify(path)}${removed ? ' (removed)' : ''}`, scope: { type: 'wt', repo: root, path },
        }
      }),
    ]
    return { root, name: xs[0].repo?.name ?? root, count: xs.length, last: latest(xs), children, scope: { type: 'repo', repo: root } }
  })
  const folderNodes = [...folders].sort(byLatest).map(([path, xs]): TreeFolder => ({
    path, label: tildify(path), count: xs.length, scope: { type: 'folder', path },
  }))
  return { all: sessions.length, repos: repoNodes, folders: folderNodes }
}

export function scopeTitle(scope: Scope, tree: Tree): string {
  const repo = 'repo' in scope ? tree.repos.find((r) => r.root === scope.repo) : undefined
  const repoName = repo?.name ?? ('repo' in scope ? (scope.repo.split('/').pop() ?? scope.repo) : '')
  switch (scope.type) {
    case 'all':
      return 'All sessions'
    case 'repo':
      return repoName
    case 'branch':
      return `${repoName} / ${scope.branch}`
    case 'wt':
      return `${repo?.children.find((c) => c.kind === 'worktree' && 'path' in c.scope && c.scope.path === scope.path)?.label ?? scope.path.split('/').pop()} worktree`
    case 'folder':
      return tildify(scope.path)
  }
}

export const defaultExpanded = (tree: Tree): Record<string, boolean> =>
  Object.fromEntries(tree.repos.slice(0, 2).map((r) => [r.root, true]))
```

Run: `npx vitest run src/shared/tree.ts`
Expected: 6 tests PASS.

- [ ] **Step 6: Write the failing view tests**

Create `src/shared/views.ts` with the imports from Step 7 and this block:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const at = (m: number, d: number, h = 9) => new Date(2026, m, d, h).toISOString()

  it('groups the timeline by day with Today and Yesterday labels', () => {
    const xs = [makeSession({ end: at(9, 6) }), makeSession({ end: at(9, 5) }), makeSession({ end: at(9, 2) })]
    expect(groupSessions(xs, 'timeline', now).map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Fri, Oct 2'])
  })
  it('shows the list view as one group without a header', () => {
    expect(groupSessions([makeSession(), makeSession()], 'list', now)).toMatchObject([{ label: '', sessions: [{}, {}] }])
  })
  it('groups by repository, then by folder for sessions outside a repository', () => {
    const xs = [makeSession(), makeSession({ repo: null, cwd: '/Users/me/code' })]
    expect(groupSessions(xs, 'repo', now).map((g) => g.label)).toEqual(['app', '~/code (not a repository)'])
  })
  it('groups by worktree, notes removed ones, and labels the main checkout', () => {
    const xs = [
      makeSession(),
      makeSession({ worktree: { name: 'transcriptions', path: '/w/t', removedSeen: at(9, 2) } }),
      makeSession({ repo: null, cwd: '/Users/me/code' }),
    ]
    expect(groupSessions(xs, 'worktree', now).map((g) => [g.label, g.note])).toEqual([
      ['app · main checkout', null], ['transcriptions worktree', 'removed'], ['~/code', null],
    ])
  })
  it('builds a Sunday-first month grid with up to three status dots per day', () => {
    const xs = [
      makeSession({ end: at(9, 6), status: 'running' }), makeSession({ end: at(9, 6) }),
      makeSession({ end: at(9, 6), status: 'failed' }), makeSession({ end: at(9, 6) }),
    ]
    const cells = calendarCells(xs, { year: 2026, month: 9 }, dayKey(new Date(2026, 9, 6)), now)
    expect(cells).toHaveLength(35)
    expect(cells[0]).toMatchObject({ day: 27, inMonth: false })
    const oct6 = cells.find((c) => c.inMonth && c.day === 6)
    expect(oct6).toMatchObject({ isToday: true, selected: true, hasSessions: true, dots: ['running', null, 'failed'] })
  })
  it('filters the calendar list to the selected day and leaves other views alone', () => {
    const a = makeSession({ end: at(9, 6) })
    const b = makeSession({ end: at(9, 5) })
    expect(listForView([a, b], 'calendar', dayKey(new Date(2026, 9, 5)))).toEqual([b])
    expect(listForView([a, b], 'list', dayKey(new Date(2026, 9, 5)))).toEqual([a, b])
  })
  it('finds the first and last months with sessions, and the latest day', () => {
    const xs = [makeSession({ end: at(8, 20) }), makeSession({ end: at(9, 6) })]
    expect(monthRange(xs)).toEqual({ first: { year: 2026, month: 8 }, last: { year: 2026, month: 9 } })
    expect(monthRange([])).toBeNull()
    expect(latestDay(xs)?.getDate()).toBe(6)
  })
  it('orders sessions by most recent activity', () => {
    const old = makeSession({ end: at(9, 1) })
    const recent = makeSession({ end: at(9, 6) })
    expect(byRecent([old, recent])).toEqual([recent, old])
  })
}
```

Run: `npx vitest run src/shared/views.ts`
Expected: FAIL with `groupSessions is not defined`.

- [ ] **Step 7: Implement `views.ts` above the test block**

```ts
import type { Session, Status } from './api'
import { makeSession } from './fixtures'
import { attention, daysAgo, shortDay, tildify } from './format'

export type ViewMode = 'list' | 'timeline' | 'repo' | 'worktree' | 'calendar'
export interface Group { key: string; label: string; note: string | null; sessions: Session[] }
export interface YearMonth { year: number; month: number }
export interface CalendarCell {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  selected: boolean
  hasSessions: boolean
  dots: (Status | null)[]
}

export const byRecent = (xs: Session[]): Session[] => [...xs].sort((a, b) => b.end.localeCompare(a.end))

export function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
}

export function groupSessions(sessions: Session[], mode: ViewMode, now: Date): Group[] {
  const groups: Group[] = []
  const byKey = new Map<string, Group>()
  const push = (key: string, label: string, note: string | null, s: Session) => {
    let g = byKey.get(key)
    if (!g) {
      g = { key, label, note, sessions: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.sessions.push(s)
  }
  for (const s of sessions) {
    if (mode === 'list') push('all', '', null, s)
    else if (mode === 'timeline') {
      const n = daysAgo(s.end, now)
      push(dayKey(s.end), n === 0 ? 'Today' : n === 1 ? 'Yesterday' : shortDay(new Date(s.end)), null, s)
    } else if (mode === 'repo') {
      if (s.repo) push(`r:${s.repo.root}`, s.repo.name, null, s)
      else push(`f:${s.cwd}`, `${tildify(s.cwd)} (not a repository)`, null, s)
    } else if (mode === 'worktree') {
      if (s.worktree) push(`w:${s.worktree.path}`, `${s.worktree.name} worktree`, s.worktree.removedSeen ? 'removed' : null, s)
      else push(`m:${s.repo?.root ?? s.cwd}`, s.repo ? `${s.repo.name} · main checkout` : tildify(s.cwd), null, s)
    } else push('day', shortDay(new Date(s.end)), null, s)
  }
  return groups
}

export const listForView = (sessions: Session[], mode: ViewMode, day: string | null): Session[] =>
  mode === 'calendar' && day ? sessions.filter((s) => dayKey(s.end) === day) : sessions

const ym = (iso: string): YearMonth => {
  const d = new Date(iso)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function monthRange(sessions: Session[]): { first: YearMonth; last: YearMonth } | null {
  if (!sessions.length) return null
  const sorted = byRecent(sessions)
  return { first: ym(sorted[sorted.length - 1].end), last: ym(sorted[0].end) }
}

export const latestDay = (sessions: Session[]): Date | null => (sessions.length ? new Date(byRecent(sessions)[0].end) : null)

export function calendarCells(sessions: Session[], month: YearMonth, selected: string | null, today: Date): CalendarCell[] {
  const first = new Date(month.year, month.month, 1)
  const daysIn = new Date(month.year, month.month + 1, 0).getDate()
  const total = Math.ceil((first.getDay() + daysIn) / 7) * 7
  const byDay = new Map<string, Session[]>()
  for (const s of sessions) {
    const k = dayKey(s.end)
    const list = byDay.get(k)
    if (list) list.push(s)
    else byDay.set(k, [s])
  }
  const todayKey = dayKey(today)
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(month.year, month.month, 1 - first.getDay() + i)
    const key = dayKey(d)
    const on = byDay.get(key) ?? []
    return {
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === month.month,
      isToday: key === todayKey,
      selected: key === selected,
      hasSessions: on.length > 0,
      dots: on.slice(0, 3).map((s) => (attention(s.status) ? s.status : null)),
    }
  })
}
```

Run: `npx vitest run src/shared/views.ts`
Expected: 8 tests PASS.

- [ ] **Step 8: Run the suite and the node typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.node.json`
Expected: all PASS, and tsc exits 0 (`src/shared` is in the node config). No commit (not a git repo).

### Task 8: Search kinds, the Ask scorer and actions

**Files:**
- Create: `src/shared/search.ts`

**Interfaces:**
- Consumes: Task 7 (`format.ts`, `tree.ts` `visible`, `fixtures.ts`), Task 1 api types and `resumeCommand`, `prCommand`.
- Produces: `KindId`, `Kind`, `KINDS: Kind[]`, `kindById(id: KindId): Kind`, `detectKind(input: string): { kind: KindId; rest: string } | null`, `ActionId`, `Result`, `ResultGroup`, `SearchContext = { now: Date; selected: Session | null; settings: Settings }`, `search(all: Session[], kind: KindId, query: string, ctx: SearchContext): ResultGroup[]`, `matches(s: Session, q: string): boolean`, `ask(s: Session, q: string): { score: number; pct: number; reason: string } | null`, `TERMINALS: { id: Terminal; label: string }[]`.
- Produces (types, exact; the command bar renders every row from these fields alone):
  ```ts
  export type KindId = 'sessions' | 'ask' | 'files' | 'artifacts' | 'prs' | 'in' | 'is' | 'when' | 'actions' | 'terminal' | 'rename'
  export interface Kind { id: KindId; prefix: string; label: string; icon: IconName; desc: string; examples: string[] }
  export type ActionId = 'resume' | 'copy' | 'fork' | 'openFolder' | 'openPr' | 'copyPr' | 'showRepo' | 'rename' | 'archive' | 'unarchive' | 'changeTerminal' | 'teeOn' | 'teeOff'
  interface Row { key: string; icon: IconName; iconColor: string; title: string; sub: string; mono: boolean; right: string; keycap: string }
  export type Result =
    | (Row & { type: 'kind'; kind: Kind })
    | (Row & { type: 'session'; session: Session; reason: string | null; artifact: Artifact | null })
    | (Row & { type: 'option'; fill: { kind: KindId; query: string } })
    | (Row & { type: 'action'; action: ActionId; session: Session; detail: string })
    | (Row & { type: 'terminal'; terminal: Terminal })
  export interface ResultGroup { label: string; results: Result[] }
  ```

Behaviour is the prototype's `pVals()` and `sem()` (`Session Manager Minimal.dc.html` lines 345–440), ported to real fields. The plan's code below is the reference; where it differs from the prototype, the plan wins. File, commit and PR rows are `session` results with a `reason`, as in the prototype. ↵ on any of them resumes that session.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/search.ts` with the imports from Step 3 and this block:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const settings: Settings = { terminal: 'iterm', archived: [], statusTee: false }
  const at = (d: number) => new Date(2026, 9, d, 9).toISOString()
  const live = makeSession({
    title: 'live-meeting', end: at(6), status: 'running', branch: 'live-meeting',
    prompts: ['Add a live meeting mode that shows the transcript while the meeting runs'],
    summary: { did: 'Streamed partial transcripts to the live view.', next: ['Finish speaker chips'] },
    files: [{ path: 'src/transcribe/diarize.ts', added: 141, removed: 52 }],
    commits: [{ sha: '4e9c1b7', msg: 'Stream partial transcripts to the live view', at: at(6) }],
    pr: { repo: 'alan-oliv/meetnotes', number: 27, url: 'https://github.com/alan-oliv/meetnotes/pull/27' },
    artifacts: [{ name: 'veracity-report.md', kind: 'markdown', path: '/Users/me/code/app/.claude/veracity-report.md', bytes: 9000, preview: '# Veracity report' }],
  })
  const team8 = makeSession({ title: 'perf pass', end: at(5), repo: { name: 'team8', root: '/Users/me/code/team8' }, cwd: '/Users/me/code/team8' })
  const folder = makeSession({ title: 'disk cleanup', end: at(1), repo: null, cwd: '/Users/me/code', status: 'interrupted' })
  const hidden = makeSession({ title: 'sdk run', hidden: true, end: at(6) })
  const archived = makeSession({ title: 'old thing', archived: true, end: at(6) })
  const all = [folder, team8, live, hidden, archived]
  const ctx = { now, selected: live, settings }
  const titles = (gs: ResultGroup[]) => gs.flatMap((g) => g.results.map((r) => r.title))

  it('turns a typed prefix into its kind, longest prefix first, ignoring case', () => {
    expect(detectKind('file:diarize')).toEqual({ kind: 'files', rest: 'diarize' })
    expect(detectKind('? where did I fix it')).toEqual({ kind: 'ask', rest: 'where did I fix it' })
    expect(detectKind('IS:running')).toEqual({ kind: 'is', rest: 'running' })
    expect(detectKind('>resume')).toEqual({ kind: 'actions', rest: 'resume' })
    expect(detectKind('transcript')).toBeNull()
  })
  it('shows the search kinds and the three newest sessions on empty input, and only kinds after a slash', () => {
    const empty = search(all, 'sessions', '', ctx)
    expect(empty.map((g) => g.label)).toEqual(['Search kinds', 'Recent'])
    expect(empty[0].results.map((r) => r.keycap)).toEqual(['?', 'file:', 'art:', 'pr:', 'in:', 'is:', 'when:', '>'])
    expect(empty[1].results.map((r) => r.title)).toEqual(['live-meeting', 'perf pass', 'disk cleanup'])
    expect(search(all, 'sessions', '/', ctx).map((g) => g.label)).toEqual(['Search kinds'])
  })
  it('matches every word across title, prompts, summary, paths, PR and commits, never hidden or archived', () => {
    expect(titles(search(all, 'sessions', 'speaker diarize', ctx))).toEqual(['live-meeting'])
    expect(titles(search(all, 'sessions', 'meetnotes#27 4e9c1b7', ctx))).toEqual(['live-meeting'])
    expect(titles(search(all, 'sessions', 'run', ctx))).not.toContain('sdk run')
    expect(titles(search(all, 'sessions', 'old thing', ctx))).toEqual([])
  })
  it('scores Ask queries by the share of meaningful words found and says why', () => {
    const r = ask(live, 'where did I fix the diarize transcript')
    expect(r).toEqual({ score: 1, pct: 94, reason: 'Changed src/transcribe/diarize.ts' })
    expect(ask(live, 'the a session')).toBeNull()
    expect(ask(live, 'kubernetes billing transcript')).toBeNull()
    const best = search(all, 'ask', 'live transcript', ctx)[0]
    expect(best.label).toBe('Best matches')
    expect(best.results[0]).toMatchObject({ title: 'live-meeting', right: '94%' })
  })
  it('lists one row per changed file with its folder, session and additions', () => {
    const [g] = search(all, 'files', 'diarize', ctx)
    expect(g.label).toBe('Files')
    expect(g.results[0]).toMatchObject({ type: 'session', title: 'diarize.ts', sub: 'src/transcribe · live-meeting', right: '+141', mono: true, reason: 'Changed src/transcribe/diarize.ts' })
  })
  it('finds artifacts by name, kind, path or content and carries them to the preview', () => {
    const [g] = search(all, 'artifacts', 'veracity', ctx)
    expect(g.results[0]).toMatchObject({ title: 'veracity-report.md', sub: 'markdown · 9KB · live-meeting' })
    expect(g.results[0].type === 'session' && g.results[0].artifact?.name).toBe('veracity-report.md')
  })
  it('finds PRs by number with or without # and commits by sha or message', () => {
    expect(titles(search(all, 'prs', '#27', ctx))).toEqual(['alan-oliv/meetnotes#27'])
    expect(titles(search(all, 'prs', '4e9c', ctx))).toEqual(['Stream partial transcripts to the live view'])
    expect(search(all, 'prs', '', ctx)[0].label).toBe('Pull requests')
  })
  it('suggests places until the first word names one, then searches inside it', () => {
    expect(titles(search(all, 'in', '', ctx))).toEqual(['app', 'team8', '~/code'])
    const inside = search(all, 'in', 'team8 perf', ctx)
    expect(inside[0].label).toBe('In team8')
    expect(titles(inside)).toEqual(['perf pass'])
    expect(search(all, 'in', 'te', ctx)[0].results[0]).toMatchObject({ type: 'option', fill: { kind: 'in', query: 'team8 ' } })
  })
  it('offers statuses with counts and reaches hidden and archived sessions only through is:', () => {
    const opts = search(all, 'is', '', ctx)[0].results
    expect(opts.map((r) => `${r.title} ${r.sub}`)).toEqual([
      'running 1 session', 'waiting 0 sessions', 'interrupted 1 session', 'failed 0 sessions',
      'completed 1 session', 'hidden 1 session', 'archived 1 session',
    ])
    expect(titles(search(all, 'is', 'hidden', ctx))).toEqual(['sdk run'])
    expect(titles(search(all, 'is', 'archived', ctx))).toEqual(['old thing'])
  })
  it('filters by today, yesterday and the last week', () => {
    expect(titles(search(all, 'when', 'today', ctx))).toEqual(['live-meeting'])
    expect(titles(search(all, 'when', 'yesterday', ctx))).toEqual(['perf pass'])
    expect(titles(search(all, 'when', 'week', ctx))).toEqual(['live-meeting', 'perf pass', 'disk cleanup'])
  })
  it('lists actions for the selected session, with PR actions only when it has a PR', () => {
    const acts = search(all, 'actions', '', ctx)[0]
    expect(acts.label).toBe('Actions on “live-meeting”')
    expect(acts.results.map((r) => r.title)).toEqual([
      'Resume', 'Copy resume command', 'Fork into a new session', 'Open folder', 'Open PR alan-oliv/meetnotes#27',
      'All sessions for PR #27', 'Show app in the tree', 'Rename session', 'Archive session', 'Change terminal', 'Show plan usage',
    ])
    expect(acts.results[2]).toMatchObject({ type: 'action', action: 'fork', detail: `claude --resume ${live.id} --fork-session` })
    expect(titles(search(all, 'actions', 'open', { ...ctx, selected: folder }))).toEqual(['Open folder'])
    expect(search(all, 'actions', '', { ...ctx, selected: null })).toEqual([])
  })
  it('offers the three terminals and marks the current one', () => {
    const rows = search(all, 'terminal', '', ctx)[0].results
    expect(rows.map((r) => [r.title, r.sub])).toEqual([['iTerm', 'Current'], ['Warp', ''], ['Terminal', '']])
  })
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/search.ts`
Expected: FAIL with `detectKind is not defined`.

- [ ] **Step 3: Implement `search.ts` above the test block**

```ts
import { prCommand, resumeCommand, type Artifact, type IconName, type Session, type Settings, type Terminal } from './api'
import { makeSession } from './fixtures'
import { agoShort, attention, daysAgo, fileSize, plural, tildify } from './format'
import { visible } from './tree'
import { byRecent } from './views'

export type KindId = 'sessions' | 'ask' | 'files' | 'artifacts' | 'prs' | 'in' | 'is' | 'when' | 'actions' | 'terminal' | 'rename'
export interface Kind { id: KindId; prefix: string; label: string; icon: IconName; desc: string; examples: string[] }
export type ActionId =
  | 'resume' | 'copy' | 'fork' | 'openFolder' | 'openPr' | 'copyPr' | 'showRepo'
  | 'rename' | 'archive' | 'unarchive' | 'changeTerminal' | 'teeOn' | 'teeOff'

interface Row { key: string; icon: IconName; iconColor: string; title: string; sub: string; mono: boolean; right: string; keycap: string }
export type Result =
  | (Row & { type: 'kind'; kind: Kind })
  | (Row & { type: 'session'; session: Session; reason: string | null; artifact: Artifact | null })
  | (Row & { type: 'option'; fill: { kind: KindId; query: string } })
  | (Row & { type: 'action'; action: ActionId; session: Session; detail: string })
  | (Row & { type: 'terminal'; terminal: Terminal })
export interface ResultGroup { label: string; results: Result[] }
export interface SearchContext { now: Date; selected: Session | null; settings: Settings }
type SessionResult = Extract<Result, { type: 'session' }>

export const KINDS: Kind[] = [
  { id: 'sessions', prefix: '', label: 'Sessions', icon: 'Search1', desc: 'Match words in titles, prompts, summaries and paths. This is what you get when you just type.', examples: ['transcript', 'board performance', 'marketplaces'] },
  { id: 'ask', prefix: '?', label: 'Ask', icon: 'Bolt', desc: 'Describe the session in your own words. Results are ranked by meaning and say why they matched.', examples: ['? where did I fix the failed transcript', '? the one that made team8 faster', '? telling speakers apart'] },
  { id: 'files', prefix: 'file:', label: 'Files', icon: 'Document', desc: 'Find sessions by a file they changed. Partial names and paths work.', examples: ['file:diarize', 'file:useVirtualRows', 'file:.claude/commands'] },
  { id: 'artifacts', prefix: 'art:', label: 'Artifacts', icon: 'Attachment2', desc: 'Find what a session produced: plans, reports, docs, commands and screenshots, even when the session name says nothing about them.', examples: ['art:report', 'art:.md', 'art:profile'] },
  { id: 'prs', prefix: 'pr:', label: 'PRs and commits', icon: 'Branch', desc: 'Look up a PR number or repository, a commit hash or a commit message.', examples: ['pr:27', 'pr:audio-sync', 'pr:virtualize'] },
  { id: 'in', prefix: 'in:', label: 'Repository', icon: 'Box', desc: 'Limit to one repository or folder, then keep typing to search inside it.', examples: ['in:team8', 'in:meetnotes live', 'in:~/code'] },
  { id: 'is', prefix: 'is:', label: 'Status', icon: 'Loader', desc: 'Running, waiting, interrupted, failed or completed sessions, plus hidden and archived ones.', examples: ['is:running', 'is:interrupted', 'is:hidden'] },
  { id: 'when', prefix: 'when:', label: 'Time', icon: 'ClockOutline', desc: 'Today, yesterday or this week.', examples: ['when:today', 'when:yesterday', 'when:week'] },
  { id: 'actions', prefix: '>', label: 'Actions', icon: 'Code', desc: 'Run an action on the selected session without leaving the keyboard.', examples: ['> resume', '> copy', '> open pr'] },
]
const INTERNAL_KINDS: Kind[] = [
  { id: 'terminal', prefix: '', label: 'Resume in', icon: 'Code', desc: 'Pick the terminal that resumes and forks sessions. Change it later with > Change terminal.', examples: [] },
  { id: 'rename', prefix: '', label: 'Rename', icon: 'Edit', desc: 'Type a new title and press Enter. Named sessions resume by name from any folder.', examples: [] },
]
export const kindById = (id: KindId): Kind => [...KINDS, ...INTERNAL_KINDS].find((k) => k.id === id) ?? KINDS[0]

export const TERMINALS: { id: Terminal; label: string }[] = [
  { id: 'iterm', label: 'iTerm' },
  { id: 'warp', label: 'Warp' },
  { id: 'terminal', label: 'Terminal' },
]

const SECONDARY = 'var(--app-text-2)'
const TERTIARY = 'var(--app-text-3)'

export function detectKind(input: string): { kind: KindId; rest: string } | null {
  const lower = input.toLowerCase()
  const k = KINDS.filter((x) => x.prefix && lower.startsWith(x.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return k ? { kind: k.id, rest: input.slice(k.prefix.length).replace(/^\s+/, '') } : null
}

function haystack(s: Session): string {
  return [
    s.title, s.repo?.name ?? '', s.cwd, tildify(s.cwd), s.branch ?? '', s.prompts.join(' '),
    s.summary ? `${s.summary.did} ${s.summary.next.join(' ')}` : '',
    s.files.map((f) => f.path).join(' '),
    s.pr ? `${s.pr.repo}#${s.pr.number} #${s.pr.number}` : '',
    s.commits.map((c) => `${c.sha} ${c.msg}`).join(' '),
    s.artifacts.map((a) => a.name).join(' '),
  ].join(' ').toLowerCase()
}

export function matches(s: Session, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = haystack(s)
  return words.every((w) => hay.includes(w))
}

const STOP = new Set(
  'the a an one session sessions where when which that i we me my claude did do was is to of for in on with and or about it this from made make work worked fix fixed find found'.split(' '),
)

// ponytail: lexical stand-in for embeddings, ported verbatim from the prototype's sem(); swap the body, keep the signature.
export function ask(s: Session, q: string): { score: number; pct: number; reason: string } | null {
  const toks = q.toLowerCase().replace(/[^a-z0-9#./_\-\s]/g, ' ').split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 ? t.replace(/(ing|ed|er|es|s)$/, '') : t))
  if (!toks.length) return null
  const first = s.prompts[0] ?? ''
  const fields: [string, string][] = [
    ...s.files.map((f): [string, string] => [`Changed ${f.path}`, f.path]),
    ...s.artifacts.map((a): [string, string] => [`Created ${a.name}`, `${a.name} ${a.kind} ${a.preview}`]),
    ...(s.pr ? [[`PR ${s.pr.repo}#${s.pr.number}`, `${s.pr.repo}#${s.pr.number}`] as [string, string]] : []),
    ...(first ? [[`Prompt: “${first.length > 80 ? `${first.slice(0, 79)}…` : first}”`, s.prompts.join(' ')] as [string, string]] : []),
    ...(s.summary ? [[`Summary: ${s.summary.did}`, `${s.summary.did} ${s.summary.next.join(' ')}`] as [string, string]] : []),
    [`Title: ${s.title}`, `${s.title} ${s.repo?.name ?? ''}`],
  ]
  let hit = 0
  let reason = ''
  for (const t of toks) {
    const f = fields.find(([, hay]) => hay.toLowerCase().includes(t))
    if (f) {
      hit++
      reason ||= f[0]
    }
  }
  const score = hit / toks.length
  return score >= 0.5 ? { score, pct: Math.round(58 + score * 36), reason } : null
}

function sessionRow(s: Session, now: Date, over: Partial<Omit<SessionResult, 'type' | 'session'>> = {}): Result {
  const dot = attention(s.status)
  return {
    type: 'session', session: s, reason: null, artifact: null, key: s.id,
    icon: dot ? 'Loader' : 'Document', iconColor: dot ? dot.color : TERTIARY,
    title: s.title, sub: `${s.repo ? `${s.repo.name} · ` : ''}${agoShort(s.end, now)}`,
    mono: false, right: '', keycap: '', ...over,
  }
}

const kindRow = (k: Kind): Result => ({
  type: 'kind', kind: k, key: `k:${k.id}`, icon: k.icon, iconColor: SECONDARY, title: k.label,
  sub: k.examples[0] ?? '', mono: true, right: '', keycap: k.prefix,
})

const optionRow = (title: string, sub: string, icon: IconName, fill: { kind: KindId; query: string }): Result => ({
  type: 'option', fill, key: `o:${fill.kind}:${fill.query}`, icon, iconColor: SECONDARY, title, sub, mono: false, right: '', keycap: '',
})

const baseName = (p: string) => p.split('/').pop() ?? p
const dirName = (p: string) => p.split('/').slice(0, -1).join('/')

function actionsFor(s: Session, settings: Settings): Result[] {
  const a = (action: ActionId, title: string, icon: IconName, detail: string): Result => ({
    type: 'action', action, session: s, detail, key: `a:${action}`, icon, iconColor: SECONDARY, title, sub: '', mono: false, right: '', keycap: '',
  })
  const list: Result[] = [
    a('resume', 'Resume', 'ArrowRight', resumeCommand(s.id, false)),
    a('copy', 'Copy resume command', 'Clipboard', resumeCommand(s.id, false)),
    a('fork', 'Fork into a new session', 'Layers', resumeCommand(s.id, true)),
  ]
  if (s.cwdExists) list.push(a('openFolder', 'Open folder', 'Storage', tildify(s.cwd)))
  if (s.pr) {
    list.push(
      a('openPr', `Open PR ${s.pr.repo}#${s.pr.number}`, 'Link', s.pr.url),
      a('copyPr', `All sessions for PR #${s.pr.number}`, 'Branch', prCommand(s.pr.number)),
    )
  }
  if (s.repo) list.push(a('showRepo', `Show ${s.repo.name} in the tree`, 'Box', tildify(s.repo.root)))
  list.push(
    a('rename', 'Rename session', 'Edit', 'Appends a custom-title record to the transcript, as /rename does.'),
    s.archived
      ? a('unarchive', 'Unarchive session', 'Archive', 'Shows it in the tree and list again.')
      : a('archive', 'Archive session', 'Archive', 'Hides it from the tree and list. is:archived still finds it.'),
    a('changeTerminal', 'Change terminal', 'Code', `Current: ${TERMINALS.find((t) => t.id === settings.terminal)?.label ?? 'not chosen'}`),
    settings.statusTee
      ? a('teeOff', 'Hide plan usage', 'Loader', 'Restores your original status line in ~/.claude/settings.json.')
      : a('teeOn', 'Show plan usage', 'Loader', 'Wraps your status line so Session Deck can read plan usage. Your status line keeps rendering.'),
  )
  return list
}

function places(shown: Session[]): { id: string; count: number; test: (s: Session) => boolean }[] {
  const out = new Map<string, { id: string; count: number; test: (s: Session) => boolean }>()
  for (const s of shown) {
    const id = s.repo ? s.repo.name : tildify(s.cwd)
    const p = out.get(id) ?? {
      id, count: 0,
      test: s.repo ? (x: Session) => x.repo?.name === id : (x: Session) => !x.repo && tildify(x.cwd) === id,
    }
    p.count++
    out.set(id, p)
  }
  return [...out.values()]
}

export function search(all: Session[], kind: KindId, query: string, ctx: SearchContext): ResultGroup[] {
  const q = query.trim()
  const ql = q.toLowerCase()
  const shown = byRecent(visible(all))
  const groups: ResultGroup[] = []
  const add = (label: string, results: Result[]) => {
    if (results.length) groups.push({ label, results })
  }
  const row = (s: Session, over?: Partial<Omit<SessionResult, 'type' | 'session'>>) => sessionRow(s, ctx.now, over)

  switch (kind) {
    case 'sessions':
      if (q === '' || q === '/') {
        add('Search kinds', KINDS.filter((k) => k.id !== 'sessions').map(kindRow))
        if (q === '') add('Recent', shown.slice(0, 3).map((s) => row(s)))
      } else {
        add('Sessions', shown.filter((s) => matches(s, q)).map((s) => row(s)))
        add('Search kinds', KINDS.filter((k) => k.id !== 'sessions' && (k.label.toLowerCase().includes(ql) || k.prefix.startsWith(ql))).map(kindRow))
      }
      break
    case 'ask':
      if (!q) add('Examples', kindById('ask').examples.map((e) => optionRow(e.slice(2), 'Ask', 'Bolt', { kind: 'ask', query: e.slice(2) })))
      else {
        const scored = shown.map((s) => ({ s, m: ask(s, q) })).filter((x) => x.m !== null)
        scored.sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
        add('Best matches', scored.map(({ s, m }) => row(s, { right: `${m?.pct}%`, reason: m?.reason ?? null })))
      }
      break
    case 'files': {
      const rows: Result[] = []
      for (const s of shown) {
        for (const f of s.files) {
          if (q && !f.path.toLowerCase().includes(ql)) continue
          rows.push(row(s, {
            key: `${s.id}:f:${f.path}`, icon: 'Document', iconColor: TERTIARY, title: baseName(f.path),
            sub: `${dirName(f.path)} · ${s.title}`, mono: true, right: `+${f.added}`, reason: `Changed ${f.path}`,
          }))
        }
      }
      add(q ? 'Files' : 'Recently changed files', rows.slice(0, 40))
      break
    }
    case 'artifacts': {
      const rows: Result[] = []
      for (const s of shown) {
        for (const a of s.artifacts) {
          if (q && !`${a.name} ${a.kind} ${a.path} ${a.preview}`.toLowerCase().includes(ql)) continue
          rows.push(row(s, {
            key: `${s.id}:a:${a.path}`, icon: 'Attachment2', iconColor: SECONDARY, title: a.name,
            sub: `${a.kind} · ${fileSize(a.bytes)} · ${s.title}`, right: agoShort(s.end, ctx.now), reason: `Created ${tildify(a.path)}`, artifact: a,
          }))
        }
      }
      add(q ? 'Artifacts' : 'All artifacts', rows)
      break
    }
    case 'prs': {
      const rows: Result[] = []
      const qn = ql.replace(/^#/, '')
      for (const s of shown) {
        if (s.pr) {
          const label = `${s.pr.repo}#${s.pr.number}`
          if (!q || label.toLowerCase().includes(qn)) {
            rows.push(row(s, { key: `${s.id}:pr`, icon: 'Branch', iconColor: 'var(--app-green)', title: label, sub: s.title, right: `#${s.pr.number}`, reason: `Opened ${label}` }))
          }
        }
        if (!q) continue
        for (const c of s.commits) {
          if (!`${c.sha} ${c.msg}`.toLowerCase().includes(ql)) continue
          rows.push(row(s, { key: `${s.id}:c:${c.sha}`, icon: 'Code2', iconColor: TERTIARY, title: c.msg, sub: `${c.sha} · ${s.title}`, mono: true, reason: `Commit ${c.sha} ${c.msg}` }))
        }
      }
      add(q ? 'Matches' : 'Pull requests', rows)
      break
    }
    case 'in': {
      const ps = places(shown)
      const [first = '', ...rest] = q.split(/\s+/)
      const place = ps.find((p) => p.id.toLowerCase() === first.toLowerCase())
      if (place) add(`In ${place.id}`, shown.filter((s) => place.test(s) && matches(s, rest.join(' '))).map((s) => row(s)))
      else add('Repositories and folders', ps.filter((p) => !q || p.id.toLowerCase().includes(ql)).map((p) => optionRow(p.id, plural(p.count, 'session'), 'Box', { kind: 'in', query: `${p.id} ` })))
      break
    }
    case 'is':
    case 'when': {
      const opts: [string, Session[]][] =
        kind === 'is'
          ? [
              ...(['running', 'waiting', 'interrupted', 'failed', 'completed'] as const).map((st): [string, Session[]] => [st, shown.filter((s) => s.status === st)]),
              ['hidden', byRecent(all.filter((s) => s.hidden && !s.archived))],
              ['archived', byRecent(all.filter((s) => s.archived))],
            ]
          : [
              ['today', shown.filter((s) => daysAgo(s.end, ctx.now) === 0)],
              ['yesterday', shown.filter((s) => daysAgo(s.end, ctx.now) === 1)],
              ['week', shown.filter((s) => daysAgo(s.end, ctx.now) <= 7)],
            ]
      const label = kindById(kind).label
      const exact = opts.find(([name]) => name === ql)
      if (exact) add(`${label}: ${exact[0]}`, exact[1].map((s) => row(s)))
      else add(label, opts.filter(([name]) => !q || name.startsWith(ql)).map(([name, xs]) => optionRow(name, plural(xs.length, 'session'), kindById(kind).icon, { kind, query: name })))
      break
    }
    case 'actions':
      if (ctx.selected) add(`Actions on “${ctx.selected.title}”`, actionsFor(ctx.selected, ctx.settings).filter((r) => !q || r.title.toLowerCase().includes(ql)))
      break
    case 'terminal':
      add('Resume in', TERMINALS.filter((t) => !q || t.label.toLowerCase().includes(ql)).map((t): Result => ({
        type: 'terminal', terminal: t.id, key: `t:${t.id}`, icon: 'Code', iconColor: SECONDARY, title: t.label,
        sub: ctx.settings.terminal === t.id ? 'Current' : '', mono: false, right: '', keycap: '',
      })))
      break
    case 'rename':
      break
  }
  return groups
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/shared/search.ts && npx tsc --noEmit -p tsconfig.node.json`
Expected: 12 tests PASS, and tsc exits 0. If an Ask expectation is off by a token, check `ask()` against the prototype's `sem()` (prototype line 347) before you change the test: the prototype is the spec. No commit (not a git repo).

### Task 9: Lay the renderer foundation: tokens, icons, buttons, hooks

**Files:**
- Create: `src/renderer/src/env.d.ts`, `css.d.ts`, `tokens.css`, `icons.tsx`, `Button.tsx`, `Button.css`, `hooks.ts`

**Interfaces:**
- Consumes: Task 1 (`Api`, `Session`, `Settings`, `IconName`).
- Produces: `Icon({ name: IconName; size?: number; className?: string })`, `Button({ kind: 'primary' | 'secondary'; children: ReactNode; onClick(): void; title?: string })`, `useSessions(): Session[] | null`, `useSettings(): Settings | null`, `useNow(ms?: number): Date`, `errorText(e: unknown): string`, every `--app-*` token, and the global classes `.keycap`, `.dot`, `.mono`, `.tnum`.

Renderer tests run in Vitest's node environment and render with `react-dom/server`'s `renderToStaticMarkup`, with no DOM library. Every renderer `.tsx` that has a test imports `renderToStaticMarkup` at the top.

- [ ] **Step 1: Write the type shims and design tokens**

`src/renderer/src/env.d.ts`:
```ts
import type { Api } from '../../shared/api'

declare global {
  interface Window {
    api: Api
  }
}

export {}
```

`src/renderer/src/css.d.ts`:
```ts
declare module '*.css' {}
```

`src/renderer/src/tokens.css`. Values are the handoff README's "Design Tokens (Linear Design System, Dark)", verbatim:
```css
:root {
  --app-bg: #181921;
  --app-sidebar: #191a23;
  --app-surface: #1d1e2b;
  --app-elevated: #292a35;
  --app-hover: #2c2d42;
  --app-selected: #393a4b;
  --app-modal: #202128;
  --app-border: #2c2d3c;
  --app-border-strong: #393a4b;
  --app-border-hover: #444556;
  --app-divider: rgba(89, 89, 116, 0.25);
  --app-wash: rgba(149, 149, 189, 0.125);
  --app-scrim: rgba(29, 30, 43, 0.498);
  --app-text: #eeeffc;
  --app-text-2: #d2d3e0;
  --app-text-3: #858699;
  --app-text-disabled: #6b6f76;
  --app-link: #6c79ff;
  --app-link-hover: #7477f0;
  --app-on-primary: #ffffff;
  --app-brand: #575bc7;
  --app-brand-hover: #666be2;
  --app-focus: #5e6ad2;
  --app-green: #4cb782;
  --app-yellow: #f2c94c;
  --app-orange: #f2994a;
  --app-red: #eb5757;
  --app-blue: #4ea7fc;
  --app-violet: #bb87fc;
  --app-font: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --app-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --app-radius: 4px;
  --app-radius-track: 5px;
  --app-radius-panel: 8px;
  --app-radius-meter: 3px;
  --app-shadow-panel: 0 16px 70px rgba(0, 0, 0, 0.5);
  --app-shadow-primary: inset 0 0 0 1px #575bc7, 0 1px 2px rgba(0, 0, 0, 0.09);
  --app-shadow-secondary: inset 0 0 0 1px #393a4b, 0 1px 1px rgba(0, 0, 0, 0.15);
  --app-shadow-secondary-hover: inset 0 0 0 1px #444556, 0 1px 1px rgba(0, 0, 0, 0.15);
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--app-bg);
  color: var(--app-text);
  font-family: var(--app-font);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  user-select: none;
  cursor: default;
  overflow: hidden;
}

input::placeholder {
  color: var(--app-text-3);
}

.keycap {
  font-size: 11px;
  line-height: 18px;
  padding: 0 5px;
  border-radius: var(--app-radius);
  background: var(--app-elevated);
  box-shadow: inset 0 0 0 1px var(--app-border-strong);
  color: var(--app-text-3);
  white-space: nowrap;
}

.keycap:hover {
  color: var(--app-text);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

.mono {
  font-family: var(--app-mono);
}

.tnum {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 2: Generate `icons.tsx` from the design system's icon data**

The handoff bundle stores every icon as `{ viewBox, body }` SVG markup with `fill="currentColor"`. Copy the 23 names in `ICON_NAMES` out of it with a one-off script. The script lives in your scratch dir and is not part of the app.

Create `$TMPDIR/extract-icons.mjs`:
```js
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dsRoot = 'docs/design_handoff_session_manager_minimal/_ds'
const bundle = readFileSync(join(dsRoot, readdirSync(dsRoot)[0], '_ds_bundle.js'), 'utf8')
const start = bundle.indexOf('// components/icons/icon-data.js')
const seg = bundle.slice(start, bundle.indexOf('// components/', start + 40))
const names = ['AllItems', 'Box', 'Branch', 'Layers', 'Storage', 'ChevronDown2', 'Search1', 'Bolt', 'Document', 'Attachment2', 'Loader', 'ClockOutline', 'Code', 'Code2', 'ViewList', 'Timeline', 'CalendarEmpty', 'ArrowRight', 'Clipboard', 'Link', 'Edit', 'Archive', 'Check']
const entries = names.map((n) => {
  const m = new RegExp(`"${n}": \\{\\s*viewBox: "([^"]+)",\\s*body: ("(?:[^"\\\\]|\\\\.)*")`).exec(seg)
  if (!m) throw new Error(`missing icon ${n}`)
  return `  ${n}: { viewBox: ${JSON.stringify(m[1])}, body: ${m[2]} },`
})
process.stdout.write(`// Generated from the Linear Design System icon data in docs/design_handoff_session_manager_minimal.
import { renderToStaticMarkup } from 'react-dom/server'
import type { IconName } from '../../shared/api'

const ICONS: Record<IconName, { viewBox: string; body: string }> = {
${entries.join('\n')}
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const icon = ICONS[name]
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="currentColor"
      aria-hidden="true"
      style={{ flex: 'none', display: 'block' }}
      // Static design-system markup bundled with the app, never user input.
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('renders a design-system icon at the requested size in the current colour', () => {
    const html = renderToStaticMarkup(<Icon name="Box" size={14} />)
    expect(html).toContain('width="14"')
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('<path')
  })
}
`)
```

Run: `node "$TMPDIR/extract-icons.mjs" > src/renderer/src/icons.tsx && grep -c "viewBox:" src/renderer/src/icons.tsx`
Expected: prints `23`. If it throws `missing icon X`, open the bundle segment and fix the regex rather than dropping the icon.

- [ ] **Step 3: Write the buttons**

`src/renderer/src/Button.tsx`:
```tsx
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import './Button.css'

export function Button({ kind, children, onClick, title }: { kind: 'primary' | 'secondary'; children: ReactNode; onClick(): void; title?: string }) {
  return (
    <button type="button" className={`btn btn-${kind}`} onClick={onClick} title={title}>
      {children}
    </button>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('renders a primary or secondary design-system button with its label', () => {
    expect(renderToStaticMarkup(<Button kind="primary" onClick={() => {}}>Resume</Button>)).toBe('<button type="button" class="btn btn-primary">Resume</button>')
  })
}
```

`src/renderer/src/Button.css`. These are Linear `Buttons`, size "sm", read from the bundle: 28px tall, 14px side padding, 13px/500:
```css
.btn {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--app-radius);
  font: 500 13px/1 var(--app-font);
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  cursor: default;
}

.btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--app-focus);
}

.btn-primary {
  background: var(--app-brand);
  color: var(--app-on-primary);
  box-shadow: var(--app-shadow-primary);
}

.btn-primary:hover {
  background: var(--app-brand-hover);
}

.btn-secondary {
  background: var(--app-elevated);
  color: var(--app-text);
  box-shadow: var(--app-shadow-secondary);
}

.btn-secondary:hover {
  background: var(--app-hover);
  box-shadow: var(--app-shadow-secondary-hover);
}
```

- [ ] **Step 4: Write the failing hooks test**

Create `src/renderer/src/hooks.ts` with the imports from Step 5 and:

```ts
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('strips Electron’s remote-method prefix from IPC errors', () => {
    expect(errorText(new Error("Error invoking remote method 'api:renameSession': Error: Can't rename a running session"))).toBe("Can't rename a running session")
    expect(errorText('plain')).toBe('plain')
  })
}
```

Run: `npx vitest run src/renderer/src/hooks.ts`
Expected: FAIL with `errorText is not defined`.

- [ ] **Step 5: Implement the hooks above the test block**

```ts
import { useEffect, useState } from 'react'
import type { Session, Settings } from '../../shared/api'

// State lives in main: load once, then reload whenever main says it changed.
function useLive<T>(load: () => Promise<T>, subscribe: (cb: () => void) => () => void): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    let seq = 0
    const reload = () => {
      const n = ++seq
      load().then(
        (v) => {
          if (alive && n === seq) setValue(v)
        },
        (e) => console.error(e),
      )
    }
    reload()
    const off = subscribe(reload)
    return () => {
      alive = false
      off()
    }
  }, [])
  return value
}

export const useSessions = (): Session[] | null => useLive(() => window.api.listSessions(), (cb) => window.api.onSessionsChanged(cb))
export const useSettings = (): Settings | null => useLive(() => window.api.getSettings(), (cb) => window.api.onSettingsChanged(cb))

export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
```

- [ ] **Step 6: Run the renderer tests and the full typecheck**

Run: `npx vitest run src/renderer && npm run typecheck`
Expected: 3 tests PASS. `npm run typecheck` exits 0 for both configs; from this task on it must stay green. No commit (not a git repo).

### Task 10: Build the tree sidebar

**Files:**
- Create: `src/renderer/src/Sidebar.tsx`, `src/renderer/src/Sidebar.css`

**Interfaces:**
- Consumes: Task 7 (`Tree`, `Scope`, `sameScope`, `tildify`), Task 9 (`Icon`).
- Produces: `Sidebar(props: { tree: Tree; scope: Scope; expanded: Record<string, boolean>; onScope(scope: Scope): void; onToggle(root: string): void })`.

Design source: README "1. Tree sidebar", prototype lines 131–175. One change: the traffic-light row stays empty and becomes the window drag region, because the native lights are drawn there (`trafficLightPosition: { x: 14, y: 13 }` in main).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/Sidebar.tsx` with the imports from Step 3 and:

```tsx
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const root = '/Users/me/code/app'
  const tree = buildTree([
    makeSession({ branch: 'main' }),
    makeSession({ worktree: { name: 'old', path: `${root}/.worktrees/old`, removedSeen: '2026-10-02T00:00:00.000Z' } }),
    makeSession({ repo: { name: 'team8', root: '/Users/me/code/team8' } }),
    makeSession({ repo: null, cwd: '/Users/me/code' }),
  ])
  const render = (scope: Scope, expanded: Record<string, boolean>) =>
    renderToStaticMarkup(<Sidebar tree={tree} scope={scope} expanded={expanded} onScope={() => {}} onToggle={() => {}} />)

  it('lists all sessions, repositories with counts, and folders', () => {
    const html = render({ type: 'all' }, {})
    expect(html).toContain('All sessions')
    expect(html).toContain('Repositories')
    expect(html).toContain('>team8<')
    expect(html).toContain('Folders')
    expect(html).toContain('>~/code<')
  })
  it('shows branches and worktrees only for expanded repositories, striking removed worktrees', () => {
    expect(render({ type: 'all' }, {})).not.toContain('>main<')
    const open = render({ type: 'all' }, { [root]: true })
    expect(open).toContain('>main<')
    expect(open).toContain('side-label is-removed">old<')
    expect(open).toContain('title="~/code/app/.worktrees/old (removed)"')
  })
  it('marks exactly the selected scope', () => {
    const html = render({ type: 'repo', repo: '/Users/me/code/team8' }, {})
    expect(html.match(/is-selected/g)).toHaveLength(1)
    expect(html).toMatch(/side-repo is-selected[^>]*>[\s\S]*?>team8</)
  })
}
```

Run: `npx vitest run src/renderer/src/Sidebar.tsx`
Expected: FAIL with `Sidebar is not defined`.

- [ ] **Step 2: Write `Sidebar.css`**

```css
.sidebar {
  width: 220px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--app-sidebar);
  box-shadow: inset -1px 0 0 var(--app-divider);
}

.sidebar-lights {
  height: 38px;
  flex: none;
  -webkit-app-region: drag;
}

.sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.side-section,
.side-repo-block,
.side-children {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.side-header {
  padding: 0 8px 6px;
  font-size: 12px;
  line-height: 16px;
  color: var(--app-text-3);
}

.side-item,
.side-repo,
.side-folder,
.side-child {
  display: flex;
  align-items: center;
  border-radius: var(--app-radius);
  color: var(--app-text-2);
}

.side-item,
.side-folder {
  height: 28px;
  padding: 0 8px;
  gap: 8px;
  font-size: 13px;
}

.side-repo {
  height: 28px;
  padding: 0 8px 0 2px;
  gap: 6px;
  font-size: 13px;
}

.side-child {
  height: 26px;
  padding: 0 8px;
  gap: 8px;
  font-size: 12px;
}

.side-item:hover,
.side-repo:hover,
.side-folder:hover,
.side-child:hover {
  background: var(--app-wash);
  color: var(--app-text);
}

.side-item.is-selected,
.side-repo.is-selected,
.side-folder.is-selected,
.side-child.is-selected {
  background: var(--app-selected);
  color: var(--app-text);
}

.side-children {
  margin-left: 17px;
  padding-left: 8px;
  box-shadow: inset 1px 0 0 var(--app-divider);
}

.side-icon,
.side-chevron {
  color: var(--app-text-3);
}

.side-chevron {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.side-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.side-repo .side-label {
  margin-left: 2px;
}

.side-folder .side-label {
  font-family: var(--app-mono);
  font-size: 12px;
}

.side-label.is-removed {
  text-decoration: line-through;
}

.side-count {
  font-size: 12px;
  color: var(--app-text-3);
}
```

- [ ] **Step 3: Implement `Sidebar.tsx` above the test block**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { makeSession } from '../../shared/fixtures'
import { tildify } from '../../shared/format'
import { buildTree, sameScope, type Scope, type Tree } from '../../shared/tree'
import { Icon } from './icons'
import './Sidebar.css'

export interface SidebarProps {
  tree: Tree
  scope: Scope
  expanded: Record<string, boolean>
  onScope(scope: Scope): void
  onToggle(root: string): void
}

export function Sidebar({ tree, scope, expanded, onScope, onToggle }: SidebarProps) {
  const cls = (s: Scope, base: string) => (sameScope(s, scope) ? `${base} is-selected` : base)
  return (
    <nav className="sidebar">
      <div className="sidebar-lights" />
      <div className="sidebar-scroll">
        <div className={cls({ type: 'all' }, 'side-item')} onClick={() => onScope({ type: 'all' })}>
          <Icon name="AllItems" size={14} className="side-icon" />
          <span className="side-label">All sessions</span>
          <span className="side-count">{tree.all}</span>
        </div>
        {tree.repos.length > 0 && (
          <div className="side-section">
            <div className="side-header">Repositories</div>
            {tree.repos.map((r) => {
              const isOpen = !!expanded[r.root]
              return (
                <div key={r.root} className="side-repo-block">
                  <div className={cls(r.scope, 'side-repo')} onClick={() => onScope(r.scope)} title={tildify(r.root)}>
                    <span
                      className="side-chevron"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(r.root)
                      }}
                    >
                      <span style={{ display: 'flex', transform: isOpen ? 'none' : 'rotate(-90deg)', opacity: r.children.length ? 1 : 0.3 }}>
                        <Icon name="ChevronDown2" size={10} />
                      </span>
                    </span>
                    <Icon name="Box" size={14} className="side-icon" />
                    <span className="side-label">{r.name}</span>
                    <span className="side-count">{r.count}</span>
                  </div>
                  {isOpen && r.children.length > 0 && (
                    <div className="side-children">
                      {r.children.map((c) => (
                        <div key={`${c.kind}:${c.label}`} className={cls(c.scope, 'side-child')} onClick={() => onScope(c.scope)} title={c.title}>
                          <Icon name={c.kind === 'branch' ? 'Branch' : 'Layers'} size={12} className="side-icon" />
                          <span className={c.removed ? 'side-label is-removed' : 'side-label'}>{c.label}</span>
                          <span className="side-count">{c.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {tree.folders.length > 0 && (
          <div className="side-section">
            <div className="side-header">Folders</div>
            {tree.folders.map((f) => (
              <div key={f.path} className={cls(f.scope, 'side-folder')} onClick={() => onScope(f.scope)} title={f.label}>
                <Icon name="Storage" size={14} className="side-icon" />
                <span className="side-label">{f.label}</span>
                <span className="side-count">{f.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/renderer/src/Sidebar.tsx && npm run typecheck`
Expected: 3 tests PASS, and typecheck exits 0. No commit (not a git repo).

### Task 11: Build the session list, view switcher and calendar

**Files:**
- Create: `src/renderer/src/SessionList.tsx`, `SessionList.css`, `Calendar.tsx`, `Calendar.css`

**Interfaces:**
- Consumes: Task 7 (`groupSessions`, `listForView`, `calendarCells`, `monthRange`, `ViewMode`, `YearMonth`, `agoShort`, `clock`, `attention`, `tildify`, `plural`), Task 9 (`Icon`).
- Produces: `SessionList(props: SessionListProps)` with `SessionListProps = { title: string; sessions: Session[]; showModes: boolean; mode: ViewMode; onMode(m: ViewMode): void; selectedId: string | null; onSelect(id: string): void; onOpenBar(): void; now: Date; month: YearMonth; day: string | null; onMonth(ym: YearMonth): void; onDay(key: string): void }`, `Calendar(props: { sessions: Session[]; month: YearMonth; day: string | null; now: Date; onMonth(ym: YearMonth): void; onDay(key: string): void })`.

Prop semantics: `sessions` is the scoped list, newest first, **before** the calendar's day filter. `SessionList` applies `listForView` itself, so the calendar can dot every day of the month. The header count is `sessions.length`.

Design source: README "2. Session list", prototype lines 176–240.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/SessionList.tsx` with the imports from Step 4 and:

```tsx
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const base = {
    title: 'All sessions', showModes: true, mode: 'list' as ViewMode, onMode: () => {}, selectedId: null,
    onSelect: () => {}, onOpenBar: () => {}, now, month: { year: 2026, month: 9 }, day: null, onMonth: () => {}, onDay: () => {},
  }
  const live = makeSession({ title: 'live-meeting', status: 'running', forks: 1, end: new Date(2026, 9, 6, 9, 12).toISOString() })
  const old = makeSession({ title: 'old pass', end: new Date(2026, 9, 3, 9, 0).toISOString(), repo: null, cwd: '/Users/me/code' })
  const render = (over: Partial<SessionListProps> = {}) => renderToStaticMarkup(<SessionList {...base} sessions={[live, old]} {...over} />)

  it('shows the scope title, the count, the command bar key and rows with time and location', () => {
    const html = render()
    expect(html).toContain('>All sessions<')
    expect(html).toContain('>2 sessions<')
    expect(html).toContain('⌘⇧P')
    expect(html).toContain('>9:12 AM<')
    expect(html).toContain('>3d<')
    expect(html).toContain('app · ~/code/app · 1 fork')
    expect(html).toContain('title="Running"')
  })
  it('shows the view switcher only when asked, labelling just the current view', () => {
    expect(render()).toContain('mode is-current')
    expect(render()).toContain('<span>List</span>')
    expect(render()).not.toContain('<span>Timeline</span>')
    expect(render({ showModes: false })).not.toContain('class="modes"')
  })
  it('puts start times in a column and groups by day in the timeline', () => {
    const html = render({ mode: 'timeline' })
    expect(html).toContain('row-time')
    expect(html).toContain('>Today<')
    expect(html).toContain('>Sat, Oct 3<')
  })
  it('lists only the selected day under the calendar', () => {
    const html = render({ mode: 'calendar', day: dayKey(new Date(2026, 9, 3)) })
    expect(html).toContain('October 2026')
    expect(html).toContain('old pass')
    expect(html).not.toContain('live-meeting')
  })
  it('says so when there is nothing to show', () => {
    expect(render({ sessions: [] })).toContain('No sessions here.')
  })
}
```

Run: `npx vitest run src/renderer/src/SessionList.tsx`
Expected: FAIL with `SessionList is not defined`.

- [ ] **Step 2: Write `SessionList.css`**

```css
.list {
  width: 380px;
  flex: none;
  display: flex;
  flex-direction: column;
  box-shadow: inset -1px 0 0 var(--app-divider);
}

.list-header {
  padding: 14px 16px 10px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  -webkit-app-region: drag;
}

.list-header > * {
  -webkit-app-region: no-drag;
}

.list-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 2px;
}

.list-title {
  font-size: 15px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-count {
  flex: 1;
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
}

.modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--app-radius-track);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
}

.mode {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--app-radius);
  color: var(--app-text-3);
  font-size: 13px;
  font-weight: 500;
}

.mode:hover {
  color: var(--app-text);
}

.mode.is-current {
  flex: 1 1 auto;
  background: var(--app-selected);
  color: var(--app-text);
}

.list-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 16px;
}

.group {
  display: flex;
  flex-direction: column;
}

.group-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 14px 10px 6px;
}

.group-label {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--app-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-count {
  font-size: 12px;
  color: var(--app-text-3);
}

.group-note {
  font-size: 11px;
  color: var(--app-yellow);
}

.row {
  display: grid;
  column-gap: 10px;
  align-items: start;
  padding: 10px;
  border-radius: var(--app-radius);
}

.row:hover {
  background: var(--app-wash);
}

.row.is-selected {
  background: var(--app-selected);
}

.row-time {
  font-size: 12px;
  line-height: 16px;
  color: var(--app-text-3);
}

.row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.row-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-ago {
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
}

.row-where {
  font-size: 12px;
  line-height: 16px;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-empty {
  padding: 48px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--app-text-3);
}
```

- [ ] **Step 3: Write `Calendar.tsx` and `Calendar.css`**

`src/renderer/src/Calendar.tsx`:
```tsx
import type { Session } from '../../shared/api'
import { attention } from '../../shared/format'
import { calendarCells, monthRange, type YearMonth } from '../../shared/views'
import { Icon } from './icons'
import './Calendar.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const index = (m: YearMonth) => m.year * 12 + m.month

export interface CalendarProps {
  sessions: Session[]
  month: YearMonth
  day: string | null
  now: Date
  onMonth(ym: YearMonth): void
  onDay(key: string): void
}

export function Calendar({ sessions, month, day, now, onMonth, onDay }: CalendarProps) {
  const cells = calendarCells(sessions, month, day, now)
  const range = monthRange(sessions)
  // Navigation stays within the first and last months that have sessions.
  const step = (delta: number) => {
    const n = index(month) + delta
    if (range && (n < index(range.first) || n > index(range.last))) return
    onMonth({ year: Math.floor(n / 12), month: n % 12 })
  }
  return (
    <div className="cal">
      <div className="cal-head">
        <span className="cal-title">{`${MONTHS[month.month]} ${month.year}`}</span>
        <span className="cal-nav" title="Previous month" onClick={() => step(-1)}>
          <span style={{ display: 'flex', transform: 'rotate(180deg)' }}>
            <Icon name="ArrowRight" size={12} />
          </span>
        </span>
        <span className="cal-nav" title="Next month" onClick={() => step(1)}>
          <Icon name="ArrowRight" size={12} />
        </span>
      </div>
      <div className="cal-grid">
        {DOW.map((d, i) => (
          <span key={i} className="cal-dow">{d}</span>
        ))}
        {cells.map((c) => (
          <div
            key={c.key}
            className={`cal-day${c.selected ? ' is-selected' : ''}${c.isToday && !c.selected ? ' is-today' : ''}`}
            onClick={() => onDay(c.key)}
          >
            <span
              className="cal-num tnum"
              style={{ color: c.selected ? 'var(--app-text)' : !c.inMonth ? 'var(--app-text-disabled)' : c.hasSessions ? 'var(--app-text-2)' : 'var(--app-text-3)' }}
            >
              {c.day}
            </span>
            <span className="cal-dots">
              {c.dots.map((st, i) => (
                <span key={i} className="cal-dot" style={{ background: (st && attention(st)?.color) || 'var(--app-text-3)' }} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

`src/renderer/src/Calendar.css`:
```css
.cal {
  padding: 4px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cal-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cal-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
}

.cal-nav {
  display: flex;
  padding: 4px;
  border-radius: var(--app-radius);
  color: var(--app-text-3);
}

.cal-nav:hover {
  background: var(--app-wash);
  color: var(--app-text);
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  row-gap: 2px;
}

.cal-dow {
  padding: 4px 0;
  text-align: center;
  font-size: 11px;
  color: var(--app-text-3);
}

.cal-day {
  height: 38px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: var(--app-radius);
}

.cal-day:hover {
  background: var(--app-wash);
}

.cal-day.is-selected {
  background: var(--app-selected);
}

.cal-day.is-today {
  box-shadow: inset 0 0 0 1px var(--app-border-strong);
}

.cal-num {
  font-size: 12px;
  line-height: 14px;
}

.cal-dots {
  display: flex;
  gap: 2px;
  height: 4px;
}

.cal-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
}
```

- [ ] **Step 4: Implement `SessionList.tsx` above the test block**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import type { IconName, Session } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { agoShort, attention, clock, plural, tildify } from '../../shared/format'
import { dayKey, groupSessions, listForView, type ViewMode, type YearMonth } from '../../shared/views'
import { Calendar } from './Calendar'
import { Icon } from './icons'
import './SessionList.css'

const MODES: { id: ViewMode; label: string; icon: IconName }[] = [
  { id: 'list', label: 'List', icon: 'ViewList' },
  { id: 'timeline', label: 'Timeline', icon: 'Timeline' },
  { id: 'repo', label: 'Repository', icon: 'Box' },
  { id: 'worktree', label: 'Worktree', icon: 'Layers' },
  { id: 'calendar', label: 'Calendar', icon: 'CalendarEmpty' },
]

export interface SessionListProps {
  title: string
  sessions: Session[]
  showModes: boolean
  mode: ViewMode
  onMode(m: ViewMode): void
  selectedId: string | null
  onSelect(id: string): void
  onOpenBar(): void
  now: Date
  month: YearMonth
  day: string | null
  onMonth(ym: YearMonth): void
  onDay(key: string): void
}

function Row({ s, mode, now, selected, onSelect }: { s: Session; mode: ViewMode; now: Date; selected: boolean; onSelect(id: string): void }) {
  const dot = attention(s.status)
  const timeline = mode === 'timeline'
  const where = `${mode !== 'repo' && s.repo ? `${s.repo.name} · ` : ''}${tildify(s.cwd)}${s.forks ? ` · ${plural(s.forks, 'fork')}` : ''}`
  return (
    <div
      className={selected ? 'row is-selected' : 'row'}
      style={{ gridTemplateColumns: timeline ? '58px minmax(0, 1fr)' : 'minmax(0, 1fr)' }}
      onClick={() => onSelect(s.id)}
    >
      {timeline && <span className="row-time tnum">{clock(new Date(s.end)).replace(' ', ' ')}</span>}
      <div className="row-main">
        <div className="row-line">
          {dot && <span className="dot" title={dot.label} style={{ background: dot.color }} />}
          <span className="row-title">{s.title}</span>
          {!timeline && <span className="row-ago">{agoShort(s.end, now)}</span>}
        </div>
        <span className="row-where">{where}</span>
      </div>
    </div>
  )
}

export function SessionList(p: SessionListProps) {
  const shown = listForView(p.sessions, p.mode, p.day)
  const groups = groupSessions(shown, p.mode, p.now)
  return (
    <section className="list">
      <header className="list-header">
        <div className="list-title-row">
          <span className="list-title">{p.title}</span>
          <span className="list-count">{plural(p.sessions.length, 'session')}</span>
          <span className="keycap" title="Command bar" onClick={p.onOpenBar}>⌘⇧P</span>
        </div>
        {p.showModes && (
          <div className="modes">
            {MODES.map((m) => (
              <div key={m.id} className={m.id === p.mode ? 'mode is-current' : 'mode'} title={m.label} onClick={() => p.onMode(m.id)}>
                <Icon name={m.icon} size={14} />
                {m.id === p.mode && <span>{m.label}</span>}
              </div>
            ))}
          </div>
        )}
      </header>
      <div className="list-body">
        {p.mode === 'calendar' && (
          <Calendar sessions={p.sessions} month={p.month} day={p.day} now={p.now} onMonth={p.onMonth} onDay={p.onDay} />
        )}
        {groups.map((g) => (
          <div key={g.key} className="group">
            {g.label && (
              <div className="group-header">
                <span className="group-label">{g.label}</span>
                <span className="group-count">{g.sessions.length}</span>
                {g.note && <span className="group-note">{g.note}</span>}
              </div>
            )}
            {g.sessions.map((s) => (
              <Row key={s.id} s={s} mode={p.mode} now={p.now} selected={s.id === p.selectedId} onSelect={p.onSelect} />
            ))}
          </div>
        ))}
        {shown.length === 0 && <div className="list-empty">No sessions here.</div>}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/renderer/src/SessionList.tsx && npm run typecheck`
Expected: 5 tests PASS, and typecheck exits 0. No commit (not a git repo).

### Task 12: Build the detail pane and usage block

**Files:**
- Create: `src/renderer/src/Detail.tsx`, `Detail.css`, `Usage.tsx`, `Usage.css`

**Interfaces:**
- Consumes: Task 7 (`format.ts`), Task 9 (`Button`).
- Produces: `CopiedKey = { id: string; what: 'resume' | 'fork' | 'pr' }` (exported from `Detail.tsx`), `Detail(props: DetailProps)` with `DetailProps = { session: Session; now: Date; copied: CopiedKey | null; teeOn: boolean; onResume(): void; onCopy(): void; onFork(): void; onOpenFolder(): void; onCopyPr(): void; onEnableTee(): void }`, `Usage(props: { session: Session; now: Date; teeOn: boolean; onEnableTee(): void })`, `facts(s: Session): { k: string; v: string; mono: boolean }[]`, `tiles(s: Session): { k: string; v: string; sub: string | null }[][]`.

Design source: README "3. Detail pane", prototype lines 241–322 and `selVm()` (lines 520–560). Differences from the prototype:
- Resume and Fork open the terminal: the App wires them in Task 14.
- "Copied" shows on Copy command or Fork when the App reports a clipboard fallback.
- Open folder is hidden when the cwd is gone.
- "Where it stopped", "Next" and "Files changed" are omitted when there is no data.
- Each changed file shows `+added −removed`.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/Detail.tsx` with the imports from Step 4 and:

```tsx
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const pr = { repo: 'alan-oliv/meetnotes', number: 27, url: 'https://github.com/alan-oliv/meetnotes/pull/27' }
  const noop = () => {}
  const handlers = { onResume: noop, onCopy: noop, onFork: noop, onOpenFolder: noop, onCopyPr: noop, onEnableTee: noop }

  it('lists facts in the handoff order, skipping rows without data', () => {
    const s = makeSession({
      branch: 'live-meeting', pr, forks: 1, named: true,
      worktree: { name: 'transcriptions', path: '/w', removedSeen: new Date(2026, 9, 2).toISOString() },
    })
    expect(facts(s)).toEqual([
      { k: 'Folder', v: '~/code/app', mono: true },
      { k: 'Repository', v: 'app · live-meeting', mono: false },
      { k: 'Worktree', v: 'transcriptions (removed Oct 2)', mono: false },
      { k: 'Pull request', v: 'alan-oliv/meetnotes#27', mono: false },
      { k: 'Title', v: 'Named. Resumes by name from any folder.', mono: false },
      { k: 'Forks', v: '1 branch of this conversation', mono: false },
      { k: 'Resuming', v: 'Over 100k tokens. After an hour idle, Claude offers to continue from a summary.', mono: false },
      { k: 'Kept until', v: 'Nov 5, then deleted by the 30-day cleanup', mono: false },
      { k: 'Session ID', v: s.id, mono: true },
    ])
    const plain = facts(makeSession({ repo: null, branch: null, usage: { ...makeSession().usage, contextUsed: 5000 } })).map((f) => f.k)
    expect(plain).toEqual(['Folder', 'Title', 'Kept until', 'Session ID'])
  })
  it('fills the four tile rows the way the prototype does', () => {
    expect(tiles(makeSession()).map((r) => r.map((t) => `${t.k}=${t.v}${t.sub ? ` ${t.sub}` : ''}`))).toEqual([
      ['In=150', 'Out=190.9k', 'Total=14.2M'],
      ['Cache hit=99.2%', 'Cache read=260.8k 99.2%', 'Cache write=2.2k 0.8%'],
      ['Cost=$5.08', 'Duration=40m', 'Lines=+524 −131'],
      ['Mode=Bypass permissions', 'Compactions=0', 'Agents=3'],
    ])
    const styled = makeSession({ usage: { ...makeSession().usage, outputStyle: 'architecture' } })
    expect(tiles(styled)[3][2]).toEqual({ k: 'Output style', v: 'architecture', sub: '3 agents' })
  })
  it('renders the title, the sub-line, the actions and the PR link', () => {
    const html = renderToStaticMarkup(<Detail session={makeSession({ title: 'live-meeting', pr })} now={now} copied={null} teeOn={false} {...handlers} />)
    expect(html).toContain('>live-meeting</h2>')
    expect(html).toContain('Today, 9:12 AM · Opus 5.5 · 6.1MB')
    for (const label of ['Resume', 'Copy command', 'Fork', 'Open folder', 'All sessions for #27']) expect(html).toContain(`>${label}<`)
  })
  it('swaps a label to Copied for the copy that just happened', () => {
    const s = makeSession({ pr })
    const html = renderToStaticMarkup(<Detail session={s} now={now} copied={{ id: s.id, what: 'pr' }} teeOn={false} {...handlers} />)
    expect(html).toContain('>Copied<')
    expect(html).toContain('>Copy command<')
    expect(html).not.toContain('All sessions for #27')
  })
  it('shows where it stopped, what is next and the changed files', () => {
    const s = makeSession({
      summary: { did: 'Streamed partial transcripts.', next: ['Finish speaker chips'] },
      files: [{ path: 'src/live/LiveMeetingView.tsx', added: 212, removed: 18 }],
    })
    const html = renderToStaticMarkup(<Detail session={s} now={now} copied={null} teeOn={false} {...handlers} />)
    expect(html).toContain('Where it stopped')
    expect(html).toContain('Finish speaker chips')
    expect(html).toContain('1 file changed')
    expect(html).toContain('+212 −18')
  })
  it('colours the context meter by how full it is and shows the plan line for live sessions', () => {
    const at = (used: number, extra: Partial<Session> = {}) =>
      renderToStaticMarkup(<Usage session={makeSession({ ...extra, usage: { ...makeSession().usage, contextUsed: used, ...(extra.usage ?? {}) } })} now={now} teeOn={false} onEnableTee={noop} />)
    expect(at(263_000)).toContain('var(--app-brand)')
    expect(at(650_000)).toContain('var(--app-yellow)')
    expect(at(850_000)).toContain('var(--app-orange)')
    expect(at(263_000)).toContain('263k / 1M')
    const plan = { usedPct: 32.9, resetsAt: new Date(2026, 9, 6, 15, 7).toISOString() }
    expect(at(263_000, { live: true, usage: { ...makeSession().usage, plan } })).toContain('32.9% of plan used · resets in 4h 7m')
    expect(at(263_000, { live: true })).toContain('Show plan usage')
    expect(at(263_000)).not.toContain('Show plan usage')
  })
}
```

Run: `npx vitest run src/renderer/src/Detail.tsx`
Expected: FAIL with `facts is not defined`.

- [ ] **Step 2: Write `Usage.tsx` and `Usage.css`**

`src/renderer/src/Usage.tsx`:
```tsx
import type { Session } from '../../shared/api'
import { compact, costLabel, durationLabel, modeLabel, modelLabel, resetsIn } from '../../shared/format'
import './Usage.css'

type Tile = { k: string; v: string; sub: string | null }

export function tiles(s: Session): Tile[][] {
  const u = s.usage
  const cache = u.cacheRead + u.cacheWrite
  const share = (n: number) => `${cache ? Math.round((n / cache) * 1000) / 10 : 0}%`
  const last: Tile = u.outputStyle
    ? { k: 'Output style', v: u.outputStyle, sub: u.agents ? `${u.agents} agents` : null }
    : { k: 'Agents', v: String(u.agents), sub: null }
  return [
    [{ k: 'In', v: compact(u.input), sub: null }, { k: 'Out', v: compact(u.output), sub: null }, { k: 'Total', v: compact(u.total), sub: null }],
    [
      { k: 'Cache hit', v: `${u.cacheHitPct}%`, sub: null },
      { k: 'Cache read', v: compact(u.cacheRead), sub: share(u.cacheRead) },
      { k: 'Cache write', v: compact(u.cacheWrite), sub: share(u.cacheWrite) },
    ],
    [
      { k: 'Cost', v: costLabel(u.cost), sub: null },
      { k: 'Duration', v: durationLabel(u.durationMs), sub: null },
      { k: 'Lines', v: `+${u.linesAdded} −${u.linesRemoved}`, sub: null },
    ],
    [{ k: 'Mode', v: modeLabel(s.permissionMode), sub: null }, { k: 'Compactions', v: String(u.compactions), sub: null }, last],
  ]
}

export function Usage({ session: s, now, teeOn, onEnableTee }: { session: Session; now: Date; teeOn: boolean; onEnableTee(): void }) {
  const u = s.usage
  const pct = u.contextMax ? Math.round((u.contextUsed / u.contextMax) * 100) : 0
  const fill = pct >= 80 ? 'var(--app-orange)' : pct >= 60 ? 'var(--app-yellow)' : 'var(--app-brand)'
  return (
    <div className="usage">
      <div className="usage-head">
        <span className="usage-label">Usage</span>
        <span className="usage-spacer" />
        <span className="usage-model">{modelLabel(s.model)}</span>
        {s.effort && <span className="usage-chip">{s.effort}</span>}
      </div>
      <div className="meter-block">
        <div className="meter-text">
          <span className="meter-name">Context</span>
          <span className="usage-spacer" />
          <span className="meter-value tnum">{`${compact(u.contextUsed)} / ${compact(u.contextMax)}`}</span>
          <span className="meter-pct tnum">{`${pct}%`}</span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: fill }} />
        </div>
        {u.plan && <span className="meter-note">{`${Math.round(u.plan.usedPct * 10) / 10}% of plan used · resets in ${resetsIn(u.plan.resetsAt, now)}`}</span>}
        {!u.plan && s.live && !teeOn && (
          <span className="meter-note meter-link" onClick={onEnableTee}>Show plan usage</span>
        )}
      </div>
      <div className="tiles">
        {tiles(s).map((row, i) => (
          <div key={i} className="tile-row">
            {row.map((t) => (
              <div key={t.k} className="tile">
                <span className="tile-k">{t.k}</span>
                <div className="tile-vrow">
                  <span className="tile-v tnum">{t.v}</span>
                  {t.sub && <span className="tile-sub">{t.sub}</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
```

`src/renderer/src/Usage.css`:
```css
.usage {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.usage-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.usage-spacer {
  flex: 1;
}

.usage-label {
  font-size: 12px;
  color: var(--app-text-3);
}

.usage-model {
  font-size: 12px;
  color: var(--app-text-2);
}

.usage-chip {
  font-size: 11px;
  line-height: 18px;
  padding: 0 6px;
  border-radius: var(--app-radius);
  box-shadow: inset 0 0 0 1px var(--app-border-strong);
  color: var(--app-text-2);
}

.meter-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meter-text {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}

.meter-name {
  color: var(--app-text-2);
}

.meter-value {
  color: var(--app-text);
}

.meter-pct {
  color: var(--app-text-3);
}

.meter {
  height: 6px;
  border-radius: var(--app-radius-meter);
  background: var(--app-elevated);
  box-shadow: inset 0 0 0 1px var(--app-border);
  overflow: hidden;
}

.meter-fill {
  height: 100%;
  border-radius: var(--app-radius-meter);
}

.meter-note {
  font-size: 12px;
  color: var(--app-text-3);
}

.meter-link {
  color: var(--app-link);
}

.meter-link:hover {
  color: var(--app-link-hover);
  text-decoration: underline;
}

.tiles {
  display: flex;
  flex-direction: column;
  border-radius: var(--app-radius);
  box-shadow: inset 0 0 0 1px var(--app-border);
}

.tile-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  box-shadow: inset 0 -1px 0 var(--app-divider);
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  min-width: 0;
  box-shadow: inset -1px 0 0 var(--app-divider);
}

.tile-k {
  font-size: 12px;
  line-height: 14px;
  color: var(--app-text-3);
}

.tile-vrow {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.tile-v {
  font-size: 15px;
  line-height: 18px;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-sub {
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
}
```

- [ ] **Step 3: Write `Detail.css`**

```css
.detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 72px 56px 40px;
}

.detail-inner {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.detail-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-title {
  margin: 0;
  font-size: 22px;
  line-height: 28px;
  font-weight: 500;
  color: var(--app-text);
  text-wrap: pretty;
  user-select: text;
}

.detail-when {
  font-size: 13px;
  color: var(--app-text-3);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-pr {
  margin-left: 6px;
  font-size: 12px;
  color: var(--app-link);
}

.detail-pr:hover {
  color: var(--app-link-hover);
  text-decoration: underline;
}

.facts {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  row-gap: 12px;
  column-gap: 16px;
  font-size: 13px;
  line-height: 18px;
}

.fact-k {
  color: var(--app-text-3);
}

.fact-v {
  min-width: 0;
  color: var(--app-text-2);
  word-break: normal;
  text-wrap: pretty;
  user-select: text;
}

.fact-v.mono {
  font-size: 12px;
  word-break: break-all;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-label {
  font-size: 12px;
  color: var(--app-text-3);
}

.prose {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--app-text-2);
  text-wrap: pretty;
  user-select: text;
}

.file {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.file-path {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--app-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-delta {
  font-size: 12px;
  line-height: 18px;
  color: var(--app-text-3);
  white-space: nowrap;
}
```

- [ ] **Step 4: Implement `Detail.tsx` above the test block**

```tsx
import { Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { agoLong, fileSize, modelLabel, monthDay, plural, tildify } from '../../shared/format'
import { Button } from './Button'
import { Usage } from './Usage'
import './Detail.css'

export interface CopiedKey {
  id: string
  what: 'resume' | 'fork' | 'pr'
}

export interface DetailProps {
  session: Session
  now: Date
  copied: CopiedKey | null
  teeOn: boolean
  onResume(): void
  onCopy(): void
  onFork(): void
  onOpenFolder(): void
  onCopyPr(): void
  onEnableTee(): void
}

const DAY_MS = 86_400_000

export function facts(s: Session): { k: string; v: string; mono: boolean }[] {
  const out = [{ k: 'Folder', v: `${tildify(s.cwd)}${!s.cwdExists && !s.worktree ? ' (removed)' : ''}`, mono: true }]
  if (s.repo) out.push({ k: 'Repository', v: `${s.repo.name}${s.branch && s.branch !== 'HEAD' ? ` · ${s.branch}` : ''}`, mono: false })
  if (s.worktree) {
    const gone = s.worktree.removedSeen ? ` (removed ${monthDay(new Date(s.worktree.removedSeen))})` : ''
    out.push({ k: 'Worktree', v: `${s.worktree.name}${gone}`, mono: false })
  }
  if (s.pr) out.push({ k: 'Pull request', v: `${s.pr.repo}#${s.pr.number}`, mono: false })
  out.push({
    k: 'Title',
    v: s.named ? 'Named. Resumes by name from any folder.' : 'Generated from the first prompt. Rename to resume it by name.',
    mono: false,
  })
  if (s.forks) out.push({ k: 'Forks', v: `${s.forks} ${s.forks === 1 ? 'branch' : 'branches'} of this conversation`, mono: false })
  if (s.usage.contextUsed > 100_000) {
    out.push({ k: 'Resuming', v: 'Over 100k tokens. After an hour idle, Claude offers to continue from a summary.', mono: false })
  }
  const days = Math.round((Date.parse(s.keptUntil) - Date.parse(s.end)) / DAY_MS)
  out.push({ k: 'Kept until', v: `${monthDay(new Date(s.keptUntil))}, then deleted by the ${days}-day cleanup`, mono: false })
  out.push({ k: 'Session ID', v: s.id, mono: true })
  return out
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-section">
      <span className="detail-label">{label}</span>
      {children}
    </div>
  )
}

export function Detail(p: DetailProps) {
  const s = p.session
  const copied = (what: CopiedKey['what']) => p.copied?.id === s.id && p.copied.what === what
  return (
    <main className="detail">
      <div className="detail-inner">
        <div className="detail-head">
          <h2 className="detail-title">{s.title}</h2>
          <span className="detail-when">{`${agoLong(s.end, p.now)} · ${modelLabel(s.model)} · ${fileSize(s.sizeBytes)}`}</span>
        </div>
        <div className="detail-actions">
          <Button kind="primary" onClick={p.onResume} title="Opens claude --resume in your terminal">Resume</Button>
          <Button kind="secondary" onClick={p.onCopy}>{copied('resume') ? 'Copied' : 'Copy command'}</Button>
          <Button kind="secondary" onClick={p.onFork} title="Opens claude --resume … --fork-session in your terminal">
            {copied('fork') ? 'Copied' : 'Fork'}
          </Button>
          {s.cwdExists && <Button kind="secondary" onClick={p.onOpenFolder}>Open folder</Button>}
          {s.pr && (
            <span className="detail-pr" title="Copies claude --from-pr" onClick={p.onCopyPr}>
              {copied('pr') ? 'Copied' : `All sessions for #${s.pr.number}`}
            </span>
          )}
        </div>
        <div className="facts">
          {facts(s).map((f) => (
            <Fragment key={f.k}>
              <span className="fact-k">{f.k}</span>
              <span className={f.mono ? 'fact-v mono' : 'fact-v'}>{f.v}</span>
            </Fragment>
          ))}
        </div>
        <Usage session={s} now={p.now} teeOn={p.teeOn} onEnableTee={p.onEnableTee} />
        {s.summary?.did && (
          <Section label="Where it stopped">
            <p className="prose">{s.summary.did}</p>
          </Section>
        )}
        {s.summary && s.summary.next.length > 0 && (
          <Section label="Next">
            {s.summary.next.map((n) => (
              <span key={n} className="prose">{n}</span>
            ))}
          </Section>
        )}
        {s.files.length > 0 && (
          <Section label={`${plural(s.files.length, 'file')} changed`}>
            {s.files.map((f) => (
              <div key={f.path} className="file">
                <span className="file-path mono">{f.path}</span>
                <span className="file-delta tnum">{`+${f.added} −${f.removed}`}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </main>
  )
}
```

The test block uses `Usage` and `Session` through these top-level imports.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/renderer/src/Detail.tsx && npm run typecheck`
Expected: 6 tests PASS, and typecheck exits 0. No commit (not a git repo).

### Task 13: Build the command bar

**Files:**
- Create: `src/renderer/src/CommandBar.tsx`, `src/renderer/src/CommandBar.css`

**Interfaces:**
- Consumes: Task 8 (`search`, `KINDS`, `kindById`, `detectKind`, `Result`, `ResultGroup`, `KindId`), Task 7 (`format.ts`), Task 9 (`Icon`).
- Produces (exported from `CommandBar.tsx`): `BarOpen = { kind: KindId; query: string }`, `BarAction` (union below), `CommandBar(props: { open: BarOpen; sessions: Session[]; selected: Session | null; settings: Settings; now: Date; note: string | null; onClose(): void; onAction(a: BarAction): void })`.
- Produces (exact):
  ```ts
  export type BarAction =
    | { type: 'select'; id: string }
    | { type: 'resume'; id: string; fork: boolean }
    | { type: 'copy'; id: string; what: 'resume' | 'fork' | 'pr'; text: string }
    | { type: 'openFolder'; id: string }
    | { type: 'openPr'; id: string }
    | { type: 'showRepo'; id: string }
    | { type: 'archive'; id: string; archived: boolean }
    | { type: 'rename'; id: string; title: string }
    | { type: 'terminal'; terminal: Terminal }
    | { type: 'tee'; enabled: boolean }
  ```
  The bar never closes itself after an action. The App decides per `BarAction` (Task 14). Switching kinds (`> Rename session`, `> Change terminal`, picking an option) happens inside the bar. The App re-mounts the bar with a new `key` whenever it opens it on a different `BarOpen`.

Design source: README "4. Command bar" and "Search kinds", prototype lines 36–130 (markup) and 345–440 (`pVals()`: keyboard, activation, previews, footer).

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/CommandBar.tsx` with the imports from Step 3 and:

```tsx
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const settings: Settings = { terminal: 'iterm', archived: [], statusTee: false }
  const s = makeSession({
    title: 'live-meeting',
    artifacts: [{ name: 'veracity-report.md', kind: 'markdown', path: '/Users/me/code/app/r.md', bytes: 9000, preview: '# Veracity report' }],
  })
  const render = (open: BarOpen, over: Partial<CommandBarProps> = {}) =>
    renderToStaticMarkup(<CommandBar open={open} sessions={[s]} selected={s} settings={settings} now={now} note={null} onClose={() => {}} onAction={() => {}} {...over} />)

  it('opens on the search kinds and recent sessions with the plain search placeholder', () => {
    const html = render({ kind: 'sessions', query: '' })
    expect(html).toContain('Search sessions, or type / for search kinds')
    expect(html).toContain('>Search kinds<')
    expect(html).toContain('>Recent<')
    expect(html).toContain('>Choose<')
    expect(html).not.toContain('bar-chip')
  })
  it('shows the active kind as a chip with its own placeholder', () => {
    const html = render({ kind: 'files', query: '' })
    expect(html).toContain('bar-chip')
    expect(html).toContain('Find sessions by a file they changed…')
  })
  it('previews an action with the session it runs on and the exact command', () => {
    const html = render({ kind: 'actions', query: '' })
    expect(html).toContain('Actions on “live-meeting”')
    expect(html).toContain('>Runs on<')
    expect(html).toContain(`claude --resume ${s.id}`)
    expect(html).toContain('>Run<')
  })
  it('previews an artifact with its path and content', () => {
    const html = render({ kind: 'artifacts', query: 'veracity' })
    expect(html).toContain('~/code/app/r.md')
    expect(html).toContain('<pre class="bar-pre"># Veracity report</pre>')
  })
  it('says nothing is close when Ask finds no match', () => {
    expect(render({ kind: 'ask', query: 'kubernetes billing' })).toContain('Nothing close. Try different words or a file name.')
  })
  it('refuses to rename a running session and shows errors from the app in the footer', () => {
    expect(render({ kind: 'rename', query: 'x' }, { selected: { ...s, live: true } })).toContain("Can&#x27;t rename a running session")
    expect(render({ kind: 'sessions', query: '' }, { note: 'Unknown session' })).toContain('Unknown session')
  })
  it('maps each highlighted result to a kind switch or an app action', () => {
    const groups = search([s], 'actions', '', { now, selected: s, settings })
    const byAction = (id: string) => groups[0].results.find((r) => r.type === 'action' && r.action === id)!
    expect(activate(byAction('fork'))).toEqual({ type: 'emit', action: { type: 'resume', id: s.id, fork: true } })
    expect(activate(byAction('copy'))).toEqual({ type: 'emit', action: { type: 'copy', id: s.id, what: 'resume', text: `claude --resume ${s.id}` }, copied: true })
    expect(activate(byAction('rename'))).toEqual({ type: 'kind', kind: 'rename', query: 'live-meeting' })
    expect(activate(byAction('changeTerminal'))).toEqual({ type: 'kind', kind: 'terminal', query: '' })
    expect(activate(byAction('archive'))).toEqual({ type: 'emit', action: { type: 'archive', id: s.id, archived: true } })
    expect(activate(byAction('teeOn'))).toEqual({ type: 'emit', action: { type: 'tee', enabled: true } })
    const recent = search([s], 'sessions', '', { now, selected: s, settings })
    expect(activate(recent[0].results[0])).toEqual({ type: 'kind', kind: 'ask', query: '' })
    expect(activate(recent[1].results[0])).toEqual({ type: 'emit', action: { type: 'resume', id: s.id, fork: false } })
    const term = search([s], 'terminal', '', { now, selected: s, settings })[0].results[1]
    expect(activate(term)).toEqual({ type: 'emit', action: { type: 'terminal', terminal: 'warp' } })
  })
}
```

Run: `npx vitest run src/renderer/src/CommandBar.tsx`
Expected: FAIL with `CommandBar is not defined`.

- [ ] **Step 2: Write `CommandBar.css`**

```css
.bar-scrim {
  position: fixed;
  inset: 0;
  z-index: 10;
  background: var(--app-scrim);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 96px;
}

.bar {
  width: 780px;
  height: 500px;
  display: flex;
  flex-direction: column;
  border-radius: var(--app-radius-panel);
  overflow: hidden;
  background: var(--app-modal);
  box-shadow: inset 0 0 0 1px var(--app-border-strong), var(--app-shadow-panel);
}

.bar-input-row {
  height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  box-shadow: inset 0 -1px 0 var(--app-divider);
}

.bar-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--app-radius);
  background: var(--app-selected);
  font-size: 12px;
  color: var(--app-text);
  white-space: nowrap;
}

.bar-search {
  color: var(--app-text-3);
}

.bar-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: var(--app-text);
}

.bar-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.bar-results {
  width: 380px;
  flex: none;
  overflow-y: auto;
  padding: 6px;
  box-shadow: inset -1px 0 0 var(--app-divider);
}

.bar-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.bar-group-label {
  padding: 10px 10px 6px;
  font-size: 12px;
  line-height: 16px;
  color: var(--app-text-3);
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--app-radius);
}

.bar-row.is-active {
  background: var(--app-selected);
}

.bar-row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.bar-row-title,
.bar-row-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-row-title {
  font-size: 13px;
  line-height: 16px;
  color: var(--app-text);
}

.bar-row-sub {
  font-size: 12px;
  line-height: 16px;
  color: var(--app-text-3);
}

.bar-row .keycap {
  font-family: var(--app-mono);
  color: var(--app-text-2);
}

.bar-row-right {
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
}

.bar-empty {
  padding: 40px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--app-text-3);
}

.bar-preview {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 22px;
}

.pv {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pv-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pv-kind-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-text-2);
}

.pv-title {
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  color: var(--app-text);
  text-wrap: pretty;
}

.pv-when,
.pv-label {
  font-size: 12px;
  color: var(--app-text-3);
}

.pv-prose {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--app-text-2);
  text-wrap: pretty;
}

.pv-examples {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pv-example {
  align-self: flex-start;
  padding: 5px 8px;
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
  font-family: var(--app-mono);
  font-size: 12px;
  color: var(--app-text-2);
}

.pv-example:hover {
  color: var(--app-text);
  box-shadow: inset 0 0 0 1px var(--app-border-hover);
}

.pv-reason {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
  font-size: 12px;
  line-height: 18px;
  color: var(--app-text-2);
}

.pv-reason-icon {
  display: flex;
  padding-top: 2px;
  color: var(--app-link);
}

.pv-facts {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  row-gap: 8px;
  column-gap: 12px;
  font-size: 12px;
  line-height: 16px;
}

.pv-facts > :nth-child(odd) {
  color: var(--app-text-3);
}

.pv-facts > :nth-child(even) {
  min-width: 0;
  color: var(--app-text-2);
  word-break: break-all;
}

.pv-path {
  font-family: var(--app-mono);
  font-size: 11px;
  line-height: 16px;
  color: var(--app-text-3);
  word-break: break-all;
}

.bar-pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
  font-family: var(--app-mono);
  font-size: 12px;
  line-height: 18px;
  color: var(--app-text-2);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.pv-detail {
  font-family: var(--app-mono);
  font-size: 12px;
  line-height: 18px;
  color: var(--app-text-2);
  word-break: break-all;
}

.bar-footer {
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 12px 0 16px;
  box-shadow: inset 0 1px 0 var(--app-divider);
  font-size: 12px;
  color: var(--app-text-3);
}

.bar-footer-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bar-footer-primary {
  color: var(--app-text-2);
}

.bar-footer-spacer {
  flex: 1;
}

.bar-footer-divider {
  width: 1px;
  height: 14px;
  background: var(--app-divider);
}

.bar-footer .keycap:hover {
  color: var(--app-text-3);
}
```

- [ ] **Step 3: Implement `CommandBar.tsx` above the test block**

```tsx
import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { IconName, Session, Settings, Terminal } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { agoLong, fileSize, tildify } from '../../shared/format'
import { detectKind, kindById, search, type Kind, type KindId, type Result } from '../../shared/search'
import { Icon } from './icons'
import './CommandBar.css'

export interface BarOpen {
  kind: KindId
  query: string
}

export type BarAction =
  | { type: 'select'; id: string }
  | { type: 'resume'; id: string; fork: boolean }
  | { type: 'copy'; id: string; what: 'resume' | 'fork' | 'pr'; text: string }
  | { type: 'openFolder'; id: string }
  | { type: 'openPr'; id: string }
  | { type: 'showRepo'; id: string }
  | { type: 'archive'; id: string; archived: boolean }
  | { type: 'rename'; id: string; title: string }
  | { type: 'terminal'; terminal: Terminal }
  | { type: 'tee'; enabled: boolean }

export interface CommandBarProps {
  open: BarOpen
  sessions: Session[]
  selected: Session | null
  settings: Settings
  now: Date
  note: string | null
  onClose(): void
  onAction(a: BarAction): void
}

type Step = { type: 'kind'; kind: KindId; query: string } | { type: 'emit'; action: BarAction; copied?: true }

export function activate(r: Result): Step {
  switch (r.type) {
    case 'kind':
      return { type: 'kind', kind: r.kind.id, query: '' }
    case 'option':
      return { type: 'kind', kind: r.fill.kind, query: r.fill.query }
    case 'session':
      return { type: 'emit', action: { type: 'resume', id: r.session.id, fork: false } }
    case 'terminal':
      return { type: 'emit', action: { type: 'terminal', terminal: r.terminal } }
    case 'action': {
      const id = r.session.id
      switch (r.action) {
        case 'resume':
          return { type: 'emit', action: { type: 'resume', id, fork: false } }
        case 'fork':
          return { type: 'emit', action: { type: 'resume', id, fork: true } }
        case 'copy':
          return { type: 'emit', action: { type: 'copy', id, what: 'resume', text: r.detail }, copied: true }
        case 'copyPr':
          return { type: 'emit', action: { type: 'copy', id, what: 'pr', text: r.detail }, copied: true }
        case 'openFolder':
          return { type: 'emit', action: { type: 'openFolder', id } }
        case 'openPr':
          return { type: 'emit', action: { type: 'openPr', id } }
        case 'showRepo':
          return { type: 'emit', action: { type: 'showRepo', id } }
        case 'archive':
          return { type: 'emit', action: { type: 'archive', id, archived: true } }
        case 'unarchive':
          return { type: 'emit', action: { type: 'archive', id, archived: false } }
        case 'rename':
          return { type: 'kind', kind: 'rename', query: r.session.title }
        case 'changeTerminal':
          return { type: 'kind', kind: 'terminal', query: '' }
        case 'teeOn':
          return { type: 'emit', action: { type: 'tee', enabled: true } }
        case 'teeOff':
          return { type: 'emit', action: { type: 'tee', enabled: false } }
      }
    }
  }
}

const primaryVerb = (kind: KindId, cur: Result | undefined): string => {
  if (kind === 'rename') return 'Rename'
  if (!cur) return 'Resume'
  if (cur.type === 'session') return 'Resume'
  if (cur.type === 'action') return 'Run'
  return 'Choose'
}

function Preview({ cur, kind, now, onExample }: { cur: Result | undefined; kind: Kind; now: Date; onExample(e: string): void }) {
  if (cur?.type === 'session' && cur.artifact) {
    const a = cur.artifact
    return (
      <div className="pv">
        <div className="pv-head">
          <span className="pv-title">{a.name}</span>
          <span className="pv-when">{`${a.kind} · ${fileSize(a.bytes)} · from “${cur.session.title}”`}</span>
        </div>
        <span className="pv-path">{tildify(a.path)}</span>
        {a.preview && <pre className="bar-pre">{a.preview}</pre>}
      </div>
    )
  }
  if (cur?.type === 'session') {
    const s = cur.session
    const rows: [string, string, boolean][] = [['Folder', tildify(s.cwd), true]]
    if (s.repo) rows.push(['Repo', `${s.repo.name}${s.branch && s.branch !== 'HEAD' ? ` · ${s.branch}` : ''}`, false])
    if (s.pr) rows.push(['PR', `${s.pr.repo}#${s.pr.number}`, false])
    return (
      <div className="pv">
        <div className="pv-head">
          <span className="pv-title">{s.title}</span>
          <span className="pv-when">{`${agoLong(s.end, now)} · ${fileSize(s.sizeBytes)}`}</span>
        </div>
        {cur.reason && (
          <div className="pv-reason">
            <span className="pv-reason-icon"><Icon name="Bolt" size={12} /></span>
            <span>{cur.reason}</span>
          </div>
        )}
        <div className="pv-facts">
          {rows.map(([k, v, mono]) => [
            <span key={`${k}-k`}>{k}</span>,
            <span key={`${k}-v`} className={mono ? 'mono' : undefined}>{v}</span>,
          ])}
        </div>
        {s.summary?.did && <p className="pv-prose">{s.summary.did}</p>}
      </div>
    )
  }
  if (cur?.type === 'action') {
    return (
      <div className="pv">
        <span className="pv-label">Runs on</span>
        <span className="pv-title">{cur.session.title}</span>
        <span className="pv-detail">{cur.detail}</span>
      </div>
    )
  }
  const k = cur?.type === 'kind' ? cur.kind : kind
  return (
    <div className="pv">
      <div className="pv-kind-head">
        <Icon name={k.icon} size={16} />
        <span className="pv-title">{k.label}</span>
      </div>
      <p className="pv-prose">{k.desc}</p>
      {k.examples.length > 0 && (
        <div className="pv-examples">
          <span className="pv-label">Try</span>
          {k.examples.map((e) => (
            <span
              key={e}
              className="pv-example"
              onClick={(ev) => {
                ev.stopPropagation()
                onExample(e)
              }}
            >
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function CommandBar(p: CommandBarProps) {
  const [kindId, setKindId] = useState<KindId>(p.open.kind)
  const [query, setQuery] = useState(p.open.query)
  const [idx, setIdx] = useState(0)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const kind = kindById(kindId)

  const groups = search(p.sessions, kindId, query, { now: p.now, selected: p.selected, settings: p.settings })
  const flat = groups.flatMap((g) => g.results)
  const cur = flat[Math.min(idx, Math.max(0, flat.length - 1))]
  const renameBlocked = kindId === 'rename' && !!p.selected?.live

  useEffect(() => {
    listRef.current?.querySelector('.bar-row.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const setKind = (id: KindId, q = '') => {
    setKindId(id)
    setQuery(q)
    setIdx(0)
    setCopied(false)
  }
  const run = (r: Result | undefined) => {
    if (!r) return
    const step = activate(r)
    if (step.type === 'kind') return setKind(step.kind, step.query)
    setCopied(!!step.copied)
    p.onAction(step.action)
  }
  const onEnter = () => {
    if (kindId === 'rename') {
      if (p.selected && !renameBlocked) p.onAction({ type: 'rename', id: p.selected.id, title: query })
      return
    }
    run(cur)
  }
  const onExample = (e: string) => {
    const d = detectKind(e)
    if (d) setKind(d.kind, d.rest)
    else setKind('sessions', e)
  }

  const footIcon: IconName = copied ? 'Check' : kind.icon
  const footLabel = p.note ?? (renameBlocked ? "Can't rename a running session" : copied ? 'Copied resume command' : kind.label)
  const emptyText =
    kindId === 'ask' ? 'Nothing close. Try different words or a file name.'
    : kindId === 'rename' ? (p.selected ? `Press ↵ to rename “${p.selected.title}”.` : 'Select a session first.')
    : 'No matches.'

  return (
    <div className="bar-scrim" onClick={p.onClose}>
      <div className="bar" onClick={(e) => e.stopPropagation()}>
        <div className="bar-input-row">
          {kindId === 'sessions' ? (
            <span className="bar-search"><Icon name="Search1" size={16} /></span>
          ) : (
            <span className="bar-chip" title="Remove search kind" onClick={() => setKind('sessions', query)}>
              <Icon name={kind.icon} size={12} />
              {kind.label}
            </span>
          )}
          <input
            className="bar-input"
            autoFocus
            value={query}
            placeholder={kindId === 'sessions' ? 'Search sessions, or type / for search kinds' : `${kind.desc.split('.')[0]}…`}
            onChange={(e) => {
              const v = e.target.value
              const d = kindId === 'sessions' ? detectKind(v) : null
              if (d) return setKind(d.kind, d.rest)
              setQuery(v)
              setIdx(0)
              setCopied(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(flat.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                onEnter()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                if (kindId !== 'sessions') setKind('sessions')
                else p.onClose()
              } else if (e.key === 'Backspace' && !query && kindId !== 'sessions') {
                e.preventDefault()
                setKind('sessions')
              }
            }}
          />
          <span className="keycap">esc</span>
        </div>
        <div className="bar-body">
          <div className="bar-results" ref={listRef}>
            {groups.map((g) => (
              <div key={g.label} className="bar-group">
                <div className="bar-group-label">{g.label}</div>
                {g.results.map((r) => {
                  const i = flat.indexOf(r)
                  return (
                    <div
                      key={r.key}
                      className={r === cur ? 'bar-row is-active' : 'bar-row'}
                      onMouseMove={() => {
                        if (i !== idx) setIdx(i)
                      }}
                      onClick={() => (r.type === 'session' ? p.onAction({ type: 'select', id: r.session.id }) : run(r))}
                    >
                      <span style={{ display: 'flex', color: r.iconColor }}><Icon name={r.icon} size={14} /></span>
                      <div className="bar-row-text">
                        <span className="bar-row-title">{r.title}</span>
                        {r.sub && <span className={r.mono ? 'bar-row-sub mono' : 'bar-row-sub'}>{r.sub}</span>}
                      </div>
                      {r.keycap && <span className="keycap">{r.keycap}</span>}
                      {r.right && <span className="bar-row-right">{r.right}</span>}
                    </div>
                  )
                })}
              </div>
            ))}
            {flat.length === 0 && <div className="bar-empty">{emptyText}</div>}
          </div>
          <div className="bar-preview">
            <Preview cur={cur} kind={kind} now={p.now} onExample={onExample} />
          </div>
        </div>
        <div className="bar-footer">
          <span className="bar-footer-item"><Icon name={footIcon} size={12} />{footLabel}</span>
          <span className="bar-footer-spacer" />
          <span className="bar-footer-item bar-footer-primary">{primaryVerb(kindId, cur)}<span className="keycap">↵</span></span>
          <span className="bar-footer-divider" />
          <span className="bar-footer-item">Search kinds<span className="keycap">/</span></span>
          <span className="bar-footer-item">Actions<span className="keycap">&gt;</span></span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/renderer/src/CommandBar.tsx && npm run typecheck`
Expected: 7 tests PASS, and typecheck exits 0. If TypeScript says `activate` can fall through, the nested `switch` is not exhaustive over `ActionId`: add the missing case rather than a `default`. No commit (not a git repo).

### Task 14: Compose the app and verify it against real sessions

**Files:**
- Create: `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/App.css`

**Interfaces:**
- Consumes: every renderer component (Tasks 10–13) with `CopiedKey` from `Detail.tsx` and `BarOpen`/`BarAction` from `CommandBar.tsx`, Task 7 (`buildTree`, `visible`, `inScope`, `scopeTitle`, `defaultExpanded`, `listForView`, `byRecent`, `latestDay`, `dayKey`), Task 9 hooks and `errorText`, Task 1 `prCommand`, `resumeCommand`.
- Produces: the running app (`npm run dev`), and `Deck(props: { all: Session[]; settings: Settings; now: Date })`, the testable body of `App`.

What `App` owns, per the handoff's "State Management":
- **View state:** scope, expanded repos, view mode, calendar month and day, the selected id, the bar (`BarOpen` + mount `seq`), the footer note, and `copied` (cleared after 1.6 s).
- **Selection:** the derived session is `selectedId`'s session, else the first listed one. When the list itself changes and no longer holds `selectedId`, the id resets. Selecting a hidden or archived session from the bar therefore sticks until the list changes, so `is:archived` → select → `> Unarchive` works.
- **Resume:** call `resumeSession`. `needsTerminal` → remember `{ id, fork }` and open the bar on the `terminal` kind. Choosing a terminal saves it and runs the remembered resume. `copied` → flash "Copied" on Copy command or Fork.
- **Errors:** an error from any call goes to the bar footer, opening the bar if it is closed, so it is never silent.

- [ ] **Step 1: Write the page, the entry point and the layout CSS**

`src/renderer/index.html`. The CSP follows electron-vite's template:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:"
    />
    <title>Session Deck</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import './tokens.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
```

`src/renderer/src/App.css`:
```css
.app {
  height: 100%;
  display: flex;
  position: relative;
  background: var(--app-bg);
}

.app-drag {
  position: fixed;
  top: 0;
  left: 600px;
  right: 0;
  height: 38px;
  -webkit-app-region: drag;
}

.app-loading {
  height: 100%;
  background: var(--app-bg);
}
```

- [ ] **Step 2: Write the failing composition test**

Create `src/renderer/src/App.tsx` with the imports from Step 3 and:

```tsx
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const settings: Settings = { terminal: null, archived: [], statusTee: false }
  it('shows the tree, the list with its view switcher and the newest session in the detail pane', () => {
    const newest = makeSession({ title: 'live-meeting', end: new Date(2026, 9, 6, 9, 12).toISOString() })
    const older = makeSession({ title: 'perf pass', end: new Date(2026, 9, 5).toISOString() })
    const html = renderToStaticMarkup(<Deck all={[older, newest, makeSession({ title: 'sdk run', hidden: true })]} settings={settings} now={now} />)
    expect(html).toContain('All sessions')
    expect(html).toContain('class="modes"')
    expect(html).toContain('>live-meeting</h2>')
    expect(html).toContain('>2 sessions<')
    expect(html).not.toContain('sdk run')
  })
  it('shows the empty list and no detail when there are no sessions', () => {
    const html = renderToStaticMarkup(<Deck all={[]} settings={settings} now={now} />)
    expect(html).toContain('No sessions here.')
    expect(html).not.toContain('<h2')
  })
}
```

Run: `npx vitest run src/renderer/src/App.tsx`
Expected: FAIL with `Deck is not defined`.

- [ ] **Step 3: Implement `App.tsx` above the test block**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prCommand, resumeCommand, type Session, type Settings } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { buildTree, defaultExpanded, inScope, scopeTitle, visible, type Scope } from '../../shared/tree'
import { byRecent, dayKey, latestDay, listForView, type ViewMode, type YearMonth } from '../../shared/views'
import { CommandBar, type BarAction, type BarOpen } from './CommandBar'
import { Detail, type CopiedKey } from './Detail'
import { errorText, useNow, useSessions, useSettings } from './hooks'
import { SessionList } from './SessionList'
import { Sidebar } from './Sidebar'
import './App.css'

const COPIED_MS = 1600

export function App() {
  const sessions = useSessions()
  const settings = useSettings()
  const now = useNow()
  return sessions && settings ? <Deck all={sessions} settings={settings} now={now} /> : <div className="app-loading" />
}

export function Deck({ all, settings, now }: { all: Session[]; settings: Settings; now: Date }) {
  const shown = useMemo(() => byRecent(visible(all)), [all])
  const tree = useMemo(() => buildTree(shown), [shown])
  const [scope, setScope] = useState<Scope>({ type: 'all' })
  const [expanded, setExpanded] = useState<Record<string, boolean> | null>(null)
  const [mode, setMode] = useState<ViewMode>('list')
  const [month, setMonth] = useState<YearMonth | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bar, setBar] = useState<{ open: BarOpen; seq: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState<CopiedKey | null>(null)
  const barSeq = useRef(0)
  const pending = useRef<{ id: string; fork: boolean } | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const open = expanded ?? defaultExpanded(tree)
  const viewMode: ViewMode = scope.type === 'all' ? mode : 'list'
  const scoped = shown.filter((s) => inScope(s, scope))
  const latest = latestDay(scoped)
  const calMonth = month ?? (latest ? { year: latest.getFullYear(), month: latest.getMonth() } : { year: now.getFullYear(), month: now.getMonth() })
  const calDay = day ?? (latest ? dayKey(latest) : null)
  const listed = listForView(scoped, viewMode, calDay)
  const selected = all.find((s) => s.id === selectedId) ?? listed[0] ?? null
  const listKey = listed.map((s) => s.id).join(',')

  useEffect(() => {
    if (selectedId && !listed.some((s) => s.id === selectedId)) setSelectedId(null)
  }, [listKey])

  const openBar = (o: BarOpen) => {
    barSeq.current += 1
    setNote(null)
    setBar({ open: o, seq: barSeq.current })
  }
  const closeBar = () => setBar(null)
  const fail = (e: unknown) => {
    if (!bar) openBar({ kind: 'sessions', query: '' })
    setNote(errorText(e))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setNote(null)
        setBar((b) => {
          if (b) return null
          barSeq.current += 1
          return { open: { kind: 'sessions', query: '' }, seq: barSeq.current }
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const flash = (key: CopiedKey) => {
    setCopied(key)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), COPIED_MS)
  }
  const copy = (id: string, what: CopiedKey['what'], text: string) => {
    void navigator.clipboard.writeText(text)
    flash({ id, what })
  }
  const resume = async (id: string, fork: boolean) => {
    try {
      const r = await window.api.resumeSession(id, { fork })
      if (r.ok) return
      if ('needsTerminal' in r) {
        pending.current = { id, fork }
        openBar({ kind: 'terminal', query: '' })
        return
      }
      flash({ id, what: fork ? 'fork' : 'resume' })
    } catch (e) {
      fail(e)
    }
  }
  const call = async (fn: () => Promise<unknown>, after?: () => void) => {
    try {
      await fn()
      after?.()
    } catch (e) {
      fail(e)
    }
  }

  const onAction = async (a: BarAction) => {
    setNote(null)
    switch (a.type) {
      case 'select':
        setSelectedId(a.id)
        return closeBar()
      case 'resume':
        setSelectedId(a.id)
        closeBar()
        return resume(a.id, a.fork)
      case 'copy':
        return copy(a.id, a.what, a.text)
      case 'openFolder':
        return call(() => window.api.openFolder(a.id), closeBar)
      case 'openPr':
        return call(() => window.api.openPr(a.id), closeBar)
      case 'showRepo': {
        const s = all.find((x) => x.id === a.id)
        if (s?.repo) {
          setScope({ type: 'repo', repo: s.repo.root })
          setExpanded({ ...open, [s.repo.root]: true })
        }
        return closeBar()
      }
      case 'archive':
        return call(() => window.api.setArchived(a.id, a.archived), closeBar)
      case 'rename':
        return call(() => window.api.renameSession(a.id, a.title), closeBar)
      case 'tee':
        return call(() => window.api.setStatusTee(a.enabled), closeBar)
      case 'terminal':
        return call(
          () => window.api.saveSettings({ terminal: a.terminal }),
          () => {
            closeBar()
            const p = pending.current
            pending.current = null
            if (p) void resume(p.id, p.fork)
          },
        )
    }
  }

  return (
    <div className="app">
      <div className="app-drag" />
      <Sidebar
        tree={tree}
        scope={scope}
        expanded={open}
        onScope={setScope}
        onToggle={(root) => setExpanded({ ...open, [root]: !open[root] })}
      />
      <SessionList
        title={scopeTitle(scope, tree)}
        sessions={scoped}
        showModes={scope.type === 'all'}
        mode={viewMode}
        onMode={setMode}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onOpenBar={() => openBar({ kind: 'sessions', query: '' })}
        now={now}
        month={calMonth}
        day={calDay}
        onMonth={setMonth}
        onDay={setDay}
      />
      {selected ? (
        <Detail
          session={selected}
          now={now}
          copied={copied}
          teeOn={settings.statusTee}
          onResume={() => void resume(selected.id, false)}
          onCopy={() => copy(selected.id, 'resume', resumeCommand(selected.id, false))}
          onFork={() => void resume(selected.id, true)}
          onOpenFolder={() => void call(() => window.api.openFolder(selected.id))}
          onCopyPr={() => selected.pr && copy(selected.id, 'pr', prCommand(selected.pr.number))}
          onEnableTee={() => void call(() => window.api.setStatusTee(true))}
        />
      ) : (
        <main className="detail" />
      )}
      {bar && (
        <CommandBar
          key={bar.seq}
          open={bar.open}
          sessions={all}
          selected={selected}
          settings={settings}
          now={now}
          note={note}
          onClose={closeBar}
          onAction={(a) => void onAction(a)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run every test, the typecheck and the build check**

Run:
```bash
npm test && npm run typecheck && npm run build && ! grep -r "import.meta.vitest" out/ && echo STRIPPED
```
Expected: all tests PASS (the gated ones skipped), typecheck exits 0, the build succeeds, and the last line prints `STRIPPED`.

- [ ] **Step 5: Drive the dev app against the real sessions**

Run `npm run dev`. Invoke the `run` skill (its Electron pattern) to drive and screenshot the window, and check each item below. Record a one-line result per item in your report.

1. The window opens opaque at 1360×820, with native traffic lights inside the sidebar's top row.
2. The sidebar lists Repositories (e.g. meetnotes, team8) with branch and worktree children, plus Folders. The All sessions count matches the list header. No `sdk-cli` session appears.
3. Clicking a session fills the detail pane: real title, sub-line, facts, usage tiles with a real cost, and "Where it stopped" for sessions that have a recap.
4. All five views render. Calendar opens on the latest day and its arrows stop at the first and last months.
5. `⌘⇧P` opens the bar. `file:` becomes a chip, `is:hidden` lists SDK sessions, and Esc clears the chip and then closes the bar.
6. Resume on the **oldest completed** session opens the bar on "Resume in". Pick iTerm: a new iTerm window runs `cd … && claude --resume <id>`. Close that window right after you confirm the command. If macOS asks whether Electron may control iTerm, ask the lead to have the user approve. This writes `terminal: 'iterm'` to `userData/settings.json`.
7. Copy command shows "Copied" for about 1.6 s, and the clipboard (`pbpaste`) holds `claude --resume <id>`.

If the dev console shows a CSP violation that stops the React refresh preamble, report it with the exact message and leave the CSP as written. A weakened production policy is not an acceptable fix. No commit (not a git repo).

### Task 15: Package and sign the app

**Files:**
- Create: `electron-builder.yml`, `build/entitlements.mac.plist`

**Interfaces:**
- Consumes: the `package` script from Task 1; the whole app.
- Produces: `dist/mac-arm64/Session Deck.app`, signed.

Why these settings:
- A real certificate keeps the app's identity stable across rebuilds, so macOS keeps its Automation permission for iTerm and Terminal.
- The hardened runtime silently denies Apple Events without the `automation.apple-events` entitlement **and** the `NSAppleEventsUsageDescription` string: no prompt, and no entry in System Settings.
- There is no `extraResources` (no blur addon), no `asarUnpack` (no native modules) and no custom icon, because no icon asset exists. Electron's default icon is used.

- [ ] **Step 1: Write the entitlements**

`build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
  </dict>
</plist>
```

- [ ] **Step 2: Write `electron-builder.yml`**

```yaml
appId: dev.alanoliv.session-deck
productName: Session Deck
directories:
  output: dist
files:
  - out/**
mac:
  target: dir
  identity: 'Apple Development: alanbruno@gmail.com (8ENKTPJ3B3)'
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    NSAppleEventsUsageDescription: Session Deck opens your terminal to resume Claude sessions.
```

- [ ] **Step 3: Package and check the signature**

Run:
```bash
security find-identity -v -p codesigning | grep "8ENKTPJ3B3"
npm run package
codesign -dv --verbose=2 "dist/mac-arm64/Session Deck.app" 2>&1 | grep -E "Authority=Apple Development|Identifier="
codesign -d --entitlements - "dist/mac-arm64/Session Deck.app" 2>&1 | grep -c "automation.apple-events"
/usr/libexec/PlistBuddy -c "Print :NSAppleEventsUsageDescription" "dist/mac-arm64/Session Deck.app/Contents/Info.plist"
```
Expected:
- the identity is listed;
- the package succeeds;
- `Identifier=dev.alanoliv.session-deck` and `Authority=Apple Development: alanbruno@gmail.com (8ENKTPJ3B3)` print;
- the entitlement count is `1`;
- the usage string prints.

If electron-builder rejects the identity string, retry with `identity: 'alanbruno@gmail.com (8ENKTPJ3B3)'`, which is the form without the type prefix, and record which form it accepted.

- [ ] **Step 4: Open the packaged app**

Run: `open "dist/mac-arm64/Session Deck.app"`, then screenshot it with `screencapture -x "$TMPDIR/deck-packaged.png"` and read the image.
Expected: the window lists your sessions, as in dev. The packaged app has its own `userData`, so its first Resume asks for a terminal again. Pick iTerm on the oldest completed session. macOS then asks "“Session Deck” wants access to control “iTerm”": ask the lead to have the user approve, confirm the command ran, and close that iTerm window. Quit the app. No commit (not a git repo).
