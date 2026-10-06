import { renderToStaticMarkup } from 'react-dom/server'
import './Resize.css'

const KEY_STEP = 16

export interface ResizeProps {
  width: number
  min: number
  max: number
  defaultWidth: number
  label: string
  onWidth(width: number): void
}

export function ResizeHandle({ width, min, max, defaultWidth, label, onWidth }: ResizeProps) {
  const clamp = (w: number) => Math.min(max, Math.max(min, Math.round(w)))
  return (
    <div
      className="resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onDoubleClick={() => onWidth(defaultWidth)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const startX = e.clientX
        const startWidth = width
        const el = e.currentTarget
        // Window listeners, ended by release, blur or a buttonless move, so a lost pointerup can't leave the drag stuck.
        const end = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('blur', end)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          el.classList.remove('is-dragging')
        }
        const move = (ev: PointerEvent) => {
          if (!(ev.buttons & 1)) return end()
          onWidth(clamp(startWidth + ev.clientX - startX))
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('blur', end)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        el.classList.add('is-dragging')
      }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0
        if (!step) return
        e.preventDefault()
        onWidth(clamp(width + step))
      }}
    />
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('renders a focusable separator that reports its width and limits', () => {
    const html = renderToStaticMarkup(<ResizeHandle width={250} min={160} max={360} defaultWidth={220} label="Resize sidebar" onWidth={() => {}} />)
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-label="Resize sidebar"')
    expect(html).toContain('aria-valuenow="250"')
    expect(html).toContain('aria-valuemax="360"')
    expect(html).toContain('tabindex="0"')
  })
}
