/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENERGY_SOURCE?: string
  readonly VITE_HA_URL?: string
  readonly VITE_HA_TOKEN?: string
  readonly VITE_BUY_PRICE_EUR_KWH?: string
  readonly VITE_SELL_PRICE_EUR_KWH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
