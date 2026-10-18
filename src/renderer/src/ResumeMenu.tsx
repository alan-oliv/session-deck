import { useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { canRename, RENAME_BLOCKED, resumeCommand, type IconName, type OpenIn, type Session } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { tildify } from '../../shared/format'
import { Icon } from './icons'
import './ResumeMenu.css'

export interface ResumeMenuProps {
  session: Session
  label: string
  open: OpenIn
  terminalName: string
  skip: boolean
  onResume(open: OpenIn): void
  onFork(): void
  onRename(): void
  onCopy(): void
  onOpenFolder(): void
  onArchive(): void
}

type Item = { icon: IconName; label: string; sub?: string; key?: string; cmd?: string; disabled?: boolean; run(): void }

const other = (o: OpenIn): OpenIn => (o === 'tab' ? 'window' : 'tab')

export function ResumeMenu(p: ResumeMenuProps) {
  const [menu, setMenu] = useState(false)
  const s = p.session
  const cmd = resumeCommand(s.id, false, p.skip)
  const pick = (fn: () => void) => () => {
    setMenu(false)
    fn()
  }
  const groups: Item[][] = [
    [
      { icon: 'ArrowRight', label: 'Resume', sub: `Opens in a new ${p.open} in ${p.terminalName}.`, key: '↵', cmd, run: () => p.onResume(p.open) },
      { icon: 'Layout', label: `Resume in a new ${other(p.open)}`, cmd, run: () => p.onResume(other(p.open)) },
    ],
    [
      { icon: 'Branch', label: 'Branch conversation', sub: 'Starts a new session from this point. The original stays as it is.', key: 'B', cmd: resumeCommand(s.id, true, p.skip), run: p.onFork },
      { icon: 'Edit', label: 'Rename…', sub: !canRename(s) ? RENAME_BLOCKED : s.named ? undefined : 'Give it a name so you can resume by name.', key: 'R', disabled: !canRename(s), run: p.onRename },
    ],
    [
      { icon: 'Clipboard', label: 'Copy resume command', cmd, run: p.onCopy },
      { icon: 'Storage', label: 'Open folder', sub: s.cwdExists ? tildify(s.cwd) : 'Folder no longer exists', disabled: !s.cwdExists, run: p.onOpenFolder },
    ],
    [
      s.archived
        ? { icon: 'Archive', label: 'Restore from archive', sub: 'Moves it back to All sessions.', key: 'E', run: p.onArchive }
        : { icon: 'Archive', label: 'Archive', sub: 'Hides it from All sessions. Nothing is deleted.', key: 'E', run: p.onArchive },
    ],
  ]

  useEffect(() => {
    if (!menu) return
    const byKey: Record<string, Item | undefined> = { Enter: groups[0][0], b: groups[1][0], r: groups[1][1], e: groups[3][0] }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const item = e.key === 'Escape' ? null : byKey[e.key.toLowerCase()] ?? byKey[e.key]
      if (item === undefined) return
      e.preventDefault()
      e.stopPropagation()
      setMenu(false)
      item?.run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menu, p.open, s.id])

  return (
    <div className="rm">
      <div className="rm-split">
        <button type="button" className="rm-main" onClick={() => p.onResume(p.open)} title={cmd}>{p.label}</button>
        <span className="rm-divider" />
        <button type="button" className={menu ? 'rm-chev is-open' : 'rm-chev'} title="More ways to resume" aria-label="More ways to resume" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Icon name="ChevronDown2" size={10} />
        </button>
      </div>
      {menu && (
        <>
          <div className="rm-dismiss" onPointerDown={() => setMenu(false)} />
          <div className="rm-menu" role="menu">
            {groups.map((items, g) => (
              <div key={g} className="rm-group">
                {items.map((it) => (
                  <div key={it.label} role="menuitem" aria-disabled={it.disabled} className={it.disabled ? 'rm-item is-disabled' : 'rm-item'} title={it.cmd} onClick={it.disabled ? undefined : pick(it.run)}>
                    <span className="rm-icon"><Icon name={it.icon} size={14} /></span>
                    <div className="rm-text">
                      <span className="rm-label">{it.label}</span>
                      {it.sub && <span className="rm-sub">{it.sub}</span>}
                    </div>
                    {it.key && <span className="keycap">{it.key}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const noop = () => {}
  const render = (over: Partial<Session> = {}, open: OpenIn = 'tab', skip = false) =>
    renderToStaticMarkup(<ResumeMenu session={makeSession(over)} label="Resume" open={open} terminalName="Ghostty" skip={skip} onResume={noop} onFork={noop} onRename={noop} onCopy={noop} onOpenFolder={noop} onArchive={noop} />)
  it('renders the split button closed, with the command as the tooltip', () => {
    const html = render()
    expect(html).toContain('rm-main" title="claude --resume ')
    expect(html).toContain('title="More ways to resume"')
    expect(html).not.toContain('rm-menu')
    expect(html).not.toContain('skip-permissions')
  })
  it('puts the skip-permissions flag in the tooltip when the setting is on', () => {
    expect(render({}, 'tab', true)).toMatch(/rm-main" title="claude --resume [^"]* --dangerously-skip-permissions"/)
  })
}
