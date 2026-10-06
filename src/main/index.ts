import { app, BrowserWindow, clipboard, shell } from 'electron'
import { appendFileSync, closeSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isSessionId, type ResumeResult, type Session, type SettingsPatch } from '../shared/api'
import { createIndexer } from './indexer'
import { broadcast, registerIpc } from './ipc'
import { PATHS } from './paths'
import { createSettingsStore, isTerminal } from './settings'
import { installTee, removeTee } from './statusline'
import { folderToOpen, launch, terminalCommand } from './terminal'
import { cleanTitle, customTitleLine } from './transcript'

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#181921',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  })
  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.once('ready-to-show', show)
  // A wedged renderer must not leave the window hidden forever.
  setTimeout(show, 3000)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A navigated page would still get window.api from the preload.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

// A transcript cut mid-line must not glue our record onto the partial one.
function appendLine(path: string, line: string): void {
  const size = statSync(path).size
  let lastByte = 10
  if (size > 0) {
    const fd = openSync(path, 'r')
    const b = Buffer.alloc(1)
    readSync(fd, b, 0, 1, size - 1)
    closeSync(fd)
    lastByte = b[0]
  }
  appendFileSync(path, (lastByte === 10 ? '' : '\n') + line)
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const settings = createSettingsStore(join(userData, 'settings.json'))
  const indexer = createIndexer({
    projectsDir: PATHS.projects,
    sessionsDir: PATHS.sessions,
    teeDir: PATHS.tee,
    cachePath: join(userData, 'index.json'),
    claudeSettingsPath: PATHS.claudeSettings,
    getSettings: settings.get,
    onChange: () => broadcast('sessionsChanged'),
  })

  const sessionFor = (id: unknown): Session => {
    if (!isSessionId(id)) throw new Error('Invalid session id')
    const s = indexer.get(id)
    if (!s) throw new Error('Unknown session')
    return s
  }

  registerIpc({
    listSessions: async () => indexer.list(),
    getSettings: async () => settings.get(),
    saveSettings: async (patch: SettingsPatch) => {
      const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
      if (!('terminal' in p)) return settings.get()
      const terminal = p.terminal === null ? null : isTerminal(p.terminal) ? p.terminal : undefined
      if (terminal === undefined) throw new Error('Unknown terminal')
      const next = settings.save({ terminal })
      broadcast('settingsChanged')
      return next
    },
    resumeSession: async (id, opts): Promise<ResumeResult> => {
      if (!opts || typeof opts !== 'object' || typeof opts.fork !== 'boolean') throw new Error('Invalid options')
      const s = sessionFor(id)
      const fork = opts.fork
      const terminal = settings.get().terminal
      if (!terminal) return { ok: false, needsTerminal: true }
      try {
        await launch(terminal, s, fork)
        return { ok: true }
      } catch (e) {
        clipboard.writeText(terminalCommand(s, fork))
        return { ok: false, copied: true, error: e instanceof Error ? e.message : String(e) }
      }
    },
    openFolder: async (id) => {
      const s = sessionFor(id)
      const folder = s.cwdExists ? folderToOpen(s.cwd) : null
      if (!folder) throw new Error('This folder no longer exists')
      const err = await shell.openPath(folder)
      if (err) throw new Error(err)
    },
    openPr: async (id) => {
      const s = sessionFor(id)
      if (!s.pr || !s.pr.url.startsWith('https://github.com/')) throw new Error('No pull request')
      await shell.openExternal(s.pr.url)
    },
    renameSession: async (id, title) => {
      const s = sessionFor(id)
      if (s.live) throw new Error("Can't rename a running session")
      const clean = cleanTitle(title)
      if (!clean) throw new Error('Titles are 1–120 characters on one line')
      const path = indexer.transcriptPath(s.id)
      if (!path) throw new Error('Unknown session')
      appendLine(path, customTitleLine(s.id, clean))
      await indexer.refresh()
    },
    setArchived: async (id, archived) => {
      if (typeof archived !== 'boolean') throw new Error('Invalid archived flag')
      const s = sessionFor(id)
      const ids = new Set(settings.get().archived)
      if (archived) ids.add(s.id)
      else ids.delete(s.id)
      settings.save({ archived: [...ids] })
      broadcast('settingsChanged')
      broadcast('sessionsChanged')
    },
    setStatusTee: async (enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Invalid status tee flag')
      if (enabled) installTee()
      else removeTee()
      settings.save({ statusTee: enabled })
      broadcast('settingsChanged')
      indexer.notify()
    },
  })

  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
  app.on('before-quit', () => indexer.stop())
  void indexer.start()
})

app.on('window-all-closed', () => app.quit())
