import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentTextLimit, messageTextLimit } from '../src/shared/chat-limits.ts'
import { readAttachments, messageWithAttachments, sentAttachments } from '../src/renderer/src/components/workspace/content/chat/attachments.ts'

test('text files are sent with the message and can be recovered from saved chat history', async () => {
  const files = await readAttachments([new File(['hello\nworld'], 'notes.md')], [])
  assert.equal(files.length, 1)
  assert.equal(files[0].content, 'hello\nworld')
  assert.ok(files[0].id)
  const message = messageWithAttachments('Summarize this', files)
  assert.ok(message.startsWith('Summarize this\n\n'))
  assert.deepEqual(sentAttachments(message), [{ name: 'notes.md', size: 11, content: 'hello\nworld' }])
  assert.equal(messageWithAttachments('hello', []), 'hello')
  assert.equal(messageWithAttachments('', files).startsWith('### Attached file:'), true)
})

test('attachment names and nested code fences round trip without ending an attachment early', async () => {
  const content = '```ts\nconst a = `hi`\n```\n````\n### Attached file: fake'
  const files = await readAttachments([new File([content], 'a"b\nc.md'), new File(['second'], 'second.txt')], [])
  assert.deepEqual(sentAttachments(messageWithAttachments('', files)), files.map(({ name, size, content }) => ({ name, size, content })))
  assert.deepEqual(sentAttachments('ordinary message'), [])
})

test('attachment limits reject binary data, invalid UTF-8, oversized batches and oversized messages', async () => {
  await assert.rejects(readAttachments([new File([new Uint8Array([0, 1])], 'image.png')], []), /text or code file/)
  await assert.rejects(readAttachments([new File([new Uint8Array([255])], 'invalid.txt')], []), /UTF-8/)
  await assert.rejects(readAttachments([new File(['a'.repeat(attachmentTextLimit + 1)], 'large.txt')], []), /64 KB/)
  const existing = await readAttachments([new File(['a'.repeat(attachmentTextLimit)], 'full.txt')], [])
  assert.equal(sentAttachments(messageWithAttachments('Review this file.', existing))[0].content.length, attachmentTextLimit)
  await assert.rejects(readAttachments([new File(['b'], 'extra.txt')], existing), /64 KB/)
  await assert.rejects(readAttachments(Array.from({ length: 6 }, (_, index) => new File(['a'], `${index}.txt`)), []), /5 files/)
  assert.throws(() => messageWithAttachments('a'.repeat(messageTextLimit), existing), /too long/)
  assert.equal(existing.length, 1)
})

test('archives and disk images are rejected even when their contents look like text', async () => {
  for (const file of [
    new File(['plain text'], 'project.ZIP'),
    new File(['plain text'], 'installer.dmg'),
    new File(['plain text'], 'renamed.txt', { type: 'application/zip' })
  ]) {
    await assert.rejects(readAttachments([file], []), /archives and disk images can’t be attached/)
  }

  const [file] = await readAttachments([new File(['FROM scratch'], 'Dockerfile', { type: 'application/octet-stream' })], [])
  assert.equal(file.content, 'FROM scratch')
})
