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
