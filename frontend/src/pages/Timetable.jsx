import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const COLORS = ['#6d5dfc', '#5ee7a1', '#60a5fa', '#fbbf24', '#f87171', '#a69cff']

function Timetable() {
  const { timetable, addTimetableEntry, deleteTimetableEntry, dataStatus, failedParts, isBusy } = useOutletContext()
  const loading = dataStatus === 'loading'
  const timetableUnavailable = loading || failedParts.includes('timetable')
  const [activeDay, setActiveDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1)
  
  const [showForm, setShowForm] = useState(false)
  const [subject, setSubject] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [room, setRoom] = useState('')
  const [teacher, setTeacher] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await addTimetableEntry({
        day_of_week: activeDay,
        subject,
        start_time: startTime,
        end_time: endTime,
        room,
        teacher,
        color
      })
      // Only a confirmed save clears the form. On failure it stays open and filled (the layout shows what went wrong).
      if (result?.error) return
      setSubject('')
      setStartTime('')
      setEndTime('')
      setRoom('')
      setTeacher('')
      setColor(COLORS[0])
      setShowForm(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Get entries for the active day, sorted by start time
  const dayEntries = timetable
    .filter(entry => entry.day_of_week === activeDay)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-small-title">TIMETABLE</p>
          <h1>Your Timetable</h1>
          <p className="dashboard-subtitle">Manage your weekly class schedule.</p>
        </div>
        <button className="primary-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Class'}
        </button>
      </header>

      {showForm && (
        <section className="dashboard-card form-card">
          <div className="card-header">
            <h2>Add Class for {DAYS[activeDay]}</h2>
          </div>
          <form onSubmit={handleSubmit} className="timetable-form">
            <div className="form-group">
              <input type="text" placeholder="Subject (e.g. Data Structures)" value={subject} onChange={e => setSubject(e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Start Time</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>End Time</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <input type="text" placeholder="Room (optional)" value={room} onChange={e => setRoom(e.target.value)} />
              </div>
              <div className="form-group">
                <input type="text" placeholder="Teacher (optional)" value={teacher} onChange={e => setTeacher(e.target.value)} />
              </div>
            </div>
            <div className="color-picker">
              <label>Color:</label>
              <div className="color-options">
                {COLORS.map(c => (
                  <button 
                    key={c} 
                    type="button" 
                    className={`color-btn ${color === c ? 'selected' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
            <button type="submit" className="primary-btn submit-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Save Class'}
            </button>
          </form>
        </section>
      )}

      <section className="dashboard-card timetable-card">
        <div className="day-tabs">
          {DAYS.map((day, index) => (
            <button 
              key={day} 
              className={`day-tab ${activeDay === index ? 'active' : ''}`}
              onClick={() => setActiveDay(index)}
            >
              {day.substring(0, 3)}
            </button>
          ))}
        </div>

        <div className="timetable-list">
          {timetableUnavailable ? (
            <div className="empty-tasks">{loading ? 'Loading your timetable…' : 'Your timetable could not be loaded. Use Retry above.'}</div>
          ) : dayEntries.length === 0 ? (
            <div className="empty-tasks">No classes scheduled for {DAYS[activeDay]}. Enjoy your day! 🎉</div>
          ) : (
            <div className="schedule-timeline">
              {dayEntries.map((entry) => {
                // Format time: HH:MM:SS to HH:MM
                const start = entry.start_time.substring(0, 5)
                const end = entry.end_time.substring(0, 5)
                
                return (
                  <div className="timeline-item" key={entry.id}>
                    <div className="time-col">
                      <div className="time-start">{start}</div>
                      <div className="time-end">{end}</div>
                    </div>
                    <div className="timeline-line" style={{ backgroundColor: entry.color }}></div>
                    <div className="timeline-content" style={{ borderLeftColor: entry.color }}>
                      <div className="timeline-header">
                        <h3>{entry.subject}</h3>
                        <button className="delete-task" onClick={() => deleteTimetableEntry(entry.id)} disabled={isBusy(`timetable:${entry.id}`)}>🗑</button>
                      </div>
                      <div className="timeline-details">
                        {entry.room && <span>📍 {entry.room}</span>}
                        {entry.teacher && <span>👤 {entry.teacher}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </>
  )
}

export default Timetable