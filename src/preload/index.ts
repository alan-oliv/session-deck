import { contextBridge, ipcRenderer } from 'electron'
import { API_EVENTS, API_METHODS } from '../shared/api'

const api: Record<string, unknown> = {}
for (const name of API_METHODS) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args)
}
for (const [name, channel] of Object.entries(API_EVENTS)) {
  api[name] = (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on(`evt:${channel}`, listener)
    return () => {
      ipcRenderer.removeListener(`evt:${channel}`, listener)
    }
  }
}
contextBridge.exposeInMainWorld('api', api)
