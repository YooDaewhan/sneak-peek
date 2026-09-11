import { app, BrowserWindow, ipcMain, globalShortcut, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

type Size = [number, number]
type Cfg = { hotkeys: Record<string, string>; size: Size }

const PANEL_WIDTH = 400
const DEFAULT_CFG: Cfg = {
  hotkeys: {
    quit: 'Control+Shift+Q',
    minimize: 'Control+Shift+M',
    hide: 'Control+Shift+H',
    lock: 'Control+Shift+L'
  },
  size: [720, 440]
}

// ponytail: 설정이 몇 줄뿐이라 JSON 파일 직접 읽고 쓴다. electron-store 불필요.
const cfgPath = (): string => join(app.getPath('userData'), 'config.json')

function readCfg(): Cfg {
  try {
    const saved = JSON.parse(readFileSync(cfgPath(), 'utf8'))
    return {
      hotkeys: { ...DEFAULT_CFG.hotkeys, ...saved.hotkeys },
      size: saved.size ?? DEFAULT_CFG.size
    }
  } catch {
    return DEFAULT_CFG
  }
}

let cfg = DEFAULT_CFG
let win: BrowserWindow | null = null
let peeking = false
let locked = false
let lastOpacity = 1

function saveCfg(): void {
  writeFileSync(cfgPath(), JSON.stringify(cfg))
}

let saveTimer: NodeJS.Timeout | undefined
function saveSoon(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveCfg, 400)
}

// 잠금 모드: 클릭이 창을 통과해 뒤쪽 창으로 가고, 항상 위에 떠 있다. 그래서 켜놓고 딴 일을 할 수 있다.
// 잠금 중에는 자물쇠도 못 누르니 해제는 단축키로만 된다.
function setLocked(on: boolean): void {
  if (!win) return
  locked = on
  win.setIgnoreMouseEvents(on, { forward: true })
  win.setAlwaysOnTop(on)
  win.webContents.send('lock', on)
}

// 투명도 0은 창이 안 보이는데 클릭은 먹는 상태라, 숨긴 동안은 마우스도 통과시킨다.
function toggleHidden(): void {
  if (!win) return
  if (win.getOpacity() > 0) {
    lastOpacity = win.getOpacity()
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true, { forward: true })
    win.webContents.send('opacity', 0)
  } else {
    win.setOpacity(lastOpacity || 1)
    win.setIgnoreMouseEvents(locked, { forward: true })
    win.webContents.send('opacity', lastOpacity || 1)
  }
}

function stepOpacity(delta: number): void {
  if (!win) return
  const v = Math.min(1, Math.max(0.1, Math.round((win.getOpacity() + delta) * 100) / 100))
  win.setOpacity(v)
  win.webContents.send('opacity', v)
}

// Shift+←/→ 투명도. 전역 단축키가 아니라 이 창에 포커스가 있고 재생 중일 때만 받는다.
// 재생 중에만 받으므로 주소 입력창의 Shift 선택은 그대로 살아 있다.
function watchOpacityKeys(wc: Electron.WebContents): void {
  wc.on('before-input-event', (e, input) => {
    if (!peeking || input.type !== 'keyDown') return
    if (!input.shift || input.control || input.alt || input.meta) return
    if (input.key !== 'ArrowLeft' && input.key !== 'ArrowRight') return
    e.preventDefault()
    stepOpacity(input.key === 'ArrowRight' ? 0.05 : -0.05)
  })
}

const HANDLERS: Record<string, () => void> = {
  quit: () => app.exit(0),
  minimize: () => win?.minimize(),
  hide: toggleHidden,
  lock: () => setLocked(!locked)
}

// 하나라도 등록에 실패하면(다른 앱이 쓰는 중이거나 같은 키가 겹침) false. 호출한 쪽이 되돌린다.
function applyHotkeys(keys: Record<string, string>): boolean {
  globalShortcut.unregisterAll()
  let ok = true
  for (const [action, accel] of Object.entries(keys)) {
    try {
      if (!globalShortcut.register(accel, HANDLERS[action])) ok = false
    } catch {
      ok = false
    }
  }
  return ok
}

function createWindow(): void {
  win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 160,
    useContentSize: true,
    show: false,
    // 페이지 안 플레이어(유튜브 등)가 더블클릭에 전체화면을 요청하면 Electron이 창을 전체화면으로
    // 만든다. 은밀하게 보려고 만든 앱이라 창은 절대 커지지 않아야 한다.
    fullscreenable: false,
    // OS 단축키(Win+↑)로도 창이 커지지 않게 최대화까지 막는다.
    maximizable: false,
    // 타이틀바 제거. Windows·Linux에서는 titleBarOverlay를 주지 않으면 창 버튼도 함께 사라진다.
    // 투명 창(frame: false + transparent)은 OS 리사이즈 테두리가 없어져 크기 조절이 안 된다.
    titleBarStyle: 'hidden',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  win.on('ready-to-show', () => win?.show())

  // 포커스가 호스트 페이지에 있을 때와 webview 안 페이지에 있을 때 모두 받아야 한다.
  watchOpacityKeys(win.webContents)
  win.webContents.on('did-attach-webview', (_e, wc) => {
    watchOpacityKeys(wc)
    // 페이지 안 플레이어가 전체화면을 요청하면(영상 더블클릭) 창을 키우는 대신 내려버린다.
    // 페이지 쪽 전체화면도 함께 풀어, 다시 올렸을 때 원래 레이아웃으로 돌아오게 한다.
    wc.on('enter-html-full-screen', () => {
      win?.minimize()
      wc.executeJavaScript('document.exitFullscreen?.()').catch(() => {})
    })
  })

  // 'resize'는 드래그 중 계속 오므로 화면의 숫자를 실시간으로 갱신하는 데 쓴다.
  // 기본 크기로 저장하는 건 재생 화면에서 드래그를 끝낸 뒤('resized') 한 번만.
  win.on('resize', () => {
    if (!win) return
    const size = win.getSize() as Size
    win.webContents.send('size', size)
    if (!peeking) return
    cfg.size = size
    // 직접 리사이즈할 때는 'resized'가 오지 않으므로 여기서 디바운스해 저장한다.
    saveSoon()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sneakpeek')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

  cfg = readCfg()

  ipcMain.handle('cfg:get', () => cfg)
  ipcMain.handle('cfg:hotkey', (_e, action: string, accel: string) => {
    const next = { ...cfg.hotkeys, [action]: accel }
    if (!applyHotkeys(next)) {
      applyHotkeys(cfg.hotkeys)
      return false
    }
    cfg.hotkeys = next
    saveCfg()
    return true
  })
  ipcMain.on('cfg:size', (_e, size: Size) => {
    cfg.size = size
    saveCfg()
    if (peeking && win) {
      win.setSize(size[0], size[1])
      win.center()
    }
  })

  ipcMain.on('peek:resize', (_e, peek: boolean) => {
    if (!win) return
    peeking = peek
    if (!peek) return // 입력창 높이는 렌더러가 app:fit 으로 알려준다.
    win.setSize(cfg.size[0], cfg.size[1])
    win.center()
  })

  // 입력·설정 화면은 내용 높이에 딱 맞춘다. 남는 빈 공간을 두지 않기 위함.
  ipcMain.on('app:fit', (_e, h: number) => {
    if (!win || peeking) return
    const height = Math.max(60, Math.round(h))
    if (Math.abs(win.getContentSize()[1] - height) < 2) return
    win.setContentSize(PANEL_WIDTH, height)
  })

  // 손잡이 띠는 app-region: drag를 쓰지 않는다. 그 영역은 히트 테스트가 OS로 넘어가
  // 렌더러가 마우스 이벤트를 못 받아 hover 표시가 불가능하다. 그래서 직접 옮긴다.
  ipcMain.on('app:move', (_e, dx: number, dy: number) => {
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(x + Math.round(dx), y + Math.round(dy))
  })

  ipcMain.on('app:minimize', () => win?.minimize())
  ipcMain.on('app:lock', (_e, on: boolean) => setLocked(on))
  // 잠금 중에는 창 전체가 클릭을 통과시키므로 자물쇠 버튼도 못 누른다.
  // forward: true 덕분에 마우스 이동은 계속 전달되니, 버튼에 올라갔을 때만 잠시 통과를 끈다.
  ipcMain.on('app:ignoreMouse', (_e, on: boolean) =>
    win?.setIgnoreMouseEvents(on, { forward: true })
  )
  ipcMain.on('app:opacity', (_e, v: number) => win?.setOpacity(v))
  ipcMain.on('app:quit', () => app.exit(0))

  applyHotkeys(cfg.hotkeys)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
