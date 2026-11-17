import { useLayoutEffect, useRef, useState } from 'react'
import { readAttachments, type ChatAttachment } from './attachments'

export function useAttachmentPicker(
  scope: string,
  attachments: ChatAttachment[],
  onChange: (files: ChatAttachment[]) => void
) {
  const pending = useRef<Promise<ChatAttachment[]> | undefined>(undefined)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')

  useLayoutEffect(() => {
    setReading(false)
    setError('')

    return () => {
      pending.current = undefined
    }
  }, [scope])

  async function attach(files: File[]) {
    if (!files.length || pending.current) return

    const request = readAttachments(files, attachments)
    pending.current = request
    setReading(true)
    setError('')

    try {
      const next = await request
      if (pending.current === request) onChange(next)
    } catch (error) {
      if (pending.current === request) {
        setError(error instanceof Error ? error.message : 'Could not read the selected files.')
      }
    } finally {
      if (pending.current === request) {
        pending.current = undefined
        setReading(false)
      }
    }
  }

  return { attach, reading, error }
}
