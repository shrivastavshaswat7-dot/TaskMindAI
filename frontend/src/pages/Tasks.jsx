import { useOutletContext } from 'react-router-dom'

function Tasks() {
  const { 
    tasks, 
    newTask, setNewTask, 
    newTaskDue, setNewTaskDue,
    newTaskPriority, setNewTaskPriority,
    newTaskCategory, setNewTaskCategory,
    addTask, toggleTask, deleteTask,
    prioritizeTasks, isPrioritizing,
    dataStatus, failedParts, isBusy
  } = useOutletContext()

  const completedTasks = tasks.filter((task) => task.completed).length
  const loading = dataStatus === 'loading'
  const tasksUnavailable = loading || failedParts.includes('tasks')   // not loaded: do not claim "no tasks yet"

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-small-title">TASK MANAGEMENT</p>
          <h1>Your Tasks</h1>
          <p className="dashboard-subtitle">
            {completedTasks} of {tasks.length} completed
          </p>
        </div>
        
        <button 
          className="ai-btn" 
          onClick={prioritizeTasks} 
          disabled={isPrioritizing || tasks.length === 0}
        >
          {isPrioritizing ? 'Prioritizing...' : '✨ AI Prioritize'}
        </button>
      </header>

      <section className="dashboard-card">
        <div className="card-header">
          <div>
            <h2>All Tasks</h2>
            <p>Add, complete, or remove tasks</p>
          </div>
        </div>

        <form onSubmit={addTask} className="add-task-form enhanced-task-form">
          <input
            type="text"
            placeholder="Add a new task..."
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            required
          />
          <input
            type="date"
            value={newTaskDue}
            onChange={(e) => setNewTaskDue(e.target.value)}
            className="date-input"
          />
          <select 
            value={newTaskPriority}
            onChange={(e) => setNewTaskPriority(e.target.value)}
            className="priority-select"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <input
            type="text"
            placeholder="Category"
            value={newTaskCategory}
            onChange={(e) => setNewTaskCategory(e.target.value)}
            className="category-input"
          />
          <button type="submit" className="primary-btn" disabled={isBusy('addTask')}>
            + Add Task
          </button>
        </form>

        <div className="task-list">
          {tasksUnavailable ? (
            <div className="empty-tasks">{loading ? 'Loading your tasks…' : 'Your tasks could not be loaded. Use Retry above.'}</div>
          ) : tasks.length === 0 ? (
            <div className="empty-tasks">No tasks yet. Add your first task! 🚀</div>
          ) : (
            tasks.map((task) => (
              <div
                className={`task-item ${task.completed ? 'completed' : ''}`}
                key={task.id}
              >
                <div className="task-main-row">
                  <button className="task-check" onClick={() => toggleTask(task)} disabled={isBusy(`task:${task.id}`)}>
                    {task.completed ? '✓' : ''}
                  </button>
                  <div className="task-content">
                    <span className="task-title">{task.title}</span>
                    <div className="task-meta">
                      {task.category && <span className="task-category">{task.category}</span>}
                      {task.due_date && <span className="task-date">📅 {new Date(task.due_date).toLocaleDateString()}</span>}
                      <span className={`priority-badge priority-${task.priority}`}>
                        {task.priority}
                      </span>
                    </div>
                  </div>
                  <button className="delete-task" onClick={() => deleteTask(task.id)} disabled={isBusy(`task:${task.id}`)}>
                    🗑
                  </button>
                </div>
                {task.ai_priority_reason && !task.completed && (
                  <div className="ai-reason">
                    <strong>✨ AI Note:</strong> {task.ai_priority_reason} (Score: {Math.round(task.ai_priority_score * 100)}/100)
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </>
  )
}

export default Tasks