import { useEffect } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../../shared/api'
import { makeSession } from '../../shared/fixtures'
import { RESUME_KEYS, resumeItems, type ResumeAction, type ResumeItem } from '../../shared/resume'
import { Icon } from './icons'
import './ResumeMenu.css'

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
