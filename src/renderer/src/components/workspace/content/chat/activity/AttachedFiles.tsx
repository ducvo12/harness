import ActivitySection from './ActivitySection'
import type { AgentMessage } from '../../../../../../../shared/agent'
import { sentAttachments } from '../attachments'

export default function AttachedFiles({ messages }: { messages: AgentMessage[] }) {
  const sent = messages.filter(message => message.role === 'user').flatMap(message => [
    ...sentAttachments(message.content),
    ...(message.images ?? []).map(image => ({ ...image, content: '' }))
  ].map((file, index) => ({ ...file, id: `${message.id}:${index}` })))

  return (
    <ActivitySection title="Attached files" summary={<span className="activity-count">{sent.length}</span>}>
      {sent.map(file => (
        <details className="activity-item" key={file.id}>
          <summary>
            <span className="activity-file-name" title={file.name}>
              {file.name}
            </span>

            <span className="activity-status">
              Sent
            </span>
          </summary>

          {'dataUrl' in file ? (
            <img className="chat-message-image" src={file.dataUrl} alt={file.name} />
          ) : (
            <pre>
              {file.content}
            </pre>
          )}
        </details>
      ))}
    </ActivitySection>
  )
}
