import type { Session, Transcript } from './api'

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
    repo: { name: 'app', root: '/Users/me/code/app', remote: 'alan-oliv/app' },
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
    prs: [],
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
