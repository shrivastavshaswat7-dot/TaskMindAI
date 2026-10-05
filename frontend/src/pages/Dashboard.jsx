import { useOutletContext, useNavigate } from 'react-router-dom'

function Dashboard() {
  const { name, email, tasks, newTask, setNewTask, addTask, toggleTask, deleteTask, timetable, subjects } =
    useOutletContext()
  const navigate = useNavigate()

  const completedTasks = tasks.filter((task) => task.completed).length

  // Dynamic time-of-day greeting
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Get today's classes
  const todayDayOfWeek = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
  const todaysSchedule = timetable
    .filter(entry => entry.day_of_week === todayDayOfWeek)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))

  // Calculate overall attendance
  const totalClasses = subjects.reduce((sum, s) => sum + s.total_classes, 0)
  const attendedClasses = subjects.reduce((sum, s) => sum + s.attended_classes, 0)
  const overallAttendance = totalClasses === 0 ? 100 : Math.round((attendedClasses / totalClasses) * 100)

  // Top 5 pending high-priority tasks for the dashboard
  const pendingTasks = tasks.filter(t => !t.completed).slice(0, 5)

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-small-title">STUDENT DASHBOARD</p>
          <h1>{greeting} {name ? name.split(' ')[0] : ''} 👋</h1>
          <p className="dashboard-subtitle">Let's make today productive.</p>
        </div>

        <div className="profile">
          <div className="profile-avatar">
            {email ? email.charAt(0).toUpperCase() : 'S'}
          </div>
          <div>
            <strong>{name || 'Student'}</strong>
            <span>{email}</span>
          </div>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon purple">✓</div>
          <div>
            <span>Total Tasks</span>
            <h2>{tasks.length}</h2>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">✓</div>
          <div>
            <span>Completed</span>
            <h2>{completedTasks}</h2>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon blue">◷</div>
          <div>
            <span>Attendance</span>
            <h2 style={{ color: overallAttendance < 75 ? '#f87171' : 'inherit' }}>{overallAttendance}%</h2>
          </div>
        </div>

        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/ai-assistant')}>
          <div className="stat-icon orange">✦</div>
          <div>
            <span>AI Assistant</span>
            <h2 style={{ fontSize: '14px', marginTop: '4px', color: '#a69cff' }}>Open →</h2>
          </div>
        </div>
      </section>

      <section className="dashboard-card">
        <div className="card-header">
          <div>
            <h2>Today's Tasks</h2>
            <p>Stay on top of your work · {tasks.filter(t => !t.completed).length} pending</p>
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
              <div
                className={`task-item ${task.completed ? 'completed' : ''}`}
                key={task.id}
              >
                <div className="task-main-row">
                  <button className="task-check" onClick={() => toggleTask(task)}>
                    {task.completed ? '✓' : ''}
                  </button>
                  <div className="task-content">
                    <span className="task-title">{task.title}</span>
                    <div className="task-meta">
                      <span className={`priority-badge priority-${task.priority}`}>
                        {task.priority}
                      </span>
                      {task.due_date && <span className="task-date">📅 {new Date(task.due_date).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <button className="delete-task" onClick={() => deleteTask(task.id)}>
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-card">
          <div className="card-header">
            <div>
              <h2>Today's Schedule</h2>
              <p>Stay organized</p>
            </div>
          </div>

          <div className="schedule-list">
            {todaysSchedule.length === 0 ? (
              <div className="empty-tasks" style={{ padding: '20px' }}>No classes today!</div>
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
        </div>

        <div className="ai-banner" onClick={() => navigate('/ai-assistant')} style={{ cursor: 'pointer' }}>
          <div className="ai-content">
            <div className="ai-icon">✦</div>
            <div>
              <p>YOUR AI ASSISTANT</p>
              <h2>Need help with your studies?</h2>
              <span>Chat with AI, ask about your documents, or draft emails.</span>
            </div>
          </div>
          <button className="ai-btn" onClick={e => { e.stopPropagation(); navigate('/ai-assistant') }}>
            Open AI Assistant →
          </button>
        </div>
      </section>
    </>
  )
}

export default Dashboard