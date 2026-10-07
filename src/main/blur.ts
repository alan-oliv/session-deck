import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'

type Addon = { setBlur(handle: Buffer, radius: number): number }
let addon: Addon | null | undefined
let report: (err: unknown) => void = () => {}

export function initBlur(onError: (err: unknown) => void): void {
  report = onError
}

// dlopen instead of require: the bundler leaves it alone, and a missing or broken addon only loses the blur.
function load(): Addon | null {
  if (addon !== undefined) return addon
  const file = app.isPackaged ? join(process.resourcesPath, 'blur.node') : join(app.getAppPath(), 'native/blur/build/Release/blur.node')
  try {
    const m = { exports: {} as Addon }
    process.dlopen(m, file)
    addon = m.exports
  } catch (err) {
    report(err)
    addon = null
  }
  return addon
}

export function setWindowBlur(win: BrowserWindow, radius: number): boolean {
  const a = load()
  if (!a || win.isDestroyed()) return false
  const err = a.setBlur(win.getNativeWindowHandle(), Math.max(0, Math.min(40, Math.round(radius))))
  if (err !== 0) report(new Error(`CGSSetWindowBackgroundBlurRadius returned ${err}`))
  return err === 0
}
