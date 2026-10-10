import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'

const STUDY_ROUTES = ['/pyq', '/priorities', '/study-now', '/quiz']

// Same routes and labels as before, grouped for the new sidebar
const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/', icon: '⌂', label: 'Dashboard', end: true },
      { to: '/tasks', icon: '✓', label: 'Tasks' },
      { to: '/timetable', icon: '▣', label: 'Timetable' },
      { to: '/attendance', icon: '◉', label: 'Attendance' },
    ],
  },
  {
    label: 'AI tools',
    items: [
      { to: '/ai-assistant', icon: '✦', label: 'AI Assistant' },
      { to: '/email-assistant', icon: '✉', label: 'Email Assistant' },
    ],
  },
  {
    label: 'Exam prep',
    items: [
      { to: '/pyq', icon: '◈', label: 'PYQ Analysis' },
      { to: '/priorities', icon: '▲', label: 'Priorities' },
      { to: '/study-now', icon: '▶', label: 'Study Now' },
      { to: '/quiz', icon: '?', label: 'Quiz' },
    ],
  },
]

function Layout({ context }) {
  const {
    handleLogout,
    studySubjects,
    activeSubjectId,
    selectSubject,
    name,
    email,
    notice,
    dismissNotice,
    dataStatus,
    dataError,
    retryLoad,
  } = context
  const { pathname } = useLocation()
  const [navOpen, setNavOpen] = useState(false)   // mobile drawer
  const showSubjectPicker = STUDY_ROUTES.includes(pathname) && studySubjects.length > 0

  const linkClass = ({ isActive }) => `nav-item${isActive ? ' active' : ''}`
  const closeNav = () => setNavOpen(false)
  const initial = (name || email || 'S').charAt(0).toUpperCase()

  return (
    <div className="dashboard app-shell">
      <aside className={`sidebar${navOpen ? ' open' : ''}`} id="app-sidebar" aria-label="Main navigation">
        <div className="sidebar-logo">
          <div className="logo small-logo">T</div>
          <span>
            TaskMind<span>AI</span>
          </span>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} onClick={closeNav}>
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-profile">
          <div className="sidebar-profile-avatar" aria-hidden="true">{initial}</div>
          <div style={{ minWidth: 0 }}>
            <strong>{name || 'Student'}</strong>
            <span>{email}</span>
          </div>
        </div>

        <button className="logout-btn" onClick={handleLogout}>
          ↪ Logout
        </button>
      </aside>

      <div className={`sidebar-scrim${navOpen ? ' open' : ''}`} onClick={closeNav} aria-hidden="true" />

      <div className="app-content">
        <div className="mobile-topbar">
          <button
            type="button"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? '✕' : '☰'}
          </button>
          <div className="logo small-logo">T</div>
          <span>TaskMindAI</span>
        </div>

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
          <div className="app-alerts">
            {notice && (
              <div className={`app-banner ${notice.type}`} role="alert">
                <span>{notice.text}</span>
                <button type="button" className="app-banner-close" onClick={dismissNotice} aria-label="Dismiss message">✕</button>
              </div>
            )}
            {dataStatus === 'error' && (
              <div className="app-banner error" role="alert">
                <span>{dataError}</span>
                <button type="button" className="app-banner-action" onClick={retryLoad}>Retry</button>
              </div>
            )}
          </div>
          <Outlet context={context} />
        </main>
      </div>
    </div>
  )
}

export default Layout
