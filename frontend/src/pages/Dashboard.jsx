import { useOutletContext, useNavigate } from 'react-router-dom'

// Dashboard built only from data the app already has: tasks, attendance, timetable and the study state
// (topics / priorities / plan of the active subject). Nothing here is placeholder data.
function Dashboard() {
  const {
    name,
    email,
    tasks,
    newTask,
    setNewTask,
    addTask,
    toggleTask,
    deleteTask,
    timetable,
    subjects,
    topics,
    priorityResult,
    studyPlan,
    studySubjects,
    activeSubjectId,
  } = useOutletContext()
  const navigate = useNavigate()

  const completedTasks = tasks.filter((task) => task.completed).length
  const pendingAll = tasks.filter((task) => !task.completed)
  const pendingTasks = pendingAll.slice(0, 5)

  // Time-of-day greeting
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Today's classes
  const todayDayOfWeek = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
  const todaysSchedule = timetable
    .filter((entry) => entry.day_of_week === todayDayOfWeek)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))

  // Attendance: only a number when classes are actually tracked
  const totalClasses = subjects.reduce((sum, s) => sum + s.total_classes, 0)
  const attendedClasses = subjects.reduce((sum, s) => sum + s.attended_classes, 0)
  const attendancePct = totalClasses === 0 ? null : Math.round((attendedClasses / totalClasses) * 100)

  // Exam prep: the ranking only counts while it still matches the current topics
  const activeSubject = studySubjects.find((s) => s.id === activeSubjectId)
  const ranked = priorityResult && priorityResult.topics === topics ? priorityResult.ranked || [] : []
  const top = ranked[0]
  const hasPlan = Boolean(studyPlan?.blocks?.length)

  let hero
  if (topics.length === 0) {
    hero = {
      eyebrow: 'Exam prep',
      title: 'Turn your past papers into a study plan',
      text: 'Upload previous-year papers and TaskMindAI finds the topics that matter most, ranks them and plans your time.',
      pills: [],
      primary: { label: 'Analyse past papers →', onClick: () => navigate('/pyq') },
      secondary: { label: 'Ask the AI Assistant', onClick: () => navigate('/ai-assistant') },
    }
  } else if (!top) {
    hero = {
      eyebrow: 'Exam prep',
      title: `${topics.length} topic${topics.length === 1 ? '' : 's'} ready${activeSubject ? ` in ${activeSubject.name}` : ''}`,
      text: 'Rank them by how often they appear, how many marks they carry and where you are weakest.',
      pills: [],
      primary: { label: 'Calculate priorities →', onClick: () => navigate('/priorities') },
      secondary: { label: 'Add more papers', onClick: () => navigate('/pyq') },
    }
  } else {
    hero = {
      eyebrow: 'Study next',
      title: top.name,
      text: `Your highest-priority topic${activeSubject ? ` in ${activeSubject.name}` : ''}, based on how often it appears, its marks, your weakness and the time left.`,
      pills: [
        `Priority ${top.priority}`,
        `${top.frequency}/${top.papers_total} papers`,
        `Avg ${top.avg_marks} marks`,
        `Weakness ${top.weakness ?? 50}`,
      ],
      primary: { label: 'Take a quiz →', onClick: () => navigate('/quiz', { state: { topicId: top.id } }) },
      secondary: { label: hasPlan ? 'View study plan' : 'Make a study plan', onClick: () => navigate('/study-now') },
    }
  }

  const steps = [
    { n: 1, title: 'Upload past papers', hint: 'PYQ Analysis', done: topics.length > 0, to: '/pyq' },
    { n: 2, title: 'Rank your topics', hint: 'Priorities', done: ranked.length > 0, to: '/priorities' },
    { n: 3, title: 'Build a study plan', hint: 'Study Now', done: hasPlan, to: '/study-now' },
    { n: 4, title: 'Test yourself', hint: 'Quiz', done: false, to: '/quiz', noState: true },
  ]

  return (
    <>
      <header className="dx-header">
        <div>
          <p className="dashboard-small-title">STUDENT DASHBOARD</p>
          <h1>
            {greeting} {name ? name.split(' ')[0] : ''} 👋
          </h1>
          <p className="dashboard-subtitle">Let's make today productive.</p>
        </div>

        <div className="dx-chip">
          <div className="profile-avatar">{email ? email.charAt(0).toUpperCase() : 'S'}</div>
          <div style={{ minWidth: 0 }}>
            <strong>{name || 'Student'}</strong>
            <span>{email}</span>
          </div>
        </div>
      </header>

      <section className="dx-hero" aria-label="Exam preparation">
        <div>
          <p className="dx-eyebrow">{hero.eyebrow}</p>
          <h2>{hero.title}</h2>
          <p>{hero.text}</p>
          {hero.pills.length > 0 && (
            <div className="dx-hero-meta">
              {hero.pills.map((pill) => (
                <span className="dx-pill" key={pill}>{pill}</span>
              ))}
            </div>
          )}
        </div>
        <div className="dx-hero-actions">
          <button type="button" className="dx-btn dx-btn-light" onClick={hero.primary.onClick}>
            {hero.primary.label}
          </button>
          <button type="button" className="dx-btn dx-btn-ghost" onClick={hero.secondary.onClick}>
            {hero.secondary.label}
          </button>
        </div>
      </section>

      <section className="dx-stats" aria-label="Overview">
        <div className="dx-stat">
          <div className="dx-stat-icon violet">✓</div>
          <div>
            <span>Pending tasks</span>
            <strong>{pendingAll.length}</strong>
            <small>{tasks.length} in total</small>
          </div>
        </div>

        <div className="dx-stat">
          <div className="dx-stat-icon green">✔</div>
          <div>
            <span>Completed</span>
            <strong>{completedTasks}</strong>
            <small>{tasks.length === 0 ? 'No tasks yet' : `of ${tasks.length} tasks`}</small>
          </div>
        </div>

        <div className="dx-stat">
          <div className="dx-stat-icon blue">◷</div>
          <div>
            <span>Attendance</span>
            <strong className={attendancePct !== null && attendancePct < 75 ? 'is-low' : ''}>
              {attendancePct === null ? '—' : `${attendancePct}%`}
            </strong>
            <small>
              {attendancePct === null
                ? 'No classes tracked yet'
                : attendancePct < 75
                  ? 'Below the 75% mark'
                  : `${attendedClasses} of ${totalClasses} classes`}
            </small>
          </div>
        </div>

        <div className="dx-stat">
          <div className="dx-stat-icon amber">◈</div>
          <div>
            <span>Study topics</span>
            <strong>{topics.length}</strong>
            <small>{activeSubject ? activeSubject.name : 'No subject yet'}</small>
          </div>
        </div>
      </section>

      <div className="dx-body">
        <div className="dx-col">
          <section className="dashboard-card">
            <div className="card-header">
              <div>
                <h2>Today's Tasks</h2>
                <p>Stay on top of your work · {pendingAll.length} pending</p>
              </div>
            </div>

            <form onSubmit={addTask} className="add-task-form">
              <input
                type="text"
                placeholder="Add a new task..."
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
              />
              <button type="submit" className="primary-btn">
                + Add Task
              </button>
            </form>

            <div className="task-list">
              {pendingTasks.length === 0 ? (
                <div className="empty-tasks">No pending tasks! 🎉</div>
              ) : (
                pendingTasks.map((task) => (
                  <div className={`task-item ${task.completed ? 'completed' : ''}`} key={task.id}>
                    <div className="task-main-row">
                      <button className="task-check" onClick={() => toggleTask(task)} aria-label="Mark as done">
                        {task.completed ? '✓' : ''}
                      </button>
                      <div className="task-content">
                        <span className="task-title">{task.title}</span>
                        <div className="task-meta">
                          <span className={`priority-badge priority-${task.priority}`}>{task.priority}</span>
                          {task.due_date && (
                            <span className="task-date">📅 {new Date(task.due_date).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <button className="delete-task" onClick={() => deleteTask(task.id)} aria-label="Delete task">
                        🗑
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="ai-banner" onClick={() => navigate('/ai-assistant')} style={{ cursor: 'pointer' }}>
            <div className="ai-content">
              <div className="ai-icon">✦</div>
              <div>
                <p>YOUR AI ASSISTANT</p>
                <h2>Need help with your studies?</h2>
                <span>Chat with AI, ask about your documents, or draft emails.</span>
              </div>
            </div>
            <button
              className="ai-btn"
              onClick={(e) => {
                e.stopPropagation()
                navigate('/ai-assistant')
              }}
            >
              Open AI Assistant →
            </button>
          </div>
        </div>

        <div className="dx-col">
          <section className="dashboard-card">
            <div className="card-header">
              <div>
                <h2>Today's Schedule</h2>
                <p>Stay organized</p>
              </div>
            </div>

            <div className="schedule-list">
              {todaysSchedule.length === 0 ? (
                <div className="dx-empty">No classes today!</div>
              ) : (
                todaysSchedule.map((entry) => (
                  <div className="schedule-item" key={entry.id}>
                    <div className="time" style={{ color: entry.color }}>{entry.start_time.substring(0, 5)}</div>
                    <div className="schedule-line" style={{ backgroundColor: entry.color, opacity: 0.5 }}></div>
                    <div>
                      <strong>{entry.subject}</strong>
                      <span>{entry.room || 'No Room'} • {entry.teacher || 'No Teacher'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="dashboard-card">
            <div className="card-header">
              <div>
                <h2>Study journey</h2>
                <p>From past papers to a tested plan</p>
              </div>
            </div>
            <ol className="dx-steps">
              {steps.map((step) => (
                <li key={step.n}>
                  <button type="button" className={`dx-step${step.done ? ' done' : ''}`} onClick={() => navigate(step.to)}>
                    <span className="dx-step-num">{step.done ? '✓' : step.n}</span>
                    <span>
                      <strong>{step.title}</strong>
                      <small>{step.hint}</small>
                    </span>
                    <span className="dx-step-state">{step.noState ? 'Open →' : step.done ? 'Done' : 'To do'}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  )
}

export default Dashboard
