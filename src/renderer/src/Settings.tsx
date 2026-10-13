import { useEffect, useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import darkIcon from '../../../build/icon-dark.png'
import purpleIcon from '../../../build/icon-purple.png'
import { ACCENTS, SETTINGS_DEFAULTS, TERMINALS, type AppIcon, type Settings, type SettingsPatch, type Terminal } from '../../shared/api'
import { Button } from './Button'
import { Icon } from './icons'
import './Settings.css'

const APP_ICONS: { id: AppIcon; name: string; src: string }[] = [
  { id: 'dark', name: 'Dark', src: darkIcon },
  { id: 'purple', name: 'Purple', src: purpleIcon },
]

export interface SettingsModalProps {
  settings: Settings
  installed: Terminal[]
  onChange(patch: SettingsPatch): void
  onClose(): void
}

export function SettingsModal({ settings: s, installed, onChange, onClose }: SettingsModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => panel.current?.focus(), [])
  const accent = ACCENTS.find((a) => a.id === s.accent) ?? ACCENTS[0]
  const translucent = s.opacity < 100
  const terms = TERMINALS.filter((t) => installed.includes(t.id))
  const reset = () => {
    const { terminal, open, accent, opacity, blur, appIcon } = SETTINGS_DEFAULTS
    onChange({ terminal, open, accent, opacity, blur, appIcon })
  }
  return (
    <div className="set-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="set-panel" role="dialog" aria-modal="true" aria-labelledby="set-title" tabIndex={-1} ref={panel}>
        <div className="set-head">
          <span id="set-title" className="set-title">Settings</span>
          <button type="button" className="set-close" title="Close" aria-label="Close" onClick={onClose}>
            <Icon name="Close" size={14} />
          </button>
        </div>
        <div className="set-body">
          <span className="set-section">Resuming</span>
          <div className="set-row is-first is-top">
            <div className="set-text">
              <span className="set-label">Terminal</span>
              <span className="set-help">Where Resume and Branch conversation open the session.</span>
            </div>
            <div className="set-terms" role="radiogroup" aria-label="Terminal">
              {terms.map((t) => {
                const cur = t.id === s.terminal
                return (
                  <button type="button" role="radio" aria-checked={cur} key={t.id} className={cur ? 'set-term is-selected' : 'set-term'} onClick={() => onChange({ terminal: t.id })}>
                    <span className="set-term-name">{t.label}</span>
                    <span className="set-term-check">{cur && <Icon name="Check" size={12} />}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <span className="set-label">Open in</span>
              <span className="set-help">What the main Resume button does.</span>
            </div>
            <div className="set-seg" role="radiogroup" aria-label="Open in">
              {(['tab', 'window'] as const).map((o) => (
                <button type="button" role="radio" aria-checked={s.open === o} key={o} className={s.open === o ? 'set-seg-item is-selected' : 'set-seg-item'} onClick={() => onChange({ open: o })}>
                  {o === 'tab' ? 'New tab' : 'New window'}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <span className="set-label" id="set-skip">Skip permission prompts when resuming</span>
              <span className="set-help">Claude won't stop to ask before running tools. Only use this in projects you trust.</span>
            </div>
            <input type="checkbox" className="set-check" aria-labelledby="set-skip" checked={s.skipPermissions} onChange={(e) => onChange({ skipPermissions: e.target.checked })} />
          </div>
          <span className="set-section is-divided">Appearance</span>
          <div className="set-row is-first">
            <div className="set-text">
              <span className="set-label">Accent color</span>
              <span className="set-help">Used for Resume, selection marks and the context meter.</span>
            </div>
            <div className="set-accent">
              <div className="set-swatches" role="radiogroup" aria-label="Accent color">
                {ACCENTS.map((a) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={a.id === s.accent}
                    key={a.id}
                    className="set-swatch"
                    title={a.name}
                    aria-label={a.name}
                    style={{ background: a.fill, boxShadow: a.id === s.accent ? `0 0 0 2px var(--app-modal), 0 0 0 3px ${a.fill}` : 'none' }}
                    onClick={() => onChange({ accent: a.id })}
                  >
                    {a.id === s.accent && <Icon name="Check" size={12} />}
                  </button>
                ))}
              </div>
              <span className="set-accent-name">{accent.name}</span>
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <span className="set-label">App icon</span>
              <span className="set-help">Shown in the Dock while Session Deck runs. Finder and Launchpad keep Dark.</span>
            </div>
            <div className="set-terms" role="radiogroup" aria-label="App icon">
              {APP_ICONS.map((i) => {
                const cur = i.id === s.appIcon
                return (
                  <button type="button" role="radio" aria-checked={cur} key={i.id} className={cur ? 'set-term has-icon is-selected' : 'set-term has-icon'} onClick={() => onChange({ appIcon: i.id })}>
                    <img className="set-term-icon" src={i.src} alt="" />
                    <span className="set-term-name">{i.name}</span>
                    <span className="set-term-check">{cur && <Icon name="Check" size={12} />}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <span className="set-label" id="set-opacity">Window opacity</span>
              <span className="set-help">Lower values let the desktop show through.</span>
            </div>
            <div className="set-range">
              <input type="range" min={50} max={100} step={1} value={s.opacity} aria-labelledby="set-opacity" onChange={(e) => onChange({ opacity: +e.target.value })} />
              <span className="set-range-value tnum">{`${s.opacity}%`}</span>
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <span className="set-label" id="set-blur">Background blur</span>
              <span className="set-help">{translucent ? 'How much the desktop behind the window is blurred.' : 'Only visible when opacity is below 100%.'}</span>
            </div>
            <div className="set-range">
              <input type="range" min={0} max={40} step={1} value={s.blur} aria-labelledby="set-blur" onChange={(e) => onChange({ blur: +e.target.value })} />
              <span className="set-range-value tnum">{`${s.blur} px`}</span>
            </div>
          </div>
        </div>
        <div className="set-foot">
          <span className="set-saved">Saved on this Mac.</span>
          <Button kind="secondary" onClick={reset}>Reset to defaults</Button>
        </div>
      </div>
    </div>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const render = (over: Partial<Settings> = {}, installed: Terminal[] = ['terminal', 'iterm', 'ghostty']) =>
    renderToStaticMarkup(<SettingsModal settings={{ ...SETTINGS_DEFAULTS, ...over }} installed={installed} onChange={() => {}} onClose={() => {}} />)

  it('lists only installed terminals and marks the chosen one', () => {
    const html = render({ terminal: 'iterm' })
    expect(html).toContain('>iTerm2<')
    expect(html).toContain('>Ghostty<')
    expect(html).not.toContain('>Warp<')
    expect(html).toMatch(/set-term is-selected"[^>]*>.*?>iTerm2</)
    expect(html.match(/set-term is-selected/g)).toHaveLength(1)
  })
  it('shows no selected terminal when the saved one is missing or unset', () => {
    expect(render({ terminal: 'warp' })).not.toContain('set-term is-selected')
    expect(render({ terminal: null })).not.toContain('set-term is-selected')
  })
  it('shows the open mode, the accent name and the range values', () => {
    const html = render({ open: 'window', accent: 'teal', opacity: 70, blur: 10 })
    expect(html).toMatch(/set-seg-item is-selected"[^>]*>New window</)
    expect(html).toContain('>Teal<')
    expect(html).toContain('>70%<')
    expect(html).toContain('>10 px<')
    expect(html).toContain('How much the desktop behind the window is blurred.')
  })
  it('offers the dark and purple app icons and marks the chosen one', () => {
    const html = render({ appIcon: 'purple' })
    expect(html).toContain('aria-label="App icon"')
    expect(html).toMatch(/set-term has-icon is-selected"[^>]*>.*?>Purple</)
    expect(html.match(/set-term has-icon is-selected/g)).toHaveLength(1)
  })
  it('shows the skip-permissions checkbox, checked only when the setting is on', () => {
    expect(render()).toContain('Skip permission prompts when resuming')
    expect(render()).not.toMatch(/<input type="checkbox"[^>]*checked/)
    expect(render({ skipPermissions: true })).toMatch(/<input type="checkbox"[^>]*checked/)
  })
  it('explains that blur needs a translucent window at 100% opacity', () => {
    expect(render({ opacity: 100 })).toContain('Only visible when opacity is below 100%.')
  })
}
