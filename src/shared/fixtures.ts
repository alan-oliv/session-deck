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
