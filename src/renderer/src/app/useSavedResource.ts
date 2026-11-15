import { useEffect, useState } from 'react'
import type { Result } from '../../../shared/chat'

export function useSavedResource<Value>(load: () => Promise<Result<Value>>, failure: string, revision = 0) {
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState<{ load: typeof load; attempt: number; result: Result<Value> }>()

  useEffect(() => {
    let current = true
    function publish(result: Result<Value>) {
      if (current) setSnapshot({ load, attempt, result })
    }

    void load().then(publish, () => publish({ ok: false, error: failure }))
    return () => { current = false }
  }, [load, attempt, failure, revision])

  function update(change: (value: Value) => Value) {
    setSnapshot(current => {
      if (current?.load !== load || current.attempt !== attempt || !current.result.ok) return current
      return { ...current, result: { ok: true, value: change(current.result.value) } }
    })
  }

  return {
    result: snapshot?.load === load && snapshot.attempt === attempt ? snapshot.result : undefined,
    retry: () => setAttempt(value => value + 1),
    update
  }
}
