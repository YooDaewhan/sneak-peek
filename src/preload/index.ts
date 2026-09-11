import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getConfig: (): Promise<{ hotkeys: Record<string, string>; size: [number, number] }> =>
    ipcRenderer.invoke('cfg:get'),
  setHotkey: (action: string, accel: string): Promise<boolean> =>
    ipcRenderer.invoke('cfg:hotkey', action, accel),
  setSize: (size: [number, number]): void => ipcRenderer.send('cfg:size', size),
  resize: (peek: boolean): void => ipcRenderer.send('peek:resize', peek),
  fit: (height: number): void => ipcRenderer.send('app:fit', height),
  move: (dx: number, dy: number): void => ipcRenderer.send('app:move', dx, dy),
  minimize: (): void => ipcRenderer.send('app:minimize'),
  setLock: (on: boolean): void => ipcRenderer.send('app:lock', on),
  setIgnoreMouse: (on: boolean): void => ipcRenderer.send('app:ignoreMouse', on),
  setOpacity: (v: number): void => ipcRenderer.send('app:opacity', v),
  quit: (): void => ipcRenderer.send('app:quit'),
  onLock: (cb: (on: boolean) => void): void => {
    ipcRenderer.on('lock', (_e, on: boolean) => cb(on))
  },
  onSize: (cb: (size: [number, number]) => void): void => {
    ipcRenderer.on('size', (_e, size: [number, number]) => cb(size))
  },
  onOpacity: (cb: (v: number) => void): void => {
    ipcRenderer.on('opacity', (_e, v: number) => cb(v))
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
