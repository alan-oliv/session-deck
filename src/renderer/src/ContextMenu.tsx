import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Label } from '../../shared/api'
import type { Project } from '../../shared/tree'
import { Icon } from './icons'
import { LabelPicker } from './LabelPicker'
import { MovePicker } from './MovePicker'
import './ContextMenu.css'

export interface ContextMenuProps {
  x: number
  y: number
  count: number
  archived: boolean
  labels: Label[]
  applied: string[]
  counts: Record<string, number>
  projects: Project[]
  moveBlocked: string | null
  trashBlocked: string | null
  onMove(cwd: string): void
  onArchive(): void
  onTrash?(): void
  onToggleLabel(id: string): void
  onCreateLabel(name: string): void
  onClose(): void
}

const MARGIN = 8

const clamp = (v: number, size: number, room: number) => Math.max(MARGIN, Math.min(v, room - size - MARGIN))

const archiveLabel = (count: number, archived: boolean) =>
  `${archived ? 'Restore' : 'Archive'}${count > 1 ? ` ${count} sessions` : ''}`

const trashLabel = (count: number) => (count > 1 ? `Move ${count} sessions to Trash…` : 'Move to Trash…')

export function ContextMenu(p: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: p.x, top: p.y })
  const [labels, setLabels] = useState(false)
  const [moving, setMoving] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setPos({ left: clamp(p.x, r.width, window.innerWidth), top: clamp(p.y, r.height, window.innerHeight) })
  }, [p.x, p.y, labels, moving])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      p.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p.onClose])

  return (
    <div ref={ref} className="cm" style={pos}>
      {labels ? (
        <LabelPicker
          labels={p.labels}
          applied={p.applied}
          counts={p.counts}
          query={query}
          highlight={highlight}
          onQuery={setQuery}
          onHighlight={setHighlight}
          onToggle={p.onToggleLabel}
          onCreate={(name) => {
            p.onCreateLabel(name)
            setQuery('')
            setHighlight(0)
          }}
          onClose={p.onClose}
        />
      ) : moving ? (
        <MovePicker
          projects={p.projects}
          query={query}
          highlight={highlight}
          onQuery={setQuery}
          onHighlight={setHighlight}
          onMove={(cwd) => {
            p.onMove(cwd)
            p.onClose()
          }}
          onClose={p.onClose}
        />
      ) : (
        <>
          <div
            className="lp-dismiss"
            onClick={p.onClose}
            onContextMenu={(e) => {
              e.preventDefault()
              p.onClose()
            }}
          />
          <div className="cm-menu" role="menu">
            <div
              role="menuitem"
              className="cm-item"
              onClick={() => {
                p.onArchive()
                p.onClose()
              }}
            >
              <Icon name="Archive" size={14} />
              {archiveLabel(p.count, p.archived)}
            </div>
            <div
              role="menuitem"
              aria-disabled={p.moveBlocked ? true : undefined}
              className={p.moveBlocked ? 'cm-item is-disabled' : 'cm-item'}
              title={p.moveBlocked ?? undefined}
              onClick={() => !p.moveBlocked && setMoving(true)}
            >
              <Icon name="ArrowRight" size={14} />
              Move to…
            </div>
            <div role="menuitem" className="cm-item" onClick={() => setLabels(true)}>
              <Icon name="Label" size={14} />
              Labels…
            </div>
            {p.onTrash && (
              <div
                role="menuitem"
                aria-disabled={p.trashBlocked ? true : undefined}
                className={p.trashBlocked ? 'cm-item is-danger is-disabled' : 'cm-item is-danger'}
                title={p.trashBlocked ?? undefined}
                onClick={() => {
                  if (p.trashBlocked) return
                  p.onTrash?.()
                  p.onClose()
                }}
              >
                <Icon name="Trash" size={14} />
                {trashLabel(p.count)}
              </div>
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
  const render = (count: number, archived: boolean, over: Partial<ContextMenuProps> = {}) =>
    renderToStaticMarkup(
      <ContextMenu
        x={10} y={20} count={count} archived={archived} labels={[]} applied={[]} counts={{}} projects={[]} moveBlocked={null} trashBlocked={null}
        onArchive={noop} onMove={noop} onToggleLabel={noop} onCreateLabel={noop} onClose={noop} {...over}
      />,
    )
  it('words the archive item by count and archived state', () => {
    expect(render(1, false)).toMatch(/<\/svg>Archive<\/div>/)
    expect(render(3, false)).toContain('Archive 3 sessions')
    expect(render(1, true)).toMatch(/<\/svg>Restore<\/div>/)
    expect(render(2, true)).toContain('Restore 2 sessions')
  })
  it('offers a Labels… item and opens at the click point', () => {
    const html = render(1, false)
    expect(html).toContain('Labels…')
    expect(html).toContain('style="left:10px;top:20px"')
  })
  it('offers Move to… between Archive and Labels…', () => {
    const html = render(1, false)
    expect(html).toMatch(/Archive<\/div>.*Move to…<\/div>.*Labels…/)
    expect(html).not.toContain('is-disabled')
  })
  it('greys out Move to… with the reason as its tooltip when the move is blocked', () => {
    expect(render(2, false, { moveBlocked: 'Exit it first.' })).toContain('aria-disabled="true" class="cm-item is-disabled" title="Exit it first."')
  })
  it('offers Move to Trash… as the last item only when trashing is offered', () => {
    expect(render(1, true)).not.toContain('Trash')
    expect(render(1, true, { onTrash: noop })).toMatch(/Labels…<\/div><div role="menuitem" class="cm-item is-danger">.*Move to Trash…<\/div><\/div>/)
    expect(render(3, true, { onTrash: noop })).toContain('Move 3 sessions to Trash…')
  })
  it('greys out Move to Trash… with the reason as its tooltip when trashing is blocked', () => {
    expect(render(2, true, { onTrash: noop, trashBlocked: 'Exit it first.' })).toContain('aria-disabled="true" class="cm-item is-danger is-disabled" title="Exit it first."')
  })
  it('keeps the menu inside the window', () => {
    expect(clamp(990, 200, 1000)).toBe(792)
    expect(clamp(100, 200, 1000)).toBe(100)
    expect(clamp(-5, 200, 1000)).toBe(MARGIN)
  })
}
