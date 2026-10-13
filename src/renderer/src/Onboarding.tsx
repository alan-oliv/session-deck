import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import mark from '../../../build/session-deck-mark.svg'
import { SETTINGS_DEFAULTS, TERMINALS, terminalLabel, type OpenIn, type Settings, type SettingsPatch, type Terminal } from '../../shared/api'
import { Button } from './Button'
import { Icon } from './icons'
import './Onboarding.css'

const STEPS = ['Terminal', 'How sessions open', 'Permissions', 'All set'] as const
const SUB: Partial<Record<Terminal, string>> = { terminal: 'Built into macOS', vscode: 'Integrated terminal' }

export const moveSelection = <T,>(ids: readonly T[], current: T, key: string): T => {
  const i = ids.indexOf(current)
  const d = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 0
  return ids[Math.min(ids.length - 1, Math.max(0, i + d))] ?? current
}

export interface OnboardingProps {
  settings: Settings
  installed: Terminal[]
  suggested: Terminal
  onChange(patch: SettingsPatch): void
  onFinish(openSettings: boolean): void
}

interface ViewProps extends OnboardingProps {
  step: number
  onStep(n: number): void
}

export function Onboarding(props: OnboardingProps) {
  const [step, setStep] = useState(0)
  return <OnboardingView {...props} step={step} onStep={setStep} />
}

function Option({ selected, onSelect, className, children }: { selected: boolean; onSelect(): void; className: string; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`ob-option${selected ? ' is-selected' : ''} ${className}`} onClick={onSelect}>
      <span className="ob-radio" />
      {children}
    </button>
  )
}

function OnboardingView({ settings: s, installed, suggested, step, onStep, onChange, onFinish }: ViewProps) {
  const terms = TERMINALS.filter((t) => installed.includes(t.id))
  const terminal = s.terminal && installed.includes(s.terminal) ? s.terminal : suggested
  const name = terminalLabel(terminal)
  const openLabel = s.open === 'tab' ? 'New tab' : 'New window'
  const permLabel = s.skipPermissions ? 'Skip permission prompts' : 'Ask before running tools'
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => panel.current?.focus(), [])

  const next = () => {
    if (step === 0) onChange({ terminal })
    if (step === 3) return onFinish(false)
    onStep(step + 1)
  }
  const back = () => step > 0 && onStep(step - 1)
  const useDefaults = () => {
    onChange({ terminal: suggested, open: 'tab', skipPermissions: false })
    onStep(3)
  }
  const openSettings = () => {
    onChange({ terminal })
    onFinish(true)
  }

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // A focused option means "this one, move on"; any other focused button (Back, Change…) keeps its own Enter.
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement && e.target.getAttribute('role') !== 'radio')) {
        e.preventDefault()
        next()
      } else if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const arrows = <T,>(ids: readonly T[], current: T, set: (v: T) => void) => (e: KeyboardEvent) => {
    const to = moveSelection(ids, current, e.key)
    if (to !== current) {
      e.preventDefault()
      set(to)
    }
  }

  const title = ['Welcome to Session Deck', 'New tab or new window?', 'Ask before running tools?', "You're ready to resume"][step]
  const body = [
    'Where should your sessions open?',
    'Choose what the Resume button does. The other option stays in the Resume menu.',
    'Claude Code normally asks before it edits files or runs commands. You can let resumed sessions skip those prompts.',
    "Here's how Session Deck will open your sessions.",
  ][step]

  return (
    <div className="ob-scrim">
      <div className="ob-panel" role="dialog" aria-modal="true" aria-labelledby="ob-title" tabIndex={-1} ref={panel}>
        <div className="ob-top">
          <img className="ob-mark" src={mark} alt="" />
          <span className="ob-brand">Session Deck</span>
          <div className="ob-dots" aria-hidden="true">
            {STEPS.map((n, i) => (
              <span key={n} className={`ob-dot${i === step ? ' is-current' : ''}${i <= step ? ' is-done' : ''}`} />
            ))}
          </div>
        </div>
        <div className="ob-body">
          <div className="ob-head">
            <span className="ob-kicker">{`Step ${step + 1} of 4 · ${STEPS[step]}`}</span>
            <h2 id="ob-title" className="ob-title">{title}</h2>
            <p className="ob-text">{body}</p>
          </div>
          {step === 0 && (
            <div className="ob-grid" role="radiogroup" aria-label="Terminal" onKeyDown={arrows(terms.map((t) => t.id), terminal, (t) => onChange({ terminal: t }))}>
              {terms.map((t) => (
                <Option key={t.id} className="ob-term" selected={t.id === terminal} onSelect={() => onChange({ terminal: t.id })}>
                  <span className="ob-name-col">
                    <span className="ob-name">{t.label}</span>
                    {SUB[t.id] && <span className="ob-sub">{SUB[t.id]}</span>}
                  </span>
                </Option>
              ))}
            </div>
          )}
          {step === 1 && (
            <div className="ob-list" role="radiogroup" aria-label="Open in" onKeyDown={arrows<OpenIn>(['tab', 'window'], s.open, (o) => onChange({ open: o }))}>
              <Option className="ob-wide" selected={s.open === 'tab'} onSelect={() => onChange({ open: 'tab' })}>
                <span className="ob-col">
                  <span className="ob-row"><span className="ob-name">New tab</span><span className="ob-tag">Recommended</span></span>
                  <span className="ob-desc">{`Opens in a new tab of your ${name} window if one is open, otherwise in a new window.`}</span>
                </span>
              </Option>
              <Option className="ob-wide" selected={s.open === 'window'} onSelect={() => onChange({ open: 'window' })}>
                <span className="ob-col">
                  <span className="ob-row"><span className="ob-name">New window</span></span>
                  <span className="ob-desc">{`Every resumed session gets its own ${name} window.`}</span>
                </span>
              </Option>
            </div>
          )}
          {step === 2 && (
            <div className="ob-list" role="radiogroup" aria-label="Permissions" onKeyDown={arrows<boolean>([false, true], s.skipPermissions, (v) => onChange({ skipPermissions: v }))}>
              <Option className="ob-wide" selected={!s.skipPermissions} onSelect={() => onChange({ skipPermissions: false })}>
                <span className="ob-col">
                  <span className="ob-row"><span className="ob-name">Ask before running tools</span><span className="ob-tag">Recommended</span></span>
                  <span className="ob-desc">Claude stops and asks before editing files or running commands.</span>
                </span>
              </Option>
              <Option className="ob-wide" selected={s.skipPermissions} onSelect={() => onChange({ skipPermissions: true })}>
                <span className="ob-col">
                  <span className="ob-row"><span className="ob-name">Skip permission prompts</span></span>
                  <span className="ob-desc">Claude runs tools without asking. Only use this in projects you trust.</span>
                  <span className="ob-code">claude --resume … --dangerously-skip-permissions</span>
                </span>
              </Option>
            </div>
          )}
          {step === 3 && (
            <div className="ob-final">
              <dl className="ob-summary">
                {(
                  [
                    ['Terminal', name, 0],
                    ['Resume opens', openLabel, 1],
                    ['Permissions', permLabel, 2],
                  ] as const
                ).map(([k, v, to]) => (
                  <div className="ob-sum-row" key={k}>
                    <dt>{k}</dt>
                    <dd>
                      <span>{v}</span>
                      <button type="button" className="ob-change" onClick={() => onStep(to)}>Change</button>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="ob-note">
                <span className="ob-note-icon"><Icon name="Settings" size={14} /></span>
                <span className="ob-note-text">You can change these any time in Settings. It also has appearance options if you'd like to customize: accent color, app icon, window opacity and blur.</span>
                <kbd className="ob-key">⌘,</kbd>
              </div>
            </div>
          )}
        </div>
        <div className="ob-foot">
          {step > 0 && <Button kind="secondary" onClick={back}>Back</Button>}
          {step < 3 && (
            <button type="button" className="ob-text-btn" title={`Use the defaults: ${terminalLabel(suggested)}, new tab, ask before running tools`} onClick={useDefaults}>
              Use defaults
            </button>
          )}
          <span className="ob-spacer" />
          {step === 3 && <Button kind="secondary" onClick={openSettings}>Open Settings</Button>}
          <Button kind="primary" onClick={next}>{['Get started', 'Continue', 'Continue', 'Start'][step]}</Button>
        </div>
      </div>
    </div>
  )
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const render = (over: Partial<Settings> = {}, step = 0, installed: Terminal[] = ['terminal', 'iterm', 'warp']) =>
    renderToStaticMarkup(<OnboardingView step={step} settings={{ ...SETTINGS_DEFAULTS, ...over }} installed={installed} suggested="terminal" onStep={() => {}} onChange={() => {}} onFinish={() => {}} />)

  it('step 1 lists installed terminals and selects the saved one, else the suggestion', () => {
    const selected = (label: string) => new RegExp(`ob-option is-selected[^>]*>(?:(?!<button).)*>${label}<`)
    const html = render({ terminal: 'iterm' })
    expect(html).toContain('Welcome to Session Deck')
    expect(html).toContain('Step 1 of 4 · Terminal')
    expect(html).not.toContain('>VS Code<')
    expect(html.match(/ob-option is-selected/g)).toHaveLength(1)
    expect(html).toMatch(selected('iTerm2'))
    expect(render({ terminal: 'terminal' })).not.toMatch(selected('iTerm2'))
    expect(render({ terminal: null })).toMatch(selected('Terminal'))
    expect(render({ terminal: 'warp' }, 0, ['terminal'])).toMatch(selected('Terminal'))
  })
  it('step 2 names the chosen terminal and marks New tab as recommended', () => {
    const html = render({ terminal: 'warp' }, 1)
    expect(html).toContain('New tab or new window?')
    expect(html).toContain('Opens in a new tab of your Warp window if one is open, otherwise in a new window.')
    expect(html).toContain('Every resumed session gets its own Warp window.')
    expect(html).toContain('Recommended')
  })
  it('step 3 offers both permission choices and shows the flag for skipping', () => {
    const html = render({}, 2)
    expect(html).toContain('Ask before running tools?')
    expect(html).toContain('claude --resume … --dangerously-skip-permissions')
  })
  it('step 4 summarises the three choices with Change links and offers Open Settings', () => {
    const html = render({ terminal: 'iterm', open: 'window', skipPermissions: true }, 3)
    expect(html).toContain('You&#x27;re ready to resume')
    expect(html).toMatch(/Terminal<\/dt>\s*<dd[^>]*>.*?iTerm2/)
    expect(html).toContain('New window')
    expect(html).toContain('Skip permission prompts')
    expect(html.match(/>Change</g)).toHaveLength(3)
    expect(html).toContain('Open Settings')
    expect(html).toContain('>Start<')
    expect(html).not.toContain('Use defaults')
  })
  it('labels the primary button per step and hides Back on step 1', () => {
    expect(render({}, 0)).toContain('Get started')
    expect(render({}, 0)).not.toContain('>Back<')
    expect(render({}, 1)).toContain('>Continue<')
    expect(render({}, 1)).toContain('>Back<')
  })
  it('names the suggested terminal in the Use defaults tooltip', () => {
    expect(render({ terminal: 'iterm' })).toContain('title="Use the defaults: Terminal, new tab, ask before running tools"')
  })
  it('moves the selection with the arrow keys and stops at the ends', () => {
    expect(moveSelection(['a', 'b', 'c'], 'a', 'ArrowDown')).toBe('b')
    expect(moveSelection(['a', 'b', 'c'], 'b', 'ArrowRight')).toBe('c')
    expect(moveSelection(['a', 'b', 'c'], 'c', 'ArrowDown')).toBe('c')
    expect(moveSelection(['a', 'b', 'c'], 'a', 'ArrowUp')).toBe('a')
    expect(moveSelection(['a', 'b', 'c'], 'b', 'Enter')).toBe('b')
  })
}
