import type { GridpostApi } from './index'

declare global {
  interface Window {
    gridpost: GridpostApi
  }
}

export {}
