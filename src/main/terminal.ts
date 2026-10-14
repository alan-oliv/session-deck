import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resumeCommand, TERMINALS, terminalLabel, type OpenIn, type Session, type Terminal } from '../shared/api'
import { PATHS } from './paths'

const run = promisify(execFile)

// ponytail: a path check, not a bundle-id lookup; switch to `mdfind kMDItemCFBundleIdentifier` if apps land elsewhere.
export const installedTerminals = (): Terminal[] =>
  TERMINALS.filter((t) => ['/Applications', '/System/Applications/Utilities', join(PATHS.home, 'Applications')].some((d) => existsSync(join(d, t.app)))).map((t) => t.id)

// Terminal is always present on macOS, so this never comes back empty.
export function defaultTerminal(installed: readonly Terminal[]): Terminal {
  return (['ghostty', 'iterm', 'terminal'] as const).find((t) => installed.includes(t)) ?? 'terminal'
}

// macOS keeps no usage history, so a terminal pinned in the Dock is the nearest signal for "the one they use".
// Dock tiles hold bookmark data, which plutil refuses to print as JSON, so this reads persistent-apps as XML.
export function dockTerminals(dockXml: string, installed: readonly Terminal[]): Terminal[] {
  return [...dockXml.matchAll(/<key>_CFURLString<\/key>\s*<string>([^<]*)<\/string>/g)].flatMap(([, u]) => {
    const url = decodeURIComponent(u).replace(/\/$/, '')
    const t = TERMINALS.find((x) => installed.includes(x.id) && url.endsWith(`/${x.app}`))
    return t ? [t.id] : []
  })
}

export async function suggestTerminal(installed: readonly Terminal[]): Promise<Terminal> {
  try {
    const { stdout } = await run('plutil', ['-extract', 'persistent-apps', 'xml1', '-o', '-', join(PATHS.home, 'Library/Preferences/com.apple.dock.plist')])
    return dockTerminals(stdout, installed)[0] ?? defaultTerminal(installed)
  } catch {
    return defaultTerminal(installed)
  }
}

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

export function terminalCommand(s: Pick<Session, 'id' | 'cwd' | 'cwdExists'>, fork: boolean, skip = false): string {
  const cmd = resumeCommand(s.id, fork, skip)
  const cwd = cdTarget(s)
  return cwd ? `cd ${shellQuote(cwd)} && ${cmd}` : cmd
}

export const itermScript = (cmd: string, open: OpenIn): string =>
  [
    'tell application "iTerm"',
    '  activate',
    ...(open === 'tab'
      ? ['  if (count of windows) is 0 then', '    create window with default profile', '  else', '    tell current window to create tab with default profile', '  end if']
      : ['  create window with default profile']),
    `  tell current session of current window to write text ${appleScriptString(cmd)}`,
    'end tell',
  ].join('\n')

export const terminalAppScript = (cmd: string): string =>
  ['tell application "Terminal"', '  activate', `  do script ${appleScriptString(cmd)}`, 'end tell'].join('\n')

// Terminal has no tab API: ⌘T through System Events needs Accessibility permission, so a refusal falls back to a window.
export const terminalAppTabScript = (cmd: string): string =>
  [
    'tell application "Terminal"',
    '  activate',
    '  if (count of windows) is 0 then',
    `    do script ${appleScriptString(cmd)}`,
    '  else',
    '    tell application "System Events" to keystroke "t" using command down',
    '    delay 0.3',
    `    do script ${appleScriptString(cmd)} in front window`,
    '  end if',
    'end tell',
  ].join('\n')

// A JSON string is a valid TOML basic string, so JSON.stringify quotes every value safely.
export const warpConfig = (title: string, cwd: string, cmd: string): string =>
  [
    'name = "Session Deck resume"',
    `title = ${JSON.stringify(title)}`,
    '',
    '[[panes]]',
    'id = "main"',
    'type = "terminal"',
    `directory = ${JSON.stringify(cwd)}`,
    `commands = [${JSON.stringify(cmd)}]`,
    '',
  ].join('\n')

// Warp matches the name against file stems in ~/.warp/tab_configs/. A tab config opens as a tab in the active window
// unless asked for a new one; the legacy launch configs this replaced could only open windows.
export const warpUri = (open: OpenIn): string =>
  `warp://tab_config/${encodeURIComponent(basename(PATHS.warpConfig, '.toml'))}${open === 'window' ? '?new_window=true' : ''}`

const WEZTERM = '/Applications/WezTerm.app/Contents/MacOS/wezterm'

export class CannotRunError extends Error {
  constructor(terminal: Terminal) {
    super(`Couldn't run it in ${terminalLabel(terminal)}. Resume command copied.`)
  }
}

export class AutomationDeniedError extends Error {
  constructor(readonly terminal: Terminal) {
    super(`Session Deck can't control ${terminalLabel(terminal)}. Allow it in System Settings → Privacy & Security → Automation. Resume command copied.`)
  }
}

export const isAutomationDenied = (e: unknown): boolean =>
  /-1743|not authori[sz]ed to send apple events/i.test(String((e as { stderr?: unknown } | undefined)?.stderr ?? (e instanceof Error ? e.message : '')))

async function osascript(terminal: Terminal, script: string): Promise<void> {
  try {
    await run('osascript', ['-e', script])
  } catch (e) {
    throw isAutomationDenied(e) ? new AutomationDeniedError(terminal) : e
  }
}

// Throws CannotRunError when the terminal opened but cannot be told to run the command (VS Code).
export async function launch(terminal: Terminal, open: OpenIn, s: Session, fork: boolean, skip = false): Promise<void> {
  await spawn(terminal, open, s, fork, skip)
  // Warp and WezTerm open the tab without coming forward, and `open -a` won't switch to a fullscreen Space; AppleScript `activate` does.
  const app = TERMINALS.find((t) => t.id === terminal)!.app
  try {
    await run('osascript', ['-e', `tell application ${appleScriptString(app.replace(/\.app$/, ''))} to activate`])
  } catch {
    await run('open', ['-a', app])
  }
}

async function spawn(terminal: Terminal, open: OpenIn, s: Session, fork: boolean, skip: boolean): Promise<void> {
  const cmd = terminalCommand(s, fork, skip)
  const dir = cdTarget(s) ?? PATHS.home
  const claude = resumeCommand(s.id, fork, skip).split(' ')
  switch (terminal) {
    case 'warp':
      // Never type the command into Warp: keystroke goes through the keyboard layout, and on dead-key layouts
      // (Brazilian, US International) the quotes compose with the next key and Return never runs the line.
      mkdirSync(dirname(PATHS.warpConfig), { recursive: true })
      writeFileSync(PATHS.warpConfig, warpConfig(s.title, dir, resumeCommand(s.id, fork, skip)))
      await run('open', [warpUri(open)])
      return
    case 'iterm':
      // execFile, never a shell: the script is a single argv entry.
      await osascript('iterm', itermScript(cmd, open))
      return
    case 'terminal':
      if (open === 'window') return void (await osascript('terminal', terminalAppScript(cmd)))
      try {
        await osascript('terminal', terminalAppTabScript(cmd))
      } catch {
        await osascript('terminal', terminalAppScript(cmd))
      }
      return
    case 'ghostty':
      // ponytail: Ghostty tabs can't be scripted, so both modes open a window.
      await run('open', ['-na', 'Ghostty', '--args', `--working-directory=${dir}`, '-e', ...claude])
      return
    case 'wezterm':
      try {
        await run(WEZTERM, ['cli', 'spawn', ...(open === 'window' ? ['--new-window'] : []), '--cwd', dir, '--', ...claude])
      } catch {
        await run(WEZTERM, ['start', '--cwd', dir, '--', ...claude])
      }
      return
    case 'vscode':
      await run('open', ['-b', 'com.microsoft.VSCode', '--args', open === 'window' ? '-n' : '-r', dir])
      throw new CannotRunError(terminal)
  }
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
  it('adds the skip-permissions flag to the typed command when asked', () => {
    expect(terminalCommand({ id, cwd: '/Users/me/app', cwdExists: true }, true, true))
      .toBe(`cd '/Users/me/app' && claude --resume ${id} --fork-session --dangerously-skip-permissions`)
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
  it('writes the command into an iTerm tab or window and a Terminal window or tab', () => {
    expect(itermScript("cd '/x' && claude", 'window')).toContain('create window with default profile')
    expect(itermScript("cd '/x' && claude", 'window')).not.toContain('create tab')
    expect(itermScript("cd '/x' && claude", 'tab')).toContain('tell current window to create tab with default profile')
    expect(itermScript("cd '/x' && claude", 'tab')).toContain(`write text "cd '/x' && claude"`)
    expect(terminalAppScript('claude')).toContain('do script "claude"')
    expect(terminalAppTabScript('claude')).toContain('keystroke "t" using command down')
    expect(terminalAppTabScript('claude')).toContain('do script "claude" in front window')
  })
  it('prefers Ghostty, then iTerm2, then Terminal as the default', () => {
    expect(defaultTerminal(['terminal', 'warp', 'iterm', 'ghostty'])).toBe('ghostty')
    expect(defaultTerminal(['terminal', 'iterm'])).toBe('iterm')
    expect(defaultTerminal(['terminal', 'vscode'])).toBe('terminal')
    expect(defaultTerminal([])).toBe('terminal')
    expect(installedTerminals()).toContain('terminal')
  })
  it('writes a Warp tab config with every value JSON-quoted and opens it as a tab or a window', () => {
    const toml = warpConfig('fix: "quotes"', '/Users/me/app', `claude --resume ${id}`)
    expect(toml).toContain('title = "fix: \\"quotes\\""')
    expect(toml).toContain('directory = "/Users/me/app"')
    expect(toml).toContain(`commands = ["claude --resume ${id}"]`)
    expect(warpUri('tab')).toBe('warp://tab_config/session_deck_resume')
    expect(warpUri('window')).toBe('warp://tab_config/session_deck_resume?new_window=true')
  })
  it.skipIf(!process.env.SESSION_DECK_LAUNCH)('opens a harmless echo in iTerm, Terminal and Warp', async () => {
    const echo = 'echo session-deck-check'
    await run('osascript', ['-e', itermScript(echo, 'tab')])
    await run('osascript', ['-e', terminalAppScript(echo)])
    mkdirSync(dirname(PATHS.warpConfig), { recursive: true })
    writeFileSync(PATHS.warpConfig, warpConfig('session-deck-check', PATHS.home, echo))
    await run('open', [warpUri('tab')])
  }, 120_000)
  it('recognises the macOS Automation refusal and nothing else', () => {
    expect(isAutomationDenied({ stderr: '0:36: execution error: Not authorized to send Apple events to iTerm. (-1743)' })).toBe(true)
    expect(isAutomationDenied(new Error('osascript: (-1743)'))).toBe(true)
    expect(isAutomationDenied({ stderr: 'execution error: iTerm got an error: Can’t get window 1. (-1728)' })).toBe(false)
    expect(isAutomationDenied(undefined)).toBe(false)
  })
  it('names the terminal and the System Settings path in the refusal message', () => {
    const e = new AutomationDeniedError('iterm')
    expect(e.terminal).toBe('iterm')
    expect(e.message).toContain("can't control iTerm2")
    expect(e.message).toContain('Privacy & Security → Automation')
  })
  it('lists the installed terminals pinned in the Dock, in Dock order', () => {
    const tile = (url: string) =>
      `<dict><key>tile-data</key><dict><key>book</key><data>Ym9vaw==</data><key>file-data</key><dict>
        <key>_CFURLString</key>\n\t<string>${url}</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>`
    const dock = `<plist version="1.0"><array>${['Safari.app', 'Visual%20Studio%20Code.app', 'Warp.app'].map((a) => tile(`file:///Applications/${a}/`)).join('')}</array></plist>`
    expect(dockTerminals(dock, ['terminal', 'warp', 'vscode'])).toEqual(['vscode', 'warp'])
    expect(dockTerminals(dock, ['terminal'])).toEqual([])
  })
  it('returns nothing for a Dock it cannot read', () => {
    expect(dockTerminals('not xml', ['terminal'])).toEqual([])
    expect(dockTerminals('', ['terminal'])).toEqual([])
  })
}
