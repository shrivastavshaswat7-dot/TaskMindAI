import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

function Attendance() {
  const { subjects, addSubject, deleteSubject, markAttendance, attendanceRecords, dataStatus, failedParts, isBusy } = useOutletContext()
  const loading = dataStatus === 'loading'
  const subjectsUnavailable = loading || failedParts.includes('attendance subjects') || failedParts.includes('attendance records')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [activeDate, setActiveDate] = useState(new Date().toISOString().split('T')[0]) // YYYY-MM-DD

  const handleAddSubject = async (e) => {
    e.preventDefault()
    if (!newSubject.trim()) return
    const result = await addSubject(newSubject.trim())
    if (result?.error) return          // keep the form and the typed name; the layout shows what went wrong
    setNewSubject('')
    setShowAddForm(false)
  }

  // Calculate percentage
  const getPercentage = (subject) => {
    if (subject.total_classes === 0) return 100
    return Math.round((subject.attended_classes / subject.total_classes) * 100)
  }

  // Calculate classes that can be missed to stay >= 75%
  const getMissableClasses = (subject) => {
    if (subject.total_classes === 0) return 0
    const x = Math.floor((subject.attended_classes - 0.75 * subject.total_classes) / 0.75)
    return Math.max(0, x)
  }

  // Classes needed to reach 75%
  const getClassesNeeded = (subject) => {
    if (subject.total_classes === 0) return 0
    const y = Math.ceil(3 * subject.total_classes - 4 * subject.attended_classes)
    return Math.max(0, y)
  }

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-small-title">ATTENDANCE</p>
          <h1>Your Attendance</h1>
          <p className="dashboard-subtitle">Track your classes and maintain a 75% attendance record.</p>
        </div>
        <button className="primary-btn" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Subject'}
        </button>
      </header>

      {showAddForm && (
        <section className="dashboard-card form-card">
          <div className="card-header">
            <h2>Add Subject</h2>
          </div>
          <form onSubmit={handleAddSubject} className="add-task-form">
            <input 
              type="text" 
              placeholder="Subject Name (e.g. Operating Systems)" 
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              required
            />
            <button type="submit" className="primary-btn" disabled={isBusy('addSubject')}>Save</button>
          </form>
        </section>
      )}

      <div className="attendance-date-picker dashboard-card">
        <label>Mark attendance for: </label>
        <input 
          type="date" 
          value={activeDate}
          onChange={(e) => setActiveDate(e.target.value)}
          className="date-input"
        />
      </div>

      <section className="attendance-grid">
        {subjectsUnavailable ? (
          <div className="empty-tasks dashboard-card" style={{ gridColumn: '1 / -1' }}>{loading ? 'Loading your attendance…' : 'Your attendance could not be loaded. Use Retry above.'}</div>
        ) : subjects.length === 0 ? (
          <div className="empty-tasks dashboard-card" style={{ gridColumn: '1 / -1' }}>No subjects added yet. Add a subject to start tracking attendance!</div>
        ) : (
          subjects.map((subject) => {
            const percentage = getPercentage(subject)
            const isDanger = percentage < 75
            
            // Check if already marked for active date
            const record = attendanceRecords.find(r => r.subject_id === subject.id && r.date === activeDate)

            return (
              <div className={`dashboard-card attendance-card ${isDanger ? 'danger' : ''}`} key={subject.id}>
                <div className="attendance-card-header">
                  <h3>{subject.name}</h3>
                  <button className="delete-task" onClick={() => deleteSubject(subject.id)}>🗑</button>
                </div>

                <div className="attendance-stats">
                  <div className="progress-circle">
                    <svg viewBox="0 0 36 36" className={`circular-chart ${isDanger ? 'red' : 'green'}`}>
                      <path className="circle-bg"
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path className="circle"
                        strokeDasharray={`${percentage}, 100`}
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <text x="18" y="20.35" className="percentage">{percentage}%</text>
                    </svg>
                  </div>
                  <div className="stats-text">
                    <p><strong>{subject.attended_classes}</strong> / {subject.total_classes} classes</p>
                    {isDanger ? (
                      <p className="status-danger">⚠️ Need {getClassesNeeded(subject)} more classes</p>
                    ) : (
                      <p className="status-safe">✅ Can miss {getMissableClasses(subject)} classes</p>
                    )}
                  </div>
                </div>

                <div className="attendance-actions">
                  {record ? (
                    <div className="already-marked">
                      Marked as: <strong className={`status-${record.status}`}>{record.status}</strong>
                    </div>
                  ) : (
                    <>
                      <button className="btn-present" disabled={isBusy(`attendance:${subject.id}`)} onClick={() => markAttendance(subject.id, activeDate, 'present')}>Present</button>
                      <button className="btn-absent" disabled={isBusy(`attendance:${subject.id}`)} onClick={() => markAttendance(subject.id, activeDate, 'absent')}>Absent</button>
                      <button className="btn-cancelled" disabled={isBusy(`attendance:${subject.id}`)} onClick={() => markAttendance(subject.id, activeDate, 'cancelled')}>Cancelled</button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </section>
    </>
  )
}

export default Attendance