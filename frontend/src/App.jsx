import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabase'
import Layout from './components/Layout'
import { apiJson } from './api/authFetch'
import { userMessage } from './api/errors'
import { ensureSubject, loadStudyData, saveTopics, saveWeakness } from './api/studyDb'
import { clampWeakness, keepIfEqual, normalizeSubjectName, pickActiveSubjectId } from './api/studyMapping'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Timetable from './pages/Timetable'
import Attendance from './pages/Attendance'
import AiAssistant from './pages/AiAssistant'
import EmailAssistant from './pages/EmailAssistance'
import PyqAnalysis from './pages/PyqAnalysis'
import Priorities from './pages/Priorities'
import StudyNow from './pages/StudyNow'
import Quiz from './pages/Quiz'
import './App.css'
import './theme.css'

const NO_TOPICS = []

// Uncompleted first, then by AI priority score (high first), then newest first
const compareTasks = (a, b) => {
  if (a.completed !== b.completed) return a.completed ? 1 : -1
  if (a.ai_priority_score != null && b.ai_priority_score != null) return b.ai_priority_score - a.ai_priority_score
  return new Date(b.created_at) - new Date(a.created_at)
}
const ACTIVE_SUBJECT_KEY = 'taskmind.activeStudySubject'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const [tasks, setTasks] = useState([])
  const [newTask, setNewTask] = useState('')
  const [newTaskDue, setNewTaskDue] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState('medium')
  const [newTaskCategory, setNewTaskCategory] = useState('general')
  const [isPrioritizing, setIsPrioritizing] = useState(false)

  // Loading of the user's data: 'loading' until the first load has finished, 'error' if any part failed.
  // Pages must not show "no tasks yet" style empty states for either of those.
  const [dataStatus, setDataStatus] = useState('loading')
  const [dataError, setDataError] = useState('')
  const [failedParts, setFailedParts] = useState([])
  // Message for the user when an action failed (rendered by the layout, dismissible)
  const [notice, setNotice] = useState(null)
  // Actions currently running: a second click on the same action is ignored instead of submitting twice
  const busyRef = useRef(new Set())
  const [busyKeys, setBusyKeys] = useState([])

  const [timetable, setTimetable] = useState([])
  const [subjects, setSubjects] = useState([])
  const [attendanceRecords, setAttendanceRecords] = useState([])

  // PYQ topics, subject ke hisaab se (Supabase `study_topics` mein saved). `topics` neeche active subject ke hain.
  const [studySubjects, setStudySubjects] = useState([])
  const [activeSubjectId, setActiveSubjectId] = useState('')
  const [topicsBySubject, setTopicsBySubject] = useState({})
  // /api/priorities ka result: { topics, daysLeft, ranked }. `topics` se pata chalta hai result purana toh nahi.
  const [priorityResult, setPriorityResult] = useState(null)
  // /api/plan ka result: { ranked, hours, daysLeft, blocks }
  const [studyPlan, setStudyPlan] = useState(null)

  const noticeTimer = useRef(null)
  const dismissNotice = () => {
    clearTimeout(noticeTimer.current)
    setNotice(null)
  }
  // Shown by the layout; goes away by itself after a while (or when dismissed)
  const reportError = (text) => {
    clearTimeout(noticeTimer.current)
    setNotice({ id: Date.now(), type: 'error', text })
    noticeTimer.current = setTimeout(() => setNotice(null), 12000)
  }
  const isBusy = (key) => busyKeys.includes(key)
  const runOnce = async (key, action) => {
    if (busyRef.current.has(key)) return undefined
    busyRef.current.add(key)
    setBusyKeys([...busyRef.current])
    try {
      return await action()
    } finally {
      busyRef.current.delete(key)
      setBusyKeys([...busyRef.current])
    }
  }

  const loadTasks = async (userId) => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading tasks:', error)
      return 'tasks'
    }

    // Sort: uncompleted first, then by priority score (desc), then by creation date
    const sortedData = (data || []).sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      if (a.ai_priority_score != null && b.ai_priority_score != null) {
        return b.ai_priority_score - a.ai_priority_score
      }
      return new Date(b.created_at) - new Date(a.created_at)
    })

    setTasks(sortedData)
  }

  const loadTimetable = async (userId) => {
    const { data, error } = await supabase
      .from('timetable_entries')
      .select('*')
      .eq('user_id', userId)

    if (error) {
      console.error('Error loading timetable:', error)
      return 'timetable'
    }
    setTimetable(data || [])
  }

  const loadSubjects = async (userId) => {
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error loading subjects:', error)
      return 'attendance subjects'
    }
    setSubjects(data || [])
  }



  const loadAttendance = async (userId) => {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('user_id', userId)

    if (error) {
      console.error('Error loading attendance records:', error)
      return 'attendance records'
    }
    setAttendanceRecords(data || [])
  }

  const loadStudy = async (userId) => {
    try {
      const { subjects: loaded, topicsBySubject: grouped } = await loadStudyData(userId)
      let remembered = ''
      try {
        remembered = localStorage.getItem(ACTIVE_SUBJECT_KEY) || ''
      } catch {
        // private mode: koi baat nahi
      }
      // Auth event (jaise tab refocus) pe dobara load hota hai: jo badla nahi uska reference na badlo,
      // current subject na badlo, aur "not saved" local subjects/topics na mitao.
      setStudySubjects((prev) =>
        keepIfEqual(prev, [...loaded, ...prev.filter((s) => s.unsaved && !loaded.some((l) => l.id === s.id))])
      )
      setTopicsBySubject((prev) => {
        const localOnly = Object.fromEntries(Object.entries(prev).filter(([id]) => id.startsWith('local:')))
        return keepIfEqual(prev, { ...grouped, ...localOnly })
      })
      setActiveSubjectId((current) => pickActiveSubjectId(loaded, current, remembered) || current)
    } catch (error) {
      // Migration (backend/migrations/study_topics.sql) apply na hui ho toh bhi app chalna chahiye
      console.error('Error loading study topics:', error)
      return 'study topics'
    }
    return null
  }

  // Each loader returns the name of what it could not load (or nothing). A failed load must be visible: showing an
  // empty list would look like "you have no tasks" when the truth is "we could not load them".
  const loadAllData = async (userId) => {
    const results = await Promise.all([
      loadTasks(userId),
      loadTimetable(userId),
      loadSubjects(userId),
      loadAttendance(userId),
      loadStudy(userId)
    ])
    const failed = results.filter(Boolean)
    setFailedParts(failed)
    setDataError(failed.length ? `Could not load your ${failed.join(', ')}. What you see may be incomplete.` : '')
    setDataStatus(failed.length ? 'error' : 'ready')
  }

  const retryLoad = async () => {
    setDataStatus('loading')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setDataError('You are not signed in. Please log in again.')
      setDataStatus('error')
      return
    }
    await loadAllData(user.id)
  }

  // Sab user-specific data hatao (logout button ya expired session, dono pe), taaki agla user purana data na dekhe
  const clearUserData = () => {
    setDataStatus('loading')
    setDataError('')
    setFailedParts([])
    setNotice(null)
    setTasks([])
    setTimetable([])
    setSubjects([])
    setAttendanceRecords([])
    setStudySubjects([])
    setActiveSubjectId('')
    setTopicsBySubject({})
    setPriorityResult(null)
    setStudyPlan(null)
    setEmail('')
    setName('')
  }

  useEffect(() => {
    if (window.location.hash.includes('type=recovery')) {
      setIsRecoveryMode(true)
    }

    const getSession = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error(error)
        return
      }

      if (data.session && !window.location.hash.includes('type=recovery')) {
        const user = data.session.user

        setIsLoggedIn(true)
        setEmail(user.email || '')
        setName(user.user_metadata?.name || '')

        loadAllData(user.id)
      }
    }

    getSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true)
        setIsLoggedIn(false)
        return
      }

      if (!window.location.hash.includes('type=recovery')) {
        setIsLoggedIn(!!session)

        if (!session) clearUserData()

        if (session) {
          const user = session.user

          setEmail(user.email || '')
          setName(user.user_metadata?.name || '')

          loadAllData(user.id)
        }
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const addTask = async (e) => {
    e.preventDefault()
    if (!newTask.trim()) return

    await runOnce('addTask', async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        reportError('Your session has expired. Please log in again.')
        return
      }

      const { data, error } = await supabase
        .from('tasks')
        .insert([
          {
            user_id: user.id,
            title: newTask.trim(),
            completed: false,
            due_date: newTaskDue || null,
            priority: newTaskPriority,
            category: newTaskCategory,
          },
        ])
        .select()
        .single()

      if (error) {
        console.error('Error adding task:', error)
        reportError('Could not add the task. What you typed is still there, so you can try again.')
        return
      }

      setTasks((prev) => [data, ...prev].sort(compareTasks))
      setNewTask('')
      setNewTaskDue('')
      setNewTaskPriority('medium')
      setNewTaskCategory('general')
    })
  }

  const toggleTask = async (task) => {
    await runOnce(`task:${task.id}`, async () => {
      const { data, error } = await supabase
        .from('tasks')
        .update({ completed: !task.completed })
        .eq('id', task.id)
        .select()
        .single()

      if (error) {
        console.error('Error updating task:', error)
        reportError('Could not update the task. Please try again.')
        return
      }

      setTasks((prev) => prev.map((item) => (item.id === task.id ? data : item)))
    })
  }

  const deleteTask = async (taskId) => {
    await runOnce(`task:${taskId}`, async () => {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId)

      if (error) {
        console.error('Error deleting task:', error)
        reportError('Could not delete the task. Please try again.')
        return
      }

      setTasks((prev) => prev.filter((task) => task.id !== taskId))
    })
  }

  const prioritizeTasks = async () => {
    if (isPrioritizing) return
    setIsPrioritizing(true)
    try {
      const { prioritized_tasks } = await apiJson('/api/tasks/prioritize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks }),
      })
      if (!prioritized_tasks || prioritized_tasks.length === 0) {
        reportError('The AI did not return any priorities. Please try again.')
        return
      }

      const updatedTasks = [...tasks]
      let notSaved = 0

      for (const pt of prioritized_tasks) {
        const { error } = await supabase
          .from('tasks')
          .update({
            ai_priority_score: pt.ai_priority_score,
            ai_priority_reason: pt.ai_priority_reason,
            priority: pt.suggested_priority,
          })
          .eq('id', pt.id)

        if (error) {
          notSaved += 1
          continue
        }
        const taskIndex = updatedTasks.findIndex((t) => t.id === pt.id)
        if (taskIndex !== -1) {
          updatedTasks[taskIndex] = {
            ...updatedTasks[taskIndex],
            ai_priority_score: pt.ai_priority_score,
            ai_priority_reason: pt.ai_priority_reason,
            priority: pt.suggested_priority,
          }
        }
      }

      if (notSaved > 0) {
        reportError(`The AI ranked your tasks, but ${notSaved} of them could not be saved, so those keep their old priority.`)
      }
      setTasks(updatedTasks.sort(compareTasks))
    } catch (err) {
      console.error('Error prioritizing tasks:', err)
      reportError(userMessage(err))
    } finally {
      setIsPrioritizing(false)
    }
  }

  // The timetable / attendance actions return { data } or { error } so the page can keep the user's input on failure
  const addTimetableEntry = async (entry) => {
    const result = await runOnce('addTimetableEntry', async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        reportError('Your session has expired. Please log in again.')
        return { error: new Error('not signed in') }
      }

      const { data, error } = await supabase
        .from('timetable_entries')
        .insert([{ ...entry, user_id: user.id }])
        .select()
        .single()

      if (error) {
        console.error('Error adding timetable entry:', error)
        reportError('Could not add the class. What you entered is still in the form, so you can try again.')
        return { error }
      }

      setTimetable((prev) => [...prev, data])
      return { data }
    })
    return result ?? { error: new Error('already saving') }
  }

  const deleteTimetableEntry = async (id) => {
    await runOnce(`timetable:${id}`, async () => {
      const { error } = await supabase.from('timetable_entries').delete().eq('id', id)

      if (error) {
        console.error('Error deleting timetable entry:', error)
        reportError('Could not delete the class. Please try again.')
        return
      }

      setTimetable((prev) => prev.filter((entry) => entry.id !== id))
    })
  }

  const addSubject = async (name, totalClasses = 0, attendedClasses = 0) => {
    const result = await runOnce('addSubject', async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        reportError('Your session has expired. Please log in again.')
        return { error: new Error('not signed in') }
      }

      const { data, error } = await supabase
        .from('subjects')
        .insert([{ name, total_classes: totalClasses, attended_classes: attendedClasses, user_id: user.id }])
        .select()
        .single()

      if (error) {
        console.error('Error adding subject:', error)
        reportError('Could not add the subject. What you typed is still there, so you can try again.')
        return { error }
      }

      setSubjects((prev) => [...prev, data])
      return { data }
    })
    return result ?? { error: new Error('already saving') }
  }

  const deleteSubject = async (id) => {
    await runOnce(`subject:${id}`, async () => {
      const { error } = await supabase.from('subjects').delete().eq('id', id)

      if (error) {
        console.error('Error deleting subject:', error)
        reportError('Could not delete the subject. Please try again.')
        return
      }

      setSubjects((prev) => prev.filter((s) => s.id !== id))
      // Also remove related attendance records from local state
      setAttendanceRecords((prev) => prev.filter((r) => r.subject_id !== id))
    })
  }

  // One mark = one attendance record + the subject's totals. Both must succeed: if the totals cannot be updated the
  // record is removed again, so the screen never shows a mark that would disappear (or double count) on reload.
  const markAttendance = async (subjectId, date, status) => {
    const result = await runOnce(`attendance:${subjectId}`, async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        reportError('Your session has expired. Please log in again.')
        return { error: new Error('not signed in') }
      }

      const { data, error } = await supabase
        .from('attendance_records')
        .insert([{ subject_id: subjectId, date, status, user_id: user.id }])
        .select()
        .single()

      if (error) {
        console.error('Error marking attendance:', error)
        reportError('Could not save the attendance mark. Please try again.')
        return { error }
      }

      const subject = subjects.find((s) => s.id === subjectId)
      if (subject) {
        const newTotal = status !== 'cancelled' ? subject.total_classes + 1 : subject.total_classes
        const newAttended = status === 'present' ? subject.attended_classes + 1 : subject.attended_classes

        if (newTotal !== subject.total_classes || newAttended !== subject.attended_classes) {
          const { error: totalsError } = await supabase
            .from('subjects')
            .update({ total_classes: newTotal, attended_classes: newAttended })
            .eq('id', subjectId)

          if (totalsError) {
            console.error('Error updating attendance totals:', totalsError)
            await supabase.from('attendance_records').delete().eq('id', data.id)   // best effort: undo the record
            reportError('Could not update the attendance total, so this mark was not saved. Please try again.')
            return { error: totalsError }
          }

          setSubjects((prev) => prev.map((s) => (s.id === subjectId ? { ...s, total_classes: newTotal, attended_classes: newAttended } : s)))
        }
      }

      setAttendanceRecords((prev) => [...prev, data])
      return { data }
    })
    return result ?? { error: new Error('already saving') }
  }

  const topics = topicsBySubject[activeSubjectId] || NO_TOPICS

  const activateSubject = (subjectId) => {
    setActiveSubjectId(subjectId)
    // Ranking/plan purane topics ke the
    setPriorityResult(null)
    setStudyPlan(null)
    try {
      localStorage.setItem(ACTIVE_SUBJECT_KEY, subjectId)
    } catch {
      // ignore
    }
  }

  const selectSubject = (subjectId) => {
    if (subjectId !== activeSubjectId) activateSubject(subjectId)
  }

  // /api/extract ke topics ko subject mein save karo. Wahi PDFs dobara dene par duplicate nahi banta
  // (unique user+subject+topic) aur purani weakness bachi rehti hai.
  // Save fail ho toh topics is session ke liye dikhte hain, aur error wapas milta hai.
  const saveExtractedTopics = async (subjectName, extracted) => {
    const name = normalizeSubjectName(subjectName)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    let subject
    let list = extracted
    let error = null
    try {
      if (!user) throw new Error('Not signed in')
      subject = await ensureSubject(user.id, name, studySubjects.filter((s) => !s.unsaved))
      list = await saveTopics(user.id, subject.id, extracted)
    } catch (err) {
      console.error('Error saving topics:', err)
      error = err
      subject =
        studySubjects.find((s) => s.name.toLowerCase() === name.toLowerCase()) ||
        { id: `local:${name.toLowerCase()}`, name, unsaved: true }
    }

    setStudySubjects((prev) => (prev.some((s) => s.id === subject.id) ? prev : [...prev, subject]))
    setTopicsBySubject((prev) => ({ ...prev, [subject.id]: list }))
    activateSubject(subject.id)
    return { subject, error }
  }

  // Quiz ke baad ek topic ki weakness badlo. Nayi topic list wapas deti hai (priorities dobara nikalne ke liye),
  // aur Supabase mein save karti hai (fail ho toh sirf console error; UI state phir bhi update rehti hai).
  const applyTopicWeakness = (topicId, weakness) => {
    const value = clampWeakness(weakness)
    if (value === null) return topics
    const updated = topics.map((t) => (t.id === topicId ? { ...t, weakness: value } : t))
    setTopicsBySubject((prev) => ({ ...prev, [activeSubjectId]: updated }))

    if (!String(activeSubjectId).startsWith('local:')) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          saveWeakness(user.id, activeSubjectId, topicId, value).catch((error) => {
            console.error('Error saving weakness:', error)
            reportError('The new weakness score could not be saved, so it will be back to the old value after a reload.')
          })
        }
      })
    }
    return updated
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()

    setIsLoggedIn(false)
    clearUserData()
  }

  if (!isLoggedIn || isRecoveryMode) {
    return (
      <Auth
        setIsLoggedIn={setIsLoggedIn}
        setName={setName}
        setEmail={setEmail}
        loadData={loadAllData}
        initialMode={isRecoveryMode ? 'reset' : 'login'}
        onRecoveryComplete={() => {
          setIsRecoveryMode(false)
          setIsLoggedIn(true)
        }}
      />
    )
  }

  const outletContext = {
    name,
    email,
    tasks,
    newTask,
    setNewTask,
    newTaskDue,
    setNewTaskDue,
    newTaskPriority,
    setNewTaskPriority,
    newTaskCategory,
    setNewTaskCategory,
    addTask,
    toggleTask,
    deleteTask,
    prioritizeTasks,
    isPrioritizing,
    timetable,
    addTimetableEntry,
    deleteTimetableEntry,
    subjects,
    attendanceRecords,
    addSubject,
    deleteSubject,
    markAttendance,
    topics,
    studySubjects,
    activeSubjectId,
    selectSubject,
    saveExtractedTopics,
    applyTopicWeakness,
    priorityResult,
    setPriorityResult,
    studyPlan,
    setStudyPlan,
    handleLogout,
    dataStatus,
    dataError,
    failedParts,
    retryLoad,
    notice,
    dismissNotice,
    reportError,
    isBusy,
  }

  return (
    <Routes>
      <Route element={<Layout context={outletContext} />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/timetable" element={<Timetable />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/ai-assistant" element={<AiAssistant />} />
        <Route path="/email-assistant" element={<EmailAssistant />} />
        <Route path="/pyq" element={<PyqAnalysis />} />
        <Route path="/priorities" element={<Priorities />} />
        <Route path="/study-now" element={<StudyNow />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App