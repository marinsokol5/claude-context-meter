import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const MINUTE = 60_000
const START = 1_000_000_000_000
const USAGE = { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 84_000, cache_creation_input_tokens: 0 }

const BAND = {
  plugin: 'context-meter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

function engine(on: On, tokens?: number) {
  const context = { tokens, window: 200_000, percent: tokens === undefined ? undefined : Math.round((tokens / 200_000) * 100) }
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({ value: { startedAt: START, context, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  // The engine draws nothing in the band when the plugin passes.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

const TURN = {
  answer: 'hi',
  durationMs: 1000,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  usage: { ...USAGE, model: 'claude-opus-5-5' },
} as const

// The band's text, both parts joined.
async function band($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const fill = await ui.find({ type: 'Text', text: /Context/ })
  const cache = await ui.find({ type: 'Text', text: /cache/ })
  await ui.unmount()

  return `${fill?.text ?? ''}${cache?.text ?? ''}`
}

test('a new chat shows nothing until the first response', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
  await ui.unmount()
})

test('after a turn: fill, then warm, then cold', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  engine(on, 84_000)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const shown = await band($, surface)
    expect(shown).toContain('Context 84k / 200k · 42%')
    expect(shown).toContain('cache warm, 60m left')
  }

  await clock.advance(23 * MINUTE)
  expect(await band($, 'desktop')).toContain('cache warm, 37m left')

  await clock.advance(40 * MINUTE)
  expect(await band($, 'desktop')).toContain('cache cold: next message re-sends 84k uncached')
})

test('a resumed chat remembers when its last turn ended', async ($, on) => {
  mock.clock(on, { now: START + 50 * MINUTE })
  mock.store(on, { 'lastAt:s1': START })
  engine(on, 120_000)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(await band($, 'desktop')).toContain('cache warm, 10m left')
})

test('the 5m cache lifetime option', { options: { cacheTtl: '5m' } }, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  engine(on, 84_000)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  expect(await band($, 'desktop')).toContain('5m left')
  await clock.advance(6 * MINUTE)
  expect(await band($, 'desktop')).toContain('cache cold')
})
