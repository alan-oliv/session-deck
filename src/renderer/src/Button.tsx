import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import './Button.css'

export function Button({ kind, children, onClick, title }: { kind: 'primary' | 'secondary'; children: ReactNode; onClick(): void; title?: string }) {
  return (
    <button type="button" className={`btn btn-${kind}`} onClick={onClick} title={title}>
      {children}
    </button>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('renders a primary or secondary design-system button with its label', () => {
    expect(renderToStaticMarkup(<Button kind="primary" onClick={() => {}}>Resume</Button>)).toBe('<button type="button" class="btn btn-primary">Resume</button>')
  })
}
