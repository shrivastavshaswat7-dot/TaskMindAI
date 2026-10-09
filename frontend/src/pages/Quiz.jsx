import { useState } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { getPriorities, getQuiz, submitQuiz } from '../api/study'
import { mockQuestions, mockSubmit } from '../api/quizMock'

const isValidQuestion = (q) =>
  q && typeof q.q === 'string' && Array.isArray(q.options) && q.options.length > 0

function Quiz() {
  const { topics, applyTopicWeakness, priorityResult, setPriorityResult } = useOutletContext()
  const navigate = useNavigate()
  const location = useLocation()

  // Study Now se "Take quiz" pe topicId aata hai; warna sabse upar wala ranked topic
  const preferredId = location.state?.topicId
  const defaultId =
    (topics.some((t) => t.id === preferredId) && preferredId) ||
    priorityResult?.ranked?.[0]?.id ||
    topics[0]?.id ||
    ''

  const [topicId, setTopicId] = useState(defaultId)
  const [phase, setPhase] = useState('select') // 'select' | 'question' | 'result'
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([])
  const [current, setCurrent] = useState(0)
  const [isMock, setIsMock] = useState(false)
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const topic = topics.find((t) => t.id === topicId)

  const startQuiz = async () => {
    if (!topic) return
    setIsLoading(true)
    setError('')
    setNotice('')

    let loaded = []
    try {
      const data = await getQuiz(topic.id, topic.name)
      loaded = (data.questions || []).filter(isValidQuestion)
    } catch {
      // Backend na ho toh bhi page chale; neeche mock use hoga
    }

    const useMock = loaded.length === 0
    if (useMock) {
      loaded = mockQuestions(topic.name)
      setNotice('Sample questions — the quiz backend is not connected yet.')
    }

    setIsMock(useMock)
    setQuestions(loaded)
    setAnswers(new Array(loaded.length).fill(null))
    setCurrent(0)
    setResult(null)
    setPhase('question')
    setIsLoading(false)
  }

  const chooseOption = (option) => {
    setAnswers((prev) => prev.map((a, i) => (i === current ? option : a)))
  }

  const handleSubmit = async () => {
    setIsLoading(true)
    setError('')
    try {
      const data = isMock
        ? mockSubmit(questions, answers, topic.weakness ?? 50)
        : await submitQuiz(topic.id, answers, questions, topic.weakness ?? 50)
      setResult(data)
      setPhase('result')
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const updatePriorities = async () => {
    const weakness = Number(result?.updated_weakness)
    // Khaali result (jaise backend stub ka total 0) se weakness overwrite mat karo
    if (!Number.isFinite(weakness) || !(Number(result?.total) > 0)) {
      navigate('/priorities')
      return
    }

    // State + Supabase dono mein weakness update; nayi topics list wapas aati hai
    const updatedTopics = applyTopicWeakness(topic.id, weakness)

    if (priorityResult) {
      setIsLoading(true)
      try {
        const data = await getPriorities(updatedTopics, priorityResult.daysLeft)
        setPriorityResult({
          topics: updatedTopics,
          daysLeft: priorityResult.daysLeft,
          ranked: data.ranked || [],
        })
      } catch {
        // Priorities page "recalculate" note dikhayega
      } finally {
        setIsLoading(false)
      }
    }
    navigate('/priorities')
  }

  const resetQuiz = () => {
    setPhase('select')
    setQuestions([])
    setAnswers([])
    setResult(null)
    setError('')
    setNotice('')
  }

  const header = (
    <header className="dashboard-header">
      <div>
        <p className="dashboard-small-title">QUIZ</p>
        <h1>Topic Quiz</h1>
        <p className="dashboard-subtitle">Test yourself and update how weak each topic is.</p>
      </div>
      {isMock && phase !== 'select' && <span className="priority-badge priority-high">Sample mode</span>}
    </header>
  )

  if (topics.length === 0) {
    return (
      <>
        {header}
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

  if (phase === 'select') {
    return (
      <>
        {header}
        <section className="dashboard-card">
          <div className="card-header">
            <div>
              <h2>Choose a Topic</h2>
              <p>Current weakness is used to rank your priorities</p>
            </div>
          </div>
          <div className="add-task-form study-form">
            <select
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className="priority-select quiz-topic-select"
            >
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (weakness {t.weakness ?? 50})
                </option>
              ))}
            </select>
            <button className="primary-btn" onClick={startQuiz} disabled={isLoading || !topic}>
              {isLoading ? 'Loading quiz...' : 'Start Quiz →'}
            </button>
          </div>
        </section>
      </>
    )
  }

  if (phase === 'question') {
    const question = questions[current]
    const isLast = current === questions.length - 1
    const selected = answers[current]

    return (
      <>
        {header}
        <section className="dashboard-card">
          <div className="card-header">
            <div>
              <h2>{topic?.name}</h2>
              <p>
                Question {current + 1} of {questions.length}
                {question.subtopic ? ` · ${question.subtopic}` : ''}
              </p>
            </div>
          </div>

          {notice && <p className="doc-filter-note">{notice}</p>}

          <p className="quiz-question">{question.q}</p>
          <div className="quiz-options">
            {question.options.map((option, i) => (
              <button
                key={`${i}-${option}`}
                type="button"
                className={`quiz-option ${selected === option ? 'selected' : ''}`}
                onClick={() => chooseOption(option)}
              >
                {option}
              </button>
            ))}
          </div>

          {error && (
            <div className="doc-answer-error" style={{ marginTop: '16px' }}>❌ {error}</div>
          )}

          <div className="quiz-actions">
            <button className="ghost-btn" onClick={resetQuiz} disabled={isLoading}>
              Cancel
            </button>
            {isLast ? (
              <button className="primary-btn" onClick={handleSubmit} disabled={!selected || isLoading}>
                {isLoading ? 'Submitting...' : 'Submit Quiz'}
              </button>
            ) : (
              <button className="primary-btn" onClick={() => setCurrent(current + 1)} disabled={!selected}>
                Next →
              </button>
            )}
          </div>
        </section>
      </>
    )
  }

  // phase === 'result'
  const total = Number(result?.total) || 0
  const score = Number(result?.score) || 0
  const percent = total > 0 ? Math.round((score / total) * 100) : 0
  const weakSubtopics = Array.isArray(result?.weak_subtopics) ? result.weak_subtopics : []

  return (
    <>
      {header}
      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon green">✓</div>
          <div>
            <span>Score</span>
            <h2>{score} / {total}</h2>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">%</div>
          <div>
            <span>Accuracy</span>
            <h2>{percent}%</h2>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">▲</div>
          <div>
            <span>Weakness</span>
            <h2>{topic?.weakness ?? 50} → {result?.updated_weakness ?? '—'}</h2>
          </div>
        </div>
      </section>

      <section className="dashboard-card">
        <div className="card-header">
          <div>
            <h2>{topic?.name}</h2>
            <p>{isMock ? 'Result from sample questions' : 'Quiz result'}</p>
          </div>
        </div>

        <h3 className="quiz-subheading">Weak subtopics</h3>
        {weakSubtopics.length === 0 ? (
          <div className="empty-tasks">No weak subtopics. Great job! 🎉</div>
        ) : (
          <div className="task-meta">
            {weakSubtopics.map((s) => (
              <span key={s} className="priority-badge priority-urgent">{s}</span>
            ))}
          </div>
        )}

        <div className="quiz-actions">
          <button className="ghost-btn" onClick={resetQuiz} disabled={isLoading}>
            Try another topic
          </button>
          <button className="ai-btn" onClick={updatePriorities} disabled={isLoading}>
            {isLoading ? 'Updating...' : 'Update Priorities'}
          </button>
        </div>
      </section>
    </>
  )
}

export default Quiz
