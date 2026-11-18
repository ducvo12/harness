import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { desktopSession } from './desktop/session.mjs'

const directory = await mkdtemp(join(tmpdir(), 'granite-saved-chats-'))
const existingProfile = join(directory, 'existing-profile')
const executable = './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const prompts = []
const sampleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII='
let held

function pasteImage(selector) {
  return `(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(sampleImage.split(',')[1])}), char => char.charCodeAt(0))
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }))
    document.querySelector(${JSON.stringify(selector)})
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })()`
}
function streamEvent(response, delta, finishReason = null) {
  response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\n`)
}

function streamTool(response, name, args, id) {
  streamEvent(response, { tool_calls: [{
    index: 0, id, type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  }] })
  streamEvent(response, {}, 'tool_calls')
}

const provider = createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"data":[{"id":"saved-chat-test","context_window":65536}]}')
    return
  }

  let raw = ''
  for await (const chunk of request) raw += chunk
  const messages = JSON.parse(raw).messages
  const userIndex = messages.findLastIndex(message => message.role === 'user')
  const prompt = messages[userIndex].content
  if (Array.isArray(prompt)) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const image = prompt.find(part => part.type === 'image_url')
    streamEvent(response, { content: image?.image_url?.url === sampleImage ? 'Received the attached image.' : 'Image data missing.' })
    streamEvent(response, {}, 'stop')
    response.end('data: [DONE]\n\n')
    return
  }

  prompts.push(prompt)
  if (prompt === 'Provider refuses this message') {
    response.writeHead(400, { 'Content-Type': 'application/json' })
    response.end('{"error":{"message":"Fixture rejected the request"}}')
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  if (prompt === 'Keep working in this chat' || prompt === 'Hold for steering') {
    held = response
    streamEvent(response, { content: 'Partial saved-chat reply' })
    return
  }
  if (prompt === 'Start a General chat') {
    held = response
    streamEvent(response, { content: 'Reply in the new General chat' })
    return
  }
  if (prompt === 'Ask me a question') {
    streamTool(response, 'ask_user', { questions: [{ title: 'What should the project be called?' }] }, 'workspace-question')
  } else if (prompt === 'Write the baseline file' || prompt === 'Write a file and run a terminal') {
    const baseline = prompt === 'Write the baseline file'
    const outputs = messages.slice(userIndex + 1).filter(message => message.role === 'tool')
    if (!outputs.length) {
      streamTool(response, 'repo_write', {
        path: baseline ? 'baseline.txt' : 'live.txt',
        content: baseline ? 'baseline\n' : 'first\nsecond\n',
        revision: null
      }, 'workspace-write')
    } else if (baseline) {
      streamEvent(response, { content: 'Baseline file written.' })
      streamEvent(response, {}, 'stop')
    } else if (outputs.length === 1) {
      streamTool(response, 'repo_command_start', {
        command: 'printf "Waiting for input\\n"; read answer'
      }, 'workspace-terminal')
    } else {
      // Leave the terminal active until the workspace stops the run.
      return
    }
  } else {
    streamEvent(response, { content: prompt === 'Start a project chat' ? 'Reply in the new project chat' : 'Thanks for naming the project.' })
    streamEvent(response, {}, 'stop')
  }
  response.end('data: [DONE]\n\n')
})

function workspaceSession(profile, entry) {
  return desktopSession(profile, 9462, { ELECTRON_RENDERER_URL: '' }, entry)
}

async function verifyCreation(entry) {
  const profile = join(directory, 'fresh-profile')
  const fresh = workspaceSession(profile, entry)
  const { evaluate, click, fill, wait } = fresh
  const dialog = 'dialog.workspace-creation[open]'
  const name = dialog + ' input'
  const mode = dialog + ' select'
  const read = async expression => {
    const result = await evaluate(expression)
    assert.equal(result.ok, true, result.error)
    return result.value
  }
  const close = () => wait(() => evaluate(`!document.querySelector(${JSON.stringify(dialog)})`), 'creation dialog closes')

  try {
    await fresh.launch()
    await wait(() => evaluate('document.querySelector(".agent-explorer")?.textContent.includes("No saved agents.")'), 'empty profile agent picker')
    assert.deepEqual(await read('window.granite.agents.list()'), [])

    await click('New agent')
    assert.ok(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(name)})`))
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(dialog + ' button[type=submit]')}).disabled`), true)
    await fill(name, 'Nova')
    await click('Create agent')
    await close()
    await wait(() => evaluate('document.querySelector(".agent-explorer")?.textContent.includes("General")'), 'first agent has General')
    assert.equal(await evaluate('document.querySelector("[data-region=explorer] [role=tab][aria-selected=true]").textContent'), 'Nova')
    const [nova] = await read('window.granite.agents.list()')
    assert.equal(nova.name, 'Nova')
    assert.equal(await evaluate('Boolean(document.querySelector("[aria-label=\'New project in General\']"))'), false)

    await click('New section')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(mode)}).value`), 'shared')
    await fill(name, 'Research')
    await fill(mode, 'closed', 'select')
    await click('Create section')
    await close()
    await wait(() => evaluate('Boolean(document.querySelector("[aria-label=\'New project in Research\']"))'), 'section appears in Explorer')

    await click('New project in Research')
    assert.doesNotMatch(await evaluate(`document.querySelector(${JSON.stringify(dialog)}).textContent`), /repository/i)
    await fill(name, 'Road<map')
    await click('Create project')
    await wait(() => evaluate(`document.querySelector(${JSON.stringify(dialog + ' [role=alert]')})?.textContent.includes('angle brackets')`),
      'invalid name is rejected')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(name)}).value`), 'Road<map')
    await fill(name, 'Roadmap')
    await click('Create project')
    await close()
    await wait(() => evaluate('Boolean(document.querySelector("[aria-label=\'New chat in Roadmap\']"))'), 'project appears in Explorer')
    const organization = await read(`window.granite.organization.get(${JSON.stringify(nova.id)})`)
    const section = organization.sections.find(item => item.name === 'Research')
    assert.equal(section.mode, 'closed')
    assert.equal(organization.projects.length, 1)
    const [project] = organization.projects
    assert.equal(project.name, 'Roadmap')
    assert.equal(project.sectionId, section.id)
    assert.equal(project.repositoryPath, null)

    await click('New chat in Roadmap')
    assert.equal(await evaluate('document.querySelector(".saved-transcript-header p").textContent'), 'Nova / Research / Roadmap')

    await click('Add tab to Group 1')
    await wait(() => evaluate('Boolean(document.querySelector(".agent-picker-create"))'), 'additional agent picker')
    await click('New agent')
    await fill(name, 'Aster')
    await click('Create agent')
    await close()
    await wait(() => evaluate('document.querySelector("[data-region=explorer] [role=tab][aria-selected=true]").textContent === "Aster"'), 'new agent replaces its picker')
    assert.deepEqual((await read('window.granite.agents.list()')).map(agent => agent.name).sort(), ['Aster', 'Nova'])

    await wait(() => evaluate(`JSON.parse(localStorage.getItem('granite.workspace.layout'))?.layout.regions[0].layout.tabs.length === 2`),
      'agent tabs written to storage')
    await fresh.quit()
    const root = join(profile, 'agents', nova.id)
    await writeFile(join(root, 'AGENTS.md'), '# Existing instructions')
    await mkdir(join(root, 'notes', 'nested'))
    await writeFile(join(root, 'notes', 'nested', 'Plan.md'), '# Nested plan')
    await writeFile(join(root, 'notes', 'example.png'), 'Image fixture')
    await fresh.launch()
    await wait(() => evaluate('document.querySelector("[data-region=explorer] [role=tab][aria-selected=true]").textContent === "Aster"'),
      'selected agent tab restored after relaunch')
    await click('Nova')
    await wait(() => evaluate('Boolean(document.querySelector("[aria-label=\'New chat in Roadmap\']"))'), 'project survives relaunch')
    await verifyMarkdown(fresh, root)
    await verifyDrafts(fresh, nova.id)
  } finally {
    await fresh.quit()
  }
  console.log('Fresh-profile creation for agents, sections, and chat-only projects passed, including validation and relaunch.')
}

async function verifyDrafts(fresh, agentId) {
  const { click, evaluate, fill, wait } = fresh
  const input = 'textarea[aria-label="Message"]'
  const draft = () => evaluate(`document.querySelector(${JSON.stringify(input)})?.value`)
  const conversations = async () => {
    const result = await evaluate(`window.granite.conversations.list(${JSON.stringify(agentId)})`)
    assert.ok(result.ok, result.error)
    return result.value
  }
  const savedChatRow = `document.querySelector('.tree-entry[title^="Outline saved on quit"]')`
  const openSaved = () => evaluate(`${savedChatRow}.click()`)
  const snapshot = () => evaluate("JSON.parse(localStorage.getItem('granite.workspace.chat-drafts'))?.drafts ?? []")
  const closeChatTab = () => evaluate(`document.querySelector('[data-region=content] [role=tab][aria-selected=true]').nextElementSibling.click()`)

  await evaluate(`[...document.querySelectorAll('summary')].find(summary => summary.textContent.trim() === 'Roadmap').click()`)
  await click('New chat in Roadmap')
  await fill(input, 'Outline', 'textarea')
  assert.equal(await evaluate(`(() => {
    const input = document.querySelector('.composer input[type=file]')
    const attach = document.querySelector('.composer button[aria-label="Attach files"]')
    let opened = false
    input.addEventListener('click', event => {
      event.preventDefault()
      opened = true
    }, { once: true })
    attach.click()
    const transfer = new DataTransfer()
    transfer.items.add(new File(['Roadmap notes'], 'notes.txt', { type: 'text/plain' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return opened
  })()`), true, 'the composer plus opens the file picker')
  const removeAttachment = '.composer-attachments [aria-label="Remove notes.txt"]'
  await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(removeAttachment)}))`), 'draft attachment appears above the input')
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(removeAttachment)}).getBoundingClientRect().bottom <=
    document.querySelector(${JSON.stringify(input)}).getBoundingClientRect().top`))
  const pickerFormats = await evaluate('document.querySelector(".composer input[type=file]").accept.split(",")')
  assert.ok(pickerFormats.includes('image/png') && pickerFormats.includes('text/*'))
  assert.ok(pickerFormats.includes('.pdf') && pickerFormats.includes('.heic'))
  assert.ok(!pickerFormats.includes('.zip') && !pickerFormats.includes('.dmg'))
  await evaluate(`(() => {
    const input = document.querySelector('.composer input[type=file]')
    const transfer = new DataTransfer()
    transfer.items.add(new File(['renamed binary'], 'renamed.png', { type: 'image/png' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(() => evaluate('document.querySelector(".composer [role=alert]")?.textContent.includes("could not read this image")'), 'a renamed file is rejected as invalid image content')
  assert.equal(await evaluate('document.querySelectorAll(".composer-attachment").length'), 1)
  await evaluate(pasteImage(input))
  await wait(() => evaluate('document.querySelector(".composer-attachments img")?.naturalWidth === 1'), 'pasted image renders as a draft thumbnail')
  const convertFixtures = await Promise.all(['report.pdf', 'photo.heic'].map(async name => ({
    name, data: (await readFile(new URL(`../tests/fixtures/attachments/${name}`, import.meta.url))).toString('base64')
  })))
  await evaluate(`(() => {
    const input = document.querySelector('.composer input[type=file]')
    const transfer = new DataTransfer()
    for (const { name, data } of ${JSON.stringify(convertFixtures)}) {
      const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0))
      transfer.items.add(new File([bytes], name))
    }
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(async () => {
    const error = await evaluate('document.querySelector(".composer [role=alert]")?.textContent')
    assert.ok(!error, error)
    return evaluate(`Boolean(document.querySelector('.composer-attachment[title="report.pdf"]')) &&
      document.querySelector('.composer-attachment[title="photo.heic"] img')?.naturalWidth === 64
    `)
  }, 'PDF and HEIC attach, and the HEIC preview renders')
  assert.equal((await snapshot()).length, 0)
  await closeChatTab()
  await wait(async () => (await snapshot()).some(draft => draft.text === 'Outline'), 'closing the tab saves the draft')
  assert.deepEqual(await conversations(), [])
  await click('Draft · Outline')
  assert.equal(await draft(), 'Outline')

  await fill(input, 'Outline saved on quit', 'textarea')
  assert.equal((await snapshot())[0].text, 'Outline')
  await fresh.quit()
  await fresh.launch()
  await wait(async () => await draft() === 'Outline saved on quit', 'normal quit saves the last edit and restores its open tab')
  assert.equal(await evaluate(`document.querySelector('.saved-transcript-header p').textContent`), 'Nova / Research / Roadmap')
  assert.equal((await snapshot())[0].attachments[0].content, 'Roadmap notes')
  await wait(() => evaluate('document.querySelector(".composer-attachments img")?.naturalWidth === 1'), 'pasted image thumbnail survives restart')

  await wait(() => evaluate(`document.querySelector('[aria-label="Send message"]')?.disabled === false`),
    'restored composer is ready without a provider')
  await click('Send message')
  await wait(() => evaluate('document.querySelector(".saved-transcript")?.textContent.includes("Outline saved on quit")'), 'outgoing message appears without a provider')
  await wait(() => evaluate('document.querySelector(".workspace-chat .error")?.textContent.includes("Connect an available model")'), 'missing provider is reported after acceptance')
  await wait(() => evaluate(`[...document.querySelectorAll('.workspace-chat-activity details')].some(item =>
    item.querySelector('summary').textContent.includes('notes.txt') && item.textContent.includes('Roadmap notes')
  )`), 'sent attachment appears in the same activity box')
  assert.equal(await draft(), '')
  const [chat] = await conversations()
  const saved = await evaluate(`window.granite.conversations.get(${JSON.stringify(agentId)}, ${JSON.stringify(chat.id)})`)
  assert.equal(saved.value.messages.length, 1)
  assert.match(saved.value.messages[0].content, /Roadmap notes/)
  assert.match(saved.value.messages[0].content, /PDF attachment fixture/)
  const [pasted, photo] = saved.value.messages[0].images
  assert.deepEqual(pasted, { name: 'clipboard.png', dataUrl: sampleImage })
  assert.equal(photo.name, 'photo.heic')
  assert.match(photo.dataUrl, /^data:image\/jpeg;base64,\/9j\//)
  assert.equal(saved.value.messages[0].delivery, 'pending')

  await fill(input, 'Another draft', 'textarea')
  await closeChatTab()
  await wait(async () => (await snapshot()).some(draft => draft.id === chat.id), 'saved chat draft remains after closing')
  await fresh.quit()
  await fresh.launch()
  await wait(() => evaluate(`Boolean(${savedChatRow})`), 'closed saved chat is listed after restart')
  await openSaved()
  assert.equal(await draft(), 'Another draft')
  await fill(input, '', 'textarea')
  await closeChatTab()
  await wait(async () => (await snapshot()).length === 0, 'clearing the composer removes its stored draft')
  await openSaved()
  await fill(input, 'Delete this with the chat', 'textarea')
  await closeChatTab()
  await wait(async () => (await snapshot()).some(draft => draft.id === chat.id), 'draft stored before deleting the chat')

  const deleted = await evaluate(`window.granite.conversations.delete(${JSON.stringify(agentId)}, ${JSON.stringify(chat.id)})`)
  assert.ok(deleted.ok, deleted.error)
  await wait(async () => (await snapshot()).length === 0, 'deleting the chat removes its draft')
  // Simulate a quit after the SQLite commit and before the renderer acknowledges it.
  const interrupted = {
    id: crypto.randomUUID(), agentId, text: 'Accepted before quit', attachments: [], pendingId: crypto.randomUUID(),
    location: { sectionId: chat.sectionId, projectId: chat.projectId }
  }
  const accepted = await evaluate(`window.granite.conversations.acceptMessage(${JSON.stringify(agentId)},
    ${JSON.stringify(interrupted.id)}, ${JSON.stringify(interrupted.pendingId)}, ${JSON.stringify(interrupted.text)},
    ${JSON.stringify(interrupted.location)})`)
  assert.ok(accepted.ok, accepted.error)
  await evaluate(`localStorage.setItem('granite.workspace.chat-drafts',
    ${JSON.stringify(JSON.stringify({ version: 1, drafts: [interrupted] }))})`)
  await fresh.quit()
  await fresh.launch()
  await wait(async () => (await snapshot()).length === 0, 'acceptance recovery removes the already-sent draft')
  const [recovered] = await conversations()
  assert.equal(recovered.id, interrupted.id)
  assert.equal(recovered.title, interrupted.text)

  console.log('Chat drafts survive tab closure and normal quit with attachments. Sends without a provider persist, and clearing or deletion removes drafts.')
}

async function verifyMarkdown({ evaluate, click, fill, wait }, root) {
  const instructions = join(root, 'AGENTS.md')
  const editor = '.file-editor'
  const preview = text => wait(() => evaluate(
    `document.querySelector('.file-preview')?.textContent.includes(${JSON.stringify(text)})`
  ), `file preview contains ${text}`)
  const activeTab = () => evaluate('document.querySelector("[data-region=content] [role=tab][aria-selected=true]")?.id')

  const fileRow = path => `button.tree-file[title="${path}"]`
  const findFile = path => `document.querySelector(${JSON.stringify(fileRow(path))})`
  const openFile = path => evaluate(`${findFile(path)}.click()`)

  await wait(() => evaluate(`Boolean(${findFile('AGENTS.md')})`), 'Markdown files appear in Explorer')
  await openFile('AGENTS.md')
  await preview('Existing instructions')
  const fileTab = await activeTab()
  await click('Edit')
  await fill(editor, '# Updated instructions', 'textarea')

  await openFile('identity.md')
  await preview('This file is empty.')
  await openFile('AGENTS.md')
  assert.equal(await activeTab(), fileTab)
  assert.equal(await evaluate('document.activeElement.id'), fileTab)
  assert.equal(await evaluate('document.querySelector(".file-editor").value'), '# Updated instructions')
  assert.equal(await evaluate(`document.getElementById('${fileTab}').nextElementSibling.disabled`), true)
  assert.equal(await evaluate(`document.getElementById('${fileTab}').closest('.pane').querySelector('.pane-close').disabled`), true)

  await writeFile(instructions, '# External revision')
  await click('Save')
  await wait(() => evaluate('document.querySelector(".file-error")?.textContent.includes("changed")'), 'external edit is protected')
  assert.equal(await evaluate('document.querySelector(".file-editor").value'), '# Updated instructions')
  assert.equal(await readFile(instructions, 'utf8'), '# External revision')
  await click('Discard draft and reload')
  await preview('External revision')

  await click('Edit')
  await fill(editor, '# Updated instructions', 'textarea')
  await click('Save')
  await preview('Updated instructions')
  assert.equal(await readFile(instructions, 'utf8'), '# Updated instructions')

  await click('notes/')
  await wait(() => evaluate('Boolean(document.querySelector(".notes-tree .notes-tree"))'), 'nested Notes folder appears')
  assert.doesNotMatch(await evaluate('document.querySelector(".notes-tree").textContent'), /example\.png/)
  await click('nested/')
  await wait(() => evaluate(`Boolean(${findFile('/notes/nested/Plan.md')})`), 'nested Markdown file appears')

  const addedFile = 'Added from Finder.md'
  const addedNote = '/notes/nested/Added note.md'
  await writeFile(join(root, addedFile), '# Added file')
  await writeFile(join(root, addedNote), '# Added note')
  await writeFile(join(root, 'Unsupported.txt'), 'Unsupported root file')
  await writeFile(join(root, 'notes', 'nested', 'Unsupported.jpg'), 'Unsupported nested file')
  await evaluate("window.dispatchEvent(new Event('focus'))")
  await wait(() => evaluate(`Boolean(${findFile(addedFile)} && ${findFile(addedNote)})`), 'root and expanded folder refresh on window focus')
  assert.equal(await evaluate(`Boolean(${findFile('Unsupported.txt')} || ${findFile('/notes/nested/Unsupported.jpg')})`), false)

  await rm(join(root, addedNote))
  await evaluate("window.dispatchEvent(new Event('focus'))")
  await wait(() => evaluate(`!${findFile(addedNote)}`), 'deleted file disappears on window focus')

  await openFile('/notes/nested/Plan.md')
  await preview('Nested plan')
  await click('Edit')
  await fill(editor, '# Unsaved plan', 'textarea')
  await click('Cancel')
  await preview('Nested plan')
  assert.equal(await readFile(join(root, 'notes', 'nested', 'Plan.md'), 'utf8'), '# Nested plan')
  console.log('Markdown discovery, external refresh, file filtering, preview, draft protection, revision checks, Save, and Cancel passed.')
}

function seedProfile() {
  const code = `
    import { AgentRuntime } from './src/backend/agents/runtime.ts'
    const runtime = await AgentRuntime.open(${JSON.stringify(existingProfile)})
    try {
      const atlas = await runtime.createAgent('Archive')
      await runtime.saveMarkdown(atlas.id, '/notes/Workspace.md', '# Workspace note', null)
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

  const entry = join(directory, 'workspace.cjs')
  await writeFile(entry, `
    const { app } = require('electron')
    process.on('SIGTERM', () => app.quit())
    app.on('browser-window-created', (_event, window) => window.webContents.setBackgroundThrottling(false))
    require(${JSON.stringify(resolve('out/main/index.js'))})
  `)
  await verifyCreation(entry)

  const desktop = workspaceSession(existingProfile, entry)
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
  const activeTabId = () => evaluate(`document.querySelector(${JSON.stringify(content + ' [role=tab][aria-selected=true]')})?.id`)
  const closeTab = id => evaluate(`document.getElementById(${JSON.stringify(id)}).closest('.pane-tab').querySelector('.tab-close').click()`)
  const header = () => evaluate('document.querySelector(".saved-transcript-header")?.textContent')

  try {
    await desktop.launch()
    const connection = await evaluate(`window.granite.connections.save({
      name: 'Local test',
      baseUrl: 'http://127.0.0.1:${provider.address().port}/v1',
      model: 'saved-chat-test',
      apiKey: ''
    })`)
    assert.equal(connection.ok, true, connection.error)
    await desktop.quit()
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
    assert.equal(await draft(), 'Draft for the long chat')
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
    await wait(() => evaluate('!document.querySelector(".workspace[data-transition]")'), 'final fade settles')
    await click('Archive')
    await wait(() => evaluate('Boolean(document.querySelector(".tree-entry[title=\'Long saved chat\']"))'), 'Archive tree ready')
    const agentId = await evaluate(`(async () => {
      const agents = await window.granite.agents.list()
      if (!agents.ok) throw new Error(agents.error)
      return agents.value.find(agent => agent.name === 'Archive').id
    })()`)
    const organization = await evaluate(`window.granite.organization.get(${JSON.stringify(agentId)})`)
    assert.equal(organization.ok, true)
    const general = organization.value.sections.find(section => section.kind === 'general')
    const empty = organization.value.sections.find(section => section.name === 'Empty section')
    const release = organization.value.projects.find(project => project.name === 'Release')
    const savedChats = async () => {
      const result = await evaluate(`window.granite.conversations.list(${JSON.stringify(agentId)})`)
      assert.equal(result.ok, true)
      return result.value
    }
    const savedCount = (await savedChats()).length

    await click('New chat')
    const generalTab = await activeTabId()
    assert.match(await header(), /Archive \/ General.*New chat/)
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Message')
    await fill(composer, 'Start a General chat', 'textarea')
    await click('New chat in Empty section')
    const sectionTab = await activeTabId()
    assert.notEqual(sectionTab, generalTab)
    assert.match(await header(), /Archive \/ Empty section.*New chat/)
    assert.equal(await draft(), '')
    await fill(composer, 'Keep this draft on failure', 'textarea')
    assert.equal((await savedChats()).length, savedCount)

    const deleted = await evaluate(`window.granite.organization.deleteSection(${JSON.stringify(agentId)}, ${JSON.stringify(empty.id)})`)
    assert.equal(deleted.ok, true)
    await click('Send message')
    await wait(() => evaluate('Boolean(document.querySelector(".workspace-chat [role=alert]"))'), 'deleted destination is reported')
    assert.equal(await draft(), 'Keep this draft on failure')
    await closeTab(sectionTab)
    await wait(async () => await tabCount() === 1, 'unsaved tab closes')
    assert.equal(await activeTabId(), generalTab)
    assert.equal(await draft(), 'Start a General chat')
    assert.equal((await savedChats()).length, savedCount)
    assert.equal(prompts.length, 3)

    await click('Send message')
    await wait(() => transcriptContains('Reply in the new General chat'), 'first General message streams')
    await wait(() => evaluate('Boolean(document.querySelector(".tree-entry[title=\'Start a General chat\']"))'), 'new General chat appears in Explorer')
    assert.equal(await activeTabId(), generalTab)
    const savedGeneral = (await savedChats()).find(chat => chat.title === 'Start a General chat')
    assert.equal(savedGeneral.sectionId, general.id)
    assert.equal(savedGeneral.projectId, null)

    await evaluate(`[...document.querySelectorAll('summary')].find(summary => summary.textContent.trim() === 'Release').click()`)
    await click('New chat in Release')
    const projectTab = await activeTabId()
    assert.match(await header(), /Archive \/ Planning \/ Release.*New chat/)
    await fill(composer, 'Start a project chat', 'textarea')
    await evaluate(`(() => {
      const send = document.querySelector('.composer button[type=submit]')
      send.click()
      send.click()
    })()`)
    await wait(async () => (await savedChats()).some(chat => chat.title === 'Start a project chat'), 'project message is accepted while General streams')
    const newChats = await savedChats()
    const savedProject = newChats.find(chat => chat.title === 'Start a project chat')
    assert.equal(newChats.length, savedCount + 2)
    assert.equal(savedProject.sectionId, release.sectionId)
    assert.equal(savedProject.projectId, release.id)

    await click('Start a General chat')
    await click('■ Stop')
    await wait(() => evaluate('Boolean(document.querySelector(".tree-entry[title=\'Start a project chat\']"))'), 'new project chat appears in Explorer')
    await click('Start a project chat')
    await wait(() => transcriptContains('Reply in the new project chat'), 'project reply arrives')
    assert.equal(await activeTabId(), projectTab)
    await closeTab(projectTab)
    await wait(async () => await tabCount() === 1, 'new saved project tab closes')
    await click('Start a project chat')
    await wait(() => transcriptContains('Reply in the new project chat'), 'new project chat reopens from storage')
    assert.notEqual(await activeTabId(), projectTab)
    assert.deepEqual(prompts.slice(3), ['Start a General chat', 'Start a project chat'])

    const storageKey = 'granite.workspace.layout'
    const noteRow = '.tree-file[title="/notes/Workspace.md"]'
    const filePreview = 'document.querySelector(".file-preview")?.textContent.includes("Workspace note")'
    const tabPresent = id => evaluate(`Boolean(document.getElementById(${JSON.stringify(id)}))`)
    const keyDown = (selector, key) => evaluate(`document.querySelector(${JSON.stringify(selector)})
      .dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`)
    const geometry = () => evaluate(`({
      regions: Array.from(document.querySelectorAll('[data-region]'), node => [node.dataset.region, Math.round(node.getBoundingClientRect().width)]),
      dividers: Array.from(document.querySelectorAll('[role=separator]'), node => [node.ariaLabel, node.offsetLeft, node.offsetTop]),
      panes: Array.from(document.querySelectorAll('[data-pane-id]'), pane => ({
        id: pane.dataset.paneId,
        tabs: Array.from(pane.querySelectorAll('[role=tab]'), tab => [tab.id, tab.ariaSelected])
      }))
    })`)
    const stored = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}))`)

    await click('notes/')
    await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(noteRow)}))`), 'Workspace note appears in Explorer')
    await evaluate(`document.querySelector(${JSON.stringify(noteRow)}).click()`)
    await wait(() => evaluate(filePreview), 'Workspace note opens')
    const noteTab = await activeTabId()
    await dragTab(noteTab, content + ' .pane-body', 0.78, 0.5, '.pane-dock-preview')
    const innerDivider = '[aria-label="Resize Content groups"]'
    await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(innerDivider)}))`), 'file has its own pane')
    const outerDivider = '[aria-label="Resize regions"]'
    for (const divider of [innerDivider, outerDivider]) {
      const origin = await point(divider)
      const target = { ...origin, x: origin.x - 24 }
      await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...origin })
      await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', ...origin, button: 'left', buttons: 1, clickCount: 1 })
      await wait(() => evaluate('Boolean(document.querySelector(".pane-divider.is-resizing"))'), 'divider resize starts')
      await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target, buttons: 1 })
      await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', buttons: 0, clickCount: 1 })
      await wait(async () => (await point(divider)).x < origin.x, 'divider moves after drag')
    }
    await keyDown('[aria-label="Move Explorer region"]', 'ArrowRight')
    await wait(() => evaluate('document.querySelector("[data-region]").dataset.region === "content"'), 'regions swap')

    await click('Edit')
    await fill('.file-editor', 'Unsaved file text', 'textarea')
    await click('New chat')
    const unsavedTab = await evaluate('document.activeElement.closest("[role=tabpanel]").getAttribute("aria-labelledby")')
    await click('Start a project chat')
    await wait(() => transcriptContains('Reply in the new project chat'), 'saved chat is selected beside the note')
    const savedGeometry = await geometry()
    const expected = { ...savedGeometry, panes: savedGeometry.panes.map(pane => ({
      ...pane, tabs: pane.tabs.filter(([id]) => id !== unsavedTab)
    })) }
    assert.ok(savedGeometry.panes.some(pane => pane.tabs.some(([id]) => id === unsavedTab)))
    await wait(async () => (await stored())?.layout.regions[0].type === 'content', 'swapped layout written to storage')
    const saved = JSON.stringify(await stored())
    assert.ok(saved.includes(noteTab))
    assert.ok(!saved.includes(unsavedTab) && !saved.includes('Unsaved file text'))

    await desktop.quit()
    await desktop.launch()
    await wait(() => evaluate(filePreview), 'file preview restored without its draft')
    await wait(() => transcriptContains('Reply in the new project chat'), 'saved chat restored without an Explorer click')
    assert.deepEqual(await geometry(), expected)

    await click('Start a General chat')
    await wait(() => transcriptContains('Reply in the new General chat'), 'restored inactive chat loads when selected')
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(generalTab)}).ariaSelected`), 'true')
    await click('Start a project chat')
    const removed = await evaluate(`window.granite.conversations.delete(${JSON.stringify(agentId)}, ${JSON.stringify(savedGeneral.id)})`)
    assert.equal(removed.ok, true, removed.error)
    await rm(join(existingProfile, 'agents', agentId, 'notes', 'Workspace.md'))
    await desktop.quit()
    await desktop.launch()
    await wait(async () => !await tabPresent(generalTab) && !await tabPresent(noteTab), 'deleted chat and file are removed on restore')
    await wait(() => transcriptContains('Reply in the new project chat'), 'surviving chat still opens')
    assert.deepEqual(prompts.slice(3), ['Start a General chat', 'Start a project chat'])

    await wait(async () => !JSON.stringify(await stored()).includes(noteTab), 'reconciled layout written to storage')
    await evaluate(`localStorage.setItem(${JSON.stringify(storageKey)}, '{"version":1,"layout":null}')`)
    await desktop.quit()
    await desktop.launch()
    await wait(() => evaluate('Boolean(document.querySelector(".agent-picker-create"))'), 'invalid snapshot restores the default explorer')
    assert.equal(await tabCount(), 0)
    assert.equal(await evaluate('document.querySelector("[data-region]").dataset.region'), 'explorer')
    await click('Archive')
    await wait(() => evaluate('Boolean(document.querySelector(".agent-explorer .new-chat-button"))'), 'Archive is ready after resetting layout')
    await click('New chat')
    await fill(composer, 'Provider refuses this message', 'textarea')
    await click('Send message')
    await wait(() => transcriptContains('Provider refuses this message'), 'outgoing message appears after provider rejection')
    await wait(() => evaluate('Boolean(document.querySelector(".workspace-chat [role=alert]"))'), 'provider rejection is reported')
    const rejected = (await savedChats()).find(chat => chat.title === 'Provider refuses this message')
    assert.ok(rejected)
    const rejectedChat = await evaluate(`window.granite.conversations.get(${JSON.stringify(agentId)}, ${JSON.stringify(rejected.id)})`)
    assert.equal(rejectedChat.value.messages.filter(message => message.role === 'user').length, 1)
    assert.equal(await draft(), '')
    await click('New chat')
    await fill(composer, 'Hold for steering', 'textarea')
    await click('Send message')
    await wait(() => transcriptContains('Partial saved-chat reply'), 'run is streaming before steering')
    const beforeSteering = (await activeRuns()).find(run => run.phase === 'streaming')
    await fill(composer, 'Steer the active reply', 'textarea')
    await click('Send update')
    await wait(() => transcriptContains('Thanks for naming the project.'), 'steering resumes the live run')
    const steered = await evaluate(`window.granite.conversations.get(${JSON.stringify(agentId)},
      ${JSON.stringify(beforeSteering.conversationId)})`)
    const messages = steered.value.messages.filter(message => message.role === 'user')
    assert.deepEqual(messages.map(message => message.content), ['Hold for steering', 'Steer the active reply'])
    assert.ok(messages.every(message => message.runId === beforeSteering.id))
    console.log('Workspace order, widths, splits, and saved tabs survived restart. Deleted tabs and malformed snapshots recovered.')

    const repository = await evaluate(`window.granite.organization.createRepository(${JSON.stringify(agentId)}, ${JSON.stringify(release.id)})`)
    assert.equal(repository.ok, true, repository.error)
    const tools = await evaluate(`window.granite.harness.save(${JSON.stringify(agentId)}, {
      instructions: '', terminal: true, approveWrites: true, skills: true, mcpServers: []
    })`)
    assert.equal(tools.ok, true, tools.error)
    await evaluate(`[...document.querySelectorAll('.agent-explorer summary')]
      .find(summary => summary.textContent.trim() === 'Release' && !summary.parentElement.open)?.click()`)

    const activityFor = title => `(() => {
      const tab = [...document.querySelectorAll('[role=tab][aria-selected=true]')].find(tab => tab.textContent.trim() === ${JSON.stringify(title)})
      return tab?.closest('.pane').querySelector('.workspace-chat-activity')
    })()`
    const totals = title => evaluate(`${activityFor(title)}?.querySelector('.activity-line-totals')?.ariaLabel`)
    const terminalCount = title => evaluate(`[...${activityFor(title)}?.querySelectorAll('.activity-disclosure') ?? []]
      .find(button => button.querySelector('.activity-section-label').textContent === 'Terminal processes')
      ?.querySelector('.activity-count').textContent`)
    const baselineTitle = 'Project saved chat'
    const liveTitle = 'Start a project chat'
    const activityPosition = title => evaluate(`getComputedStyle(${activityFor(title)}.querySelector('.workspace-activity-panel')).position`)
    const openCompactActivity = title => evaluate(`(() => {
      const button = ${activityFor(title)}.querySelector('.workspace-activity-toggle')
      if (button.getClientRects().length && button.ariaExpanded === 'false') button.click()
    })()`)

    await click(baselineTitle)
    const baselineTab = await activeTabId()
    await fill(composer, 'Write the baseline file', 'textarea')
    await click('Send message')
    await wait(() => transcriptContains('Baseline file written.'), 'baseline repository reply')
    await wait(async () => await totals(baselineTitle) === '1 lines added, 0 lines removed', 'baseline line totals')
    await rpc('Emulation.setDeviceMetricsOverride', { width: 1680, height: 900, deviceScaleFactor: 1, mobile: false })
    await wait(async () => await activityPosition(baselineTitle) === 'static', 'wide chat shows the activity sidebar')
    await click(liveTitle)
    await wait(async () => await totals(liveTitle) === '0 lines added, 0 lines removed', 'switching tabs clears the previous chat’s totals')
    await dragTab(baselineTab, content + ' .pane-body', 0.78, 0.5, '.pane-dock-preview')
    await wait(async () => await totals(baselineTitle) === '1 lines added, 0 lines removed', 'docked chat restores its saved totals')
    await wait(async () => await activityPosition(baselineTitle) === 'absolute' && await activityPosition(liveTitle) === 'absolute', 'both narrow panes use popovers')
    assert.equal(await evaluate(`${activityFor(liveTitle)}.querySelector('.workspace-activity-panel').getClientRects().length`), 0)

    const livePane = await evaluate(`${activityFor(liveTitle)}.closest('.pane').dataset.paneId`)
    const liveScope = `[data-pane-id="${livePane}"]`
    await fill(liveScope + ' textarea[aria-label="Message"]', 'Write a file and run a terminal', 'textarea')
    await evaluate(`document.querySelector(${JSON.stringify(liveScope + ' .composer button[type=submit]')}).click()`)
    await wait(async () => await totals(liveTitle) === '2 lines added, 0 lines removed' && await terminalCount(liveTitle) === '1', 'live line totals and terminal count')
    assert.equal(await totals(baselineTitle), '1 lines added, 0 lines removed')
    assert.equal(await terminalCount(baselineTitle), '0')
    await openCompactActivity(liveTitle)
    await evaluate(`[...${activityFor(liveTitle)}.querySelectorAll('.activity-disclosure')].forEach(button => button.click())`)
    await evaluate(`${activityFor(liveTitle)}.querySelector('details:not(.repository-file-change) > summary').click()`)
    await wait(() => evaluate(`${activityFor(liveTitle)}.querySelector('[aria-label="Terminal output"]')?.textContent.includes('Waiting for input')`), 'live terminal output')
    await click('Stop task')
    await wait(async () => await terminalCount(liveTitle) === '0', 'stopped terminal clears the count')

    const baselineComposer = `[aria-labelledby="${baselineTab}"] .composer`
    await evaluate(pasteImage(baselineComposer + ' textarea'))
    await wait(() => evaluate(`document.querySelector(${JSON.stringify(baselineComposer + ' img')})?.naturalWidth === 1`), 'image thumbnail belongs to the selected chat')
    assert.equal(await evaluate(`Boolean(${activityFor(liveTitle)}.closest('.pane').querySelector('.composer-attachments'))`), false)

    await closeTab(baselineTab)
    await wait(async () => !await tabPresent(baselineTab), 'baseline chat closes before reopening')
    await click(baselineTitle)
    await wait(async () => await totals(baselineTitle) === '1 lines added, 0 lines removed', 'reopened chat restores its line totals')
    await openCompactActivity(baselineTitle)
    await evaluate(`${activityFor(baselineTitle)}.querySelector('.activity-disclosure').click()`)
    await wait(() => evaluate(`Boolean(${activityFor(baselineTitle)}.querySelector('.repository-file-change'))`), 'reopened chat loads its saved report')
    await evaluate(`${activityFor(baselineTitle)}.querySelector('.repository-file-change > summary').click()`)
    await wait(() => evaluate(`(() => {
      const diff = ${activityFor(baselineTitle)}.querySelector('.repository-file-change pre')
      return diff?.getBoundingClientRect().height > 0 && diff.textContent.includes('+baseline')
    })()`), 'reopened chat shows its file diff')
    console.log('Repository line totals, saved diffs, and live terminal output followed the correct workspace chat.')

    const reopenedTab = await evaluate(`${activityFor(baselineTitle)}.closest('.pane').querySelector('[role=tab][aria-selected=true]').id`)
    const reopenedComposer = `[aria-labelledby="${reopenedTab}"] .composer`
    await wait(() => evaluate(`document.querySelector(${JSON.stringify(reopenedComposer + ' img')})?.naturalWidth === 1`), 'image thumbnail is restored when reopening the chat')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(reopenedComposer + ' textarea')}).value`), '')
    await evaluate(`document.querySelector(${JSON.stringify(reopenedComposer + ' .send-button')}).click()`)
    await wait(() => transcriptContains('Received the attached image.'), 'image-only message reaches the model as an image')
    await wait(() => evaluate(`!document.querySelector(${JSON.stringify(reopenedComposer + ' .stop-button')})`), 'image-only reply settles')

    const fullAttachment = 'Sample line for attachment testing.\n'.repeat(2000).slice(0, 64_000)
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(reopenedComposer + ' input[type=file]')})
      const transfer = new DataTransfer()
      transfer.items.add(new File([${JSON.stringify(fullAttachment)}], 'full.txt', { type: 'text/plain' }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await wait(() => evaluate(`document.querySelector(${JSON.stringify(reopenedComposer + ' .send-button')})?.disabled === false`), '64 KB attachment is ready to send')
    await evaluate(`document.querySelector(${JSON.stringify(reopenedComposer + ' .send-button')}).click()`)
    await wait(() => prompts.some(prompt => prompt.includes(fullAttachment)), 'the local model receives all 64 KB of attached text')
  } finally {
    await desktop.quit()
  }
  console.log('The final chat pane held its fade. Explorer drafts, first sends, and reopening newly saved chats passed.')
} finally {
  provider.closeAllConnections()
  provider.close()
  await rm(directory, { recursive: true, force: true })
}
