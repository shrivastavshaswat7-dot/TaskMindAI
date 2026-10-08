import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { getPriorities } from '../api/study'

const DEFAULT_DAYS_LEFT = 7

// Score ko existing priority-badge classes se map karo
function priorityLevel(score) {
  if (score >= 75) return { cls: 'urgent', label: 'Critical' }
  if (score >= 60) return { cls: 'high', label: 'High' }
  if (score >= 40) return { cls: 'medium', label: 'Medium' }
  return { cls: 'low', label: 'Low' }
}

function Priorities() {
  const { topics, priorityResult, setPriorityResult } = useOutletContext()
  const navigate = useNavigate()
  const [daysLeft, setDaysLeft] = useState(
    String(priorityResult?.daysLeft ?? DEFAULT_DAYS_LEFT)
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const ranked = priorityResult?.ranked || []
  const isStale = priorityResult && priorityResult.topics !== topics

  const handleCalculate = async (e) => {
    e.preventDefault()
    const days = Number(daysLeft)
    if (!Number.isFinite(days) || days < 0) {
      setError('Days left must be 0 or more')
      return
    }

    setIsLoading(true)
    setError('')
    try {
      const data = await getPriorities(topics, days)
      setPriorityResult({ topics, daysLeft: days, ranked: data.ranked || [] })
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  if (topics.length === 0) {
    return (
      <>
        <header className="dashboard-header">
          <div>
            <p className="dashboard-small-title">PRIORITIES</p>
            <h1>Topic Priorities</h1>
            <p className="dashboard-subtitle">Find out what to study first.</p>
          </div>
        </header>
        <section className="dashboard-card">
          <div className="empty-tasks">
            No topics yet. Upload your PYQ papers first.
            <div style={{ marginTop: '16px' }}>
              <button className="primary-btn" onClick={() => navigate('/pyq')}>
                Go to PYQ Analysis →
              </button>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-small-title">PRIORITIES</p>
          <h1>Topic Priorities</h1>
          <p className="dashboard-subtitle">
            Ranked by how often a topic appears, its marks, your weakness and exam proximity.
          </p>
        </div>
        {ranked.length > 0 && (
          <button className="ai-btn" onClick={() => navigate('/study-now')}>
            Make Study Plan →
          </button>
        )}
      </header>

      <section className="dashboard-card">
        <form onSubmit={handleCalculate} className="add-task-form study-form">
          <label className="priority-days-label" htmlFor="days-left">Days left for exam</label>
          <input
            id="days-left"
            type="number"
            min="0"
            step="1"
            value={daysLeft}
            onChange={(e) => setDaysLeft(e.target.value)}
            className="date-input"
            required
          />
          <button type="submit" className="primary-btn" disabled={isLoading}>
            {isLoading ? 'Calculating...' : `✨ Calculate Priorities (${topics.length} topics)`}
          </button>
        </form>

        {error && (
          <div className="doc-answer-error" style={{ marginTop: '16px' }}>❌ {error}</div>
        )}
        {isStale && !isLoading && (
          <p className="doc-filter-note">
            Topics have changed since the last calculation. Recalculate to update the ranking.
          </p>
        )}
      </section>

      <section className="dashboard-card">
        <div className="card-header">
          <div>
            <h2>Ranked Topics</h2>
            <p>
              {ranked.length > 0
                ? `${priorityResult.daysLeft} days left · highest priority first`
                : 'Calculate priorities to see the ranking'}
            </p>
          </div>
        </div>

        {ranked.length === 0 ? (
          <div className="empty-tasks">
            {isLoading ? 'Ranking your topics...' : 'No ranking yet. Enter days left and calculate.'}
          </div>
        ) : (
          <div className="priority-table-wrap">
            <table className="priority-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Topic</th>
                  <th>Unit</th>
                  <th>Frequency</th>
                  <th>Avg marks</th>
                  <th>Priority</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((topic, index) => {
                  const level = priorityLevel(topic.priority)
                  return (
                    <tr key={topic.id}>
                      <td className="priority-rank">{index + 1}</td>
                      <td className="priority-topic">{topic.name}</td>
                      <td>{topic.unit > 0 ? topic.unit : '—'}</td>
                      <td>{topic.frequency}/{topic.papers_total}</td>
                      <td>{topic.avg_marks}</td>
                      <td>
                        <span className={`priority-badge priority-${level.cls}`}>
                          {topic.priority} · {level.label}
                        </span>
                      </td>
                      <td className="priority-reason">{topic.reason}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

export default Priorities
