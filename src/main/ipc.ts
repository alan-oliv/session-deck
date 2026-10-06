import { BrowserWindow, ipcMain } from 'electron'
import { API_METHODS, type Api, type ApiMethod, type EventChannel } from '../shared/api'

export function registerIpc(handlers: { [K in ApiMethod]: Api[K] }): void {
  for (const name of API_METHODS) {
    const handler = handlers[name] as (...args: unknown[]) => unknown
    ipcMain.handle(`api:${name}`, (_event, ...args: unknown[]) => handler(...args))
  }
}

export function broadcast(channel: EventChannel): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(`evt:${channel}`)
}
