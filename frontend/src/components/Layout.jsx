import { Outlet, NavLink, useLocation } from 'react-router-dom'

const STUDY_ROUTES = ['/pyq', '/priorities', '/study-now', '/quiz']

function Layout({ context }) {
  const { handleLogout, studySubjects, activeSubjectId, selectSubject } = context
  const { pathname } = useLocation()
  const showSubjectPicker = STUDY_ROUTES.includes(pathname) && studySubjects.length > 0

  const linkClass = ({ isActive }) =>
    `nav-item${isActive ? ' active' : ''}`

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo small-logo">T</div>
          <span>
            TaskMind<span>AI</span>
          </span>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end className={linkClass}>
            <span>⌂</span>
            Dashboard
          </NavLink>
          <NavLink to="/tasks" className={linkClass}>
            <span>✓</span>
            Tasks
          </NavLink>
          <NavLink to="/timetable" className={linkClass}>
            <span>▣</span>
            Timetable
          </NavLink>
          <NavLink to="/attendance" className={linkClass}>
            <span>◉</span>
            Attendance
          </NavLink>
          <NavLink to="/ai-assistant" className={linkClass}>
            <span>✦</span>
            AI Assistant
          </NavLink>
          <NavLink to="/email-assistant" className={linkClass}>
            <span>✉</span>
            Email Assistant
          </NavLink>
          <NavLink to="/pyq" className={linkClass}>
            <span>◈</span>
            PYQ Analysis
          </NavLink>
          <NavLink to="/priorities" className={linkClass}>
            <span>▲</span>
            Priorities
          </NavLink>
          <NavLink to="/study-now" className={linkClass}>
            <span>▶</span>
            Study Now
          </NavLink>
          <NavLink to="/quiz" className={linkClass}>
            <span>?</span>
            Quiz
          </NavLink>
        </nav>

        <button className="logout-btn" onClick={handleLogout}>
          ↪ Logout
        </button>
      </aside>

      <main className="dashboard-main">
        {showSubjectPicker && (
          <div className="add-task-form study-form" style={{ marginBottom: '16px' }}>
            <label className="priority-days-label" htmlFor="study-subject">Subject</label>
            <select
              id="study-subject"
              className="priority-select"
              value={activeSubjectId}
              onChange={(e) => selectSubject(e.target.value)}
            >
              {studySubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.unsaved ? ' (not saved)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <Outlet context={context} />
      </main>
    </div>
  )
}

export default Layout