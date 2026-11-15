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
const prompts = []
let held
function streamEvent(response, delta, finishReason = null) {
  response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\n`)
}

const provider = createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"data":[{"id":"saved-chat-test"}]}')
    return
  }

  let raw = ''
  for await (const chunk of request) raw += chunk
  const prompt = JSON.parse(raw).messages.findLast(message => message.role === 'user').content
  prompts.push(prompt)
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  if (prompt === 'Keep working in this chat') {
    held = response
    streamEvent(response, { content: 'Partial saved-chat reply' })
    return
  }
  if (prompt === 'Ask me a question') {
    streamEvent(response, { tool_calls: [{
      index: 0, id: 'workspace-question', type: 'function',
      function: { name: 'ask_user', arguments: JSON.stringify({ questions: [{ title: 'What should the project be called?' }] }) }
    }] })
    streamEvent(response, {}, 'tool_calls')
  } else {
    streamEvent(response, { content: 'Thanks for naming the project.' })
    streamEvent(response, {}, 'stop')
  }
  response.end('data: [DONE]\n\n')
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
  assert.equal(prompts.length, 0)
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
  const { evaluate, click, fill, wait, rpc } = desktop

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
  const composer = content + ' textarea[aria-label="Message"]'
  const draft = () => evaluate(`document.querySelector(${JSON.stringify(composer)})?.value`)
  const transcriptContains = phrase => evaluate(`Boolean([...document.querySelectorAll('.saved-transcript')]
    .find(transcript => transcript.textContent.includes(${JSON.stringify(phrase)})))`)
  const activeRuns = () => evaluate(`(async () => {
    const result = await window.granite.runs.list()
    if (!result.ok) throw new Error(result.error)
    return result.value
  })()`)

  function closeAndMeasureFade() {
    return evaluate(`(async () => {
      const pane = document.querySelector(${JSON.stringify(content + ' .pane')})
      const scope = pane.closest('.workspace')
      const start = scope.startViewTransition
      let transition
      scope.startViewTransition = function (update) {
        transition = start.call(this, update)
        return transition
      }
      pane.querySelector('.tab-close').click()
      delete scope.startViewTransition

      try {
        await transition.ready
      } catch (error) {
        if (error.name !== 'InvalidStateError') throw error
        await transition.finished
        return 'capture skipped'
      }
      const exit = document.getAnimations().find(animation =>
        animation.animationName === 'vt-exit' &&
        animation.effect.pseudoElement === '::view-transition-old(pane-' + pane.dataset.paneId + ')')
      if (!exit) throw new Error('Final chat pane exit animation did not start')
      await exit.finished
      return exit.effect.getComputedTiming().progress
    })()`)
  }

  const closeChat = title => evaluate(`[...document.querySelectorAll('.tab-close')]
    .find(button => button.ariaLabel.startsWith(${JSON.stringify('Close ' + title + ' in ')})).click()`)

  try {
    await desktop.launch()
    await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
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
    await fill(composer, 'Draft for the long chat', 'textarea')
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
    assert.equal(await draft(), '')
    await fill(composer, 'Draft for the project chat', 'textarea')
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
    assert.equal(await draft(), 'Draft for the long chat')
    await click('Close Long saved chat in Group 2')
    await wait(async () => await tabCount() === 1, 'first chat closed')
    assert.equal(await draft(), 'Draft for the project chat')
    await click('Close Project saved chat in Group 2')
    await wait(async () => await tabCount() === 0, 'Content becomes empty')
    await click('Long saved chat')
    await wait(() => evaluate(longVisible), 'chat reopened from empty Content')
    assert.notEqual(await evaluate('document.activeElement.id'), longId)
    assert.ok(await evaluate(`(() => {
      const reader = document.querySelector('.saved-transcript')
      return reader.scrollHeight - reader.clientHeight - reader.scrollTop <= 1
    })()`))
    assert.equal(await draft(), '')
    assert.equal(prompts.length, 0, 'opening and docking chats does not prompt the model')

    await fill(composer, 'Keep working in this chat', 'textarea')
    await click('Send message')
    await wait(() => transcriptContains('Partial saved-chat reply'), 'live reply in the saved chat')
    assert.equal(await draft(), '')
    assert.deepEqual(prompts, ['Keep working in this chat'])
    const [running] = await activeRuns()
    assert.equal(running.phase, 'streaming')
    const closeLongChat = () => evaluate(`document.querySelector(${JSON.stringify(content + ' .tab-close')}).click()`)
    await closeLongChat()
    await wait(async () => await tabCount() === 0, 'last chat closes during the run')
    await wait(() => evaluate('!document.querySelector(".workspace[data-transition]")'), 'pane exit finishes')
    assert.equal((await activeRuns())[0].phase, 'streaming')
    streamEvent(held, { content: ' followed by text while closed' })

    await click('Long saved chat')
    await wait(() => transcriptContains('Partial saved-chat reply followed by text while closed'), 'reopened chat shows the same live reply')
    assert.equal((await activeRuns())[0].id, running.id)
    await click('■ Stop')
    await wait(async () => (await activeRuns())[0].phase === 'stopped', 'reopened chat can stop its run')
    await wait(() => evaluate('!document.querySelector(".stop-button")'), 'Stop clears after the run settles')
    assert.ok(await transcriptContains('Partial saved-chat reply followed by text while closed'))

    await click('Project saved chat')
    await wait(() => transcriptContains('Project transcript'), 'project chat ready')
    await fill(composer, 'Ask me a question', 'textarea')
    await click('Send message')
    const answer = '.question-panel input'
    await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(answer)}))`), 'dedicated answer input')
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(answer)}).getBoundingClientRect().bottom
      <= document.querySelector(${JSON.stringify(composer)}).getBoundingClientRect().top`))
    assert.equal(await draft(), '')
    await fill(composer, 'Unsent composer draft', 'textarea')
    await fill(answer, 'Orchard', 'input')
    await click('Submit')
    await wait(() => transcriptContains('Thanks for naming the project.'), 'answer resumes the run')
    assert.equal(await draft(), 'Unsent composer draft')
    assert.equal(prompts[1], 'Ask me a question')
    assert.match(prompts[2], /User answer to question.*Orchard/s)

    await click('Add tab to Group 1')
    await wait(() => evaluate('Boolean([...document.querySelectorAll(".agent-explorer button")].find(button => button.textContent === "Second agent"))'), 'agent picker')
    await click('Second agent')
    await wait(() => evaluate('document.querySelector(".agent-explorer")?.textContent.includes("No saved chats.")'), 'second agent tree')
    assert.equal(await tabCount(), 2)
    assert.equal(prompts.length, 3)
    console.log('Saved-chat layout, draft isolation, live streaming across close and reopen, Stop, and the separate question input passed.')

    await closeChat('Long saved chat')
    await wait(async () => await tabCount() === 1, 'only the project chat remains')
    await wait(() => evaluate('!document.querySelector(".pane-titlebar[data-transition]")'), 'first tab exit finished')
    let exitProgress = await closeAndMeasureFade()
    // A renderer can decline capture before animating. Retry the action, then require a real fade.
    for (let retry = 0; exitProgress === 'capture skipped' && retry < 3; retry++) {
      await click('Archive')
      await wait(() => evaluate('Boolean(document.querySelector(".tree-entry[title=\'Long saved chat\']"))'), 'Archive tree')
      await click('Long saved chat')
      await wait(() => evaluate(longVisible), 'chat reopened for the fade check')
      exitProgress = await closeAndMeasureFade()
    }
    assert.equal(exitProgress, 1, 'the final chat pane holds its faded-out state after the exit animation')
  } finally {
    await desktop.quit()
  }
  console.log('Both shells launched. The final chat pane held its faded-out state.')
} finally {
  provider.closeAllConnections()
  provider.close()
  await rm(directory, { recursive: true, force: true })
}
