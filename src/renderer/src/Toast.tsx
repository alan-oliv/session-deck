import { renderToStaticMarkup } from 'react-dom/server'
import './Toast.css'

export function Toast({ text }: { text: string }) {
  return <div className="toast">{text}</div>
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  it('renders the message in a fixed toast', () => {
    expect(renderToStaticMarkup(<Toast text='Renamed. Resume with claude --resume "x"' />)).toBe('<div class="toast">Renamed. Resume with claude --resume &quot;x&quot;</div>')
  })
}
