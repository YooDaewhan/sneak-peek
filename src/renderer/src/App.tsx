import { useEffect, useRef, useState } from 'react'

function resolve(raw: string): string {
  const s = raw.trim()
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

// ponytail: 사이트별 임베드 주소(유튜브 /embed는 referrer 없으면 오류 153, 치지직은 규격 비공개)를
// 하나하나 맞추는 대신, 원래 페이지를 띄우고 <video>만 창 전체로 올리고 나머지는 가린다.
// visibility는 상속되므로 body의 자손 전체를 숨긴 뒤 video에서만 다시 켜면 플레이어 DOM은 그대로 살아있다.
// 스타일시트의 !important는 인라인 스타일을 이기므로 플레이어가 매 프레임 크기를 덮어써도 버틴다.
const ISOLATE = `
  html, body { overflow: hidden !important; background: #000 !important; }
  body > * { visibility: hidden !important; }
  video {
    visibility: visible !important;
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    max-height: none !important;
    object-fit: contain !important;
    background: #000 !important;
    z-index: 2147483647 !important;
  }
`

// 유튜브·네이버는 UA에 Electron이 보이면 지원 안 하는 브라우저로 보고 홈으로 튕긴다.
const UA = navigator.userAgent.replace(/ (sneak-peek|Electron)\/[\d.]+/g, '')

const ACTIONS: [string, string, string][] = [
  ['quit', '즉시 종료', '어느 앱에 있든 누르면 바로 종료됩니다.'],
  [
    'minimize',
    '최소화',
    '작업표시줄로 내립니다. 잠금 모드에서도 동작합니다. 화면을 더블클릭해도 내려갑니다.'
  ],
  ['hide', '숨기기 (투명도 0)', '완전히 투명해지고 마우스도 통과합니다. 같은 키로 복구.'],
  ['lock', '잠금 모드', '클릭이 뒤쪽 앱으로 통과하고 항상 위에 뜹니다. 해제도 이 키로.']
]

const SIDES = ['top', 'left', 'right']

const SIZES: [string, [number, number]][] = [
  ['작게', [480, 300]],
  ['보통', [720, 440]],
  ['크게', [960, 580]]
]

const NAMED: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Escape: 'Esc'
}

// 전역 단축키라 조합키 없는 단일 키는 막는다(F1~F12 제외). OS 전체 키를 가로채게 되므로.
function toAccelerator(e: React.KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const mods = [
    e.ctrlKey && 'Control',
    e.shiftKey && 'Shift',
    e.altKey && 'Alt',
    e.metaKey && 'Super'
  ].filter(Boolean) as string[]
  const key = e.key.length === 1 ? e.key.toUpperCase() : (NAMED[e.key] ?? e.key)
  if (!mods.length && !/^F([1-9]|1[0-2])$/.test(key)) return null
  return [...mods, key].join('+')
}

function App(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [src, setSrc] = useState('')
  const [muted, setMuted] = useState(true)
  // 처음엔 페이지 보기로 시작한다. 광고 건너뛰기나 로그인처럼 먼저 눌러야 할 게 있어서다.
  const [videoOnly, setVideoOnly] = useState(false)
  const [opacity, setOpacity] = useState(1)
  const [locked, setLocked] = useState(false)
  const [settings, setSettings] = useState(false)
  const [hotkeys, setHotkeys] = useState<Record<string, string>>({})
  const [size, setSize] = useState<[number, number]>([720, 440])
  const [error, setError] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const view = useRef<WebviewEl>(null)
  const cssKey = useRef('')

  useEffect(() => {
    window.api.getConfig().then((c) => {
      setHotkeys(c.hotkeys)
      setSize(c.size)
    })
    window.api.onLock(setLocked)
    window.api.onSize(setSize)
    window.api.onOpacity(setOpacity)
  }, [])

  useEffect(() => {
    const wv = view.current
    if (!wv) return
    // 새 문서로 넘어가면 주입한 CSS는 함께 사라지므로 키를 버린다.
    const reset = (): void => {
      cssKey.current = ''
    }
    const apply = async (): Promise<void> => {
      wv.setAudioMuted(muted)
      if (videoOnly && !cssKey.current) cssKey.current = await wv.insertCSS(ISOLATE)
    }
    wv.addEventListener('did-navigate', reset)
    wv.addEventListener('dom-ready', apply)
    // dom-ready만 믿으면 이미 로드가 끝난 뒤(토글·음소거 변경)에는 주입할 기회가 없다.
    // 아직 붙지 않았으면 여기서 실패하고 dom-ready가 처리한다.
    apply().catch(() => {})
    return () => {
      wv.removeEventListener('did-navigate', reset)
      wv.removeEventListener('dom-ready', apply)
    }
  }, [muted, videoOnly])

  // 입력·설정 화면은 내용 높이에 창을 맞춘다. 아래 빈 공간을 남기지 않기 위함.
  useEffect(() => {
    const el = panel.current
    if (!el) return
    const fit = (): void => window.api.fit(el.scrollHeight)
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [src, settings])

  const open = (): void => {
    if (!input.trim()) return
    setSrc(resolve(input))
    setSettings(false)
    window.api.resize(true)
  }

  const back = (): void => {
    setSrc('')
    setVideoOnly(false)
    setSettings(false)
    window.api.resize(false)
  }

  // 광고 스킵·나이 확인·로그인처럼 가려진 UI를 눌러야 할 때. 주입한 CSS만 넣고 빼므로 재생이 끊기지 않는다.
  const toggleVideoOnly = async (): Promise<void> => {
    const wv = view.current
    if (!wv) return
    if (videoOnly) {
      if (cssKey.current) await wv.removeInsertedCSS(cssKey.current)
      cssKey.current = ''
    } else {
      cssKey.current = await wv.insertCSS(ISOLATE)
    }
    setVideoOnly(!videoOnly)
  }

  // 눌러서 끄는 동안 화면 좌표 변화량을 넘긴다. 창이 커서를 따라오므로 변화량은 계속 정확하다.
  const drag =
    (onDelta: (dx: number, dy: number) => void) =>
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      let last = { x: e.screenX, y: e.screenY }
      const move = (ev: PointerEvent): void => {
        onDelta(ev.screenX - last.x, ev.screenY - last.y)
        last = { x: ev.screenX, y: ev.screenY }
      }
      const up = (): void => {
        el.releasePointerCapture(e.pointerId)
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    }

  const togglePlay = (): void => {
    view.current?.executeJavaScript(
      "{const v = document.querySelector('video'); if (v) v.paused ? v.play() : v.pause()}"
    )
  }

  const changeOpacity = (v: number): void => {
    setOpacity(v)
    window.api.setOpacity(v)
  }

  const captureHotkey = async (action: string, e: React.KeyboardEvent): Promise<void> => {
    e.preventDefault()
    const accel = toAccelerator(e)
    if (!accel) {
      setError('조합키(Ctrl/Shift/Alt)가 포함된 키 또는 F1~F12만 가능합니다')
      return
    }
    const ok = await window.api.setHotkey(action, accel)
    setError(ok ? '' : `${accel} 등록 실패 (다른 앱이나 다른 기능이 쓰는 중)`)
    if (ok) setHotkeys({ ...hotkeys, [action]: accel })
  }

  // 잠금 중에는 창 전체가 클릭을 통과시켜 버튼도 못 누른다. forward: true 덕분에 마우스 이동은
  // 계속 전달되므로, 이 버튼들에 커서가 올라간 동안만 통과를 끈다.
  const clickableWhenLocked = {
    onMouseEnter: (): void => {
      if (locked) window.api.setIgnoreMouse(false)
    },
    onMouseLeave: (): void => {
      if (locked) window.api.setIgnoreMouse(true)
    }
  }

  // app-region: drag를 쓰면 OS가 타이틀바로 취급해 더블클릭에 창을 최대화한다.
  // 은밀하게 보려고 만든 앱이라 반대로 내려가야 하므로, 드래그도 더블클릭도 직접 처리한다.
  const moveArea = {
    onPointerDown: drag(window.api.move),
    onDoubleClick: (): void => window.api.minimize()
  }

  // 하단바·입력창은 안에 버튼이 있으니 빈 공간을 잡았을 때만 반응한다.
  const moveAreaSelf = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) drag(window.api.move)(e)
    },
    onDoubleClick: (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) window.api.minimize()
    }
  }

  const toggleSettings = (): void => setSettings(!settings)

  const pickSize = (s: [number, number]): void => {
    setSize(s)
    window.api.setSize(s)
  }

  const custom = !SIZES.some(([, s]) => s[0] === size[0] && s[1] === size[1])

  const settingsPanel = (
    <div className="settings">
      {ACTIONS.map(([action, label, help]) => (
        <label key={action}>
          <span>
            {label}
            <span className="help" data-help={help} aria-label={help}>
              ?
            </span>
          </span>
          <input
            readOnly
            value={hotkeys[action] ?? ''}
            onKeyDown={(e) => captureHotkey(action, e)}
            placeholder="키를 누르세요"
          />
        </label>
      ))}

      <span className="sub">기본 창 크기</span>
      <div className="sizes">
        {SIZES.map(([label, s]) => (
          <button
            key={label}
            className={size[0] === s[0] && size[1] === s[1] ? 'primary' : ''}
            onClick={() => pickSize(s)}
          >
            {label}
          </button>
        ))}
        {/* 테두리로 조절한 크기가 최우선. 드래그하는 동안 실시간으로 바뀐다. */}
        <span className={custom ? 'now primary' : 'now'}>
          {size[0]}×{size[1]}
        </span>
      </div>
      <div className="hint">재생 중 Shift+←/→ 로 투명도</div>

      {error && <div className="error">{error}</div>}
    </div>
  )

  if (src) {
    return (
      <div className={videoOnly ? 'peek' : 'peek framed'}>
        <webview ref={view} src={src} className="view" partition="persist:peek" useragent={UA} />
        {/* 페이지 보기에서 창을 옮길 띠. 위·왼쪽은 페이지 위에 투명하게 얹고,
            오른쪽은 스크롤바를 막지 않도록 페이지를 20px 밀어낸 어두운 프레임으로 둔다.
            아래쪽은 하단바가 그 역할을 한다. */}
        {!videoOnly &&
          SIDES.map((side) => <div key={side} className={'grab ' + side} {...moveArea} />)}
        {/* 영상만 보기일 때는 페이지를 클릭할 일이 없으니 영상 위 어디를 잡아도 창이 끌린다.
            페이지 보기에서는 건너뛰기 같은 버튼을 막지 않도록 이 층을 걷어낸다. */}
        {videoOnly && <div className="drag" {...moveArea} />}
        {/* 잠금·종료는 어떤 층에도 가리지 않게 z-index 최상위로 띄운다. 잠금 중에도 눌러야 하기 때문이다. */}
        <button
          className="lock"
          onClick={() => window.api.setLock(!locked)}
          aria-label={locked ? '잠금 해제' : '잠금'}
          {...clickableWhenLocked}
        >
          {locked ? '🔒' : '🔓'}
        </button>
        {/* 최소화·종료. 평소엔 투명해 보이지 않고, 모서리에 커서가 오면 드러나며 커진다. */}
        <div className="corner" {...clickableWhenLocked}>
          <button onClick={() => window.api.minimize()} aria-label="최소화">
            –
          </button>
          <button className="x" onClick={() => window.api.quit()} aria-label="종료">
            ✕
          </button>
        </div>
        {settings && <div className="overlay">{settingsPanel}</div>}
        <div className="bar" {...clickableWhenLocked} {...(videoOnly ? {} : moveAreaSelf)}>
          <button onClick={() => setMuted(!muted)}>
            {muted ? '🔇' : '🔊'}
            <span className="label">{muted ? '음소거' : '소리'}</span>
          </button>
          <button onClick={togglePlay}>⏯</button>
          <button onClick={toggleVideoOnly}>
            {videoOnly ? '🎬' : '🖥'}
            <span className="label">{videoOnly ? '영상만 보기' : '페이지 보기'}</span>
          </button>
          <button onClick={toggleSettings}>⚙</button>
          <label className="opacity">
            <span className="label">투명도</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => changeOpacity(Number(e.target.value))}
            />
          </label>
          <button onClick={back}>
            ←<span className="label">주소 변경</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel" ref={panel} {...moveAreaSelf}>
      <label>
        링크 (유튜브 · 치지직 등)
        <input
          autoFocus
          value={input}
          placeholder="https://www.youtube.com/watch?v=..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && open()}
        />
      </label>

      <button className="link" onClick={toggleSettings}>
        설정 {settings ? '▲' : '▼'}
      </button>

      {settings && settingsPanel}

      <div className="actions">
        <button className="primary" onClick={open}>
          확인
        </button>
        <button onClick={() => window.api.quit()}>취소</button>
      </div>
    </div>
  )
}

export default App

// ponytail: 프레임워크 없는 자체 점검. dev 빌드에서만 실행되고 프로덕션에서는 제거된다.
if (import.meta.env.DEV) {
  const eq = (a: string, b: string): void => {
    if (a !== b) throw new Error(`resolve 실패: ${a} !== ${b}`)
  }
  eq(resolve(' chzzk.naver.com/live/abc123 '), 'https://chzzk.naver.com/live/abc123')
  eq(resolve('https://youtu.be/dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ')
}
