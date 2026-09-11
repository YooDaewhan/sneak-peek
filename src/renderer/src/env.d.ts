/// <reference types="vite/client" />
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare global {
  interface WebviewEl extends HTMLElement {
    src: string
    setAudioMuted: (muted: boolean) => void
    insertCSS: (css: string) => Promise<string>
    removeInsertedCSS: (key: string) => Promise<void>
    executeJavaScript: (code: string) => Promise<unknown>
    reload: () => void
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<WebviewEl>, WebviewEl> & {
        src?: string
        allowpopups?: string
        useragent?: string
        partition?: string
      }
    }
  }
}
