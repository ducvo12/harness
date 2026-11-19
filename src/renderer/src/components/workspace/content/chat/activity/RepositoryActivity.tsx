import { useEffect, useState, type ReactNode } from 'react'
import type { RepositoryReport } from '../../../../../../../shared/repository'
import { isLiveRun, type RunSnapshot } from '../../../../../../../shared/run'
import ActivitySection from './ActivitySection'
import RepositoryChanges from './RepositoryChanges'
import { activitySummary } from './activity-summary'

const publicationLabels = {
  staged: 'Changes staged',
  applied: 'Changes applied',
  partial: 'Some changes applied',
  discarded: 'Changes discarded'
}

export default function RepositoryActivity({ agentId, conversationId, run, onStop, children }: {
  agentId: string
  conversationId: string
  run?: RunSnapshot
  onStop: () => Promise<void>
  children?: ReactNode
}) {
  const runId = run?.id
  const busy = Boolean(run && isLiveRun(run))
  const stopping = run?.phase === 'stopping'
  const [reports, setReports] = useState<RepositoryReport[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(conversationId))

  useEffect(() => {
    if (!conversationId || !agentId) return

    let current = true
    let timer: ReturnType<typeof setTimeout>

    async function load() {
      let retry = false

      try {
        const result = await window.granite.repositories.reports(agentId, conversationId)
        if (!current) return
        if (result.ok) {
          setReports(result.value)
          setError('')
        } else {
          setError(result.error)
        }
      } catch {
        if (!current) return
        setError('Could not load repository activity. Retrying…')
        retry = true
      } finally {
        if (current) {
          setLoading(false)
          if (busy || retry) timer = setTimeout(() => void load(), 1500)
        }
      }
    }

    void load()
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [agentId, conversationId, busy, runId])

  const { active } = activitySummary(reports, run)

  return (
    <div aria-busy={loading}>
      {error && <p className="activity-error" role="alert">{error}</p>}

      <RepositoryChanges agentId={agentId} conversationId={conversationId} run={run} reports={reports}
        onChange={updated => setReports(previous => previous.map(report => report.runId === updated.runId ? updated : report))} />

      {children}

      <ActivitySection title="Terminal processes" summary={<span className="activity-count">{active.length}</span>}>
        {active.map(command => (
          <details key={`${command.runId}:${command.id}`} className="activity-item">
            <summary>
              <span className="activity-file-name" title={command.command}>
                {command.command}
              </span>

              <span className="activity-status is-active">
                {command.status}
              </span>
            </summary>

            <code className="activity-command">
              {command.command}
            </code>

            <p className="activity-hint">
              {command.cwd} · {publicationLabels[command.publication]}
              {command.exitCode != null && ` · Exit ${command.exitCode}`}
            </p>

            {command.output && (
              <pre aria-label="Terminal output">
                {command.output}
              </pre>
            )}

            {command.error && <p className="activity-error" role="alert">{command.error}</p>}

            {busy && command.runId === run?.id && (
              <button type="button" className="quiet-button" disabled={stopping} onClick={() => void onStop()}>
                {stopping ? 'Stopping…' : 'Stop task'}
              </button>
            )}
          </details>
        ))}
      </ActivitySection>
    </div>
  )
}
