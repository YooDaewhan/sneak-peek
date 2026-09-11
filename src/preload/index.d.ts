import { ElectronAPI } from '@electron-toolkit/preload'

interface Cfg {
  hotkeys: Record<string, string>
  size: [number, number]
}

interface Api {
  getConfig: () => Promise<Cfg>
  setHotkey: (action: string, accel: string) => Promise<boolean>
  setSize: (size: [number, number]) => void
  resize: (peek: boolean) => void
  fit: (height: number) => void
  move: (dx: number, dy: number) => void
  minimize: () => void
  setLock: (on: boolean) => void
  setIgnoreMouse: (on: boolean) => void
  setOpacity: (v: number) => void
  quit: () => void
  onLock: (cb: (on: boolean) => void) => void
  onSize: (cb: (size: [number, number]) => void) => void
  onOpacity: (cb: (v: number) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
