import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading } from '../types'

const reading = atom({ plugin: 'context-meter', key: 'reading' } as const, null)
// Redrawn on a timer so the cache countdown moves between turns.
const now = atom({ plugin: 'context-meter', key: 'now' } as const, 0)

const MINUTE = 60_000
const TTL = { '1h': 60 * MINUTE, '5m': 5 * MINUTE }
const TICK = 30_000
// When each session's last turn ended is kept this long, so a resumed chat
// still knows whether its cache is warm.
const KEEP = 30 * 24 * 60 * MINUTE

const lastAtKey = (sessionId: string) => `lastAt:${sessionId}`

export const register: Register = (on, options) => {
  const ttl = options.cacheTtl === '5m' ? TTL['5m'] : TTL['1h']

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(lastAtKey(await $.session.id()))
    const { context } = await $.session.usage()
    await update($, reading, () => ({
      tokens: context.tokens ?? null,
      window: context.window,
      percent: context.percent ?? null,
      lastAt: typeof stored === 'number' ? stored : null,
    }))
    await tick($)
    $.clock.every(TICK, () => void tick($))
    await forgetOld($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const { context } = e
      await update($, reading, r => ({
        tokens: context.tokens ?? null,
        window: context.window,
        percent: context.percent ?? null,
        lastAt: r?.lastAt ?? null,
      }))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Subagents keep caches of their own; only the main thread's counts here.
    if (e.agentId === undefined && e.usage !== undefined) {
      const lastAt = await $.clock.now()
      await $.store.set(lastAtKey(await $.session.id()), lastAt)
      await update($, reading, r => (r === null ? r : { ...r, lastAt }))
      await tick($)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, reading)

    if (e.props.hasSurvey || r === null || r.tokens === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const isNarrow = e.props.bodyColumns < 60
    const fill = r.percent ?? 0
    const fillColor = fill >= 90 ? 'error' : fill >= 75 ? 'warning' : undefined
    const left = r.lastAt === null ? null : r.lastAt + ttl - (await read($, now))

    return (
      <Box>
        <Text color={fillColor} dimColor={fillColor === undefined}>
          {isNarrow ? '' : 'Context '}
          {tokens(r.tokens)} / {tokens(r.window)} · {fill}%
        </Text>
        {left !== null && (
          <Text dimColor>
            {' · '}
            {e.props.isWorking || left > 0
              ? `cache warm${e.props.isWorking ? '' : `, ${minutes(left)} left`}`
              : isNarrow
                ? 'cache cold'
                : `cache cold: next message re-sends ${tokens(r.tokens)} uncached`}
          </Text>
        )}
      </Box>
    )
  })
}

async function tick($: EngineInterface) {
  const t = await $.clock.now()
  await update($, now, () => t)
}

async function forgetOld($: EngineInterface) {
  const t = await $.clock.now()

  for (const key of await $.store.keys()) {
    const at = await $.store.get(key)

    if (key.startsWith('lastAt:') && (typeof at !== 'number' || t - at > KEEP)) {
      await $.store.delete(key)
    }
  }
}

function tokens(n: number) {
  if (n >= 1_000_000) {
    return `${+(n / 1_000_000).toFixed(1)}M`
  }

  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

function minutes(ms: number) {
  const m = Math.floor(ms / MINUTE)

  return m < 1 ? '<1m' : `${m}m`
}
