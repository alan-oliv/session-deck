export type Status = 'running' | 'waiting' | 'interrupted' | 'failed' | 'completed'
export type Terminal = 'terminal' | 'iterm' | 'ghostty' | 'warp' | 'wezterm' | 'vscode'
export type OpenIn = 'tab' | 'window'
export type Accent = 'brand' | 'blue' | 'violet' | 'teal' | 'green' | 'orange' | 'red'
export type AppIcon = 'dark' | 'purple'

export interface Settings {
  terminal: Terminal | null // null: the first installed of Ghostty, iTerm2, Terminal
  open: OpenIn
  accent: Accent
  opacity: number // 50–100
  blur: number // 0–40 px
  appIcon: AppIcon
  archived: string[]
  statusTee: boolean
}
export type SettingsPatch = Partial<Pick<Settings, 'terminal' | 'open' | 'accent' | 'opacity' | 'blur' | 'appIcon'>>
export const SETTINGS_DEFAULTS: Settings = { terminal: null, open: 'tab', accent: 'brand', opacity: 88, blur: 24, appIcon: 'dark', archived: [], statusTee: false }

export const TERMINALS: { id: Terminal; label: string; app: string }[] = [
  { id: 'terminal', label: 'Terminal', app: 'Terminal.app' },
  { id: 'iterm', label: 'iTerm2', app: 'iTerm.app' },
  { id: 'ghostty', label: 'Ghostty', app: 'Ghostty.app' },
  { id: 'warp', label: 'Warp', app: 'Warp.app' },
  { id: 'wezterm', label: 'WezTerm', app: 'WezTerm.app' },
  { id: 'vscode', label: 'VS Code', app: 'Visual Studio Code.app' },
]
export const terminalLabel = (id: Terminal): string => TERMINALS.find((t) => t.id === id)?.label ?? id

export const ACCENTS: { id: Accent; name: string; fill: string }[] = [
  { id: 'brand', name: 'Linear purple', fill: '#575bc7' },
  { id: 'blue', name: 'Blue', fill: '#4ea7fc' },
  { id: 'violet', name: 'Violet', fill: '#bb87fc' },
  { id: 'teal', name: 'Teal', fill: '#26b5ce' },
  { id: 'green', name: 'Green', fill: '#4cb782' },
  { id: 'orange', name: 'Orange', fill: '#f2994a' },
  { id: 'red', name: 'Red', fill: '#eb5757' },
]

export interface FileChange { path: string; added: number; removed: number }
export interface Commit { sha: string; msg: string; at: string }
export interface Artifact { name: string; kind: string; path: string; bytes: number; preview: string }
// A page the session published to claude.ai: its path is the link, with no size or preview.
export const PUBLISHED_KIND = 'claude.ai'
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
  repo: { name: string; root: string; remote: string | null } | null
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
  prs: PullRequest[]
  forkedFrom: string | null
  forks: number
  prompts: string[]
  summary: { did: string; next: string[] } | null
  files: FileChange[]
  commits: Commit[]
  artifacts: Artifact[]
  usage: Usage
}

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

// Not ok: the command is on the clipboard and `message` says why.
export type ResumeResult = { ok: true } | { ok: false; message: string }

export interface Api {
  listSessions(): Promise<Session[]>
  getSettings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<Settings>
  listTerminals(): Promise<Terminal[]>
  resumeSession(id: string, opts: { fork: boolean; open?: OpenIn }): Promise<ResumeResult>
  openFolder(id: string): Promise<void>
  openPr(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  setStatusTee(enabled: boolean): Promise<void>
  getTranscript(id: string): Promise<Transcript>
  getToolOutput(id: string, turn: number, item: number): Promise<string[]>
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
  'listTerminals',
  'resumeSession',
  'openFolder',
  'openPr',
  'renameSession',
  'setArchived',
  'setStatusTee',
  'getTranscript',
  'getToolOutput',
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
  'Link', 'Edit', 'Archive', 'Check', 'Edit2', 'Expand', 'Settings', 'Close', 'Layout',
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
  it('labels Edit and Grep the way the CLI prints them and leaves other tools alone', () => {
    expect(toolLabel('Edit')).toBe('Update')
    expect(toolLabel('MultiEdit')).toBe('Update')
    expect(toolLabel('Grep')).toBe('Search')
    expect(toolLabel('Glob')).toBe('Search')
    expect(toolLabel('Bash')).toBe('Bash')
    expect(toolLabel('mcp__linear__get_issue')).toBe('mcp__linear__get_issue')
  })
}
