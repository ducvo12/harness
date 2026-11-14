import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-saved-chats-'))
const original = join(directory, 'existing-profile')
const copy = join(directory, 'workspace-profile')
const executable = './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
let requests = 0
const provider = createServer((_request, response) => {
  requests++
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end('{"data":[{"id":"saved-chat-test"}]}')
})

function seedProfile() {
  const code = `
    import { AgentRuntime } from './src/backend/agents/runtime.ts'
    const runtime = await AgentRuntime.open(${JSON.stringify(original)})
    try {
      const atlas = await runtime.createAgent('Archive')
      await runtime.createAgent('Second agent')
      const section = await runtime.createSection(atlas.id, 'Planning', 'closed')
      await runtime.createSection(atlas.id, 'Empty section', 'shared')
      const project = await runtime.createProject(atlas.id, section.id, 'Release')
      const direct = await runtime.createConversation(atlas.id)
      const nested = await runtime.createConversation(atlas.id, { sectionId: section.id, projectId: project.id })
      runtime.store.renameConversation(atlas.id, direct.id, 'Long saved chat')
      runtime.store.renameConversation(atlas.id, nested.id, 'Project saved chat')
      for (let index = 0; index < 45; index++) {
        runtime.store.saveMessage(direct.id, {
          id: 'message-' + index,
          role: index % 2 ? 'assistant' : 'user',
          content: ('Saved transcript paragraph ' + index + '. ').repeat(13)
        })
      }
      runtime.store.saveMessage(nested.id, { id: 'project-message', role: 'assistant', content: '**Project transcript**' })
    } finally {
      runtime.close()
    }
  `
  execFileSync(executable, ['--input-type=module', '--eval', code], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
}

try {
  seedProfile()
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))

  const legacy = desktopSession(original, 9462, { ELECTRON_RENDERER_URL: '' })
  try {
    await legacy.launch()
    assert.equal(await legacy.evaluate('Boolean(document.querySelector(".app-body"))'), true)
    const connection = await legacy.evaluate(`window.granite.connections.save({
      name: 'Local test',
      baseUrl: 'http://127.0.0.1:${provider.address().port}/v1',
      model: 'saved-chat-test',
      apiKey: ''
    })`)
    assert.equal(connection.ok, true)
  } finally {
    await legacy.quit()
  }
  await cp(original, copy, { recursive: true })
  const previousRequests = requests
  const entry = join(directory, 'workspace.cjs')
  await writeFile(entry, `
    const { app } = require('electron')
    app.commandLine.appendSwitch('workspace')
    app.on('browser-window-created', (_event, window) => window.webContents.setBackgroundThrottling(false))
    require(${JSON.stringify(resolve('out/main/index.js'))})
  `)
  const desktop = desktopSession(copy, 9462, { ELECTRON_RENDERER_URL: '' }, entry, undefined, {
    ready: 'Boolean(document.querySelector(".workspace-app"))'
  })
  const { evaluate, click, wait, rpc } = desktop

  async function point(selector, x = 0.5, y = 0.5) {
    return evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
      return { x: rect.left + ${x} * rect.width, y: rect.top + ${y} * rect.height }
    })()`)
  }

  async function dragTab(id, destination, x, y, marker) {
    const origin = await point(`[id="${id}"]`, 0.3, 0.35)
    const target = await point(destination, x, y)
    assert.equal(await evaluate(`document.elementFromPoint(${origin.x}, ${origin.y})?.closest('[role="tab"]')?.id`), id)
    await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...origin })
    await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', ...origin, button: 'left', buttons: 1, clickCount: 1 })
    await wait(() => evaluate('Boolean(document.querySelector(".workspace.is-dragging"))'), 'drag started')
    await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target, buttons: 1 })
    await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(marker)}))`), `docking preview ${marker}`)
    await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', buttons: 0, clickCount: 1 })
  }

  const longVisible = 'Boolean(document.querySelector(".saved-transcript [data-message-id=message-17]"))'
  const content = '[data-region="content"]'
  const offset = `(() => {
    const row = document.querySelector('[data-message-id=message-17]')
    return row && row.closest('.saved-transcript').getBoundingClientRect().top - row.getBoundingClientRect().top
  })()`
  const tabCount = () => evaluate(`document.querySelectorAll(${JSON.stringify(content + ' [role=tab]')}).length`)

  try {
    await desktop.launch()
    await wait(() => evaluate("Boolean([...document.querySelectorAll('.agent-explorer button')].find(button => button.textContent === 'Archive'))"), 'saved agents')
    assert.equal(await tabCount(), 0)
    await click('Archive')
    await wait(() => evaluate(`Boolean(document.querySelector('.tree-entry[title="Long saved chat"]'))`), 'saved tree')
    assert.match(await evaluate('document.querySelector(".agent-explorer").textContent'), /Empty section.*No saved chats/s)
    await evaluate(`document.querySelector('.tree-entry[title="Long saved chat"]').click()
      document.querySelector('.tree-entry[title="Long saved chat"]').click()`)
    await wait(() => evaluate(longVisible), 'saved transcript')
    assert.equal(await tabCount(), 1)
    assert.match(await evaluate('document.querySelector(".saved-transcript-header").textContent'), /Archive \/ General/)
    const longId = await evaluate('document.activeElement.id')
    assert.match(longId, /^pane-.+-tab-/)

    await evaluate(`(() => {
      const row = document.querySelector('[data-message-id=message-17]')
      const scroller = row.closest('.saved-transcript')
      scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 8
    })()`)
    await wait(async () => Math.abs((await evaluate(offset)) - 8) <= 1, 'middle of transcript')
    await rpc('Runtime.evaluate', { expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', awaitPromise: true })

    await evaluate(`[...document.querySelectorAll('summary')].find(summary => summary.textContent === 'Release').click()`)
    await click('Project saved chat')
    await wait(() => evaluate('Boolean(document.querySelector(".saved-transcript strong"))'), 'formatted project reply')
    assert.match(await evaluate('document.querySelector(".saved-transcript-header").textContent'), /Archive \/ Planning \/ Release/)
    assert.equal(await tabCount(), 2)

    await dragTab(longId, content + ' .pane-body', 0.78, 0.5, '.pane-dock-preview')
    await wait(() => evaluate(`document.querySelectorAll(${JSON.stringify(content + ' .saved-transcript')}).length === 2`), 'two side-by-side transcripts')
    assert.ok(Math.abs((await evaluate(offset)) - 8) <= 1)
    await click('Long saved chat')
    assert.equal(await evaluate('document.activeElement.id'), longId)
    assert.equal(await tabCount(), 2)

    const projectPane = await evaluate('document.querySelector(".saved-transcript strong").closest(".pane").dataset.paneId')
    await dragTab(longId, `[data-pane-id="${projectPane}"] .pane-drag-handle`, 0.5, 0.5, '.tab-drop-marker')
    await wait(() => evaluate(`document.querySelectorAll(${JSON.stringify(content + ' .pane')}).length === 1 && ${longVisible}`), 'merged transcript')
    assert.ok(Math.abs((await evaluate(offset)) - 8) <= 1)
    assert.equal(await tabCount(), 2)

    await click('Close Long saved chat in Group 2')
    await wait(async () => await tabCount() === 1, 'first chat closed')
    await click('Close Project saved chat in Group 2')
    await wait(async () => await tabCount() === 0, 'Content becomes empty')
    await click('Long saved chat')
    await wait(() => evaluate(longVisible), 'chat reopened from empty Content')
    assert.notEqual(await evaluate('document.activeElement.id'), longId)
    assert.ok(await evaluate(`(() => {
      const reader = document.querySelector('.saved-transcript')
      return reader.scrollHeight - reader.clientHeight - reader.scrollTop <= 1
    })()`))

    await click('Add tab to Group 1')
    await wait(() => evaluate('Boolean([...document.querySelectorAll(".agent-explorer button")].find(button => button.textContent === "Second agent"))'), 'agent picker')
    await click('Second agent')
    await wait(() => evaluate('document.querySelector(".agent-explorer")?.textContent.includes("No saved chats.")'), 'second agent tree')
    assert.equal(await tabCount(), 1)
    assert.equal(requests, previousRequests)
  } finally {
    await desktop.quit()
  }
  console.log('Both shells launched. Saved chat loading, focus, split and merge with scroll, reopening from empty Content, and zero model requests passed.')
} finally {
  provider.close()
  await rm(directory, { recursive: true, force: true })
}
