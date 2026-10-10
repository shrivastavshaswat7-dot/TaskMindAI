import { useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { extractTopics } from '../api/study'
import './pyq.css'

const MAX_FILES = 10
const MAX_TOTAL_BYTES = 18 * 1024 * 1024   // the backend rejects more than this in one request

const isPdf = (file) => file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf'
// Same name and size = the same paper (a re-downloaded copy has a new timestamp, so that is not part of the key)
const fileKey = (file) => `${file.name}:${file.size}`

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

// A network-level failure ("Failed to fetch") says nothing useful; explain the likely causes instead
const friendlyError = (err) =>
  /failed to fetch|networkerror|load failed/i.test(err?.message || '')
    ? 'Could not reach the analysis server. If it has been idle it may be waking up (this can take up to a minute). Your files are still selected, so you can try again.'
    : err?.message || 'Something went wrong while analysing the papers. Please try again.'

function PyqAnalysis() {
  const { topics, studySubjects, activeSubjectId, saveExtractedTopics } = useOutletContext()
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [isExtracting, setIsExtracting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [fileMessage, setFileMessage] = useState('')   // non-blocking notes about the selection
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastRun, setLastRun] = useState(null)         // { found, papers } of the last successful analysis
  // Type a new name to create a subject; the same name again updates that subject.
  // Until the user types something, the active subject's name is the default.
  const [typedSubject, setTypedSubject] = useState(null)
  const subjectName =
    typedSubject ?? (studySubjects.find((s) => s.id === activeSubjectId)?.name || '')
  const activeSubject = studySubjects.find((s) => s.id === activeSubjectId)

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  const tooLarge = totalBytes > MAX_TOTAL_BYTES

  // Adds to the current selection (no duplicates, PDFs only, at most MAX_FILES) and says what was left out
  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || [])
    if (incoming.length === 0) return
    const pdfs = incoming.filter(isPdf)
    const skippedNonPdf = incoming.length - pdfs.length

    const known = new Set(files.map(fileKey))
    const fresh = pdfs.filter((f) => {
      const key = fileKey(f)
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    const duplicates = pdfs.length - fresh.length

    const room = MAX_FILES - files.length
    const accepted = fresh.slice(0, Math.max(0, room))
    const overLimit = fresh.length - accepted.length

    const notes = []
    if (skippedNonPdf > 0) notes.push(`${skippedNonPdf} file${skippedNonPdf === 1 ? ' was' : 's were'} skipped: only PDFs are supported.`)
    if (duplicates > 0) notes.push(`${duplicates} duplicate${duplicates === 1 ? '' : 's'} ignored.`)
    if (overLimit > 0) notes.push(`Maximum ${MAX_FILES} PDFs allowed at once: ${overLimit} not added.`)
    setFileMessage(notes.join(' '))
    setError('')
    setFiles((current) => [...current, ...accepted])
  }

  const removeFile = (key) => {
    setFiles((current) => current.filter((f) => fileKey(f) !== key))
    setFileMessage('')
  }

  const clearFiles = () => {
    setFiles([])
    setFileMessage('')
  }

  const openPicker = () => fileInputRef.current?.click()

  const handleExtract = async () => {
    if (files.length === 0 || isExtracting || tooLarge) return
    const papers = files.length
    setIsExtracting(true)
    setError('')
    setNotice('')
    setLastRun(null)
    try {
      const data = await extractTopics(files)
      const found = (data.topics || []).length
      const result = await saveExtractedTopics(subjectName, data.topics || [])
      setLastRun({ found, papers })
      if (result.error) {
        setError(`Topics are shown but could not be saved: ${result.error.message}`)
      } else {
        setNotice(`Saved to "${result.subject.name}". They will be here next time you log in.`)
      }
      setFiles([])
      setFileMessage('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(friendlyError(err))                  // the files stay selected so the user can retry
    } finally {
      setIsExtracting(false)
    }
  }

  // Facts about the topics shown, computed from the real data only
  const papersAnalysed = topics.reduce((max, t) => Math.max(max, t.papers_total || 0), 0)
  const years = [...new Set(topics.flatMap((t) => t.years || []))].sort((a, b) => a - b)
  const yearRange = years.length === 0 ? null : years[0] === years[years.length - 1] ? `${years[0]}` : `${years[0]}–${years[years.length - 1]}`

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

      <ol className="pyq-steps" aria-label="How it works">
        <li><span>1</span> Choose a subject</li>
        <li><span>2</span> Add the PDFs</li>
        <li><span>3</span> Analyse and rank</li>
      </ol>

      <section className="dashboard-card pyq-upload" aria-busy={isExtracting}>
        <div className="card-header">
          <div>
            <h2>Upload Papers</h2>
            <p>Up to {MAX_FILES} PDFs, one subject at a time</p>
          </div>
        </div>

        <div className="pyq-subject-row">
          <label className="priority-days-label" htmlFor="pyq-subject">Subject</label>
          <input
            id="pyq-subject"
            className="date-input"
            list="pyq-subject-list"
            placeholder="General"
            maxLength={80}
            value={subjectName}
            disabled={isExtracting}
            onChange={(e) => setTypedSubject(e.target.value)}
          />
          <datalist id="pyq-subject-list">
            {studySubjects.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
          <span className="pyq-hint">New name = new subject. Same name = adds to that subject.</span>
        </div>

        <div className="pyq-upload-grid">
          <div
            className={`drop-zone pyq-drop${isDragging ? ' dragging' : ''}${isExtracting ? ' disabled' : ''}`}
            role="button"
            tabIndex={isExtracting ? -1 : 0}
            aria-label="Add PYQ PDF files"
            aria-disabled={isExtracting}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={() => !isExtracting && setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              if (!isExtracting) addFiles(e.dataTransfer.files)
            }}
            onClick={() => !isExtracting && openPicker()}
            onKeyDown={(e) => {
              if (!isExtracting && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                openPicker()
              }
            }}
          >
            <div className="drop-icon" aria-hidden="true">📄</div>
            <p><strong>Drop PYQ PDFs here</strong> or click to browse</p>
            <p className="drop-sub">PDF files only · up to {MAX_FILES} files · 18 MB in total</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''           // lets the same file be picked again after removing it
              }}
            />
          </div>

          <div className="pyq-queue" aria-live="polite">
            <div className="pyq-queue-head">
              <strong>Selected papers</strong>
              <span className={`pyq-count${tooLarge ? ' bad' : ''}`}>
                {files.length}/{MAX_FILES}{files.length > 0 ? ` · ${formatSize(totalBytes)}` : ''}
              </span>
            </div>

            {files.length === 0 ? (
              <p className="pyq-queue-empty">No files yet. Add the question papers you want analysed.</p>
            ) : (
              <ul className="pyq-files">
                {files.map((file) => (
                  <li key={fileKey(file)}>
                    <span className="pyq-file-icon" aria-hidden="true">PDF</span>
                    <span className="pyq-file-name" title={file.name}>{file.name}</span>
                    <span className="pyq-file-size">{formatSize(file.size)}</span>
                    <button
                      type="button"
                      className="pyq-remove"
                      aria-label={`Remove ${file.name}`}
                      disabled={isExtracting}
                      onClick={() => removeFile(fileKey(file))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {files.length > 1 && !isExtracting && (
              <button type="button" className="pyq-clear" onClick={clearFiles}>Clear all</button>
            )}
          </div>
        </div>

        {fileMessage && <p className="pyq-note warn" role="status">{fileMessage}</p>}
        {tooLarge && (
          <p className="pyq-note bad" role="alert">
            These files are {formatSize(totalBytes)} in total; the limit is 18 MB. Remove a file or two to continue.
          </p>
        )}

        <button
          className="primary-btn pyq-extract"
          onClick={handleExtract}
          disabled={isExtracting || files.length === 0 || tooLarge}
        >
          {isExtracting ? 'Analyzing papers...' : `✨ Extract Topics${files.length ? ` (${files.length})` : ''}`}
        </button>

        {isExtracting && (
          <div className="pyq-progress" role="status">
            <div className="pyq-progress-bar" aria-hidden="true"><span /></div>
            <p>
              <strong>Reading {files.length} paper{files.length === 1 ? '' : 's'} and finding repeated topics…</strong>
              <br />
              This usually takes a few seconds, and up to a minute for large papers. Please keep this page open.
            </p>
          </div>
        )}

        {notice && !isExtracting && (
          <div className="pyq-result" role="status">
            <span className="pyq-result-icon" aria-hidden="true">✓</span>
            <div>
              <p>{notice}</p>
              {lastRun && (
                <small>
                  Found {lastRun.found} topic{lastRun.found === 1 ? '' : 's'} in {lastRun.papers} paper{lastRun.papers === 1 ? '' : 's'}.
                </small>
              )}
            </div>
            <button type="button" className="dx-btn dx-btn-primary" onClick={() => navigate('/priorities')}>
              Rank these topics →
            </button>
          </div>
        )}

        {error && (
          <div className="doc-answer-error pyq-error" role="alert">
            ❌ {error}
          </div>
        )}
      </section>

      <section className="dashboard-card">
        <div className="card-header pyq-topics-head">
          <div>
            <h2>Extracted Topics</h2>
            <p>Sorted by how often they appear across papers</p>
          </div>
          {topics.length > 0 && (
            <button type="button" className="dx-btn dx-btn-primary" onClick={() => navigate('/priorities')}>
              Rank these topics →
            </button>
          )}
        </div>

        {topics.length > 0 && (
          <div className="pyq-summary">
            <span className="pyq-chip"><strong>{topics.length}</strong> topic{topics.length === 1 ? '' : 's'}</span>
            {activeSubject && <span className="pyq-chip">Subject: <strong>{activeSubject.name}</strong></span>}
            {papersAnalysed > 0 && <span className="pyq-chip"><strong>{papersAnalysed}</strong> paper{papersAnalysed === 1 ? '' : 's'} analysed</span>}
            {yearRange && <span className="pyq-chip">Years <strong>{yearRange}</strong></span>}
          </div>
        )}

        {topics.length === 0 ? (
          <div className="pyq-empty">
            <div aria-hidden="true">📚</div>
            <h3>No topics yet</h3>
            <p>Upload PYQ PDFs above and the repeated topics will appear here, ready to be ranked.</p>
          </div>
        ) : (
          <ul className="pyq-topics">
            {topics.map((topic, index) => {
              const share = topic.papers_total > 0 ? Math.round((topic.frequency / topic.papers_total) * 100) : 0
              return (
                <li className="pyq-topic" key={topic.id}>
                  <span className="pyq-rank" aria-hidden="true">{index + 1}</span>
                  <div className="pyq-topic-main">
                    <span className="task-title">{topic.name}</span>
                    <div className="pyq-topic-meta">
                      {topic.unit > 0 && <span className="pyq-tag">Unit {topic.unit}</span>}
                      <span className="pyq-tag">avg {topic.avg_marks} marks</span>
                      {topic.years.length > 0 && <span className="pyq-tag years">📅 {topic.years.join(', ')}</span>}
                    </div>
                  </div>
                  <div className="pyq-freq" title={`Appears in ${topic.frequency} of ${topic.papers_total} papers`}>
                    <div className="pyq-freq-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></div>
                    <small>{topic.frequency}/{topic.papers_total} papers</small>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

export default PyqAnalysis
