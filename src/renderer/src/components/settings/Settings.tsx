import { useState } from 'react'
import type { SavedConnection } from '../../../../shared/chat'
import ConnectionEditor, { type ConnectionSelection } from './ConnectionEditor'
import ConnectionList from './ConnectionList'

export default function Settings({
  connections,
  onChange
}: {
  connections: SavedConnection[]
  onChange: (next: SavedConnection[]) => void
}) {
  const [selection, setSelection] = useState<ConnectionSelection | null>(null)
  const [saved, setSaved] = useState(false)

  function openEditor(next: ConnectionSelection) {
    setSaved(false)
    setSelection(next)
  }

  function finishEditing(connection: SavedConnection) {
    onChange([...connections.filter(item => item.id !== connection.id), connection])
    setSaved(true)
    setSelection(null)
  }

  return (
    <main className="settings-main">
      <div className="settings-content">
        {selection ? (
          <ConnectionEditor
            connections={connections}
            selection={selection}
            onSave={finishEditing}
            onClose={() => setSelection(null)}
          />
        ) : (
          <ConnectionList
            connections={connections}
            initialNotice={saved ? 'Connection saved.' : ''}
            onChange={onChange}
            onEdit={connection => openEditor({ connection })}
            onConnect={preset => openEditor({ preset })}
          />
        )}
      </div>
    </main>
  )
}
