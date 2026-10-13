import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_MS = 6 * 60 * 60 * 1000

// A downloaded update installs on quit by itself; install() only brings that forward.
export function createUpdates(onReady: () => void) {
  let ready: string | null = null
  if (app.isPackaged) {
    autoUpdater.on('update-downloaded', (info) => {
      ready = info.version
      onReady()
    })
    const check = () => autoUpdater.checkForUpdates().catch((e) => console.error('update', e))
    void check()
    setInterval(check, CHECK_MS)
  }
  return { ready: () => ready, install: () => autoUpdater.quitAndInstall() }
}
