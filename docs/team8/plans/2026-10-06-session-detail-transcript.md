# Session Detail Transcript Implementation Plan

> **For agentic workers:** this plan is executed by teammates that `team8:run` dispatches from the shared task list. Read your own task section. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Transcript tab to Session Deck's detail pane that shows a Claude Code session as readable turns with folded tool output and diffs, plus a Focus toggle and three resizable panes.

**Architecture:** Main gains a second pure JSONL reducer (`turns.ts`) that turns session records into turns and items, and an in-memory tail cache (`transcripts.ts`) that parses only appended bytes and serves two new IPC calls. The renderer gets a pure view-model (`transcriptView.ts`) ported from the prototype, a `Transcript` component rendered with react-markdown, a tab bar in `Detail`, and a shared resize handle used by the sidebar, the list and the command bar, with widths clamped by pure helpers in `panes.ts`.

**Tech Stack:** Electron 44, electron-vite 5, TypeScript 7 strict, React 19, react-markdown 10, remark-gfm 4, Vitest 5 in-source tests.

**Spec:** `docs/team8/specs/2026-10-06-session-detail-transcript-design.md`. Read it with this plan. The UI source of truth is `docs/design/design_handoff_session_detail_transcript/README.md`; its prototype `Session Manager Minimal.dc.html` has the transcript logic in methods `dtVm` (line 755), `txData` (765), `spans` (781), `txVm` (787) and the resize logic in `rzVals`, `rzSet`, `rzStart` (468–496). The Linear icon map with `Edit2` and `Expand` is in the handoff's `_ds/*/_ds_bundle.js`.

## Global Constraints

- **Branch:** `session-detail-transcript` is checked out. Commit after each task with `git add <paths> && git commit -m "<message>"` on the files you own. No AI attribution lines, no "Generated with" footers. Do not create branches.
- **New dependencies, exactly two, both devDependencies** (Vite bundles them): `react-markdown@10`, `remark-gfm@4`. Nothing else.
- **Tests:** in-source `if (import.meta.vitest) { const { it, expect } = import.meta.vitest; … }`, each `it` named by the behaviour it checks, in plain language. `npm test` runs them. After `npm run build`, `grep -r "import.meta.vitest" out/` must find nothing.
- **Typecheck:** `npm run typecheck` must exit 0 at the end of every task.
- **Main owns state and side effects.** The renderer names sessions only by id. Every IPC handler validates its arguments (`isSessionId`, index lookup, integer checks) before any file use.
- **Styling:** colours, type, radii and shadows come only from `--app-*` tokens in `src/renderer/src/tokens.css`. Pixel values and copy strings are verbatim from the handoff README or this plan. No transitions or animations.
- **Comments:** only a non-obvious *why*. No comment restates code. Deliberate ceilings get a `// ponytail:` comment naming the ceiling and the upgrade path.
- **Match existing style:** 2-space indent, no semicolons, single quotes, trailing commas in multiline literals, `const` arrow helpers for one-liners.
- **Renderer tests** render with `renderToStaticMarkup` from `react-dom/server` (already the pattern) and never touch `window.api`; effects do not run in static renders.

## File structure

| File | Track | Responsibility |
|---|---|---|
| `src/shared/api.ts` | A | Transcript types, `toolLabel`, two new Api methods, two icon names |
| `src/shared/fixtures.ts` | A | `makeTranscript()` for tests |
| `src/renderer/src/icons.tsx` | A | `Edit2`, `Expand` SVG bodies |
| `src/renderer/src/tokens.css` | A | `--app-diff-add`, `--app-diff-del` |
| `src/main/lines.ts` | A | `tailLines` (new) |
| `src/main/transcript.ts` | A | export `parseRecord`, `promptText`, `stripRecapSuffix` |
| `src/main/indexer.ts` | A | use `tailLines` |
| `src/main/turns.ts` | A | JSONL → `Transcript` reducer (new, pure) |
| `src/main/transcripts.ts` | A | per-session tail cache + output lookup (new) |
| `src/main/index.ts` | A | `getTranscript`, `getToolOutput` handlers |
| `src/shared/panes.ts` | B | pane limits, clamps, stored widths (new, pure) |
| `src/shared/transcriptView.ts` | B | view-model (new, pure) |
| `src/renderer/src/Resize.tsx`, `Resize.css` | C | shared resize handle (new) |
| `src/renderer/src/Sidebar.tsx`, `Sidebar.css` | C | use the shared handle |
| `src/renderer/src/SessionList.tsx`, `SessionList.css` | C | width prop, handle |
| `src/renderer/src/CommandBar.tsx`, `CommandBar.css` | C | results width prop, handle |
| `src/renderer/src/App.tsx`, `App.css` | C | pane widths, focus, detail tab |
| `src/renderer/src/Detail.tsx`, `Detail.css` | C | tab bar, scroll bodies, transcript loading |
| `src/renderer/src/Transcript.tsx`, `Transcript.css` | D | the Transcript tab (new) |
| `package.json`, `package-lock.json` | D | react-markdown, remark-gfm |

Tracks: A = Tasks 1–4, B = Tasks 5–6, C = Tasks 7, 9, 10, D = Task 8.

---

### Task 1: Shared contract: transcript types, tool labels, icons, fixtures

**Files:**
- Modify: `src/shared/api.ts`
- Modify: `src/shared/fixtures.ts`
- Modify: `src/renderer/src/icons.tsx`
- Modify: `src/renderer/src/tokens.css`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/shared/api.ts`): `DiffSign`, `DiffLine`, `Item`, `ToolItem`, `Turn`, `Transcript`, `toolLabel(tool: string): string`, `'Edit2' | 'Expand'` in `IconName`. (The two `Api` methods land in Task 4 with their handlers.)
- Produces (`src/shared/fixtures.ts`): `makeTranscript(over?: Partial<Transcript>): Transcript`, a two-turn sample with 8 items (2 text, 6 tools, 1 edit, 1 error, one run of 4 consecutive tools).
- Produces (`tokens.css`): `--app-diff-add`, `--app-diff-del`.

- [ ] **Step 1: Write the failing tests in `src/shared/api.ts`**

Add inside the existing `if (import.meta.vitest)` block, after the `prCommand` test:

```ts
  it('labels Edit and Grep the way the CLI prints them and leaves other tools alone', () => {
    expect(toolLabel('Edit')).toBe('Update')
    expect(toolLabel('MultiEdit')).toBe('Update')
    expect(toolLabel('Grep')).toBe('Search')
    expect(toolLabel('Glob')).toBe('Search')
    expect(toolLabel('Bash')).toBe('Bash')
    expect(toolLabel('mcp__linear__get_issue')).toBe('mcp__linear__get_issue')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/api.ts`
Expected: FAIL with `toolLabel is not defined`.

- [ ] **Step 3: Add the transcript types, the two methods and the labels to `src/shared/api.ts`**

After the `Session` interface:

```ts
export type DiffSign = ' ' | '+' | '-'
export type DiffLine = [lineNo: number, sign: DiffSign, text: string]
export interface ToolItem {
  k: 'tool'
  tool: string      // raw name: Bash, Edit, Grep, Read, Write, Skill, Agent, …
  name: string      // what the row shows; see toolLabel
  arg: string       // command, path, pattern, skill, query, prompt, url or description
  out?: string[]    // first lines of the result
  more?: number     // lines not included, of the output or of the diff
  err?: boolean
  a?: number
  d?: number
  diff?: DiffLine[]
  link?: string     // GitHub PR URL from a `gh pr create` result
}
export type Item = { k: 'text'; md: string } | ToolItem
export interface Turn { prompt: string; items: Item[]; footer?: string; recap?: string }
export interface Transcript { cli: string; turns: Turn[] }

// The CLI prints Edit as "Update" and Grep/Glob as "Search"; the transcript reads like the terminal did.
const TOOL_LABELS: Record<string, string> = { Edit: 'Update', MultiEdit: 'Update', Grep: 'Search', Glob: 'Search' }
export const toolLabel = (tool: string): string => TOOL_LABELS[tool] ?? tool
```

In `ICON_NAMES`, after `'Check',`: `'Edit2', 'Expand',`.

The two `Api` methods are added in Task 4 together with their handlers, so the typecheck stays green between the two tasks.

- [ ] **Step 4: Add `makeTranscript` to `src/shared/fixtures.ts`**

Change the import to `import type { Session, Transcript } from './api'` and append:

```ts
// Two turns, 8 items: 2 texts, 6 tools, 1 edit, 1 error, and a run of 4 consecutive tools (items 2–5 of turn 0).
export function makeTranscript(over: Partial<Transcript> = {}): Transcript {
  return {
    cli: 'Claude Code v2.1.283',
    turns: [
      {
        prompt: 'Recording still doesn\'t feel live. Fix all of it.',
        items: [
          { k: 'tool', tool: 'Bash', name: 'Bash', arg: 'sed -n 1,90p src/StatusLine.tsx', out: ['import { Fragment } from \'react\'', 'import { Icon } from \'./Icon\'', ''], more: 108 },
          { k: 'text', md: 'Before writing the cancel logic, I need to see `splitForWhisper`.\n\n- check the abort signal\n- check **Resume**' },
          { k: 'tool', tool: 'Grep', name: 'Search', arg: 'splitForWhisper' },
          { k: 'tool', tool: 'Bash', name: 'Bash', arg: 'npm test', out: ['552 passed'] },
          { k: 'tool', tool: 'Edit', name: 'Update', arg: 'src/main/bin.ts', a: 2, d: 2, diff: [
            [22, ' ', ''],
            [23, '-', 'export function run(cmd: string): Promise<string> {'],
            [23, '+', 'export function run(cmd: string, signal?: AbortSignal): Promise<string> {'],
            [24, ' ', '  return new Promise((resolve, reject) => {'],
            [25, '-', '    const child = execFile(cmd, (err, stdout) => {'],
            [25, '+', '    const child = execFile(cmd, { signal }, (err, stdout) => {'],
          ] },
          { k: 'tool', tool: 'Bash', name: 'Bash', arg: 'gh pr create --title "Live recording"', out: ['https://github.com/alan-oliv/meetnotes/pull/28'], link: 'https://github.com/alan-oliv/meetnotes/pull/28' },
        ],
        footer: 'Worked for 30m 42s · done Monday 12:42 PM',
        recap: 'Next: review **PR #28**.',
      },
      {
        prompt: 'Now the summary.',
        items: [
          { k: 'tool', tool: 'Bash', name: 'Bash', arg: 'npm run build', err: true, out: ['Exit code 1', 'error TS2304'] },
          { k: 'text', md: 'Fixed the import.' },
        ],
      },
    ],
    ...over,
  }
}
```

- [ ] **Step 5: Add the two icons to `src/renderer/src/icons.tsx`**

After the `Check` entry in `ICONS`:

```ts
  Edit2: { viewBox: "0 0 16 16", body: "<path d=\"M 1.031 8.75 C 2.303 8.766 3.366 9.742 3.498 11.011 C 2.833 11.426 1.402 11.792 0.531 11.989 C 0.2 12.063 -0.08 11.76 0.021 11.437 C 0.253 10.69 0.646 9.514 1.031 8.75 Z\" fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"matrix(1 0 0 1 2 2)\"/><path d=\"M 11.739 2.716 C 12.158 2.029 12.073 1.117 11.485 0.522 C 10.891 -0.079 9.978 -0.161 9.298 0.276 C 9.855 1.311 10.704 2.16 11.739 2.716 Z\" fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"matrix(1 0 0 1 2 2)\"/><path d=\"M 8.18 1.342 L 2.142 7.416 C 3.329 7.77 4.292 8.663 4.74 9.818 L 10.688 3.842 C 9.664 3.221 8.804 2.364 8.18 1.342 Z\" fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"matrix(1 0 0 1 2 2)\"/>" },
  Expand: { viewBox: "0 0 16 16", body: "<path d=\"M 5.28 6.72 C 5.42 6.861 5.499 7.051 5.499 7.25 C 5.499 7.449 5.42 7.639 5.28 7.78 L 3 10 L 4.25 11.25 C 4.25 11.449 4.171 11.64 4.03 11.78 C 3.89 11.921 3.699 12 3.5 12 L 0.75 12 C 0.551 12 0.36 11.921 0.22 11.78 C 0.079 11.64 0 11.449 0 11.25 L 0 8.5 C 0 8.301 0.079 8.11 0.22 7.97 C 0.36 7.829 0.551 7.75 0.75 7.75 L 2 9 L 4.22 6.72 C 4.361 6.58 4.551 6.501 4.75 6.501 C 4.949 6.501 5.139 6.58 5.28 6.72 Z M 6.72 5.28 C 6.58 5.139 6.501 4.949 6.501 4.75 C 6.501 4.551 6.58 4.361 6.72 4.22 L 9 2 L 7.75 0.75 C 7.75 0.551 7.829 0.36 7.97 0.22 C 8.11 0.079 8.301 0 8.5 0 L 11.25 0 C 11.449 0 11.64 0.079 11.78 0.22 C 11.921 0.36 12 0.551 12 0.75 L 12 3.5 C 12 3.699 11.921 3.89 11.78 4.03 C 11.64 4.171 11.449 4.25 11.25 4.25 L 10 3 L 7.78 5.28 C 7.639 5.42 7.449 5.499 7.25 5.499 C 7.051 5.499 6.861 5.42 6.72 5.28 Z\" fill=\"currentColor\" fill-rule=\"nonzero\" transform=\"matrix(1 0 0 1 2 2)\"/>" },
```

Add a test to the `icons.tsx` block:

```ts
  it('draws the transcript icons added for the tab bar and Write rows', () => {
    expect(renderToStaticMarkup(<Icon name="Expand" size={12} />)).toContain('width="12"')
    expect(renderToStaticMarkup(<Icon name="Edit2" size={14} />)).toContain('<path')
  })
```

- [ ] **Step 6: Add the diff tokens to `src/renderer/src/tokens.css`**

After `--app-violet: #bb87fc;`:

```css
  --app-diff-add: rgba(76, 183, 130, 0.12);
  --app-diff-del: rgba(235, 87, 87, 0.12);
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run src/shared/api.ts src/renderer/src/icons.tsx && npm run typecheck`
Expected: both test files PASS and the typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/shared/api.ts src/shared/fixtures.ts src/renderer/src/icons.tsx src/renderer/src/tokens.css
git commit -m "Add the transcript contract, tool labels and tab-bar icons"
```

### Task 2: Shared line reader and exported record helpers

**Files:**
- Create: `src/main/lines.ts`
- Modify: `src/main/transcript.ts`
- Modify: `src/main/indexer.ts:174-188, 252-258`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/main/lines.ts`): `tailLines(path: string, offset: number, onLine: (line: string, next: number) => void, highWaterMark?: number): Promise<number>`.
- Produces (`src/main/transcript.ts`): `parseRecord(line: string): Record<string, any> | null`, `promptText(text: string): string | null`, `stripRecapSuffix(text: string): string`.

- [ ] **Step 1: Write `src/main/lines.ts` with its failing tests**

```ts
import { createReadStream, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Streams complete lines from `offset` and reports the byte offset just past each one, so a caller
// can save progress per line and a partial last line is re-read on the next call.
export async function tailLines(
  path: string,
  offset: number,
  onLine: (line: string, next: number) => void,
  highWaterMark = 64 * 1024,
): Promise<number> {
  let carry: Buffer = Buffer.alloc(0)
  let at = offset
  for await (const chunk of createReadStream(path, { start: offset, highWaterMark }) as AsyncIterable<Buffer>) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
    let from = 0
    let nl: number
    while ((nl = buf.indexOf(10, from)) !== -1) {
      at += nl - from + 1
      onLine(buf.toString('utf8', from, nl), at)
      from = nl + 1
    }
    carry = buf.subarray(from)
  }
  return at
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const file = (text: string) => {
    const p = join(mkdtempSync(join(tmpdir(), 'deck-lines-')), 't.jsonl')
    writeFileSync(p, text)
    return p
  }
  const collect = async (p: string, offset = 0, hwm?: number) => {
    const lines: string[] = []
    const nexts: number[] = []
    const end = await tailLines(p, offset, (l, n) => {
      lines.push(l)
      nexts.push(n)
    }, hwm)
    return { lines, nexts, end }
  }

  it('yields complete lines with their end offsets and stops before a partial last line', async () => {
    const p = file('{"a":1}\n{"b":2}\n{"c"')
    expect(await collect(p)).toEqual({ lines: ['{"a":1}', '{"b":2}'], nexts: [8, 16], end: 16 })
  })
  it('continues from a saved offset', async () => {
    const p = file('{"a":1}\n{"b":2}\n')
    expect(await collect(p, 8)).toEqual({ lines: ['{"b":2}'], nexts: [16], end: 16 })
  })
  it('keeps a line and a multibyte character that straddle chunk boundaries', async () => {
    const p = file('ab\ncé\n')
    expect((await collect(p, 0, 1)).lines).toEqual(['ab', 'cé'])
    expect((await collect(p, 0, 4)).lines).toEqual(['ab', 'cé'])
  })
}
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/main/lines.ts`
Expected: 3 PASS. (`'ab\ncé\n'` is 7 bytes; chunk size 4 cuts `é` in two, chunk size 1 cuts everything.)

- [ ] **Step 3: Make the indexer use it**

In `src/main/indexer.ts`, delete the `parseFrom` function (lines 174–188) and replace the call in `scanOnce`:

```ts
      try {
        await tailLines(path, entry.offset, (line, next) => {
          reduceLine(entry.agg, line)
          entry.offset = next
        })
      } catch (e) {
```

Replace `createReadStream` in the `node:fs` import with nothing (remove it; keep the others) and add `import { tailLines } from './lines'`.

- [ ] **Step 4: Export the record helpers from `src/main/transcript.ts`**

Replace `reduceLine` with:

```ts
export function parseRecord(line: string): Rec | null {
  if (!line || SKIP_HEAD.test(line.slice(0, 120))) return null
  if (line.includes('"type":"attachment"') && !line.includes('"forkedFrom"')) return null
  let rec: unknown
  try {
    rec = JSON.parse(line)
  } catch {
    return null
  }
  return rec && typeof rec === 'object' && !Array.isArray(rec) ? (rec as Rec) : null
}

export function reduceLine(agg: Agg, line: string): void {
  const rec = parseRecord(line)
  if (rec) reduceRecord(agg, rec)
}
```

Make `promptText` exported (`export function promptText`). Add above `splitSummary`:

```ts
export const stripRecapSuffix = (text: string): string => text.replace(/\s*\(disable recaps in \/config\)\s*$/, '').trim()
```

and make `splitSummary` start with `const clean = stripRecapSuffix(text)`.

Add two tests to the block:

```ts
  it('parses a record line and returns null for skipped types, attachments and bad JSON', () => {
    expect(parseRecord('{"type":"custom-title","customTitle":"x"}')).toEqual({ type: 'custom-title', customTitle: 'x' })
    expect(parseRecord('{"type":"file-history-snapshot","snapshot":{}}')).toBeNull()
    expect(parseRecord('{"type":"attachment","attachment":{}}')).toBeNull()
    expect(parseRecord('[1,2]')).toBeNull()
    expect(parseRecord('{nope')).toBeNull()
  })
  it('keeps slash commands with arguments as prompts and drops other tagged text', () => {
    expect(promptText('<command-message>plan</command-message>\n<command-name>/team8:plan</command-name>\n<command-args>build it</command-args>')).toBe('/team8:plan build it')
    expect(promptText('<local-command-stdout>ok</local-command-stdout>')).toBeNull()
    expect(promptText('  plain  ')).toBe('plain')
    expect(stripRecapSuffix('Did it. (disable recaps in /config)')).toBe('Did it.')
  })
```

- [ ] **Step 5: Run the suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS (the indexer tests still cover tailing, appends and shrinks), typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/lines.ts src/main/indexer.ts src/main/transcript.ts
git commit -m "Share the transcript line reader and record helpers"
```

### Task 3: Turns reducer

**Files:**
- Create: `src/main/turns.ts`

**Interfaces:**
- Consumes: `parseRecord`, `promptText`, `stripRecapSuffix` from `src/main/transcript.ts` (Task 2); `toolLabel`, `DiffLine`, `Item`, `ToolItem`, `Transcript` from `src/shared/api.ts` (Task 1); `clock` from `src/shared/format.ts`.
- Produces (`src/main/turns.ts`): `TurnsAgg`, `emptyTurnsAgg(id: string): TurnsAgg`, `reduceTurnLine(agg: TurnsAgg, line: string): void`, `finalizeTurns(agg: TurnsAgg): Transcript`, `toolLines(agg: TurnsAgg, turn: number, item: number): string[] | null`, `durationText(ms: number): string`.

- [ ] **Step 1: Write the failing tests in `src/main/turns.ts`**

Create the file with the imports, an empty export so it compiles, and the test block. Records mirror real `~/.claude/projects` lines.

```ts
import { clock } from '../shared/format'
import { toolLabel, type DiffLine, type Item, type ToolItem, type Transcript } from '../shared/api'
import { parseRecord, promptText, stripRecapSuffix } from './transcript'

export {}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const base = { sessionId: id, cwd: '/Users/me/code/app', version: '2.1.283', timestamp: '2026-10-05T15:40:00.000Z' }
  const user = (content: unknown, extra: object = {}) => ({ type: 'user', ...base, message: { role: 'user', content }, ...extra })
  const assistant = (content: unknown[], extra: object = {}) => ({ type: 'assistant', ...base, message: { id: 'msg_1', model: 'claude-opus-5-5', content }, ...extra })
  const use = (tid: string, name: string, input: object) => ({ type: 'tool_use', id: tid, name, input })
  const result = (tid: string, content: unknown, extra: object = {}, tur?: unknown) =>
    user([{ type: 'tool_result', tool_use_id: tid, content, ...extra }], tur === undefined ? {} : { toolUseResult: tur })
  const run = (...recs: unknown[]) => {
    const agg = emptyTurnsAgg(id)
    for (const r of recs) reduceTurnLine(agg, typeof r === 'string' ? r : JSON.stringify(r))
    return { agg, t: finalizeTurns(agg) }
  }
  const tool = (t: Transcript, turn: number, i: number) => t.turns[turn].items[i] as ToolItem

  it('starts a turn per real prompt, keeping slash commands with arguments and skipping meta and interrupts', () => {
    const { t } = run(
      user('Caveat: injected', { isMeta: true }),
      user('<command-message>plan</command-message>\n<command-name>/team8:plan</command-name>\n<command-args>build it</command-args>'),
      user('<command-message>clear</command-message>\n<command-name>/clear</command-name>\n<command-args></command-args>'),
      user('[Request interrupted by user]'),
      user([{ type: 'text', text: 'second prompt' }]),
    )
    expect(t.turns.map((x) => x.prompt)).toEqual(['/team8:plan build it', 'second prompt'])
    expect(t.cli).toBe('Claude Code v2.1.283')
  })

  it('turns assistant text and tool calls into items with the CLI label and the first useful argument', () => {
    const { t } = run(
      user('go'),
      assistant([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '  Looking.  ' }, use('t1', 'Grep', { pattern: 'splitFor', path: 'src' }), use('t2', 'Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' }), use('t3', 'Skill', { skill: 'tdd' })]),
    )
    expect(t.turns[0].items).toEqual([
      { k: 'text', md: 'Looking.' },
      { k: 'tool', tool: 'Grep', name: 'Search', arg: 'splitFor' },
      { k: 'tool', tool: 'Edit', name: 'Update', arg: '/a.ts' },
      { k: 'tool', tool: 'Skill', name: 'Skill', arg: 'tdd' },
    ])
  })

  it('attaches items before any prompt to a turn with an empty prompt', () => {
    const { t } = run(assistant([{ type: 'text', text: 'after compaction' }]), user('next'))
    expect(t.turns.map((x) => x.prompt)).toEqual(['', 'next'])
    expect(t.turns[0].items).toEqual([{ k: 'text', md: 'after compaction' }])
  })

  it('keeps the first three output lines, counts the rest, and serves the full lines on request', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
    const { agg, t } = run(user('go'), assistant([use('t1', 'Bash', { command: 'ls' })]), result('t1', lines.join('\n')))
    expect(tool(t, 0, 0)).toEqual({ k: 'tool', tool: 'Bash', name: 'Bash', arg: 'ls', out: ['line 1', 'line 2', 'line 3'], more: 7 })
    expect(toolLines(agg, 0, 0)).toEqual(lines)
    expect(toolLines(agg, 0, 1)).toBeNull()
    expect(toolLines(agg, 3, 0)).toBeNull()
  })

  it('reads block-array results, marks errors, and drops results with no matching call', () => {
    const { t } = run(
      user('go'),
      assistant([use('t1', 'Bash', { command: 'npm test' })]),
      result('t1', [{ type: 'text', text: 'Exit code 1' }, { type: 'text', text: 'boom' }], { is_error: true }),
      result('zzz', 'orphan'),
    )
    expect(tool(t, 0, 0)).toEqual({ k: 'tool', tool: 'Bash', name: 'Bash', arg: 'npm test', out: ['Exit code 1', 'boom'], err: true })
    expect(t.turns[0].items).toHaveLength(1)
  })

  it('builds the diff from structuredPatch hunks with old numbers for removals and new numbers otherwise', () => {
    const patch = [
      { oldStart: 23, oldLines: 2, newStart: 23, newLines: 2, lines: [' a', '-b', '+B'] },
      { oldStart: 40, oldLines: 1, newStart: 40, newLines: 2, lines: ['-c', '+C', '+D', '\\ No newline at end of file'] },
    ]
    const { t } = run(user('go'), assistant([use('t1', 'Edit', { file_path: '/a.ts', old_string: 'b', new_string: 'B' })]),
      result('t1', 'The file /a.ts has been updated successfully.', {}, { filePath: '/a.ts', structuredPatch: patch }))
    const it1 = tool(t, 0, 0)
    expect(it1.diff).toEqual<DiffLine[]>([[23, ' ', 'a'], [24, '-', 'b'], [24, '+', 'B'], [40, '-', 'c'], [40, '+', 'C'], [41, '+', 'D']])
    expect(it1).toMatchObject({ a: 3, d: 2 })
    expect(it1.out).toBeUndefined()
  })

  it('caps a diff at 400 lines and reports the overflow as more lines', () => {
    const lines = Array.from({ length: 450 }, (_, i) => `+l${i}`)
    const { t } = run(user('go'), assistant([use('t1', 'Write', { file_path: '/big.md', content: 'x' })]),
      result('t1', 'ok', {}, { structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 450, lines }] }))
    expect(tool(t, 0, 0).diff).toHaveLength(400)
    expect(tool(t, 0, 0)).toMatchObject({ a: 450, d: 0, more: 50 })
  })

  it('links a PR created with gh pr create, even behind a cd', () => {
    const { t } = run(user('go'), assistant([use('t1', 'Bash', { command: 'cd app && gh pr create --title x' })]),
      result('t1', 'Creating pull request\nhttps://github.com/alan-oliv/meetnotes/pull/28\n'))
    expect(tool(t, 0, 0).link).toBe('https://github.com/alan-oliv/meetnotes/pull/28')
  })

  it('writes the footer from turn_duration and the recap from away_summary', () => {
    const done = new Date(2026, 9, 5, 12, 42).toISOString()
    const { t } = run(
      user('go'),
      { type: 'system', subtype: 'turn_duration', durationMs: 1_842_000, ...base, timestamp: done },
      { type: 'system', subtype: 'away_summary', content: 'Fixed it. Next: ship. (disable recaps in /config)', ...base },
    )
    expect(t.turns[0].footer).toBe('Worked for 30m 42s · done Monday 12:42 PM')
    expect(t.turns[0].recap).toBe('Fixed it. Next: ship.')
    expect(durationText(12_000)).toBe('12s')
    expect(durationText(3_725_000)).toBe('1h 2m 5s')
  })

  it('ignores sidechain records, malformed lines and snapshots', () => {
    const { t } = run('{bad', '{"type":"file-history-snapshot","snapshot":{}}', user('side', { isSidechain: true }), assistant([{ type: 'text', text: 'side' }], { isSidechain: true }), user('go'))
    expect(t.turns).toEqual([{ prompt: 'go', items: [] }])
  })

  it('cuts a long argument to 400 characters', () => {
    const { t } = run(user('go'), assistant([use('t1', 'Bash', { command: 'x'.repeat(1000) })]))
    expect(tool(t, 0, 0).arg).toHaveLength(400)
    expect(tool(t, 0, 0).arg.endsWith('…')).toBe(true)
  })
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/turns.ts`
Expected: FAIL with `emptyTurnsAgg is not defined` (or an import error on the names).

- [ ] **Step 3: Write the reducer above the test block, replacing `export {}`**

```ts
const OUT_LINES = 3
const DIFF_LINES = 400
const ARG_CHARS = 400
// ponytail: per-tool ceiling for lines kept in memory; the session file keeps the rest.
const KEEP_LINES = 2000
const ARG_KEYS = ['command', 'file_path', 'pattern', 'skill', 'query', 'prompt', 'url', 'description'] as const
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write'])
const PR_URL_RE = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Rec = Record<string, any>

interface Entry { item: Item; lines: string[]; diff: DiffLine[] }
interface TurnAgg { prompt: string; entries: Entry[]; footer?: string; recap?: string }
export interface TurnsAgg { id: string; cli: string | null; turns: TurnAgg[]; open: Map<string, Entry> }

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const emptyTurnsAgg = (id: string): TurnsAgg => ({ id, cli: null, turns: [], open: new Map() })

// Items can arrive before any prompt (e.g. right after a compaction); they get a turn without a bubble.
function current(agg: TurnsAgg): TurnAgg {
  if (!agg.turns.length) agg.turns.push({ prompt: '', entries: [] })
  return agg.turns[agg.turns.length - 1]
}

export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`
}

function footerText(ms: number, ts: string | null): string {
  const when = ts ? new Date(ts) : null
  const done = when && !Number.isNaN(when.getTime()) ? ` · done ${WEEKDAYS[when.getDay()]} ${clock(when)}` : ''
  return `Worked for ${durationText(ms)}${done}`
}

function argOf(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  for (const k of ARG_KEYS) {
    const v = (input as Rec)[k]
    if (typeof v === 'string' && v.trim()) {
      const a = v.trim()
      return a.length > ARG_CHARS ? `${a.slice(0, ARG_CHARS - 1)}…` : a
    }
  }
  return ''
}

function resultText(c: unknown): string {
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c.map((x: Rec) => (typeof x?.text === 'string' ? x.text : '')).filter(Boolean).join('\n')
}

function diffLines(hunks: unknown[]): DiffLine[] {
  const out: DiffLine[] = []
  for (const h of hunks as Rec[]) {
    if (!Array.isArray(h?.lines)) continue
    let o = num(h.oldStart)
    let n = num(h.newStart)
    for (const raw of h.lines) {
      if (typeof raw !== 'string' || raw.startsWith('\\')) continue
      const text = raw.slice(1)
      if (raw[0] === '-') out.push([o++, '-', text])
      else if (raw[0] === '+') out.push([n++, '+', text])
      else {
        out.push([n, ' ', text])
        o++
        n++
      }
    }
  }
  return out
}

function reduceUser(agg: TurnsAgg, r: Rec): void {
  const c = r.message?.content
  const blocks: Rec[] = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []
  for (const b of blocks) {
    if (b?.type === 'text' && typeof b.text === 'string') {
      if (r.isMeta || b.text.trimStart().startsWith('[Request interrupted')) continue
      const prompt = promptText(b.text)
      if (prompt) agg.turns.push({ prompt, entries: [] })
    } else if (b?.type === 'tool_result') {
      const e = agg.open.get(String(b.tool_use_id))
      if (!e || e.item.k !== 'tool') continue
      agg.open.delete(String(b.tool_use_id))
      fillResult(e, e.item, b, r.toolUseResult)
    }
  }
}

function fillResult(e: Entry, item: ToolItem, b: Rec, tur: unknown): void {
  const text = resultText(b.content)
  e.lines = text ? text.replace(/\n$/, '').split('\n').slice(0, KEEP_LINES) : []
  if (b.is_error === true) item.err = true
  const patch = tur && typeof tur === 'object' ? (tur as Rec).structuredPatch : null
  if (EDIT_TOOLS.has(item.tool) && Array.isArray(patch)) e.diff = diffLines(patch)
  if (item.tool === 'Bash' && /\bgh pr create\b/.test(item.arg)) {
    const m = PR_URL_RE.exec(text)
    if (m) item.link = m[0]
  }
}

function reduceAssistant(agg: TurnsAgg, r: Rec): void {
  const content = r.message?.content
  if (!Array.isArray(content)) return
  for (const b of content as Rec[]) {
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      const turn = current(agg)
      const last = turn.entries[turn.entries.length - 1]?.item
      // A streamed message can repeat its text block; show it once.
      if (last?.k === 'text' && last.md === b.text.trim()) continue
      turn.entries.push({ item: { k: 'text', md: b.text.trim() }, lines: [], diff: [] })
    } else if (b?.type === 'tool_use' && typeof b.name === 'string') {
      const e: Entry = { item: { k: 'tool', tool: b.name, name: toolLabel(b.name), arg: argOf(b.input) }, lines: [], diff: [] }
      current(agg).entries.push(e)
      if (typeof b.id === 'string') agg.open.set(b.id, e)
    }
  }
}

export function reduceTurnLine(agg: TurnsAgg, line: string): void {
  const r = parseRecord(line)
  if (!r || r.isSidechain) return
  const v = str(r.version)
  if (v) agg.cli = `Claude Code v${v}`
  switch (r.type) {
    case 'user':
      return reduceUser(agg, r)
    case 'assistant':
      return reduceAssistant(agg, r)
    case 'system':
      if (r.subtype === 'turn_duration') current(agg).footer = footerText(num(r.durationMs), str(r.timestamp))
      else if (r.subtype === 'away_summary' && str(r.content)) current(agg).recap = stripRecapSuffix(r.content)
  }
}

function payload(e: Entry): Item {
  if (e.item.k === 'text') return e.item
  const item: ToolItem = { ...e.item }
  if (e.diff.length) {
    item.a = e.diff.filter((l) => l[1] === '+').length
    item.d = e.diff.filter((l) => l[1] === '-').length
    item.diff = e.diff.slice(0, DIFF_LINES)
    if (e.diff.length > DIFF_LINES) item.more = e.diff.length - DIFF_LINES
  } else if (e.lines.length) {
    item.out = e.lines.slice(0, OUT_LINES)
    if (e.lines.length > OUT_LINES) item.more = e.lines.length - OUT_LINES
  }
  return item
}

export function finalizeTurns(agg: TurnsAgg): Transcript {
  return {
    cli: agg.cli ?? 'Claude Code',
    turns: agg.turns.map((t) => ({
      prompt: t.prompt,
      items: t.entries.map(payload),
      ...(t.footer ? { footer: t.footer } : {}),
      ...(t.recap ? { recap: t.recap } : {}),
    })),
  }
}

export function toolLines(agg: TurnsAgg, turn: number, item: number): string[] | null {
  const e = agg.turns[turn]?.entries[item]
  return e && e.item.k === 'tool' && e.lines.length ? e.lines : null
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/main/turns.ts && npm run typecheck`
Expected: 11 PASS, typecheck exits 0. If the footer test fails on the weekday, check that the test builds `done` with the local `Date` constructor as written (the footer is local time, like every other time in the app).

- [ ] **Step 5: Commit**

```bash
git add src/main/turns.ts
git commit -m "Reduce session records into transcript turns"
```

### Task 4: Transcript store and IPC handlers

**Files:**
- Create: `src/main/transcripts.ts`
- Modify: `src/main/index.ts:61-70, 79-82`

**Interfaces:**
- Consumes: `tailLines` (Task 2); `emptyTurnsAgg`, `reduceTurnLine`, `finalizeTurns`, `toolLines`, `TurnsAgg` (Task 3); `Transcript` (Task 1); `indexer.transcriptPath(id)`.
- Produces (`src/main/transcripts.ts`): `TranscriptStore { get(id: string): Promise<Transcript>; output(id: string, turn: number, item: number): Promise<string[]> }`, `createTranscriptStore(pathFor: (id: string) => string | undefined, keep?: number): TranscriptStore`.
- Produces: IPC handlers `getTranscript`, `getToolOutput` registered in main.
- Also modifies `src/shared/api.ts` (track A): adds the two `Api` methods and their `API_METHODS` entries.

- [ ] **Step 1: Write `src/main/transcripts.ts` with failing tests**

```ts
import { appendFileSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Transcript } from '../shared/api'
import { tailLines } from './lines'
import { emptyTurnsAgg, finalizeTurns, reduceTurnLine, toolLines, type TurnsAgg } from './turns'

// ponytail: four parsed sessions in memory; a fifth evicts the least recently requested.
const KEEP = 4

interface Entry { path: string; size: number; offset: number; agg: TurnsAgg }

export interface TranscriptStore {
  get(id: string): Promise<Transcript>
  output(id: string, turn: number, item: number): Promise<string[]>
}

export function createTranscriptStore(pathFor: (id: string) => string | undefined, keep = KEEP): TranscriptStore {
  // Map order is recency: a hit is deleted and re-set.
  const cache = new Map<string, Entry>()
  const inflight = new Map<string, Promise<Entry>>()

  async function tail(id: string): Promise<Entry> {
    const path = pathFor(id)
    if (!path) throw new Error('Unknown session')
    const size = statSync(path).size
    let e = cache.get(id)
    // ponytail: assumes append-only; a same-size rewrite is served from memory until the app restarts.
    if (!e || e.path !== path || size < e.offset) e = { path, size: -1, offset: 0, agg: emptyTurnsAgg(id) }
    if (size !== e.size) {
      const entry = e
      entry.offset = await tailLines(path, entry.offset, (line, next) => {
        reduceTurnLine(entry.agg, line)
        entry.offset = next
      })
      entry.size = size
    }
    cache.delete(id)
    cache.set(id, e)
    while (cache.size > keep) cache.delete(cache.keys().next().value as string)
    return e
  }

  // Two requests for one session must not tail the same bytes twice.
  function load(id: string): Promise<Entry> {
    const pending = inflight.get(id)
    if (pending) return pending
    const p = tail(id).finally(() => inflight.delete(id))
    inflight.set(id, p)
    return p
  }

  return {
    get: async (id) => finalizeTurns((await load(id)).agg),
    output: async (id, turn, item) => {
      const lines = toolLines((await load(id)).agg, turn, item)
      if (!lines) throw new Error('Unknown tool call')
      return lines
    },
  }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const a = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const b = '711a48a0-fc93-44b8-b71c-1c6e5b645970'
  const line = (o: object) => `${JSON.stringify({ sessionId: a, version: '2.1.283', timestamp: '2026-10-06T09:00:00.000Z', ...o })}\n`
  const prompt = (text: string) => line({ type: 'user', message: { content: text } })
  const call = (text: string) =>
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }) +
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] } })
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-tx-'))
    const paths: Record<string, string> = { [a]: join(dir, `${a}.jsonl`), [b]: join(dir, `${b}.jsonl`) }
    writeFileSync(paths[a], prompt('first'))
    writeFileSync(paths[b], prompt('other'))
    return { paths, store: createTranscriptStore((id) => paths[id], 1) }
  }

  it('parses a session once and tails only appended lines afterwards', async () => {
    const { paths, store } = fixture()
    expect((await store.get(a)).turns.map((t) => t.prompt)).toEqual(['first'])
    appendFileSync(paths[a], prompt('second'))
    expect((await store.get(a)).turns.map((t) => t.prompt)).toEqual(['first', 'second'])
    expect((await store.get(a)).turns).toHaveLength(2)
  })
  it('starts over when the file shrinks', async () => {
    const { paths, store } = fixture()
    appendFileSync(paths[a], prompt('second'))
    await store.get(a)
    writeFileSync(paths[a], prompt('fresh'))
    expect((await store.get(a)).turns.map((t) => t.prompt)).toEqual(['fresh'])
  })
  it('serves concurrent requests from one parse', async () => {
    const { paths, store } = fixture()
    appendFileSync(paths[a], call('one\ntwo\nthree\nfour'))
    const [x, y] = await Promise.all([store.get(a), store.get(a)])
    expect(x.turns[0].items).toHaveLength(1)
    expect(y.turns[0].items).toHaveLength(1)
  })
  it('returns full tool output and rejects indices that point at nothing', async () => {
    const { paths, store } = fixture()
    appendFileSync(paths[a], call('one\ntwo\nthree\nfour'))
    expect((await store.get(a)).turns[0].items[0]).toMatchObject({ out: ['one', 'two', 'three'], more: 1 })
    expect(await store.output(a, 0, 0)).toEqual(['one', 'two', 'three', 'four'])
    await expect(store.output(a, 0, 5)).rejects.toThrow('Unknown tool call')
    await expect(store.output(a, 9, 0)).rejects.toThrow('Unknown tool call')
  })
  it('still serves a session after others pushed it out of memory', async () => {
    const { paths, store } = fixture()
    await store.get(a)
    await store.get(b)
    appendFileSync(paths[a], prompt('second'))
    expect((await store.get(a)).turns.map((t) => t.prompt)).toEqual(['first', 'second'])
  })
  it('rejects a session the index does not know', async () => {
    const store = createTranscriptStore(() => undefined)
    await expect(store.get(a)).rejects.toThrow('Unknown session')
  })
}
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/main/transcripts.ts`
Expected: 6 PASS.

- [ ] **Step 3: Add the two methods to `src/shared/api.ts`**

In `interface Api`, after `setStatusTee(enabled: boolean): Promise<void>`:

```ts
  getTranscript(id: string): Promise<Transcript>
  getToolOutput(id: string, turn: number, item: number): Promise<string[]>
```

In `API_METHODS`, after `'setStatusTee',`:

```ts
  'getTranscript',
  'getToolOutput',
```

- [ ] **Step 4: Register the handlers in `src/main/index.ts`**

Add the import `import { createTranscriptStore } from './transcripts'`. After the `indexer` is created (after the `createIndexer({...})` call):

```ts
  const transcripts = createTranscriptStore((id) => indexer.transcriptPath(id))
```

In `registerIpc({...})`, after the `setStatusTee` handler:

```ts
    getTranscript: async (id) => transcripts.get(sessionFor(id).id),
    getToolOutput: async (id, turn, item) => {
      if (!Number.isInteger(turn) || !Number.isInteger(item) || turn < 0 || item < 0) throw new Error('Invalid tool call')
      return transcripts.output(sessionFor(id).id, turn, item)
    },
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck`
Expected: all PASS; typecheck exits 0 (the `_allMethodsListed` check passes because both methods are in `API_METHODS`; the preload needs no change, it loops over the list).

- [ ] **Step 6: Commit**

```bash
git add src/main/transcripts.ts src/main/index.ts src/shared/api.ts
git commit -m "Serve session transcripts over IPC from a tail cache"
```

### Task 5: Pane limits and clamps

**Files:**
- Create: `src/shared/panes.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/shared/panes.ts`): `PaneKey = 'side' | 'list' | 'pal'`, `PaneWidths { side: number; list: number; pal: number }`, `PANES: Record<PaneKey, { default: number; min: number; max: number }>`, `DETAIL_MIN = 360`, `PANES_KEY = 'paneWidths'`, `paneMax(key: PaneKey, other: number, windowWidth: number): number`, `clampPane(key: PaneKey, w: number, other: number, windowWidth: number): number`, `readPaneWidths(raw: string | null, windowWidth: number): PaneWidths`.

- [ ] **Step 1: Write `src/shared/panes.ts` with its tests**

```ts
export type PaneKey = 'side' | 'list' | 'pal'
export interface PaneWidths { side: number; list: number; pal: number }

export const PANES: Record<PaneKey, { default: number; min: number; max: number }> = {
  side: { default: 220, min: 160, max: 360 },
  list: { default: 380, min: 280, max: 600 },
  pal: { default: 380, min: 260, max: 520 },
}
export const DETAIL_MIN = 360
export const PANES_KEY = 'paneWidths'

// The tree and the list share the window with a detail pane that never drops below DETAIL_MIN;
// `other` is the width of the one that is not being resized. The command bar column has no neighbour.
export function paneMax(key: PaneKey, other: number, windowWidth: number): number {
  const p = PANES[key]
  if (key === 'pal') return p.max
  return Math.max(p.min, Math.min(p.max, windowWidth - DETAIL_MIN - other))
}

export const clampPane = (key: PaneKey, w: number, other: number, windowWidth: number): number =>
  Math.min(paneMax(key, other, windowWidth), Math.max(PANES[key].min, Math.round(w)))

export function readPaneWidths(raw: string | null, windowWidth: number): PaneWidths {
  let j: Record<string, unknown> = {}
  try {
    const v = JSON.parse(raw ?? 'null')
    if (v && typeof v === 'object') j = v
  } catch {
    // A bad stored value just means defaults.
  }
  const n = (k: PaneKey) => (typeof j[k] === 'number' && Number.isFinite(j[k]) ? (j[k] as number) : PANES[k].default)
  const side = clampPane('side', n('side'), clampPane('list', n('list'), PANES.side.min, windowWidth), windowWidth)
  const list = clampPane('list', n('list'), side, windowWidth)
  return { side, list, pal: clampPane('pal', n('pal'), 0, windowWidth) }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('keeps each pane between its minimum and maximum, in whole pixels', () => {
    expect(clampPane('side', 100, 380, 1360)).toBe(160)
    expect(clampPane('side', 1000, 380, 1360)).toBe(360)
    expect(clampPane('side', 250.4, 380, 1360)).toBe(250)
    expect(clampPane('list', 100, 220, 1360)).toBe(280)
    expect(clampPane('list', 900, 220, 1360)).toBe(600)
    expect(clampPane('pal', 100, 0, 1360)).toBe(260)
    expect(clampPane('pal', 900, 0, 1360)).toBe(520)
  })
  it('leaves the detail pane at least 360 pixels', () => {
    expect(paneMax('side', 380, 1000)).toBe(260)
    expect(paneMax('list', 220, 1000)).toBe(420)
    expect(clampPane('list', 600, 220, 1000)).toBe(420)
    expect(paneMax('side', 600, 1000)).toBe(160)
    expect(paneMax('pal', 999, 1000)).toBe(520)
  })
  it('reads stored widths, clamping each and falling back to defaults for bad values', () => {
    expect(readPaneWidths(null, 1360)).toEqual({ side: 220, list: 380, pal: 380 })
    expect(readPaneWidths('{nope', 1360)).toEqual({ side: 220, list: 380, pal: 380 })
    expect(readPaneWidths('{"side":300,"list":"x","pal":9999}', 1360)).toEqual({ side: 300, list: 380, pal: 520 })
    expect(readPaneWidths('{"side":360,"list":600}', 1000)).toEqual({ side: 160, list: 480, pal: 380 })
  })
}
```

- [ ] **Step 2: Run the tests and the typecheck**

Run: `npx vitest run src/shared/panes.ts && npm run typecheck`
Expected: 3 PASS, typecheck exits 0. The last case: at 1000px, side is clamped first against a list of 600 (`1000 − 360 − 600 = 40`, raised to the 160 minimum), then list against that side (`1000 − 360 − 160 = 480`).

- [ ] **Step 3: Commit**

```bash
git add src/shared/panes.ts
git commit -m "Add pane width limits and clamps"
```

### Task 6: Transcript view-model

**Files:**
- Create: `src/shared/transcriptView.ts`

**Interfaces:**
- Consumes: `Item`, `ToolItem`, `Transcript` (Task 1); `makeTranscript` (Task 1) in tests; `plural` from `src/shared/format.ts`.
- Produces (`src/shared/transcriptView.ts`): `Filter`, `FILTERS: { id: Filter; label: string }[]`, `ViewState`, `Row` (`TextRow | ToolRow | GroupRow`), `TurnView`, `View`, `isEdit(it: Item): boolean`, `hasBody(it: ToolItem): boolean`, `transcriptView(t: Transcript, s: ViewState): View`.

- [ ] **Step 1: Write the failing tests in `src/shared/transcriptView.ts`**

Create the file with the imports, `export {}`, and this block. The fixture is `makeTranscript()` from Task 1: turn 0 has items `0 Bash (3 lines + 108 more)`, `1 text`, `2 Search (no body)`, `3 Bash`, `4 Update (diff +2 −2)`, `5 Bash (PR link)`, a footer and a recap; turn 1 has `0 Bash (failed)` and `1 text`.

```ts
import { plural } from './format'
import { makeTranscript } from './fixtures'
import type { Item, ToolItem, Transcript } from './api'

export {}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const t = makeTranscript()
  const state = (over: Partial<ViewState> = {}): ViewState => ({ filter: 'all', expandAll: false, openRows: {}, openGroups: {}, ...over })
  const kinds = (rows: Row[]) => rows.map((r) => (r.kind === 'group' ? `group(${r.label})` : `${r.kind}:${r.key}`))

  it('counts items per filter', () => {
    expect(transcriptView(t, state()).counts).toEqual({ all: 8, msg: 2, tools: 6, edits: 1, errors: 1 })
  })
  it('folds three or more consecutive tool calls into a step group under All only', () => {
    const all = transcriptView(t, state())
    expect(kinds(all.turns[0].rows)).toEqual(['tool:0:0', 'text:0:1', 'group(4 steps)'])
    const g = all.turns[0].rows[2]
    expect(g.kind === 'group' && g.summary).toBe('Search · Bash ×2 · Update')
    expect(g.kind === 'group' && g.members.map((m) => m.key)).toEqual(['0:2', '0:3', '0:4', '0:5'])
    expect(kinds(transcriptView(t, state({ filter: 'tools' })).turns[0].rows)).toEqual(['tool:0:0', 'tool:0:2', 'tool:0:3', 'tool:0:4', 'tool:0:5'])
  })
  it('writes the turn label and meta line from every item, not just the shown ones', () => {
    const v = transcriptView(t, state({ filter: 'msg' }))
    expect(v.turns[0]).toMatchObject({ index: 0, label: 'Turn 1', meta: '5 steps · 1 edit' })
    expect(v.turns[1]).toMatchObject({ index: 1, label: 'Turn 2', meta: '1 step' })
  })
  it('shows prompts and recaps under All and Messages, footers under All only', () => {
    const all = transcriptView(t, state()).turns[0]
    expect(all).toMatchObject({ prompt: t.turns[0].prompt, footer: t.turns[0].footer, recap: t.turns[0].recap })
    const msg = transcriptView(t, state({ filter: 'msg' })).turns[0]
    expect(msg).toMatchObject({ prompt: t.turns[0].prompt, footer: null, recap: t.turns[0].recap })
    expect(kinds(msg.rows)).toEqual(['text:0:1'])
    const tools = transcriptView(t, state({ filter: 'tools' })).turns[0]
    expect(tools).toMatchObject({ prompt: null, footer: null, recap: null })
  })
  it('drops turns with nothing to show and flags an empty result for the narrow filters', () => {
    const edits = transcriptView(t, state({ filter: 'edits' }))
    expect(edits.turns.map((x) => x.index)).toEqual([0])
    expect(kinds(edits.turns[0].rows)).toEqual(['tool:0:4'])
    const errors = transcriptView(t, state({ filter: 'errors' }))
    expect(errors.turns.map((x) => x.index)).toEqual([1])
    expect(errors.empty).toBe(false)
    const clean: Transcript = { cli: 'x', turns: [{ prompt: 'p', items: [{ k: 'text', md: 'hi' }] }] }
    expect(transcriptView(clean, state({ filter: 'errors' })).empty).toBe(true)
    expect(transcriptView(clean, state({ filter: 'errors' })).turns).toEqual([])
    expect(transcriptView(clean, state({ filter: 'msg' })).empty).toBe(false)
  })
  it('keys open rows by their place in the original list so the state survives a filter change', () => {
    const open = { '0:3': true }
    const all = transcriptView(t, state({ openRows: open, openGroups: { '0:g2': true } }))
    const g = all.turns[0].rows[2]
    expect(g.kind === 'group' && g.open).toBe(true)
    expect(g.kind === 'group' && g.members.map((m) => m.open)).toEqual([false, true, false, false])
    const tools = transcriptView(t, state({ filter: 'tools', openRows: open })).turns[0].rows
    expect(tools.map((r) => r.kind === 'tool' && r.open)).toEqual([false, false, true, false, false])
  })
  it('lets expand-all open every row and group unless a group was closed by hand', () => {
    const v = transcriptView(t, state({ expandAll: true, openGroups: { '0:g2': false } }))
    const g = v.turns[0].rows[2]
    expect(g.kind === 'group' && g.open).toBe(false)
    expect(g.kind === 'group' && g.members.every((m) => m.open)).toBe(true)
    expect(v.turns[1].rows[0]).toMatchObject({ kind: 'tool', open: true })
  })
  it('knows which rows have a body and which items are edits', () => {
    const items = t.turns[0].items as ToolItem[]
    expect(hasBody(items[0])).toBe(true)
    expect(hasBody(items[2])).toBe(false)
    expect(hasBody(items[5])).toBe(true)
    expect(isEdit(items[4])).toBe(true)
    expect(isEdit(items[0])).toBe(false)
    expect(isEdit({ k: 'text', md: 'x' })).toBe(false)
    expect(FILTERS.map((f) => f.label)).toEqual(['All', 'Messages', 'Tools', 'Edits', 'Errors'])
  })
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/transcriptView.ts`
Expected: FAIL with `transcriptView is not defined` (or an import error).

- [ ] **Step 3: Write the view-model, replacing `export {}`**

```ts
export type Filter = 'all' | 'msg' | 'tools' | 'edits' | 'errors'
export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'msg', label: 'Messages' },
  { id: 'tools', label: 'Tools' },
  { id: 'edits', label: 'Edits' },
  { id: 'errors', label: 'Errors' },
]

export interface ViewState {
  filter: Filter
  expandAll: boolean
  openRows: Record<string, boolean>
  openGroups: Record<string, boolean>
}

export interface TextRow { kind: 'text'; key: string; md: string }
export interface ToolRow { kind: 'tool'; key: string; turn: number; index: number; item: ToolItem; open: boolean; hasBody: boolean; inGroup: boolean }
export interface GroupRow { kind: 'group'; key: string; label: string; summary: string; failed: number; open: boolean; members: ToolRow[] }
export type Row = TextRow | ToolRow | GroupRow

export interface TurnView {
  index: number
  label: string
  meta: string
  prompt: string | null
  rows: Row[]
  footer: string | null
  recap: string | null
}
export interface View { counts: Record<Filter, number>; turns: TurnView[]; empty: boolean }

const GROUP_MIN = 3

export const isEdit = (it: Item): boolean => it.k === 'tool' && (it.diff !== undefined || it.a !== undefined)
const isErr = (it: Item): boolean => it.k === 'tool' && !!it.err
export const hasBody = (it: ToolItem): boolean => !!(it.out?.length || it.diff || it.link)

const matches = (it: Item, f: Filter): boolean =>
  f === 'all' || (f === 'msg' && it.k === 'text') || (f === 'tools' && it.k === 'tool') || (f === 'edits' && isEdit(it)) || (f === 'errors' && isErr(it))

export function transcriptView(t: Transcript, s: ViewState): View {
  const flat = t.turns.flatMap((x) => x.items)
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, flat.filter((it) => matches(it, f.id)).length])) as Record<Filter, number>
  const showPrompt = s.filter === 'all' || s.filter === 'msg'
  let shown = 0
  const turns: TurnView[] = []

  t.turns.forEach((turn, ti) => {
    const kept = turn.items.map((item, index) => ({ item, index })).filter((x) => matches(x.item, s.filter))
    const toolRow = (x: { item: Item; index: number }, inGroup: boolean): ToolRow => {
      const key = `${ti}:${x.index}`
      const item = x.item as ToolItem
      return { kind: 'tool', key, turn: ti, index: x.index, item, open: s.expandAll || !!s.openRows[key], hasBody: hasBody(item), inGroup }
    }
    const rows: Row[] = []
    let i = 0
    while (i < kept.length) {
      const x = kept[i]
      if (x.item.k === 'text') {
        rows.push({ kind: 'text', key: `${ti}:${x.index}`, md: x.item.md })
        i++
        continue
      }
      let j = i
      while (j < kept.length && kept[j].item.k === 'tool') j++
      const run = kept.slice(i, j)
      if (s.filter === 'all' && run.length >= GROUP_MIN) {
        const key = `${ti}:g${x.index}`
        const byName = new Map<string, number>()
        for (const r of run) byName.set((r.item as ToolItem).name, (byName.get((r.item as ToolItem).name) ?? 0) + 1)
        rows.push({
          kind: 'group',
          key,
          label: `${run.length} steps`,
          summary: [...byName].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · '),
          failed: run.filter((r) => isErr(r.item)).length,
          open: s.openGroups[key] ?? s.expandAll,
          members: run.map((r) => toolRow(r, true)),
        })
      } else {
        for (const r of run) rows.push(toolRow(r, false))
      }
      i = j
    }
    shown += rows.length
    const tools = turn.items.filter((it) => it.k === 'tool').length
    const edits = turn.items.filter(isEdit).length
    const prompt = showPrompt && turn.prompt ? turn.prompt : null
    const footer = s.filter === 'all' && turn.footer ? turn.footer : null
    const recap = showPrompt && turn.recap ? turn.recap : null
    if (rows.length || prompt || footer || recap) {
      turns.push({ index: ti, label: `Turn ${ti + 1}`, meta: `${plural(tools, 'step')}${edits ? ` · ${plural(edits, 'edit')}` : ''}`, prompt, rows, footer, recap })
    }
  })

  return { counts, turns, empty: shown === 0 && !showPrompt }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/shared/transcriptView.ts && npm run typecheck`
Expected: 8 PASS, typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/transcriptView.ts
git commit -m "Add the transcript view-model"
```

### Task 7: Shared resize handle and resizable tree, list and results column

**Files:**
- Create: `src/renderer/src/Resize.tsx`, `src/renderer/src/Resize.css`
- Modify: `src/renderer/src/Sidebar.tsx`, `src/renderer/src/Sidebar.css`
- Modify: `src/renderer/src/SessionList.tsx`, `src/renderer/src/SessionList.css`
- Modify: `src/renderer/src/CommandBar.tsx`, `src/renderer/src/CommandBar.css`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `PANES`, `PANES_KEY`, `PaneKey`, `PaneWidths`, `paneMax`, `clampPane`, `readPaneWidths` (Task 5).
- Produces (`Resize.tsx`): `ResizeHandle({ width, min, max, defaultWidth, label, onWidth }: ResizeProps)`.
- Produces: `SidebarProps` gains `maxWidth: number` and loses nothing else; `SessionListProps` gains `width: number; maxWidth: number; onWidth(width: number): void`; `CommandBarProps` gains `resultsWidth: number; onResultsWidth(width: number): void`. `Deck` holds `panes: PaneWidths` and persists it under `paneWidths`.

- [ ] **Step 1: Write `src/renderer/src/Resize.tsx` and `Resize.css`**

`Resize.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import './Resize.css'

const KEY_STEP = 16

export interface ResizeProps {
  width: number
  min: number
  max: number
  defaultWidth: number
  label: string
  onWidth(width: number): void
}

export function ResizeHandle({ width, min, max, defaultWidth, label, onWidth }: ResizeProps) {
  const clamp = (w: number) => Math.min(max, Math.max(min, Math.round(w)))
  return (
    <div
      className="resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onDoubleClick={() => onWidth(defaultWidth)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const startX = e.clientX
        const startWidth = width
        const el = e.currentTarget
        // Window listeners, ended by release, blur or a buttonless move, so a lost pointerup can't leave the drag stuck.
        const end = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('blur', end)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          el.classList.remove('is-dragging')
        }
        const move = (ev: PointerEvent) => {
          if (!(ev.buttons & 1)) return end()
          onWidth(clamp(startWidth + ev.clientX - startX))
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('blur', end)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        el.classList.add('is-dragging')
      }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0
        if (!step) return
        e.preventDefault()
        onWidth(clamp(width + step))
      }}
    />
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('renders a focusable separator that reports its width and limits', () => {
    const html = renderToStaticMarkup(<ResizeHandle width={250} min={160} max={360} defaultWidth={220} label="Resize sidebar" onWidth={() => {}} />)
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-label="Resize sidebar"')
    expect(html).toContain('aria-valuenow="250"')
    expect(html).toContain('aria-valuemax="360"')
    expect(html).toContain('tabindex="0"')
  })
}
```

`Resize.css`:

```css
/* On the pane's right edge; no-drag keeps it grabbable inside a title-bar drag region. */
.resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 5px;
  height: 100%;
  z-index: 5;
  cursor: col-resize;
  outline: none;
  -webkit-app-region: no-drag;
}

.resize:hover,
.resize:focus-visible,
.resize.is-dragging {
  box-shadow: inset -2px 0 0 var(--app-focus);
}
```

- [ ] **Step 2: Move the sidebar onto the shared handle**

In `src/renderer/src/Sidebar.tsx`:
- Delete `SIDEBAR_WIDTH`, `MIN_WIDTH`, `MAX_WIDTH`, `KEY_STEP`, `clampSidebarWidth` and the local `ResizeHandle` function.
- Add imports: `import { PANES } from '../../shared/panes'` and `import { ResizeHandle } from './Resize'`.
- `SidebarProps`: add `maxWidth: number` after `width`.
- In `Sidebar`, destructure `maxWidth` and render:
  ```tsx
      <ResizeHandle width={width} min={PANES.side.min} max={maxWidth} defaultWidth={PANES.side.default} label="Resize sidebar" onWidth={onWidth} />
  ```
- Tests: delete the `keeps the sidebar between 180 and 360 pixels wide` test. Change the `render` helper's signature to `(scope: Scope, expanded: Record<string, boolean>, width = PANES.side.default)` and pass `maxWidth={360}` to `<Sidebar>`. The separator test keeps its four assertions.

In `src/renderer/src/Sidebar.css`, delete the `.sidebar-resize` rule, its hover rule and the comment above them.

- [ ] **Step 3: Make the list resizable**

In `src/renderer/src/SessionList.tsx`:
- Imports: `import { PANES } from '../../shared/panes'`, `import { ResizeHandle } from './Resize'`.
- `SessionListProps`: add `width: number`, `maxWidth: number`, `onWidth(width: number): void` after `title`.
- Render:
  ```tsx
    <section className="list" style={{ width: p.width }}>
      <ResizeHandle width={p.width} min={PANES.list.min} max={p.maxWidth} defaultWidth={PANES.list.default} label="Resize session list" onWidth={p.onWidth} />
      <header className="list-header">
  ```
- Tests: add `width: 380, maxWidth: 600, onWidth: () => {}` to `base`, and to the first test add:
  ```ts
      expect(html).toContain('class="list" style="width:380px"')
      expect(html).toContain('aria-label="Resize session list"')
  ```

In `src/renderer/src/SessionList.css`, the `.list` rule becomes:

```css
.list {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  box-shadow: inset -1px 0 0 var(--app-divider);
}
```

- [ ] **Step 4: Make the command bar's results column resizable**

In `src/renderer/src/CommandBar.tsx`:
- Imports: `import { PANES } from '../../shared/panes'`, `import { ResizeHandle } from './Resize'`.
- `CommandBarProps`: add `resultsWidth: number` and `onResultsWidth(width: number): void` after `note`.
- Wrap the results list so the handle sits on a non-scrolling column:
  ```tsx
        <div className="bar-body">
          <div className="bar-results-col" style={{ width: p.resultsWidth }}>
            <ResizeHandle width={p.resultsWidth} min={PANES.pal.min} max={PANES.pal.max} defaultWidth={PANES.pal.default} label="Resize results" onWidth={p.onResultsWidth} />
            <div className="bar-results" ref={listRef}>
              … (the existing groups and the empty state, unchanged)
            </div>
          </div>
          <div className="bar-preview">
  ```
- Tests: the `render` helper passes `resultsWidth={380} onResultsWidth={() => {}}`.

In `src/renderer/src/CommandBar.css`, replace the `.bar-results` rule with:

```css
.bar-results-col {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow: inset -1px 0 0 var(--app-divider);
}

.bar-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}
```

- [ ] **Step 5: Hold and persist the three widths in `Deck`**

In `src/renderer/src/App.tsx`:
- Replace the `Sidebar` import line with `import { Sidebar } from './Sidebar'` and add `import { clampPane, PANES_KEY, paneMax, readPaneWidths, type PaneKey, type PaneWidths } from '../../shared/panes'`.
- Delete `LIST_WIDTH`, `SIDEBAR_KEY`, `savedSidebarWidth` and the comment above `LIST_WIDTH`. Add:
  ```ts
  // Static renders in tests have no window; the default window width stands in.
  const windowWidth = () => (typeof window === 'undefined' ? 1360 : window.innerWidth)

  function savedPanes(): PaneWidths {
    try {
      return readPaneWidths(localStorage.getItem(PANES_KEY), windowWidth())
    } catch {
      return readPaneWidths(null, windowWidth())
    }
  }
  ```
- In `Deck`, replace `const [sidebarWidth, setSidebarWidth] = useState(savedSidebarWidth)` with:
  ```ts
  const [panes, setPanes] = useState<PaneWidths>(savedPanes)
  const [winWidth, setWinWidth] = useState(windowWidth)
  ```
  Replace the `sidebarWidth` persistence effect with:
  ```ts
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(PANES_KEY, JSON.stringify(panes))
    } catch {
      // Storage unavailable: the widths just reset on the next launch.
    }
  }, [panes])

  const setPane = (k: PaneKey) => (w: number) =>
    setPanes((p) => ({ ...p, [k]: clampPane(k, w, k === 'side' ? p.list : k === 'list' ? p.side : 0, winWidth) }))
  ```
- In the JSX:
  ```tsx
      <div className="app-drag" style={{ left: panes.side + panes.list }} />
      <Sidebar
        tree={tree}
        scope={scope}
        expanded={open}
        width={panes.side}
        maxWidth={paneMax('side', panes.list, winWidth)}
        onWidth={setPane('side')}
        …
      />
      <SessionList
        title={scopeTitle(scope, tree)}
        width={panes.list}
        maxWidth={paneMax('list', panes.side, winWidth)}
        onWidth={setPane('list')}
        …
      />
  ```
  and on `<CommandBar …>` add `resultsWidth={panes.pal}` and `onResultsWidth={setPane('pal')}`.

- [ ] **Step 6: Run the suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS (Resize, Sidebar, SessionList, CommandBar, App tests included), typecheck exits 0.

- [ ] **Step 7: Check it in the app**

Run `npm run dev` and confirm: dragging the tree's and list's right edges resizes them with the purple 2px mark on hover; the detail pane never goes under 360px wide as the window narrows; double-clicking a handle resets it; ⌘⇧P then dragging the results column's edge resizes it between 260 and 520; after relaunch the widths are back. Quit the app.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/Resize.tsx src/renderer/src/Resize.css src/renderer/src/Sidebar.tsx src/renderer/src/Sidebar.css src/renderer/src/SessionList.tsx src/renderer/src/SessionList.css src/renderer/src/CommandBar.tsx src/renderer/src/CommandBar.css src/renderer/src/App.tsx
git commit -m "Make the tree, list and command bar results resizable"
```

### Task 8: Transcript component

**Files:**
- Create: `src/renderer/src/Transcript.tsx`, `src/renderer/src/Transcript.css`
- Modify: `package.json`, `package-lock.json` (the install)

**Interfaces:**
- Consumes: `Transcript`, `ToolItem`, `Session`, `IconName` (Task 1); `transcriptView`, `FILTERS`, `Filter`, `ViewState`, `Row`, `hasBody` (Task 6); `Icon` from `icons.tsx`; `Button`; `agoLong`, `modelLabel`, `tildify` from `format.ts`; `makeSession`, `makeTranscript` in tests.
- Produces (`Transcript.tsx`): `TranscriptProps { session: Session; transcript: Transcript | null; error: string | null; now: Date; onResume(): void; loadOutput(turn: number, item: number): Promise<string[]> }`, `Transcript(p: TranscriptProps)` whose root is the tab's own scroll body (`<div className="tx">`, `flex: 1; overflow-y: auto`), `DiffView({ item })`, `toolIcon(tool: string): IconName`.

- [ ] **Step 1: Install the two markdown packages**

Run:
```bash
npm install -D react-markdown@10 remark-gfm@4
```
Expected: `package.json` gains both under `devDependencies` and no `dependencies` key appears. If npm reports a peer warning about React, ignore it: react-markdown 10 declares `react >=18`.

- [ ] **Step 2: Write the failing tests in `src/renderer/src/Transcript.tsx`**

Create the file with the imports, a placeholder `export {}`, and this block:

```tsx
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { IconName, Session, ToolItem, Transcript as TranscriptData } from '../../shared/api'
import { makeSession, makeTranscript } from '../../shared/fixtures'
import { agoLong, modelLabel, tildify } from '../../shared/format'
import { FILTERS, transcriptView, type Filter, type GroupRow, type ToolRow } from '../../shared/transcriptView'
import { Button } from './Button'
import { Icon } from './icons'
import './Transcript.css'

export {}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const now = new Date(2026, 9, 6, 11, 0)
  const noop = () => {}
  const load = () => Promise.resolve([] as string[])
  const session = makeSession({ title: 'live-meeting', cwd: '/Users/me/code/meetnotes' })
  const render = (over: Partial<TranscriptProps> = {}) =>
    renderToStaticMarkup(<Transcript session={session} transcript={makeTranscript()} error={null} now={now} onResume={noop} loadOutput={load} {...over} />)

  it('shows the header line, the filter counts and the turns with their rows', () => {
    const html = render()
    expect(html).toContain('>live-meeting</h2>')
    expect(html).toContain('Claude Code v2.1.283 · Opus 5.5 · xhigh effort · ~/code/meetnotes')
    expect(html).toContain('All<span class="seg-count tnum">8</span>')
    expect(html).toContain('Errors<span class="seg-count tnum">1</span>')
    expect(html).toContain('>Turn 1<')
    expect(html).toContain('>5 steps · 1 edit<')
    expect(html).toContain('>Bash</span>')
    expect(html).toContain('>+108 lines<')
    expect(html).toContain('>4 steps</span>')
    expect(html).toContain('Search · Bash ×2 · Update')
    expect(html).toContain('>failed<')
    expect(html).toContain('Worked for 30m 42s · done Monday 12:42 PM')
    expect(html).toContain('>Recap<')
    expect(html).toContain('<strong>PR #28</strong>')
    expect(html).toContain('>Expand all<')
  })
  it('renders assistant markdown with bullets, inline code and bold', () => {
    const html = render()
    expect(html).toContain('<code>splitForWhisper</code>')
    expect(html).toContain('<li>check the abort signal</li>')
    expect(html).toContain('<strong>Resume</strong>')
  })
  it('draws a diff as numbered lines with signs on tinted add and delete rows', () => {
    const html = renderToStaticMarkup(<DiffView item={makeTranscript().turns[0].items[4] as ToolItem} />)
    expect(html).toContain('tx-diff-line is-del')
    expect(html).toContain('tx-diff-line is-add')
    expect(html).toContain('<span class="tx-diff-n tnum">23</span><span class="tx-diff-sign">−</span>')
    expect(html).toContain('<span class="tx-diff-n tnum">23</span><span class="tx-diff-sign">+</span>')
    expect(html).toContain('signal?: AbortSignal')
  })
  it('says the session is waiting while live and when it ended otherwise, with a Resume button', () => {
    expect(render()).toContain('Session ended Today, 9:12 AM')
    expect(render({ session: makeSession({ live: true }) })).toContain('Waiting for your next message')
    expect(render()).toContain('>Resume</button>')
  })
  it('shows the read error and hides the toolbar and end bar until the transcript loads', () => {
    const html = render({ transcript: null, error: 'boom' })
    expect(html).toContain('read the session file.')
    expect(html).not.toContain('seg-count')
    expect(html).not.toContain('tx-end')
  })
  it('maps tools to their icons', () => {
    expect(['Bash', 'Grep', 'Glob', 'Read', 'Edit', 'MultiEdit', 'Write', 'Skill', 'Agent'].map(toolIcon)).toEqual([
      'Code', 'Search1', 'Search1', 'Document', 'Edit', 'Edit', 'Edit2', 'Bolt', 'Code',
    ])
  })
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/Transcript.tsx`
Expected: FAIL with `Transcript is not defined` (or a missing `Transcript.css`; create the file empty if so).

- [ ] **Step 4: Write the component, replacing `export {}`**

```tsx
const TURNS_PAGE = 30
const PIN_PX = 64
const TOP_PX = 48
const ICONS: Record<string, IconName> = { Bash: 'Code', Grep: 'Search1', Glob: 'Search1', Read: 'Document', Edit: 'Edit', MultiEdit: 'Edit', Write: 'Edit2', Skill: 'Bolt' }

export const toolIcon = (tool: string): IconName => ICONS[tool] ?? 'Code'

export interface TranscriptProps {
  session: Session
  transcript: TranscriptData | null
  error: string | null
  now: Date
  onResume(): void
  loadOutput(turn: number, item: number): Promise<string[]>
}

function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          img: ({ alt }) => <span>{alt ?? ''}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

const moreNote = (n: number) => `${n} more lines in the session file`

export function DiffView({ item }: { item: ToolItem }) {
  return (
    <div className="tx-box tx-diff">
      {(item.diff ?? []).map(([n, sign, text], i) => (
        <div key={i} className={sign === '+' ? 'tx-diff-line is-add' : sign === '-' ? 'tx-diff-line is-del' : 'tx-diff-line'}>
          <span className="tx-diff-n tnum">{n}</span>
          <span className="tx-diff-sign">{sign === '+' ? '+' : sign === '-' ? '−' : ''}</span>
          <span className="tx-diff-text">{text}</span>
        </div>
      ))}
      {item.more ? <div className="tx-more tx-diff-more">{moreNote(item.more)}</div> : null}
    </div>
  )
}

function Output({ item, full }: { item: ToolItem; full: string[] | undefined }) {
  const lines = full ?? item.out ?? []
  return (
    <div className={item.err ? 'tx-box tx-out is-err' : 'tx-box tx-out'}>
      {lines.map((l, i) => <div key={i} className="tx-out-line">{l}</div>)}
      {!full && item.more ? <div className="tx-more">{moreNote(item.more)}</div> : null}
    </div>
  )
}

function ToolRowView({ row, full, onToggle }: { row: ToolRow; full: string[] | undefined; onToggle(row: ToolRow): void }) {
  const it = row.item
  const meta = it.a !== undefined ? '' : it.more ? `+${it.more} lines` : it.err ? 'failed' : ''
  return (
    <>
      <div className="tx-tool" title={it.arg} onClick={row.hasBody ? () => onToggle(row) : undefined}>
        <span className={it.err ? 'tx-tool-icon is-err' : 'tx-tool-icon'}><Icon name={toolIcon(it.tool)} size={14} /></span>
        <span className="tx-tool-name">{it.name}</span>
        <span className="tx-tool-arg mono">{it.arg}</span>
        {it.a !== undefined ? (
          <span className="tx-stat tnum"><span className="tx-add">{`+${it.a}`}</span><span className="tx-del">{`−${it.d ?? 0}`}</span></span>
        ) : meta ? (
          <span className="tx-meta">{meta}</span>
        ) : null}
        <span className="tx-chev" style={{ transform: row.open ? 'none' : 'rotate(-90deg)', opacity: row.hasBody ? 1 : 0 }}>
          <Icon name="ChevronDown2" size={10} />
        </span>
      </div>
      {row.open && row.hasBody && (
        <div className="tx-body">
          {it.diff ? <DiffView item={it} /> : it.out?.length ? <Output item={it} full={full} /> : null}
          {it.link && (
            <a className="tx-link" href={it.link} target="_blank" rel="noreferrer">
              <Icon name="Branch" size={14} />
              <span className="tx-link-url">{it.link}</span>
            </a>
          )}
        </div>
      )}
    </>
  )
}

function GroupView({ row, full, onToggle, onToggleGroup }: {
  row: GroupRow
  full: Record<string, string[]>
  onToggle(row: ToolRow): void
  onToggleGroup(row: GroupRow): void
}) {
  return (
    <>
      <div className="tx-group" onClick={() => onToggleGroup(row)}>
        <span className="tx-tool-icon"><Icon name="Layers" size={14} /></span>
        <span className="tx-tool-name">{row.label}</span>
        <span className="tx-group-sum">{row.summary}</span>
        {row.failed > 0 && <span className="tx-group-err">{`${row.failed} failed`}</span>}
        <span className="tx-chev" style={{ transform: row.open ? 'none' : 'rotate(-90deg)' }}><Icon name="ChevronDown2" size={10} /></span>
      </div>
      {row.open && (
        <div className="tx-members">
          {row.members.map((m) => <ToolRowView key={m.key} row={m} full={full[m.key]} onToggle={onToggle} />)}
        </div>
      )}
    </>
  )
}

export function Transcript(p: TranscriptProps) {
  const s = p.session
  const [filter, setFilter] = useState<Filter>('all')
  const [expandAll, setExpandAll] = useState(false)
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [full, setFull] = useState<Record<string, string[]>>({})
  const [shown, setShown] = useState(TURNS_PAGE)
  const scroll = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const grewFrom = useRef(0)

  const view = useMemo(
    () => (p.transcript ? transcriptView(p.transcript, { filter, expandAll, openRows, openGroups }) : null),
    [p.transcript, filter, expandAll, openRows, openGroups],
  )
  const turns = view ? view.turns.slice(-shown) : []

  // Follow new items only when the reader was already at the bottom.
  useLayoutEffect(() => {
    const el = scroll.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [p.transcript])
  // Older turns were added above: keep what the reader was looking at in place.
  useLayoutEffect(() => {
    const el = scroll.current
    if (el && grewFrom.current) {
      el.scrollTop += el.scrollHeight - grewFrom.current
      grewFrom.current = 0
    }
  }, [shown])

  const onScroll = () => {
    const el = scroll.current
    if (!el) return
    pinned.current = el.scrollHeight - el.clientHeight - el.scrollTop <= PIN_PX
    if (el.scrollTop < TOP_PX && view && shown < view.turns.length) {
      grewFrom.current = el.scrollHeight
      setShown((n) => n + TURNS_PAGE)
    }
  }
  const toggleRow = (row: ToolRow) => {
    setOpenRows((o) => ({ ...o, [row.key]: !row.open }))
    if (!row.open && row.item.more && !row.item.diff && !full[row.key]) {
      p.loadOutput(row.turn, row.index).then(
        (lines) => setFull((f) => ({ ...f, [row.key]: lines })),
        () => {},
      )
    }
  }
  const toggleGroup = (row: GroupRow) => setOpenGroups((o) => ({ ...o, [row.key]: !row.open }))
  const toggleAll = () => {
    setExpandAll(!expandAll)
    setOpenRows({})
    setOpenGroups({})
  }

  const meta = [p.transcript?.cli, modelLabel(s.model), s.effort && `${s.effort} effort`, tildify(s.cwd)].filter(Boolean).join(' · ')

  return (
    <div className="tx" ref={scroll} onScroll={onScroll}>
      <div className="tx-inner">
        <div className="tx-head">
          <h2 className="tx-title">{s.title}</h2>
          <span className="tx-meta-line">{meta}</span>
          {view && (
            <div className="tx-toolbar">
              <div className="seg">
                {FILTERS.map((f) => (
                  <span key={f.id} className={f.id === filter ? 'seg-item is-active' : 'seg-item'} onClick={() => setFilter(f.id)}>
                    {f.label}<span className="seg-count tnum">{view.counts[f.id]}</span>
                  </span>
                ))}
              </div>
              <span className="tx-spacer" />
              <span className="tx-text-btn" onClick={toggleAll}>{expandAll ? 'Collapse all' : 'Expand all'}</span>
            </div>
          )}
        </div>
        {p.error && <div className="tx-empty">Couldn't read the session file.</div>}
        {view?.empty && <div className="tx-empty">Nothing matches this filter.</div>}
        {turns.map((t) => (
          <div key={t.index} className="tx-turn">
            <div className="tx-divider">
              <span className="tx-divider-label">{t.label}</span>
              <span className="tx-divider-line" />
              <span className="tx-divider-meta">{t.meta}</span>
            </div>
            {t.prompt && <div className="tx-prompt">{t.prompt}</div>}
            <div className="tx-items">
              {t.rows.map((r) =>
                r.kind === 'text' ? (
                  <div key={r.key} className="tx-msg"><span className="tx-msg-dot" /><Md text={r.md} /></div>
                ) : r.kind === 'tool' ? (
                  <ToolRowView key={r.key} row={r} full={full[r.key]} onToggle={toggleRow} />
                ) : (
                  <GroupView key={r.key} row={r} full={full} onToggle={toggleRow} onToggleGroup={toggleGroup} />
                ),
              )}
            </div>
            {t.footer && <div className="tx-footer"><Icon name="ClockOutline" size={12} />{t.footer}</div>}
            {t.recap && (
              <div className="tx-box tx-recap">
                <span className="tx-recap-label">Recap</span>
                <Md text={t.recap} />
              </div>
            )}
          </div>
        ))}
        {view && (
          <div className="tx-end">
            <span className="dot" style={{ background: s.live ? 'var(--app-green)' : 'var(--app-text-3)' }} />
            <span className="tx-end-label">{s.live ? 'Waiting for your next message' : `Session ended ${agoLong(s.end, p.now)}`}</span>
            <span className="tx-spacer" />
            <Button kind="primary" onClick={p.onResume}>Resume</Button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Write `src/renderer/src/Transcript.css`**

```css
.tx {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 40px 48px;
}

.tx-inner {
  max-width: 820px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.tx-head {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tx-title {
  margin: 0;
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  color: var(--app-text);
  text-wrap: pretty;
  user-select: text;
}

.tx-meta-line {
  font-size: 12px;
  line-height: 16px;
  color: var(--app-text-3);
}

.tx-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--app-radius-track);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
}

.seg-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border-radius: var(--app-radius);
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-3);
  white-space: nowrap;
}

.seg-item:hover {
  color: var(--app-text);
}

.seg-item.is-active {
  background: var(--app-selected);
  color: var(--app-text);
}

.seg-count {
  font-weight: 400;
  color: var(--app-text-3);
}

.tx-spacer {
  flex: 1;
}

.tx-text-btn {
  padding: 4px 6px;
  border-radius: var(--app-radius);
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
}

.tx-text-btn:hover {
  color: var(--app-text);
  background: var(--app-wash);
}

.tx-turn {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tx-divider {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tx-divider-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-3);
}

.tx-divider-line {
  flex: 1;
  height: 1px;
  background: var(--app-divider);
}

.tx-divider-meta {
  font-size: 12px;
  color: var(--app-text-3);
}

.tx-prompt {
  align-self: flex-end;
  max-width: 85%;
  padding: 10px 14px;
  border-radius: var(--app-radius-panel);
  background: var(--app-elevated);
  box-shadow: inset 0 0 0 1px var(--app-border);
  font-size: 13px;
  line-height: 20px;
  color: var(--app-text);
  text-wrap: pretty;
  white-space: pre-wrap;
  user-select: text;
}

.tx-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tx-msg {
  display: flex;
  gap: 10px;
  padding: 8px 8px 10px;
}

.tx-msg-dot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--app-brand);
}

.tx-tool,
.tx-group {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--app-radius);
  min-width: 0;
}

.tx-group {
  height: 30px;
}

.tx-tool:hover,
.tx-group:hover {
  background: var(--app-wash);
}

.tx-tool-icon {
  display: flex;
  color: var(--app-text-3);
}

.tx-tool-icon.is-err {
  color: var(--app-red);
}

.tx-tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-2);
  white-space: nowrap;
}

.tx-tool-arg,
.tx-group-sum {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-stat {
  display: flex;
  gap: 6px;
  font-size: 12px;
}

.tx-add {
  color: var(--app-green);
}

.tx-del,
.tx-group-err {
  color: var(--app-red);
}

.tx-meta,
.tx-group-err {
  font-size: 12px;
  white-space: nowrap;
}

.tx-meta {
  color: var(--app-text-3);
}

.tx-chev {
  display: flex;
  color: var(--app-text-3);
}

.tx-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px 0 8px 30px;
}

.tx-box {
  padding: 8px 10px;
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
}

.tx-out {
  font-family: var(--app-mono);
  font-size: 12px;
  line-height: 18px;
  color: var(--app-text-2);
  user-select: text;
}

.tx-out.is-err {
  color: var(--app-red);
}

.tx-out-line {
  min-height: 18px;
  white-space: pre-wrap;
  word-break: break-word;
}

.tx-more {
  font-family: var(--app-font);
  font-size: 12px;
  line-height: 18px;
  color: var(--app-text-3);
}

.tx-diff {
  padding: 6px 0;
  overflow: hidden;
  font-family: var(--app-mono);
  font-size: 12px;
  line-height: 18px;
  user-select: text;
}

.tx-diff-line {
  display: grid;
  grid-template-columns: 40px 16px minmax(0, 1fr);
}

.tx-diff-line.is-add {
  background: var(--app-diff-add);
}

.tx-diff-line.is-del {
  background: var(--app-diff-del);
}

.tx-diff-n {
  text-align: right;
  padding-right: 8px;
  color: var(--app-text-3);
}

.tx-diff-sign {
  color: var(--app-green);
}

.is-del .tx-diff-sign {
  color: var(--app-red);
}

.tx-diff-text {
  color: var(--app-text-2);
  white-space: pre-wrap;
  word-break: break-word;
}

.tx-diff-more {
  padding: 0 10px;
}

.tx-link {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
  color: var(--app-text-3);
  text-decoration: none;
}

.tx-link-url {
  font-size: 13px;
  color: var(--app-link);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-members {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-left: 15px;
  padding-left: 8px;
  box-shadow: inset 1px 0 0 var(--app-divider);
}

.tx-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--app-text-3);
}

.tx-recap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
}

.tx-recap-label {
  font-size: 12px;
  color: var(--app-text-3);
}

.tx-recap .md {
  line-height: 20px;
}

.tx-empty {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: var(--app-text-3);
}

.tx-end {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--app-radius-panel);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
}

.tx-end-label {
  font-size: 13px;
  color: var(--app-text-2);
}

/* Markdown, styled to the handoff's inline rules; blocks it had no rule for use the output-box look. */
.md {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  line-height: 21px;
  color: var(--app-text-2);
  user-select: text;
}

.md > * {
  margin: 0;
}

.md p {
  text-wrap: pretty;
}

.md strong {
  font-weight: 500;
  color: var(--app-text);
}

.md code {
  font-family: var(--app-mono);
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--app-elevated);
  color: var(--app-text);
}

.md a {
  color: var(--app-link);
  text-decoration: none;
}

.md a:hover {
  text-decoration: underline;
}

.md h1,
.md h2,
.md h3,
.md h4,
.md h5,
.md h6 {
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text);
}

.md ul,
.md ol {
  margin-top: -4px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.md li {
  position: relative;
  padding-left: 16px;
}

.md li::before {
  position: absolute;
  left: 0;
  color: var(--app-text-3);
}

.md ul > li::before {
  content: '–';
}

.md ol {
  counter-reset: md-item;
}

.md ol > li {
  counter-increment: md-item;
  padding-left: 22px;
}

.md ol > li::before {
  content: counter(md-item) '.';
}

.md li > ul,
.md li > ol {
  margin-top: 4px;
}

.md li > p {
  margin: 0;
}

.md pre {
  padding: 8px 10px;
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: inset 0 0 0 1px var(--app-border);
  overflow-x: auto;
}

.md pre code {
  padding: 0;
  background: transparent;
  color: var(--app-text-2);
  font-size: 12px;
  line-height: 18px;
}

.md table {
  border-collapse: collapse;
  font-size: 12px;
  line-height: 18px;
}

.md th,
.md td {
  padding: 4px 10px;
  text-align: left;
  box-shadow: inset 0 0 0 1px var(--app-border);
}

.md th {
  font-weight: 500;
  color: var(--app-text);
  background: var(--app-surface);
}

.md blockquote {
  padding-left: 10px;
  box-shadow: inset 2px 0 0 var(--app-border);
  color: var(--app-text-3);
}

.md hr {
  border: 0;
  height: 1px;
  background: var(--app-divider);
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/renderer/src/Transcript.tsx && npm run typecheck`
Expected: 6 PASS, typecheck exits 0. If `components={{ a: … }}` fails to type, annotate the two component functions' props with `ComponentProps<'a'>` and `ComponentProps<'img'>` from `react`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/src/Transcript.tsx src/renderer/src/Transcript.css
git commit -m "Render a session transcript as turns, tool rows and diffs"
```

### Task 9: Detail tab bar, transcript loading, Focus

**Files:**
- Modify: `src/renderer/src/Detail.tsx`, `src/renderer/src/Detail.css`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/App.css`

**Interfaces:**
- Consumes: `Transcript` component and `TranscriptProps` (Task 8); `Transcript` type and `Api.getTranscript` / `Api.getToolOutput` (Task 1); `errorText` from `hooks.ts`; `Icon`.
- Produces (`Detail.tsx`): `DetailTab = 'overview' | 'transcript'`; `DetailProps` gains `tab: DetailTab; focus: boolean; onTab(tab: DetailTab): void; onFocus(): void`. `Deck` holds `detailTab` and `focus`, unmounts `Sidebar` and `SessionList` in focus, and renders the drag strip only without a selection.

- [ ] **Step 1: Write the failing test in `src/renderer/src/Detail.tsx`**

In the test block, extend `handlers`:

```ts
  const handlers = { tab: 'overview' as DetailTab, focus: false, onTab: noop, onFocus: noop, onResume: noop, onCopy: noop, onFork: noop, onOpenFolder: noop, onCopyPr: noop, onEnableTee: noop }
```

and add:

```tsx
  it('shows the tab bar with Focus, and swaps the overview for the transcript tab', () => {
    const s = makeSession({ title: 'live-meeting' })
    const over = renderToStaticMarkup(<Detail session={s} now={now} copied={null} teeOn={false} {...handlers} />)
    expect(over).toContain('tab is-active">Overview<')
    expect(over).toContain('>Focus<')
    expect(over).toContain('title="Hide the tree and list"')
    expect(over).toContain('class="detail-body"')
    expect(over).toContain('class="facts"')
    const tx = renderToStaticMarkup(<Detail session={s} now={now} copied={null} teeOn={false} {...handlers} tab="transcript" focus />)
    expect(tx).toContain('tab is-active">Transcript<')
    expect(tx).toContain('>Exit focus<')
    expect(tx).toContain('title="Show the tree and list again"')
    expect(tx).toContain('detail-tabs is-focus')
    expect(tx).toContain('class="tx"')
    expect(tx).not.toContain('class="facts"')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/Detail.tsx`
Expected: FAIL (unknown props and missing markup).

- [ ] **Step 3: Rewrite the `Detail` component**

Imports become:

```tsx
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session, Transcript as TranscriptData } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { agoLong, fileSize, modelLabel, monthDay, plural, tildify } from '../../shared/format'
import { Button } from './Button'
import { errorText } from './hooks'
import { Icon } from './icons'
import { Transcript } from './Transcript'
import { Usage, tiles } from './Usage'
import './Detail.css'
```

After `CopiedKey`, add the tab type and extend the props:

```ts
export type DetailTab = 'overview' | 'transcript'

export interface DetailProps {
  session: Session
  now: Date
  copied: CopiedKey | null
  teeOn: boolean
  tab: DetailTab
  focus: boolean
  onTab(tab: DetailTab): void
  onFocus(): void
  onResume(): void
  onCopy(): void
  onFork(): void
  onOpenFolder(): void
  onCopyPr(): void
  onEnableTee(): void
}
```

Above `Section`, add the loader:

```ts
type Loaded = { id: string; transcript: TranscriptData | null; error: string | null }

// Loads once per session, and again on every change while it is live; main tails only the appended bytes.
function useTranscript(id: string, live: boolean): Loaded {
  const [state, setState] = useState<Loaded>({ id: '', transcript: null, error: null })
  useEffect(() => {
    let alive = true
    let seq = 0
    const load = () => {
      const n = ++seq
      window.api.getTranscript(id).then(
        (t) => alive && n === seq && setState({ id, transcript: t, error: null }),
        (e) => alive && n === seq && setState({ id, transcript: null, error: errorText(e) }),
      )
    }
    load()
    const off = live ? window.api.onSessionsChanged(load) : null
    return () => {
      alive = false
      off?.()
    }
  }, [id, live])
  return state.id === id ? state : { id, transcript: null, error: null }
}
```

Replace the `Detail` function:

```tsx
export function Detail(p: DetailProps) {
  const s = p.session
  const copied = (what: CopiedKey['what']) => p.copied?.id === s.id && p.copied.what === what
  const { transcript, error } = useTranscript(s.id, s.live)
  const count = transcript ? transcript.turns.reduce((n, t) => n + t.items.length, 0) : null
  const tabClass = (t: DetailTab) => (p.tab === t ? 'tab is-active' : 'tab')
  return (
    <main className="detail">
      <div className={p.focus ? 'detail-tabs is-focus' : 'detail-tabs'}>
        <span className={tabClass('overview')} onClick={() => p.onTab('overview')}>Overview</span>
        <span className={tabClass('transcript')} onClick={() => p.onTab('transcript')}>
          Transcript{count !== null && <span className="tab-count tnum">{count}</span>}
        </span>
        <span className="detail-tabs-spacer" />
        <span className="focus-btn" title={p.focus ? 'Show the tree and list again' : 'Hide the tree and list'} onClick={p.onFocus}>
          <Icon name="Expand" size={12} />
          {p.focus ? 'Exit focus' : 'Focus'}
        </span>
      </div>
      {p.tab === 'overview' ? (
        <div className="detail-body">
          <div className="detail-inner">
            … the existing `detail-head`, `detail-actions`, `facts`, `Usage` and the three `Section`s, unchanged …
          </div>
        </div>
      ) : (
        <Transcript
          key={s.id}
          session={s}
          transcript={transcript}
          error={error}
          now={p.now}
          onResume={p.onResume}
          loadOutput={(turn, item) => window.api.getToolOutput(s.id, turn, item)}
        />
      )}
    </main>
  )
}
```

In `src/renderer/src/Detail.css`, replace the `.detail` rule and add the tab bar rules:

```css
.detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* The tab bar is the window's drag strip over the detail pane; its controls opt out. */
.detail-tabs {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 16px;
  box-shadow: inset 0 -1px 0 var(--app-divider);
  -webkit-app-region: drag;
}

.detail-tabs > * {
  -webkit-app-region: no-drag;
}

/* In focus the pane starts at the window's left edge, under the traffic lights. */
.detail-tabs.is-focus {
  padding-left: 84px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--app-radius);
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-3);
}

.tab:hover {
  color: var(--app-text);
}

.tab.is-active {
  background: var(--app-selected);
  color: var(--app-text);
}

.tab-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--app-text-3);
}

.detail-tabs-spacer {
  flex: 1;
}

.focus-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--app-radius);
  font-size: 12px;
  color: var(--app-text-3);
}

.focus-btn:hover {
  background: var(--app-wash);
  color: var(--app-text);
}

.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 40px 56px;
}
```

- [ ] **Step 4: Hold the tab and focus in `Deck`**

In `src/renderer/src/App.tsx`:
- Import: `import { Detail, type CopiedKey, type DetailTab } from './Detail'`.
- State, after `panes`:
  ```ts
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [focus, setFocus] = useState(false)
  ```
- JSX: the drag strip renders only when nothing is selected (the tab bar is the strip otherwise); the two panes render only outside focus; `Detail` gets the new props.
  ```tsx
    <div className="app">
      {!selected && <div className="app-drag" style={{ left: focus ? 0 : panes.side + panes.list }} />}
      {!focus && (
        <Sidebar … />
      )}
      {!focus && (
        <SessionList … />
      )}
      {selected ? (
        <Detail
          session={selected}
          now={now}
          copied={copied}
          teeOn={settings.statusTee}
          tab={detailTab}
          focus={focus}
          onTab={setDetailTab}
          onFocus={() => setFocus(!focus)}
          onResume={() => void resume(selected.id, false)}
          … the other handlers unchanged …
        />
      ) : (
        <main className="detail" />
      )}
  ```
- Add to the `Deck` test block:
  ```tsx
  it('renders the detail tab bar on Overview for the selected session', () => {
    const html = renderToStaticMarkup(<Deck all={[makeSession({ title: 'live-meeting' })]} settings={settings} now={now} />)
    expect(html).toContain('tab is-active">Overview<')
    expect(html).toContain('>Focus<')
    expect(html).not.toContain('app-drag')
  })
  ```
  and to the existing empty-list test: `expect(html).toContain('app-drag')`.

- [ ] **Step 5: Run the suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck exits 0.

- [ ] **Step 6: Check it in the app**

Run `npm run dev`: the detail pane shows Overview and Transcript tabs with a count; Transcript renders the selected session's turns; the tab stays selected when you click another session; Focus removes the tree and list and the tab bar moves right of the traffic lights; Exit focus brings both panes back at their widths; the window still drags by the tab bar. Quit the app.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/Detail.tsx src/renderer/src/Detail.css src/renderer/src/App.tsx src/renderer/src/App.css
git commit -m "Add the detail tab bar, transcript loading and Focus mode"
```

### Task 10: Verify against real sessions

**Files:**
- Modify: none (fixes go to the file's owning task if any are needed; report them)

**Interfaces:**
- Consumes: everything above.
- Produces: a verification report in the task's final answer: test, typecheck and build output, and the manual checklist results.

- [ ] **Step 1: Automated checks**

Run, from the repo root:
```bash
npm test
npm run typecheck
npm run build && (grep -r "import.meta.vitest" out/ && echo "TEST CODE LEAKED" || echo "no test code in out/")
ls -la out/renderer/assets/*.js
```
Expected: every test passes; typecheck exits 0; the grep prints `no test code in out/`. Record the renderer bundle size: react-markdown and remark-gfm add roughly 300–400 KB; report the number, do not act on it.

- [ ] **Step 2: Smoke-test the reducer on every local session**

Run:
```bash
node -e '
const { readdirSync, readFileSync } = require("fs"); const { join } = require("path"); const os = require("os")
const root = join(os.homedir(), ".claude", "projects")
let files = 0, turns = 0, items = 0, diffs = 0, links = 0
for (const d of readdirSync(root, { withFileTypes: true })) if (d.isDirectory())
  for (const f of readdirSync(join(root, d.name))) if (f.endsWith(".jsonl")) { files++; const t = readFileSync(join(root, d.name, f), "utf8"); turns += (t.match(/"type":"user"/g) || []).length }
console.log({ files, userRecords: turns })
'
```
This only proves the files are readable from Node; the real parse check is the dev app below. Then start the app with `npm run dev` and open the five largest sessions (sort by size with `ls -S ~/.claude/projects/*/*.jsonl | head -5`, match ids to titles in the list). For each: the Transcript tab renders within a second of selecting, the count matches the sum of visible step counts across turns under the Tools filter, and the console shows no errors (View → Toggle Developer Tools).

- [ ] **Step 3: Manual checklist in the dev app**

Work through these and record PASS or FAIL with a note for each:
1. Overview tab: unchanged content, 40px top padding, no clipping under the tab bar.
2. Transcript header: `Claude Code vX · <model> · <effort> effort · ~/path`; the five filter counts; Expand all.
3. Filters: Messages shows prompts, messages and recaps only; Tools shows every tool ungrouped; Edits shows only rows with a diff stat; Errors shows red-icon rows; an empty narrow filter shows "Nothing matches this filter."
4. Step groups: a run of 3+ tool calls folds under All with "N steps" and the name summary; clicking opens the members with the left guide line.
5. Rows: a Bash row with hidden output shows "+N lines"; clicking expands the first three lines plus the "N more lines in the session file" note; a moment later the full output replaces them and the note disappears. A row without a body does not react and its chevron is invisible.
6. Diffs: an Update or Write row shows "+a −d"; expanded, the grid shows line numbers, signs and tinted add/delete rows.
7. PR link: a `gh pr create` row shows the link block; clicking opens the browser.
8. Markdown: a message with a fenced code block renders it as a mono box; a table renders as a table; links open in the browser.
9. Expand all opens every group and body; Collapse all closes them, including ones opened by hand.
10. Open state survives filter changes: open a row under All, switch to Tools, it is still open.
11. End bar: an ended session reads "Session ended <relative>"; Resume opens the terminal exactly like the Overview button.
12. Live: start `claude` in a terminal inside any repo and send a prompt. Select that session: the end bar reads "Waiting for your next message" with a green dot; new items append as Claude works; when scrolled to the bottom the view follows; scrolled up more than 64px it holds position.
13. Older turns: on a session with more than 30 turns, only the last 30 render; scrolling to the top loads 30 more without the view jumping.
14. Tabs and Focus: the selected tab survives switching sessions; Focus hides the tree and list, the tab bar clears the traffic lights, and Exit focus restores both panes at their widths.
15. Panes: the tree, list and command-bar results resize, snap back on double-click, respect the 360px detail floor as the window narrows, and come back after relaunch.

- [ ] **Step 4: Report**

Your final answer lists the command outputs from Step 1 (counts and bundle size), the sessions used in Step 2, and the 15 checklist results. Any FAIL names the file and the symptom; do not fix files another track owns, report them instead.
