import { app, BrowserWindow, clipboard, dialog, shell, type MessageBoxOptions } from 'electron'
import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canRename, isSessionId, RENAME_BLOCKED, terminalLabel, type ResumeResult, type Session, type Settings, type SettingsPatch } from '../shared/api'
import { blurRadius } from '../shared/appearance'
import { forgetSessions } from '../shared/labels'
import { initBlur, setWindowBlur } from './blur'
import { createIndexer } from './indexer'
import { broadcast, registerIpc } from './ipc'
import { createLabelsStore } from './labels'
import { checkMoveTarget, moveSessionsTo } from './move'
import { PATHS } from './paths'
import { applyPatch, createSettingsStore, isTerminal } from './settings'
import { installTee, removeTee } from './statusline'
import { AutomationDeniedError, CannotRunError, defaultTerminal, folderToOpen, installedTerminals, launch, suggestTerminal, terminalCommand } from './terminal'
import { cleanTitle, customTitleLine } from './transcript'
import { createTranscriptStore } from './transcripts'
import { checkTrashable, trashSessionsTo } from './trash'
import { createUpdates } from './updates'

// The renderer tints its own background by the opacity setting; the window server blurs the desktop under it.
const applyBlur = (win: BrowserWindow, s: Settings) => setWindowBlur(win, blurRadius(s))

// Only the running Dock icon changes; Finder and Launchpad keep the bundle's dark .icns.
function applyAppIcon(s: Settings): void {
  const file = `icon-${s.appIcon}.png`
  app.dock?.setIcon(app.isPackaged ? join(process.resourcesPath, file) : join(app.getAppPath(), 'build', file))
}

function createMainWindow(settings: Settings): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  })
  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.webContents.on('did-finish-load', () => applyBlur(win, settings))
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
  const settings = createSettingsStore(join(userData, 'settings.json'), existsSync(join(userData, 'index.json')))
  const labels = createLabelsStore(join(userData, 'labels.json'))
  initBlur((err) => console.error('blur', err))
  applyAppIcon(settings.get())
  const indexer = createIndexer({
    projectsDir: PATHS.projects,
    sessionsDir: PATHS.sessions,
    teeDir: PATHS.tee,
    cachePath: join(userData, 'index.json'),
    claudeSettingsPath: PATHS.claudeSettings,
    getSettings: settings.get,
    onChange: () => broadcast('sessionsChanged'),
  })
  const transcripts = createTranscriptStore((id) => indexer.transcriptPath(id))
  const updates = createUpdates(() => broadcast('updateChanged'))

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
      if ('terminal' in p && p.terminal !== null && !isTerminal(p.terminal)) throw new Error('Unknown terminal')
      const prev = settings.get()
      const clean = applyPatch(prev, p)
      const next = settings.save(clean)
      for (const win of BrowserWindow.getAllWindows()) applyBlur(win, next)
      if (next.appIcon !== prev.appIcon) applyAppIcon(next)
      broadcast('settingsChanged')
      return next
    },
    listTerminals: async () => installedTerminals(),
    suggestTerminal: async () => suggestTerminal(installedTerminals()),
    openAutomationSettings: async () => {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation')
    },
    resumeSession: async (id, opts): Promise<ResumeResult> => {
      if (!opts || typeof opts !== 'object' || typeof opts.fork !== 'boolean') throw new Error('Invalid options')
      if (opts.open !== undefined && opts.open !== 'tab' && opts.open !== 'window') throw new Error('Invalid options')
      const s = sessionFor(id)
      const fork = opts.fork
      const { terminal: chosen, skipPermissions } = settings.get()
      const open = opts.open ?? settings.get().open
      const installed = installedTerminals()
      const terminal = chosen && installed.includes(chosen) ? chosen : defaultTerminal(installed)
      try {
        await launch(terminal, open, s, fork, skipPermissions)
        return { ok: true }
      } catch (e) {
        clipboard.writeText(terminalCommand(s, fork, skipPermissions))
        if (e instanceof AutomationDeniedError) return { ok: false, message: e.message, automation: e.terminal }
        if (e instanceof CannotRunError) return { ok: false, message: e.message }
        return { ok: false, message: `Couldn't open ${terminalLabel(terminal)}, so the command was copied. ${e instanceof Error ? e.message : String(e)}` }
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
      if (!canRename(s)) throw new Error(RENAME_BLOCKED)
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
    moveSessions: async (ids, cwd) => {
      if (!Array.isArray(ids) || !ids.length) throw new Error('Invalid sessions')
      const sessions = [...new Set(ids)].map(sessionFor)
      const target = checkMoveTarget(cwd)
      try {
        moveSessionsTo(PATHS.projects, sessions, target, (id) => indexer.transcriptPath(id))
      } finally {
        await indexer.refresh()
      }
    },
    trashSessions: async (ids) => {
      if (!Array.isArray(ids) || !ids.length) throw new Error('Invalid sessions')
      const sessions = [...new Set(ids)].map(sessionFor)
      checkTrashable(sessions)
      const box: MessageBoxOptions = {
        type: 'warning',
        message: sessions.length === 1 ? `Move “${sessions[0].title}” to the Trash?` : `Move ${sessions.length} sessions to the Trash?`,
        detail: "Claude Code won't list them in /resume anymore. You can restore the files from the Trash in Finder until you empty it.",
        buttons: ['Move to Trash', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      }
      const win = BrowserWindow.getFocusedWindow()
      const { response } = await (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box))
      if (response !== 0) return false
      const gone: string[] = []
      try {
        await trashSessionsTo(sessions, (id) => indexer.transcriptPath(id), (p) => shell.trashItem(p), (id) => gone.push(id))
      } finally {
        if (gone.length) {
          settings.save({ archived: settings.get().archived.filter((id) => !gone.includes(id)) })
          labels.save(forgetSessions(labels.get(), gone))
          broadcast('settingsChanged')
          broadcast('labelsChanged')
        }
        await indexer.refresh()
      }
      return true
    },
    setStatusTee: async (enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Invalid status tee flag')
      if (enabled) installTee()
      else removeTee()
      settings.save({ statusTee: enabled })
      broadcast('settingsChanged')
      indexer.notify()
    },
    getTranscript: async (id) => transcripts.get(sessionFor(id).id),
    getToolOutput: async (id, turn, item) => {
      if (!Number.isInteger(turn) || !Number.isInteger(item) || turn < 0 || item < 0) throw new Error('Invalid tool call')
      return transcripts.output(sessionFor(id).id, turn, item)
    },
    getLabels: async () => labels.get(),
    saveLabels: async (store) => {
      if (!store || typeof store !== 'object' || !Array.isArray((store as { list?: unknown }).list)) throw new Error('Invalid labels')
      const next = labels.save(store)
      broadcast('labelsChanged')
      return next
    },
    getUpdate: async () => updates.ready(),
    installUpdate: async () => {
      if (!updates.ready()) throw new Error('No update is ready')
      updates.install()
    },
  })

  createMainWindow(settings.get())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(settings.get())
  })
  app.on('before-quit', () => indexer.stop())
  void indexer.start()
})

app.on('window-all-closed', () => app.quit())
