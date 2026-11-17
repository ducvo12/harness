import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

const packaged = process.argv.includes('--packaged')
const executable = packaged ? './release/mac-arm64/Granite.app/Contents/MacOS/Granite' : undefined
const directory = await mkdtemp(join(tmpdir(), 'granite-workspace-smoke-'))
const desktop = desktopSession(directory, 9441, { ELECTRON_RENDERER_URL: '' }, '.', executable)

try {
  await desktop.launch()
  assert.equal(await desktop.evaluate('typeof require'), 'undefined', 'renderer has no Node require')
  const agents = await desktop.evaluate('window.granite.agents.list()')
  assert.equal(agents.ok, true, agents.error)
  assert.deepEqual(agents.value, [], 'the disposable profile starts without agents')
  console.log(`PASS ${packaged ? 'packaged' : 'development'}: workspace launch, isolated renderer, and agent worker IPC.`)
} finally {
  try {
    await desktop.quit()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
