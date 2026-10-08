import { useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { extractTopics } from '../api/study'

const MAX_FILES = 10

function PyqAnalysis() {
  const { topics, setTopics } = useOutletContext()
  const fileInputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState('')

  const pickFiles = (fileList) => {
    const pdfs = Array.from(fileList || []).filter((f) =>
      f.name.toLowerCase().endsWith('.pdf')
    )
    setError(pdfs.length > MAX_FILES ? `Maximum ${MAX_FILES} PDFs allowed at once` : '')
    setFiles(pdfs.slice(0, MAX_FILES))
  }

  const handleExtract = async () => {
    if (files.length === 0 || isExtracting) return
    setIsExtracting(true)
    setError('')
    try {
      const data = await extractTopics(files)
      setTopics(data.topics || [])
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err.message)
    } finally {
      setIsExtracting(false)
    }
  }

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-small-title">PYQ ANALYSIS</p>
          <h1>Previous Year Papers</h1>
          <p className="dashboard-subtitle">
            Upload PYQ PDFs of one subject to find the most repeated topics.
          </p>
        </div>
      </header>

      <section className="dashboard-card">
        <div className="card-header">
          <div>
            <h2>Upload Papers</h2>
            <p>Up to {MAX_FILES} PDFs, one subject at a time</p>
          </div>
        </div>

        <div
          className="drop-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            pickFiles(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="drop-icon">📄</div>
          <p><strong>Drop PYQ PDFs here</strong> or click to browse</p>
          <p className="drop-sub">
            {files.length > 0
              ? files.map((f) => f.name).join(', ')
              : 'PDF files only'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => pickFiles(e.target.files)}
          />
        </div>

        <button
          className="primary-btn"
          style={{ marginTop: '16px' }}
          onClick={handleExtract}
          disabled={isExtracting || files.length === 0}
        >
          {isExtracting ? 'Analyzing papers...' : `✨ Extract Topics${files.length ? ` (${files.length})` : ''}`}
        </button>

        {error && (
          <div className="doc-answer-error" style={{ marginTop: '16px' }}>
            ❌ {error}
          </div>
        )}
      </section>

      <section className="dashboard-card">
        <div className="card-header">
          <div>
            <h2>Extracted Topics</h2>
            <p>Sorted by how often they appear across papers</p>
          </div>
        </div>

        <div className="task-list">
          {topics.length === 0 ? (
            <div className="empty-tasks">No topics yet. Upload PYQ PDFs to begin.</div>
          ) : (
            topics.map((topic) => (
              <div className="task-item" key={topic.id}>
                <div className="task-main-row">
                  <div className="task-content">
                    <span className="task-title">{topic.name}</span>
                    <div className="task-meta">
                      {topic.unit > 0 && <span className="task-category">Unit {topic.unit}</span>}
                      <span className="task-category">
                        {topic.frequency}/{topic.papers_total} papers
                      </span>
                      <span className="task-category">avg {topic.avg_marks} marks</span>
                      {topic.years.length > 0 && (
                        <span className="task-date">📅 {topic.years.join(', ')}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  )
}

export default PyqAnalysis
