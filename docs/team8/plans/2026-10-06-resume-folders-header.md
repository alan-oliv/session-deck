# Resume Menu, Inline Rename and Folder Item Implementation Plan

> **For agentic workers:** this plan is executed by teammates that `team8:run` dispatches from the shared task list. Read your own task section. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the detail header's four action buttons with the handoff's Resume split button and menu, add inline rename on the title with a confirmation toast, and let plain Resume open a terminal tab while "Resume in a new terminal window" opens a window.

**Architecture:** A pure item list (`src/shared/resume.ts`) describes the menu; `ResumeMenu.tsx` renders it with a dismiss layer and keyboard shortcuts while open; `Detail` swaps its title for a rename input; `Deck` owns the open menu, the renaming id and a one-line `Toast`, and routes every action through the existing `resume`, `copy` and IPC calls. Main's launcher gains a `newWindow` flag that only iTerm distinguishes. The command bar's rename mode is removed; its Rename session action now starts the inline rename.

**Tech Stack:** Electron 44, electron-vite 5, TypeScript 7 strict, React 19, Vitest 5 in-source tests. No new dependencies.

**Spec:** `docs/team8/specs/2026-10-06-resume-folders-header-design.md`. Read it with this plan. The UI source of truth is `docs/design/design_handoff_resume_folders_header/README.md` §1 and §2; its prototype `Session Manager Minimal.dc.html` has `rnVm` at line 875 and `rmVm` at line 884. The `Layout` icon is in the handoff's `_ds/*/_ds_bundle.js` icon map.

## Global Constraints

- **Branch:** `resume-folders-header` is checked out (cut from `session-detail-transcript`). Commit after each task with `git add <new paths> && git commit -m "<message>" -- <your paths>`. No AI attribution lines, no "Generated with" footers. Do not create branches.
- **No new dependencies.**
- **Tests:** in-source `if (import.meta.vitest) { const { it, expect } = import.meta.vitest; … }`, each `it` named by the behaviour it checks. `npm test` runs them. After `npm run build`, `grep -r "import.meta.vitest" out/` must find nothing.
- **Typecheck:** `npm run typecheck` must exit 0 at the end of every task.
- **Main owns side effects.** Every IPC handler validates its arguments before any file, shell or AppleScript use. The resume handle is always the session id.
- **Styling:** colours, type, radii and shadows only from `--app-*` tokens in `src/renderer/src/tokens.css`; pixel values and copy verbatim from the handoff README or this plan. No transitions.
- **Comments:** only a non-obvious *why*.
- **Style:** 2-space indent, no semicolons, single quotes, trailing commas in multiline literals.
- **Renderer tests** use `renderToStaticMarkup` and never touch `window.api`; effects do not run in static renders.

## File structure

| File | Track | Responsibility |
|---|---|---|
| `src/shared/api.ts` | A | `Layout` icon name; `resumeSession` opts gain `newWindow?` |
| `src/shared/resume.ts` | A | `resumeItems`, `RESUME_KEYS`, types (new, pure) |
| `src/renderer/src/icons.tsx` | A | `Layout` SVG |
| `src/renderer/src/tokens.css` | A | brand-button washes, menu and button shadows |
| `src/main/terminal.ts` | A | `itermTabScript`, `launch(..., newWindow)` |
| `src/main/index.ts` | A | validate `newWindow`, pass it to `launch` |
| `src/renderer/src/ResumeMenu.tsx`, `ResumeMenu.css` | B | split button + menu (new) |
| `src/renderer/src/Toast.tsx`, `Toast.css` | B | one-line toast (new) |
| `src/renderer/src/Detail.tsx`, `Detail.css` | B | header: menu mount, rename field |
| `src/renderer/src/App.tsx` | B | menu/rename/toast state and flows |
| `src/renderer/src/CommandBar.tsx` | B | drop the rename kind; `startRename` action |
| `src/shared/search.ts` | B | drop the rename kind |

Tracks: A = Tasks 1–2, B = Tasks 3–5.

---

### Task 1: Menu items, icon and tokens

**Files:**
- Create: `src/shared/resume.ts`
- Modify: `src/shared/api.ts` (ICON_NAMES only), `src/renderer/src/icons.tsx`, `src/renderer/src/tokens.css`

**Interfaces:**
- Consumes: `resumeCommand`, `IconName`, `Session` from `src/shared/api.ts`; `tildify` from `src/shared/format.ts`; `makeSession` in tests.
- Produces (`src/shared/resume.ts`): `ResumeAction = 'resume' | 'resumeWindow' | 'fork' | 'rename' | 'copy' | 'openFolder'`, `ResumeItem { action; icon: IconName; label; sub: string | null; key: string | null; command: string; disabled: boolean }`, `ResumeRow = ResumeItem | 'separator'`, `RESUME_KEYS: Record<string, ResumeAction>` (`Enter`, `b`, `r`), `resumeItems(s: Session): ResumeRow[]`.
- Produces: `'Layout'` in `IconName`; tokens `--app-brand-wash`, `--app-brand-wash-open`, `--app-brand-divider`, `--app-shadow-button`, `--app-shadow-menu`.

- [ ] **Step 1: Write `src/shared/resume.ts` with its tests**

```ts
import { resumeCommand, type IconName, type Session } from './api'
import { makeSession } from './fixtures'
import { tildify } from './format'

export type ResumeAction = 'resume' | 'resumeWindow' | 'fork' | 'rename' | 'copy' | 'openFolder'
export interface ResumeItem {
  action: ResumeAction
  icon: IconName
  label: string
  sub: string | null
  key: string | null
  command: string
  disabled: boolean
}
export type ResumeRow = ResumeItem | 'separator'

// Keyboard shortcuts while the menu is open; letters are matched lower-case.
export const RESUME_KEYS: Record<string, ResumeAction> = { Enter: 'resume', b: 'fork', r: 'rename' }

export function resumeItems(s: Session): ResumeRow[] {
  const cmd = resumeCommand(s.id, false)
  const item = (action: ResumeAction, icon: IconName, label: string, sub: string | null, key: string | null, command: string, disabled = false): ResumeItem =>
    ({ action, icon, label, sub, key, command, disabled })
  return [
    item('resume', 'ArrowRight', 'Resume', 'Opens in your terminal, in the session’s original folder.', '↵', cmd),
    item('resumeWindow', 'Layout', 'Resume in a new terminal window', null, null, cmd),
    'separator',
    item('fork', 'Branch', 'Branch conversation', 'Starts a new session from this point. The original stays as it is.', 'B', resumeCommand(s.id, true)),
    item('rename', 'Edit', 'Rename…', s.named ? null : 'Give it a name so you can resume by name.', 'R', ''),
    'separator',
    item('copy', 'Clipboard', 'Copy resume command', null, null, cmd),
    item('openFolder', 'Storage', 'Open folder', s.cwdExists ? tildify(s.cwd) : 'Folder no longer exists', null, '', !s.cwdExists),
  ]
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const items = (s: Session) => resumeItems(s).filter((r): r is ResumeItem => r !== 'separator')

  it('lists the six actions in the handoff order with separators after the second and fourth', () => {
    const rows = resumeItems(makeSession())
    expect(rows.map((r) => (r === 'separator' ? '|' : r.action))).toEqual(['resume', 'resumeWindow', '|', 'fork', 'rename', '|', 'copy', 'openFolder'])
    expect(items(makeSession()).map((r) => r.key)).toEqual(['↵', null, 'B', 'R', null, null])
    expect(items(makeSession()).map((r) => r.icon)).toEqual(['ArrowRight', 'Layout', 'Branch', 'Edit', 'Clipboard', 'Storage'])
  })
  it('puts the exact command in each tooltip, always with the session id', () => {
    const s = makeSession({ named: true, title: 'live-meeting' })
    const byAction = Object.fromEntries(items(s).map((r) => [r.action, r]))
    expect(byAction.resume.command).toBe(`claude --resume ${s.id}`)
    expect(byAction.resumeWindow.command).toBe(`claude --resume ${s.id}`)
    expect(byAction.copy.command).toBe(`claude --resume ${s.id}`)
    expect(byAction.fork.command).toBe(`claude --resume ${s.id} --fork-session`)
    expect(byAction.rename.command).toBe('')
    expect(JSON.stringify(items(s))).not.toContain('live-meeting')
  })
  it('explains renaming only while the title is generated', () => {
    expect(items(makeSession({ named: false })).find((r) => r.action === 'rename')?.sub).toBe('Give it a name so you can resume by name.')
    expect(items(makeSession({ named: true })).find((r) => r.action === 'rename')?.sub).toBeNull()
  })
  it('shows the folder path, or disables the item when the folder is gone', () => {
    const open = items(makeSession({ cwd: '/Users/me/code/app' })).find((r) => r.action === 'openFolder')!
    expect(open).toMatchObject({ sub: '~/code/app', disabled: false })
    const gone = items(makeSession({ cwdExists: false })).find((r) => r.action === 'openFolder')!
    expect(gone).toMatchObject({ sub: 'Folder no longer exists', disabled: true })
  })
  it('maps Enter, B and R to resume, fork and rename', () => {
    expect(RESUME_KEYS).toEqual({ Enter: 'resume', b: 'fork', r: 'rename' })
  })
}
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/shared/resume.ts`
Expected: 5 PASS.

- [ ] **Step 3: Add the icon**

In `src/shared/api.ts`, `ICON_NAMES`, after `'Expand',`: `'Layout',`.

In `src/renderer/src/icons.tsx`, after the `Expand` entry:

```ts
  Layout: { viewBox: "0 0 16 16", body: "<path d=\"M 9.955 0 L 7.046 0 C 6.744 0 6.5 0.244 6.5 0.545 L 6.5 3.455 C 6.5 3.756 6.744 4 7.046 4 L 9.955 4 C 10.256 4 10.5 3.756 10.5 3.455 L 10.5 0.545 C 10.5 0.244 10.256 0 9.955 0 Z\" fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"matrix(1 0 0 1 3 3)\"/><path d=\"M 3.455 0 L 0.545 0 C 0.244 0 0 0.244 0 0.545 L 0 3.455 C 0 3.756 0.244 4 0.545 4 L 3.455 4 C 3.756 4 4 3.756 4 3.455 L 4 0.545 C 4 0.244 3.756 0 3.455 0 Z\" fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"matrix(1 0 0 1 3 3)\"/><path d=\"M 3.455 6.5 L 0.545 6.5 C 0.244 6.5 0 6.744 0 7.046 L 0 9.955 C 0 10.256 0.244 10.5 0.545 10.5 L 3.455 10.5 C 3.756 10.5 4 10.256 4 9.955 L 4 7.046 C 4 6.744 3.756 6.5 3.455 6.5 Z\" fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"matrix(1 0 0 1 3 3)\"/><path d=\"M 9.955 6.5 L 7.046 6.5 C 6.744 6.5 6.5 6.744 6.5 7.046 L 6.5 9.955 C 6.5 10.256 6.744 10.5 7.046 10.5 L 9.955 10.5 C 10.256 10.5 10.5 10.256 10.5 9.955 L 10.5 7.046 C 10.5 6.744 10.256 6.5 9.955 6.5 Z\" fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"matrix(1 0 0 1 3 3)\"/>" },
```

Extend the existing icons test `draws the transcript icons added for the tab bar and Write rows` with `expect(renderToStaticMarkup(<Icon name="Layout" size={14} />)).toContain('<path')`.

- [ ] **Step 4: Add the tokens**

In `src/renderer/src/tokens.css`, after `--app-diff-del: …;`:

```css
  --app-brand-wash: rgba(255, 255, 255, 0.08);
  --app-brand-wash-open: rgba(255, 255, 255, 0.12);
  --app-brand-divider: rgba(255, 255, 255, 0.2);
  --app-shadow-button: 0 1px 1px rgba(0, 0, 0, 0.15);
  --app-shadow-menu: inset 0 0 0 1px #393a4b, 0 7px 24px rgba(0, 0, 0, 0.35);
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/shared/resume.ts src/renderer/src/icons.tsx && npm run typecheck`
Expected: PASS, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/resume.ts
git commit -m "Describe the Resume menu items" -- src/shared/resume.ts src/shared/api.ts src/renderer/src/icons.tsx src/renderer/src/tokens.css
```

### Task 2: Terminal tab launch and the `newWindow` option

**Files:**
- Modify: `src/main/terminal.ts`, `src/main/index.ts:90-102`, `src/shared/api.ts` (`Api.resumeSession` signature)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Api.resumeSession(id: string, opts: { fork: boolean; newWindow?: boolean }): Promise<ResumeResult>`; `itermTabScript(cmd: string): string`; `launch(terminal, s, fork, newWindow: boolean)`.

- [ ] **Step 1: Write the failing test in `src/main/terminal.ts`**

Replace the test `writes the command into a new iTerm window and a new Terminal tab` with:

```ts
  it('writes the command into a new iTerm window, a new iTerm tab with a window fallback, and a Terminal window', () => {
    expect(itermScript("cd '/x' && claude")).toContain(`write text "cd '/x' && claude"`)
    expect(itermScript('claude')).toContain('create window with default profile')
    const tab = itermTabScript('claude')
    expect(tab).toContain('if (count of windows) = 0 then')
    expect(tab).toContain('tell current window to create tab with default profile')
    expect(tab).toContain('write text "claude"')
    expect(terminalAppScript('claude')).toContain('do script "claude"')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/terminal.ts`
Expected: FAIL with `itermTabScript is not defined`.

- [ ] **Step 3: Add the tab script and the flag**

After `itermScript` in `src/main/terminal.ts`:

```ts
// A tab in the frontmost window when there is one; iTerm has no "current window" to tell otherwise.
export const itermTabScript = (cmd: string): string =>
  [
    'tell application "iTerm"',
    '  activate',
    '  if (count of windows) = 0 then',
    '    set w to (create window with default profile)',
    '  else',
    '    tell current window to create tab with default profile',
    '    set w to current window',
    '  end if',
    `  tell current session of w to write text ${appleScriptString(cmd)}`,
    'end tell',
  ].join('\n')
```

Change `launch`:

```ts
// Terminal.app and Warp have no scriptable new tab, so they open a window either way.
export async function launch(terminal: Terminal, s: Session, fork: boolean, newWindow: boolean): Promise<void> {
  if (terminal === 'warp') {
    mkdirSync(dirname(PATHS.warpConfig), { recursive: true })
    writeFileSync(PATHS.warpConfig, warpConfig(s.title, cdTarget(s) ?? PATHS.home, resumeCommand(s.id, fork)))
    await run('open', [WARP_URI])
    return
  }
  const cmd = terminalCommand(s, fork)
  const script = terminal === 'terminal' ? terminalAppScript(cmd) : newWindow ? itermScript(cmd) : itermTabScript(cmd)
  // execFile, never a shell: the script is a single argv entry.
  await run('osascript', ['-e', script])
}
```

In the env-gated launch test, add after the iTerm window line: `await run('osascript', ['-e', itermTabScript(echo)])`.

- [ ] **Step 4: Widen the IPC contract and validate it**

In `src/shared/api.ts`, `interface Api`:

```ts
  resumeSession(id: string, opts: { fork: boolean; newWindow?: boolean }): Promise<ResumeResult>
```

In `src/main/index.ts`, the `resumeSession` handler becomes:

```ts
    resumeSession: async (id, opts): Promise<ResumeResult> => {
      if (!opts || typeof opts !== 'object' || typeof opts.fork !== 'boolean') throw new Error('Invalid options')
      if (opts.newWindow !== undefined && typeof opts.newWindow !== 'boolean') throw new Error('Invalid options')
      const s = sessionFor(id)
      const fork = opts.fork
      const terminal = settings.get().terminal
      if (!terminal) return { ok: false, needsTerminal: true }
      try {
        await launch(terminal, s, fork, opts.newWindow ?? false)
        return { ok: true }
      } catch (e) {
        clipboard.writeText(terminalCommand(s, fork))
        return { ok: false, copied: true, error: e instanceof Error ? e.message : String(e) }
      }
    },
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/main/terminal.ts src/shared/api.ts && npm run typecheck`
Expected: PASS, typecheck exits 0 (the renderer's existing `resumeSession(id, { fork })` call still compiles because `newWindow` is optional).

- [ ] **Step 6: Commit**

```bash
git commit -m "Open a terminal tab for plain resume, a window on request" -- src/main/terminal.ts src/main/index.ts src/shared/api.ts
```

### Task 3: ResumeMenu and Toast components

**Files:**
- Create: `src/renderer/src/ResumeMenu.tsx`, `src/renderer/src/ResumeMenu.css`, `src/renderer/src/Toast.tsx`, `src/renderer/src/Toast.css`

**Interfaces:**
- Consumes: `resumeItems`, `RESUME_KEYS`, `ResumeAction` (Task 1); `Icon`; `resumeCommand`, `Session`; `makeSession` in tests.
- Produces: `ResumeMenu({ session, open, copied, onToggle, onClose, onAction }: ResumeMenuProps)`; `Toast({ text }: { text: string })`.

- [ ] **Step 1: Write the failing tests in `src/renderer/src/ResumeMenu.tsx`**

Create the file with the imports, `export {}`, and this block:

```tsx
import { useEffect } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { RESUME_KEYS, resumeItems, type ResumeAction, type ResumeItem } from '../../shared/resume'
import { Icon } from './icons'
import './ResumeMenu.css'

export {}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const noop = () => {}
  const render = (over: Partial<ResumeMenuProps> = {}) =>
    renderToStaticMarkup(<ResumeMenu session={makeSession()} open={false} copied={false} onToggle={noop} onClose={noop} onAction={noop} {...over} />)

  it('renders the split button closed, with the chevron tooltip and no menu', () => {
    const html = render()
    expect(html).toContain('class="rm-main" title="Opens claude --resume in your terminal">Resume</span>')
    expect(html).toContain('title="More ways to resume"')
    expect(html).not.toContain('rm-menu')
    expect(html).not.toContain('rm-dismiss')
  })
  it('says Copied on the main part after a fallback copy', () => {
    expect(render({ copied: true })).toContain('>Copied</span>')
  })
  it('opens the menu with six items, two separators, three key caps and a dismiss layer', () => {
    const html = render({ open: true })
    expect(html.match(/class="rm-item"/g)).toHaveLength(6)
    expect(html.match(/class="rm-sep"/g)).toHaveLength(2)
    expect(html).toContain('<span class="keycap">↵</span>')
    expect(html).toContain('<span class="keycap">B</span>')
    expect(html).toContain('<span class="keycap">R</span>')
    expect(html).toContain('class="rm-dismiss"')
    expect(html).toContain('rm-chev is-open')
    expect(html).toContain('Resume in a new terminal window')
    expect(html).toContain('Starts a new session from this point.')
    expect(html).toContain('title="claude --resume ')
  })
  it('disables Open folder when the folder is gone and drops the rename hint for named sessions', () => {
    const gone = render({ open: true, session: makeSession({ cwdExists: false, named: true }) })
    expect(gone).toContain('class="rm-item is-disabled"')
    expect(gone).toContain('Folder no longer exists')
    expect(gone).not.toContain('Give it a name')
    expect(render({ open: true })).toContain('~/code/app')
  })
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/ResumeMenu.tsx`
Expected: FAIL (`ResumeMenu is not defined`, or a missing stylesheet: create `ResumeMenu.css` empty if so).

- [ ] **Step 3: Write the component, replacing `export {}`**

```tsx
export interface ResumeMenuProps {
  session: Session
  open: boolean
  copied: boolean
  onToggle(): void
  onClose(): void
  onAction(a: ResumeAction): void
}

const isItem = (r: ResumeItem | 'separator'): r is ResumeItem => r !== 'separator'

export function ResumeMenu(p: ResumeMenuProps) {
  const rows = resumeItems(p.session)
  const pick = (a: ResumeAction) => {
    p.onClose()
    p.onAction(a)
  }

  // Shortcuts live only while the menu is open; the pane itself has no focus model.
  useEffect(() => {
    if (!p.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        return p.onClose()
      }
      const a = RESUME_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      const row = a && rows.filter(isItem).find((r) => r.action === a)
      if (!row || row.disabled) return
      e.preventDefault()
      pick(row.action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="rm">
      <div className="rm-btn">
        <span className="rm-main" title="Opens claude --resume in your terminal" onClick={() => p.onAction('resume')}>
          {p.copied ? 'Copied' : 'Resume'}
        </span>
        <span className="rm-divider" />
        <span className={p.open ? 'rm-chev is-open' : 'rm-chev'} title="More ways to resume" onClick={p.onToggle}>
          <Icon name="ChevronDown2" size={10} />
        </span>
      </div>
      {p.open && (
        <>
          <div className="rm-dismiss" onClick={p.onClose} />
          <div className="rm-menu">
            {rows.map((r, i) =>
              r === 'separator' ? (
                <div key={i} className="rm-sep" />
              ) : (
                <div
                  key={r.action}
                  className={r.disabled ? 'rm-item is-disabled' : 'rm-item'}
                  title={r.command || undefined}
                  onClick={r.disabled ? undefined : () => pick(r.action)}
                >
                  <span className="rm-icon"><Icon name={r.icon} size={14} /></span>
                  <span className="rm-text">
                    <span className="rm-label">{r.label}</span>
                    {r.sub && <span className="rm-sub">{r.sub}</span>}
                  </span>
                  {r.key && <span className="keycap">{r.key}</span>}
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write `src/renderer/src/ResumeMenu.css`**

```css
.rm {
  position: relative;
}

.rm-btn {
  display: flex;
  align-items: stretch;
  height: 28px;
  border-radius: var(--app-radius);
  background: var(--app-brand);
  box-shadow: var(--app-shadow-button);
  overflow: hidden;
  color: var(--app-on-primary);
}

.rm-main {
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.rm-main:hover {
  background: var(--app-brand-wash);
}

.rm-divider {
  width: 1px;
  background: var(--app-brand-divider);
}

.rm-chev {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
}

.rm-chev:hover {
  background: var(--app-brand-wash);
}

.rm-chev.is-open {
  background: var(--app-brand-wash-open);
}

.rm-dismiss {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.rm-menu {
  position: absolute;
  top: 34px;
  left: 0;
  z-index: 21;
  width: 300px;
  padding: 4px;
  border-radius: var(--app-radius-panel);
  background: var(--app-modal);
  box-shadow: var(--app-shadow-menu);
}

.rm-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 8px;
  border-radius: var(--app-radius);
}

.rm-item:hover {
  background: var(--app-wash);
}

.rm-item.is-disabled {
  opacity: 0.5;
}

.rm-item.is-disabled:hover {
  background: transparent;
}

.rm-icon {
  display: flex;
  padding-top: 1px;
  color: var(--app-text-3);
}

.rm-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rm-label {
  font-size: 13px;
  line-height: 16px;
  color: var(--app-text);
}

.rm-sub {
  font-size: 12px;
  line-height: 16px;
  color: var(--app-text-3);
  overflow-wrap: anywhere;
}

.rm-sep {
  height: 1px;
  margin: 4px -4px;
  background: var(--app-divider);
}
```

- [ ] **Step 5: Write `src/renderer/src/Toast.tsx` and `Toast.css`**

`Toast.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import './Toast.css'

export function Toast({ text }: { text: string }) {
  return <div className="toast">{text}</div>
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('renders the message in a fixed toast', () => {
    expect(renderToStaticMarkup(<Toast text='Renamed. Resume with claude --resume "x"' />)).toBe('<div class="toast">Renamed. Resume with claude --resume &quot;x&quot;</div>')
  })
}
```

`Toast.css`:

```css
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  max-width: calc(100% - 48px);
  padding: 8px 12px;
  border-radius: var(--app-radius);
  background: var(--app-modal);
  box-shadow: inset 0 0 0 1px var(--app-border-strong), var(--app-shadow-panel);
  font-size: 13px;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: text;
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/renderer/src/ResumeMenu.tsx src/renderer/src/Toast.tsx && npm run typecheck`
Expected: 5 PASS, typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/ResumeMenu.tsx src/renderer/src/ResumeMenu.css src/renderer/src/Toast.tsx src/renderer/src/Toast.css
git commit -m "Add the Resume split button, its menu and a toast" -- src/renderer/src/ResumeMenu.tsx src/renderer/src/ResumeMenu.css src/renderer/src/Toast.tsx src/renderer/src/Toast.css
```

### Task 4: Wire the header, rename, toast and command bar

**Files:**
- Modify: `src/renderer/src/Detail.tsx`, `src/renderer/src/Detail.css`, `src/renderer/src/App.tsx`, `src/renderer/src/CommandBar.tsx`, `src/shared/search.ts`

**Interfaces:**
- Consumes: `ResumeMenu`, `Toast` (Task 3); `ResumeAction` (Task 1); `Api.resumeSession` with `newWindow` (Task 2); `errorText`.
- Produces: `DetailProps` = `{ session, now, copied, teeOn, tab, focus, onTab, onFocus, menuOpen, onMenuToggle, onMenuClose, onResumeAction(a: ResumeAction), renaming, onStartRename, onRename(title: string | null), onCopyPr, onEnableTee }`; `BarAction` gains `{ type: 'startRename'; id: string }` and loses `{ type: 'rename' }`; `KindId` loses `'rename'`.

- [ ] **Step 1: Update the Detail tests to the new props and add the header cases**

In `src/renderer/src/Detail.tsx`'s test block, replace `handlers`:

```ts
  const handlers = {
    tab: 'overview' as DetailTab, focus: false, onTab: noop, onFocus: noop,
    menuOpen: false, onMenuToggle: noop, onMenuClose: noop, onResumeAction: noop,
    renaming: false, onStartRename: noop, onRename: noop, onCopyPr: noop, onEnableTee: noop,
  }
```

Replace the test `renders the title, the sub-line, the actions and the PR link` with:

```tsx
  it('renders the title with its rename tooltip, the sub-line, the Resume split button and the PR link', () => {
    const html = renderToStaticMarkup(<Detail session={makeSession({ title: 'live-meeting', pr })} now={now} copied={null} teeOn={false} {...handlers} />)
    expect(html).toContain('title="Double-click to rename">live-meeting</h2>')
    expect(html).toContain('Today, 9:12 AM · Opus 5.5 · 6.1MB')
    expect(html).toContain('class="rm-main" title="Opens claude --resume in your terminal">Resume</span>')
    expect(html).toContain('>All sessions for #27<')
    expect(html).not.toContain('Copy command')
    expect(html).not.toContain('>Fork<')
  })
```

Replace `swaps a label to Copied for the copy that just happened` with:

```tsx
  it('swaps a label to Copied for the copy that just happened', () => {
    const s = makeSession({ pr })
    const prCopied = renderToStaticMarkup(<Detail session={s} now={now} copied={{ id: s.id, what: 'pr' }} teeOn={false} {...handlers} />)
    expect(prCopied).toContain('class="detail-pr" title="Copies claude --from-pr">Copied</span>')
    expect(prCopied).toContain('>Resume</span>')
    const forkCopied = renderToStaticMarkup(<Detail session={s} now={now} copied={{ id: s.id, what: 'fork' }} teeOn={false} {...handlers} />)
    expect(forkCopied).toContain('class="rm-main" title="Opens claude --resume in your terminal">Copied</span>')
  })
  it('replaces the title with the rename field while renaming', () => {
    const html = renderToStaticMarkup(<Detail session={makeSession({ title: 'live-meeting' })} now={now} copied={null} teeOn={false} {...handlers} renaming />)
    expect(html).not.toContain('<h2')
    expect(html).toContain('class="rename-input"')
    expect(html).toContain('value="live-meeting"')
    expect(html).toContain('placeholder="Session name"')
    expect(html).toContain('Enter to save · Esc to cancel. A name lets you resume from any folder with claude --resume &lt;name&gt;.')
  })
  it('shows the open Resume menu when asked', () => {
    const html = renderToStaticMarkup(<Detail session={makeSession()} now={now} copied={null} teeOn={false} {...handlers} menuOpen />)
    expect(html.match(/class="rm-item"/g)).toHaveLength(6)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/Detail.tsx`
Expected: FAIL (unknown props, old markup).

- [ ] **Step 3: Rework the Detail header**

Imports: replace `import { Button } from './Button'` with `import { ResumeMenu } from './ResumeMenu'`, add `import type { ResumeAction } from '../../shared/resume'`, and change the React import to `import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'`.

`DetailProps`:

```ts
export interface DetailProps {
  session: Session
  now: Date
  copied: CopiedKey | null
  teeOn: boolean
  tab: DetailTab
  focus: boolean
  onTab(tab: DetailTab): void
  onFocus(): void
  menuOpen: boolean
  onMenuToggle(): void
  onMenuClose(): void
  onResumeAction(a: ResumeAction): void
  renaming: boolean
  onStartRename(): void
  onRename(title: string | null): void
  onCopyPr(): void
  onEnableTee(): void
}
```

Above `Section`, add the rename field:

```tsx
function RenameField({ title, onDone }: { title: string; onDone(title: string | null): void }) {
  const [value, setValue] = useState(title)
  // Enter unmounts the input, which fires blur; report once.
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <div className="rename">
      <input
        className="rename-input"
        value={value}
        placeholder="Session name"
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(value.trim())
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            finish(null)
          }
        }}
      />
      <span className="rename-hint">Enter to save · Esc to cancel. A name lets you resume from any folder with claude --resume &lt;name&gt;.</span>
    </div>
  )
}
```

In `Detail`, replace the `detail-head` and `detail-actions` blocks with:

```tsx
            <div className="detail-head">
              {p.renaming ? (
                <RenameField key={s.id} title={s.title} onDone={p.onRename} />
              ) : (
                <h2 className="detail-title" title="Double-click to rename" onDoubleClick={p.onStartRename}>{s.title}</h2>
              )}
              <span className="detail-when">{`${agoLong(s.end, p.now)} · ${modelLabel(s.model)} · ${fileSize(s.sizeBytes)}`}</span>
            </div>
            <div className="detail-actions">
              <ResumeMenu
                session={s}
                open={p.menuOpen}
                copied={copied('resume') || copied('fork')}
                onToggle={p.onMenuToggle}
                onClose={p.onMenuClose}
                onAction={p.onResumeAction}
              />
              {s.pr && (
                <span className="detail-pr" title="Copies claude --from-pr" onClick={p.onCopyPr}>
                  {copied('pr') ? 'Copied' : `All sessions for #${s.pr.number}`}
                </span>
              )}
            </div>
```

The `Transcript` mount changes `onResume={p.onResume}` to `onResume={() => p.onResumeAction('resume')}`.

In `src/renderer/src/Detail.css`, after `.detail-when`:

```css
.rename {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rename-input {
  height: 36px;
  margin: 0 -8px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--app-radius);
  background: var(--app-surface);
  outline: none;
  font: 500 22px/28px var(--app-font);
  color: var(--app-text);
}

.rename-input:focus {
  box-shadow: inset 0 0 0 1px var(--app-focus);
}

.rename-hint {
  font-size: 12px;
  color: var(--app-text-3);
}
```

- [ ] **Step 4: Remove the command bar's rename mode**

In `src/shared/search.ts`:
- `KindId`: remove `| 'rename'`.
- `INTERNAL_KINDS`: delete the `rename` entry.
- In `actionsFor`, the rename action's detail becomes `'Opens the title for editing. Enter saves, Esc cancels.'`.
- In `search`, delete the `case 'rename': break`.
- No test change: the action titles list still contains `'Rename session'`.

In `src/renderer/src/CommandBar.tsx`:
- `BarAction`: replace `| { type: 'rename'; id: string; title: string }` with `| { type: 'startRename'; id: string }`.
- In `activate`, `case 'rename':` returns `{ type: 'emit', action: { type: 'startRename', id } }`.
- Delete the `if (kind === 'rename') return 'Rename'` line in `primaryVerb`.
- Delete `const renameBlocked = …`.
- `onEnter` becomes just `run(cur)`:
  ```ts
  const onEnter = () => run(cur)
  ```
- `footLabel` becomes `p.note ?? (copied ? 'Copied resume command' : kind.label)`.
- `emptyText` loses its rename branch:
  ```ts
  const emptyText = kindId === 'ask' ? 'Nothing close. Try different words or a file name.' : 'No matches.'
  ```
- Tests: rename `refuses to rename a running session and shows errors from the app in the footer` to `shows errors from the app in the footer` and keep only its second assertion. In `maps each highlighted result…`, the rename line becomes:
  ```ts
    expect(activate(byAction('rename'))).toEqual({ type: 'emit', action: { type: 'startRename', id: s.id } })
  ```

- [ ] **Step 5: Hold the menu, rename and toast state in `Deck`**

In `src/renderer/src/App.tsx`:
- Imports: add `import type { ResumeAction } from '../../shared/resume'` and `import { Toast } from './Toast'`.
- Constants: after `COPIED_MS`, `const TOAST_MS = 3000`.
- `type Pending = { id: string; fork: boolean; newWindow: boolean }`.
- State, after `focus`:
  ```ts
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  ```
  Keying both by session id means a different selection shows them closed with no reset effect.
- After `fail`, add:
  ```ts
  // Detail-pane actions report here; a toast needs no bar to be open.
  const showToast = (text: string) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }
  const report = (e: unknown) => showToast(errorText(e))
  ```
- `copy` reports through the toast: `.then(() => flash({ id, what }), report)`.
- `resume` takes the flag and reports through the toast:
  ```ts
  const resume = async (id: string, fork: boolean, newWindow: boolean) => {
    try {
      const r = await window.api.resumeSession(id, { fork, newWindow })
      if (r.ok) return
      if ('needsTerminal' in r) return openBar({ kind: 'terminal', query: '' }, { id, fork, newWindow })
      flash({ id, what: fork ? 'fork' : 'resume' })
      showToast(`Couldn't open the terminal, so the command was copied. ${r.error}`)
    } catch (e) {
      report(e)
    }
  }
  ```
- Add the rename and menu handlers after `call`:
  ```ts
  const startRename = (id: string) => {
    setSelectedId(id)
    setDetailTab('overview')
    setMenuOpenId(null)
    setRenamingId(id)
  }
  const rename = async (s: Session, title: string | null) => {
    setRenamingId(null)
    if (!title || title === s.title) return
    try {
      await window.api.renameSession(s.id, title)
      showToast(`Renamed. Resume with claude --resume "${title}"`)
    } catch (e) {
      report(e)
    }
  }
  const onResumeAction = (s: Session, a: ResumeAction) => {
    switch (a) {
      case 'resume':
        return void resume(s.id, false, false)
      case 'resumeWindow':
        return void resume(s.id, false, true)
      case 'fork':
        return void resume(s.id, true, false)
      case 'rename':
        return setRenamingId(s.id)
      case 'copy':
        return copy(s.id, 'resume', resumeCommand(s.id, false))
      case 'openFolder':
        return void window.api.openFolder(s.id).catch(report)
    }
  }
  ```
- In `onAction`: `case 'resume'` calls `resume(a.id, a.fork, false)`; replace `case 'rename'` with
  ```ts
      case 'startRename':
        closeBar()
        return startRename(a.id)
  ```
  and in `case 'terminal'` call `resume(p.id, p.fork, p.newWindow)`.
- `<Detail …>` props: replace `onResume`, `onCopy`, `onFork`, `onOpenFolder` with
  ```tsx
          menuOpen={menuOpenId === selected.id}
          onMenuToggle={() => setMenuOpenId(menuOpenId === selected.id ? null : selected.id)}
          onMenuClose={() => setMenuOpenId(null)}
          onResumeAction={(a) => onResumeAction(selected, a)}
          renaming={renamingId === selected.id}
          onStartRename={() => setRenamingId(selected.id)}
          onRename={(title) => void rename(selected, title)}
  ```
- After the `{bar && (…)}` block: `{toast && <Toast text={toast} />}`.
- Remove the now-unused `prCommand`? No: `onCopyPr` still uses it. Keep.
- Deck test: in `renders the detail tab bar on Overview for the selected session`, add `expect(html).toContain('title="More ways to resume"')` and `expect(html).not.toContain('class="toast"')`.

- [ ] **Step 6: Run the suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck exits 0.

- [ ] **Step 7: Check it in the app**

Run `npm run dev`: the header shows the split button; the chevron opens the menu and clicking outside closes it; double-clicking the title opens the rename field; Enter renames and a toast appears; `⌘⇧P` then `> Rename session` opens the inline field on the Overview tab. Quit the app.

- [ ] **Step 8: Commit**

```bash
git commit -m "Wire the Resume menu, inline rename and toast" -- src/renderer/src/Detail.tsx src/renderer/src/Detail.css src/renderer/src/App.tsx src/renderer/src/CommandBar.tsx src/shared/search.ts
```

### Task 5: Verify in the app

**Files:**
- Modify: none (fixes only in track B's files; everything else is reported)

**Interfaces:**
- Consumes: everything above.
- Produces: a verification report with the automated outputs and the checklist results.

- [ ] **Step 1: Automated checks**

```bash
npm test
npm run typecheck
npm run build && (grep -r "import.meta.vitest" out/ && echo "TEST CODE LEAKED" || echo "no test code in out/")
```
Expected: every test passes, typecheck exits 0, `no test code in out/`.

- [ ] **Step 2: Manual checklist in the dev app**

Run `npm run dev`. Set the terminal to iTerm first if it isn't (`⌘⇧P`, `> Change terminal`). Record PASS or FAIL with a one-line note for each:
1. Header: 22px title with the "Double-click to rename" tooltip, the sub-line, then the split button (brand background, 1px lighter divider, 26px chevron with "More ways to resume") and, for a session with a PR, the PR link after it. No Copy command, Fork or Open folder buttons.
2. Menu: the chevron opens a 300px panel 34px below the button; six items with the handoff's labels, sub-lines and three key caps (↵, B, R); two edge-to-edge separators; each item's tooltip is its command. Clicking outside closes it, Escape closes it, choosing an item closes it.
3. Shortcuts: with the menu open, Enter resumes, B branches, R starts renaming. With the menu closed, those keys do nothing in the pane.
4. Resume targets (iTerm): with an iTerm window open, Resume (main part, menu item or Enter) opens a new tab in that window; "Resume in a new terminal window" opens a new window; with no iTerm window open, Resume opens a window. Switch to Terminal.app: both items open a window.
5. Branch conversation opens the terminal with `--fork-session`; after the new session sends its first message it appears at the top of the list and the parent's Forks fact goes up by one.
6. Copy resume command puts `claude --resume <id>` on the clipboard; the main part does not change to Copied (that is the launch-failure fallback only).
7. Open folder reveals the folder in Finder; for a session whose folder is gone, the item is dimmed with "Folder no longer exists" and does not react, while Resume still works.
8. Rename by double-click: the title becomes the 36px input, pre-filled and fully selected, with the hint below. Enter saves: the list row, the header title, the Transcript tab's title and the command bar's "Actions on" header all show the new name, the Title fact reads "Named. Resumes by name from any folder.", and a toast reads `Renamed. Resume with claude --resume "<name>"`.
9. Rename cancels: Escape, an empty value, and an unchanged value all leave the title as it was with no toast. Blur (click elsewhere) saves.
10. Rename entry points: Rename… in the menu (with the "Give it a name" sub-line only for generated titles) and `⌘⇧P` → `> Rename session` on another session both open the inline field on that session's Overview tab. The bar no longer has a rename mode.
11. Renaming a running session shows the error toast ("Can't rename a running session") and leaves the title unchanged.
12. Toast: disappears after about 3 seconds; a second toast replaces the first and restarts the timer.
13. Folders: the Folders tree section, the "~/code (not a repository)" group header, the Folder fact and the folder scope still behave as before.

- [ ] **Step 3: Report**

Your final answer lists the Step 1 outputs and the 13 checklist results. Any FAIL names the file and the symptom; fix only files track B owns, report the rest.
