import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resumeCommand, type Session, type Terminal } from '../shared/api'
import { PATHS } from './paths'

const run = promisify(execFile)

export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
export const appleScriptString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// iTerm and Terminal type the command, so a control character in a transcript's cwd (e.g. Ctrl-U)
// would be acted on by the line editor before the shell ever sees the quotes.
function cdTarget(s: Pick<Session, 'cwd' | 'cwdExists'>): string | null {
  return s.cwdExists && !/[\x00-\x1f\x7f]/.test(s.cwd) ? s.cwd : null
}

// shell.openPath launches files, scripts and .app bundles, so only a real folder may reach it.
export function folderToOpen(cwd: string): string | null {
  let real: string
  try {
    real = realpathSync(cwd)
  } catch {
    return null
  }
  return statSync(real).isDirectory() && !/\.app$/i.test(real) ? real : null
}

export function terminalCommand(s: Pick<Session, 'id' | 'cwd' | 'cwdExists'>, fork: boolean): string {
  const cmd = resumeCommand(s.id, fork)
  const cwd = cdTarget(s)
  return cwd ? `cd ${shellQuote(cwd)} && ${cmd}` : cmd
}

export const itermScript = (cmd: string): string =>
  [
    'tell application "iTerm"',
    '  activate',
    '  set w to (create window with default profile)',
    `  tell current session of w to write text ${appleScriptString(cmd)}`,
    'end tell',
  ].join('\n')

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
  it('never types a cwd holding control characters, which the line editor would act on', () => {
    const s = { id, cwd: '/x\x15rm -rf ~ #', cwdExists: true }
    expect(terminalCommand(s, false)).toBe(`claude --resume ${id}`)
    expect(cdTarget(s)).toBeNull()
    expect(cdTarget({ cwd: '/Users/me/app', cwdExists: true })).toBe('/Users/me/app')
  })
  it('opens only real folders, never files or app bundles that the system would launch', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-open-')))
    for (const d of ['plain', 'Evil.app', 'Loud.APP']) mkdirSync(join(root, d))
    writeFileSync(join(root, 'run.command'), 'echo hi')
    symlinkSync(join(root, 'Evil.app'), join(root, 'innocent'))
    expect(folderToOpen(join(root, 'plain'))).toBe(join(root, 'plain'))
    expect(folderToOpen(join(root, 'Evil.app'))).toBeNull()
    expect(folderToOpen(join(root, 'Loud.APP'))).toBeNull()
    expect(folderToOpen(join(root, 'innocent'))).toBeNull()
    expect(folderToOpen(join(root, 'run.command'))).toBeNull()
    expect(folderToOpen(join(root, 'missing'))).toBeNull()
  })
  it('escapes backslashes and quotes inside AppleScript strings', () => {
    expect(appleScriptString('say "hi" \\ ok')).toBe('"say \\"hi\\" \\\\ ok"')
  })
  it('writes the command into a new iTerm window, a new iTerm tab with a window fallback, and a Terminal window', () => {
    expect(itermScript("cd '/x' && claude")).toContain(`write text "cd '/x' && claude"`)
    expect(itermScript('claude')).toContain('create window with default profile')
    const tab = itermTabScript('claude')
    expect(tab).toContain('if (count of windows) = 0 then')
    expect(tab).toContain('tell current window to create tab with default profile')
    expect(tab).toContain('write text "claude"')
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
    await run('osascript', ['-e', itermTabScript(echo)])
    await run('osascript', ['-e', terminalAppScript(echo)])
    mkdirSync(dirname(PATHS.warpConfig), { recursive: true })
    writeFileSync(PATHS.warpConfig, warpConfig('session-deck-check', PATHS.home, echo))
    await run('open', [WARP_URI])
  }, 120_000)
}
