import type { IpcCalls, WorkerRequest } from '../src/shared/ipc.ts'
import type { AgentDeletionResult } from '../src/shared/agent.ts'
import type { Result } from '../src/shared/chat.ts'

declare function acceptRequest(request: WorkerRequest): void
declare function acceptDeletion(result: Result<AgentDeletionResult>): void

acceptRequest({ id: 'request', action: 'workspace:save', args: ['agent', '/notes/a.md', 'content', null] })
// @ts-expect-error Unknown worker actions cannot be sent.
acceptRequest({ id: 'request', action: 'unknown', args: [] })
// @ts-expect-error File saves need their expected revision/content.
acceptRequest({ id: 'request', action: 'workspace:save', args: ['agent'] })

type Deletion = Awaited<ReturnType<IpcCalls['agents:delete']>>
const deletion: Deletion = { ok: true, value: { cleanupPending: true } }
acceptDeletion(deletion)
