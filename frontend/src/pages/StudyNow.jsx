import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { getPlan, getPriorities } from '../api/study'

const DEFAULT_HOURS = 2
const QUIZ_BLOCK = 'Quiz / Active recall'

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

function formatClock(minutes) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

function StudyNow() {
  const { topics, priorityResult, setPriorityResult, studyPlan, setStudyPlan } = useOutletContext()
  const navigate = useNavigate()
  const [hours, setHours] = useState(String(studyPlan?.hours ?? DEFAULT_HOURS))
  // Latest priorities wale days_left se shuru karo, purane plan se nahi
  const [daysLeft, setDaysLeft] = useState(
    String(priorityResult?.daysLeft ?? studyPlan?.daysLeft ?? 7)
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const ranked = priorityResult?.ranked || []
  const blocks = studyPlan?.blocks || []
  // Plan purana hai agar ranking badal gayi ya topics (jaise quiz ke baad weakness) badal gaye
  const isStale = Boolean(
    studyPlan && (studyPlan.ranked !== ranked || priorityResult?.topics !== topics)
  )

  const handleGenerate = async (e) => {
    e.preventDefault()
    const h = Number(hours)
    const days = Number(daysLeft)
    if (!Number.isFinite(h) || h <= 0) {
      setError('Study hours must be more than 0')
      return
    }
    if (!Number.isFinite(days) || days < 0) {
      setError('Days left must be 0 or more')
      return
    }

    setIsLoading(true)
    setError('')
    try {
      let currentRanked = ranked
      // days_left ya topics badle toh ranking bhi badlegi, pehle priorities dobara nikalo
      if (days !== priorityResult.daysLeft || priorityResult.topics !== topics) {
        const data = await getPriorities(topics, days)
        currentRanked = data.ranked || []
        setPriorityResult({ topics, daysLeft: days, ranked: currentRanked })
      }
      const data = await getPlan(currentRanked, h, days)
      setStudyPlan({ ranked: currentRanked, hours: h, daysLeft: days, blocks: data.blocks || [] })
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const header = (
    <header className="dashboard-header">
      <div>
        <p className="dashboard-small-title">STUDY NOW</p>
        <h1>Today's Study Plan</h1>
        <p className="dashboard-subtitle">Time split across your highest-priority topics.</p>
      </div>
    </header>
  )

  if (topics.length === 0 || ranked.length === 0) {
    return (
      <>
        {header}
        <section className="dashboard-card">
          <div className="empty-tasks">
            {topics.length === 0
              ? 'No topics yet. Upload your PYQ papers first.'
              : 'Calculate topic priorities first to build a plan.'}
            <div style={{ marginTop: '16px' }}>
              <button
                className="primary-btn"
                onClick={() => navigate(topics.length === 0 ? '/pyq' : '/priorities')}
              >
                {topics.length === 0 ? 'Go to PYQ Analysis →' : 'Go to Priorities →'}
              </button>
            </div>
          </div>
        </section>
      </>
    )
  }

  // Har block ka start/end time, plan shuru hone se
  const timeline = blocks.reduce((acc, block) => {
    const start = acc.length > 0 ? acc[acc.length - 1].end : 0
    return [...acc, { ...block, start, end: start + block.minutes }]
  }, [])
  const totalMinutes = timeline.length > 0 ? timeline[timeline.length - 1].end : 0
  const studyMinutes = blocks
    .filter((b) => b.topic !== QUIZ_BLOCK)
    .reduce((sum, b) => sum + b.minutes, 0)
  const topicIdByName = Object.fromEntries(ranked.map((t) => [t.name, t.id]))

  return (
    <>
      {header}

      <section className="dashboard-card">
        <form onSubmit={handleGenerate} className="add-task-form study-form">
          <label className="priority-days-label" htmlFor="study-hours">Hours available</label>
          <input
            id="study-hours"
            type="number"
            min="0.25"
            step="0.25"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="date-input"
            required
          />
          <label className="priority-days-label" htmlFor="study-days-left">Days left</label>
          <input
            id="study-days-left"
            type="number"
            min="0"
            step="1"
            value={daysLeft}
            onChange={(e) => setDaysLeft(e.target.value)}
            className="date-input"
            required
          />
          <button type="submit" className="primary-btn" disabled={isLoading}>
            {isLoading ? 'Planning...' : '✨ Generate Plan'}
          </button>
        </form>

        {error && (
          <div className="doc-answer-error" style={{ marginTop: '16px' }}>❌ {error}</div>
        )}
        {isStale && !isLoading && (
          <p className="doc-filter-note">
            Priorities have changed since this plan was made. Generate again to update it.
          </p>
        )}
      </section>

      {blocks.length > 0 && (
        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon purple">◷</div>
            <div>
              <span>Total Time</span>
              <h2>{formatDuration(totalMinutes)}</h2>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">✓</div>
            <div>
              <span>Study</span>
              <h2>{formatDuration(studyMinutes)}</h2>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon orange">?</div>
            <div>
              <span>Quiz / Recall</span>
              <h2>{formatDuration(totalMinutes - studyMinutes)}</h2>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue">▲</div>
            <div>
              <span>Topics</span>
              <h2>{timeline.filter((b) => b.topic !== QUIZ_BLOCK).length}</h2>
            </div>
          </div>
        </section>
      )}

      <section className="dashboard-card">
        <div className="card-header">
          <div>
            <h2>Plan</h2>
            <p>
              {blocks.length > 0
                ? `${formatDuration(totalMinutes)} · ${studyPlan.daysLeft} days left`
                : 'Enter your hours and generate a plan'}
            </p>
          </div>
        </div>

        {blocks.length === 0 ? (
          <div className="empty-tasks">
            {isLoading ? 'Building your plan...' : 'No plan yet.'}
          </div>
        ) : (
          <div className="schedule-timeline">
            {timeline.map((block, index) => {
              const isQuiz = block.topic === QUIZ_BLOCK
              const color = isQuiz ? '#fbbf24' : '#6d5dfc'
              const topicId = topicIdByName[block.topic]
              return (
                <div className="timeline-item" key={`${block.topic}-${index}`}>
                  <div className="time-col">
                    <div className="time-start">{formatClock(block.start)}</div>
                    <div className="time-end">{formatClock(block.end)}</div>
                  </div>
                  <div className="timeline-line" style={{ backgroundColor: color }}></div>
                  <div className="timeline-content" style={{ borderLeftColor: color }}>
                    <div className="timeline-header">
                      <h3>{block.topic}</h3>
                      <span className="task-category">{formatDuration(block.minutes)}</span>
                    </div>
                    <div className="timeline-details">
                      <span>{block.why}</span>
                    </div>
                    {!isQuiz && topicId && (
                      <button
                        className="ghost-btn small"
                        style={{ marginLeft: 0, marginTop: '10px' }}
                        onClick={() => navigate('/quiz', { state: { topicId } })}
                      >
                        Take quiz →
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}

export default StudyNow
