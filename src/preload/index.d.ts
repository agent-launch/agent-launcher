import type { Api } from './index'

declare global {
  interface Window {
    api: Api
  }
}

export {}
