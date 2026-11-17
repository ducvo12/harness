import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from '../src/backend/agents/store.ts'

test('response duration persists in SQLite, preserves message content and ordering, and cannot be overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'granite-response-duration-'))
  const path = join(dir, 'test.sqlite')
  const store = new AgentStore(path)
  try {
    const conversation = store.create('atlas')
    const { message } = store.begin('atlas', conversation.id, 'Question', 'model')
    assert.throws(() => store.saveResponseDuration('atlas', conversation.id, message.id, 1234), /Completed response/)
    message.content = 'Answer'
    store.finish(conversation.id, message, 'complete')
    const before = store.get('atlas', conversation.id)
    assert.equal(before.messages[1].responseDurationMs, undefined)
    for (const invalid of [-1, NaN, Infinity, 0.5]) {
      assert.throws(() => store.saveResponseDuration('atlas', conversation.id, message.id, invalid), /Invalid/)
    }
    assert.throws(() => store.saveResponseDuration('other', conversation.id, message.id, 1234), /not found/)
    assert.throws(() => store.saveResponseDuration('atlas', conversation.id, before.messages[0].id, 1234), /Completed response/)
    store.saveResponseDuration('atlas', conversation.id, message.id, 1234)
    store.saveResponseDuration('atlas', conversation.id, message.id, 9999)
    const reopened = new AgentStore(path)
    try {
      const after = reopened.get('atlas', conversation.id)
      assert.equal(after.messages[1].responseDurationMs, 1234)
      assert.deepEqual(after.messages[1], { ...before.messages[1], responseDurationMs: 1234 })
      assert.equal(after.updatedAt, before.updatedAt)
      assert.deepEqual(after.messages[0], before.messages[0])
    } finally { reopened.saver.db.close() }
  } finally {
    store.saver.db.close()
    await rm(dir, { recursive: true, force: true })
  }
})
