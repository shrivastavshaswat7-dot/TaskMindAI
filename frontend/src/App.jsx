import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabase'
import Layout from './components/Layout'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Timetable from './pages/Timetable'
import Attendance from './pages/Attendance'
import AiAssistant from './pages/AiAssistant'
import EmailAssistant from './pages/EmailAssistance'
import './App.css'

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

  const [timetable, setTimetable] = useState([])
  const [subjects, setSubjects] = useState([])
  const [attendanceRecords, setAttendanceRecords] = useState([])

  const loadTasks = async (userId) => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading tasks:', error)
      return
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
      return
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
      return
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
      return
    }
    setAttendanceRecords(data || [])
  }

  const loadAllData = async (userId) => {
    await Promise.all([
      loadTasks(userId),
      loadTimetable(userId),
      loadSubjects(userId),
      loadAttendance(userId)
    ])
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

    if (!newTask.trim()) {
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
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
      return
    }

    setTasks((prev) => [data, ...prev].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      if (a.ai_priority_score != null && b.ai_priority_score != null) {
        return b.ai_priority_score - a.ai_priority_score
      }
      return new Date(b.created_at) - new Date(a.created_at)
    }))
    setNewTask('')
    setNewTaskDue('')
    setNewTaskPriority('medium')
    setNewTaskCategory('general')
  }

  const toggleTask = async (task) => {
    const { data, error } = await supabase
      .from('tasks')
      .update({ completed: !task.completed })
      .eq('id', task.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating task:', error)
      return
    }

    setTasks((prev) =>
      prev.map((item) => (item.id === task.id ? data : item))
    )
  }

  const deleteTask = async (taskId) => {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)

    if (error) {
      console.error('Error deleting task:', error)
      return
    }

    setTasks((prev) => prev.filter((task) => task.id !== taskId))
  }

  const prioritizeTasks = async () => {
    setIsPrioritizing(true)
    try {
      const response = await fetch('/api/tasks/prioritize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks }),
      })
      if (!response.ok) throw new Error('Prioritization failed')
      
      const { prioritized_tasks } = await response.json()
      if (!prioritized_tasks || prioritized_tasks.length === 0) return

      const updatedTasks = [...tasks]
      
      for (const pt of prioritized_tasks) {
        const { error } = await supabase
          .from('tasks')
          .update({
            ai_priority_score: pt.ai_priority_score,
            ai_priority_reason: pt.ai_priority_reason,
            priority: pt.suggested_priority,
          })
          .eq('id', pt.id)

        if (!error) {
          const taskIndex = updatedTasks.findIndex(t => t.id === pt.id)
          if (taskIndex !== -1) {
            updatedTasks[taskIndex] = {
              ...updatedTasks[taskIndex],
              ai_priority_score: pt.ai_priority_score,
              ai_priority_reason: pt.ai_priority_reason,
              priority: pt.suggested_priority,
            }
          }
        }
      }
      
      updatedTasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        if (a.ai_priority_score != null && b.ai_priority_score != null) {
           return b.ai_priority_score - a.ai_priority_score
        }
        return new Date(b.created_at) - new Date(a.created_at)
      })
      
      setTasks(updatedTasks)
    } catch (err) {
      console.error('Error prioritizing tasks:', err)
    } finally {
      setIsPrioritizing(false)
    }
  }

  const addTimetableEntry = async (entry) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('timetable_entries')
      .insert([{ ...entry, user_id: user.id }])
      .select()
      .single()

    if (error) {
      console.error('Error adding timetable entry:', error)
      return { error }
    }

    setTimetable((prev) => [...prev, data])
    return { data }
  }

  const deleteTimetableEntry = async (id) => {
    const { error } = await supabase
      .from('timetable_entries')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting timetable entry:', error)
      return
    }

    setTimetable((prev) => prev.filter((entry) => entry.id !== id))
  }



  const addSubject = async (name, totalClasses = 0, attendedClasses = 0) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('subjects')
      .insert([{ name, total_classes: totalClasses, attended_classes: attendedClasses, user_id: user.id }])
      .select()
      .single()

    if (error) {
      console.error('Error adding subject:', error)
      return { error }
    }

    setSubjects((prev) => [...prev, data])
    return { data }
  }

  const deleteSubject = async (id) => {
    const { error } = await supabase
      .from('subjects')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting subject:', error)
      return
    }

    setSubjects((prev) => prev.filter((s) => s.id !== id))
    // Also remove related attendance records from local state
    setAttendanceRecords((prev) => prev.filter((r) => r.subject_id !== id))
  }

  const markAttendance = async (subjectId, date, status) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('attendance_records')
      .insert([{ subject_id: subjectId, date, status, user_id: user.id }])
      .select()
      .single()

    if (error) {
      console.error('Error marking attendance:', error)
      return { error }
    }

    setAttendanceRecords((prev) => [...prev, data])

    // Update subject stats locally and on server
    const subject = subjects.find(s => s.id === subjectId)
    if (subject) {
      const newTotal = status !== 'cancelled' ? subject.total_classes + 1 : subject.total_classes
      const newAttended = status === 'present' ? subject.attended_classes + 1 : subject.attended_classes

      if (newTotal !== subject.total_classes || newAttended !== subject.attended_classes) {
        await supabase
          .from('subjects')
          .update({ total_classes: newTotal, attended_classes: newAttended })
          .eq('id', subjectId)

        setSubjects((prev) => prev.map(s => s.id === subjectId ? { ...s, total_classes: newTotal, attended_classes: newAttended } : s))
      }
    }

    return { data }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()

    setIsLoggedIn(false)
    setTasks([])
    setTimetable([])
    setSubjects([])
    setAttendanceRecords([])
    setEmail('')
    setName('')
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
    handleLogout,
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App