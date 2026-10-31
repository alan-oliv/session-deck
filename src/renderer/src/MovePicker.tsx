import { Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tildify } from '../../shared/format'
import type { Project } from '../../shared/tree'
import { Icon } from './icons'
import './LabelPicker.css'
import './MovePicker.css'

export interface MovePickerProps {
  projects: Project[]
  query: string
  highlight: number
  onQuery(q: string): void
  onHighlight(i: number): void
  onMove(cwd: string): void
  onClose(): void
}

const SECTIONS = [['repo', 'Repositories'], ['folder', 'Folders']] as const

// Matches the path, not the sidebar tooltip, which ends in "(not a git repository)" for every folder.
function moveRows(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase()
  const hits = projects.filter((p) => p.label.toLowerCase().includes(q) || tildify(p.id).toLowerCase().includes(q))
  return SECTIONS.flatMap(([kind]) => hits.filter((p) => p.kind === kind))
}

export function MovePicker(p: MovePickerProps) {
  const rows = moveRows(p.projects, p.query)
  const hi = Math.min(p.highlight, Math.max(0, rows.length - 1))
  return (
    <>
      <div className="lp-dismiss" onClick={p.onClose} />
      <div className="lp" onMouseDown={(e) => e.preventDefault()}>
        <input
          className="lp-input"
          autoFocus
          value={p.query}
          placeholder="Move to…"
          onChange={(e) => {
            p.onQuery(e.target.value)
            p.onHighlight(0)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              p.onHighlight(Math.min(rows.length - 1, hi + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              p.onHighlight(Math.max(0, hi - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (rows.length) p.onMove(rows[hi].id)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              p.onClose()
            }
          }}
        />
        <div className="mp-list">
          {SECTIONS.map(([kind, header]) => {
            const items = rows.filter((r) => r.kind === kind)
            return items.length > 0 && (
              <Fragment key={kind}>
                <div className="mp-header">{header}</div>
                {items.map((r) => {
                  const i = rows.indexOf(r)
                  return (
                    <div
                      key={r.id}
                      ref={i === hi ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                      className={i === hi ? 'lp-row is-hi' : 'lp-row'}
                      title={tildify(r.id)}
                      onMouseMove={() => i !== hi && p.onHighlight(i)}
                      onClick={() => p.onMove(r.id)}
                    >
                      <Icon name={r.kind === 'repo' ? 'Box' : 'Storage'} size={14} className="mp-icon" />
                      <span className="lp-name">{r.label}</span>
                    </div>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
        {rows.length === 0 && <div className="lp-empty">No matching project.</div>}
      </div>
    </>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const noop = () => {}
  const proj = (kind: Project['kind'], id: string, label: string): Project => ({
    kind, id, label, title: id, count: 1, scope: kind === 'repo' ? { type: 'repo', repo: id } : { type: 'folder', path: id },
  })
  const projects = [proj('folder', '/Users/me/notes', '~/notes'), proj('repo', '/Users/me/code/app', 'app'), proj('repo', '/Users/me/code/team8', 'team8')]
  const render = (query: string) =>
    renderToStaticMarkup(<MovePicker projects={projects} query={query} highlight={0} onQuery={noop} onHighlight={noop} onMove={noop} onClose={noop} />)

  it('lists repositories before folders, each in sidebar order', () => {
    expect(moveRows(projects, '').map((p) => p.label)).toEqual(['app', 'team8', '~/notes'])
  })
  it('filters by name or path, ignoring case and surrounding spaces', () => {
    expect(moveRows(projects, ' TEAM ').map((p) => p.label)).toEqual(['team8'])
    expect(moveRows(projects, 'code/').map((p) => p.label)).toEqual(['app', 'team8'])
    expect(moveRows(projects, 'git')).toEqual([])
  })
  it('shows each section under its header with the first row highlighted, and an empty state', () => {
    const html = render('')
    expect(html).toContain('placeholder="Move to…"')
    expect(html).toMatch(/>Repositories<.*>app<.*>team8<.*>Folders<.*>~\/notes</)
    expect(html.match(/lp-row is-hi/g)).toHaveLength(1)
    expect(render('zzz')).toContain('No matching project.')
    expect(render('zzz')).not.toContain('Repositories')
  })
}
