/** The meter's last reading of the session's context window and cache. */
export type Reading = {
  /** Tokens the last response was answered over; null before the first. */
  tokens: number | null
  /** The model's context window, in tokens. */
  window: number
  /** `tokens` over `window`, 0 to 100; null before the first response. */
  percent: number | null
  /** When the last main-thread turn ended, in ms; null when not known. */
  lastAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-meter': { reading: Reading | null; now: number }
  }
}
