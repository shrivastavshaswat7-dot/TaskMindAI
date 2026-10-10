import { useState, useRef, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../supabase'
import { apiJson, authFetch } from '../api/authFetch'
import { errorFromResponse, userMessage } from '../api/errors'
import { createSseParser } from '../api/sse'

/* ─── simple markdown renderer ─────────────────────────────────────────── */
function renderMarkdown(text) {
  if (!text) return ''
  return text
    // code blocks
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    // inline code
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // unordered lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    // numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // line breaks
    .replace(/\n\n/g, '<br/><br/>')
}

const QUICK_PROMPTS = [
  { icon: '🧠', text: 'Explain recursion with examples' },
  { icon: '📚', text: 'Create a 7-day study plan for exams' },
  { icon: '⚡', text: 'Give me top 5 productivity tips for students' },
  { icon: '📐', text: 'Explain the Pythagorean theorem simply' },
  { icon: '💻', text: 'What is Big O notation?' },
  { icon: '🔬', text: 'Explain photosynthesis step by step' },
]

// Message ids only need to be unique within the chat
const newMessageId = () => Date.now()

/* ─── AI ASSISTANT PAGE ─────────────────────────────────────────────────── */
export default function AiAssistant() {
  const { name } = useOutletContext()
  const [activeTab, setActiveTab] = useState('chat')

  // ── Chat state
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const chatEndRef = useRef(null)
  const inputRef = useRef(null)

  // ── Documents state
  const [documents, setDocuments] = useState([])
  const [isUploading, setIsUploading] = useState(false)
  const [docsError, setDocsError] = useState('')
  const [uploadProgress, setUploadProgress] = useState('')
  const [docQuestion, setDocQuestion] = useState('')
  const [docAnswer, setDocAnswer] = useState(null)
  const [isQuerying, setIsQuerying] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState('')
  const fileInputRef = useRef(null)
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /* ── Chat helpers ── */
  const buildHistory = (msgs) =>
    msgs.map(m => ({ role: m.role, content: m.content }))

  const sendMessage = async (text) => {
    if (!text.trim() || isLoading) return
    const userMsg = { id: newMessageId(), role: 'user', content: text }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setIsLoading(true)

    const assistantMsgId = newMessageId() + 1
    setMessages(prev => [...prev, { id: assistantMsgId, role: 'model', content: '', streaming: true }])

    let fullText = ''
    try {
      const response = await authFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: buildHistory(nextMessages),
          system_context: name ? `Student name: ${name}` : ''
        }),
      })

      if (!response.ok) throw await errorFromResponse(response)
      if (!response.body) throw new Error('The assistant sent no answer. Please try again.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parser = createSseParser()

      // An error event from the server must reach the user (it is thrown to the catch below, not swallowed)
      const handleEvents = (events) => {
        for (const event of events) {
          if (event.error) throw new Error(event.error)
          if (event.chunk) {
            fullText += event.chunk
            const snapshot = fullText
            setMessages(prev =>
              prev.map(m => (m.id === assistantMsgId ? { ...m, content: snapshot } : m))
            )
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        handleEvents(parser.push(decoder.decode(value, { stream: true })))
      }
      handleEvents(parser.push(decoder.decode()))
      handleEvents(parser.flush())

      if (!fullText) throw new Error('The assistant returned an empty answer. Please try again.')

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId ? { ...m, streaming: false } : m
        )
      )
    } catch (err) {
      const reason = userMessage(err)
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: fullText
                  ? `${fullText}\n\n⚠️ The answer was cut off: ${reason}`
                  : `⚠️ Sorry, something went wrong: ${reason}`,
                streaming: false,
              }
            : m
        )
      )
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const clearChat = () => {
    setMessages([])
  }

  /* ── Document helpers ── */
  const fetchDocuments = async (uid) => {
    setDocsError('')
    try {
      const data = await apiJson(`/api/documents/list/${uid}`)
      setDocuments(data.documents || [])
    } catch (e) {
      console.error('Failed to fetch documents:', e)
      setDocsError(`Could not load your documents. ${userMessage(e)}`)   // not "you have no documents"
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUserId(data.user.id)
        fetchDocuments(data.user.id)
      }
    })
  }, [])

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !userId || isUploading) return

    setIsUploading(true)
    setUploadProgress(`Uploading ${file.name}...`)

    const formData = new FormData()
    formData.append('user_id', userId)
    formData.append('file', file)

    try {
      const data = await apiJson('/api/documents/upload', {
        method: 'POST',
        body: formData,
        timeoutMs: 180_000,
      })
      setUploadProgress(`✅ ${data.message}`)
      await fetchDocuments(userId)
      setTimeout(() => setUploadProgress(''), 4000)
    } catch (err) {
      setUploadProgress(`❌ Upload failed: ${userMessage(err)}`)
      setTimeout(() => setUploadProgress(''), 8000)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const fakeEvent = { target: { files: [file] } }
    handleFileUpload(fakeEvent)
  }

  const handleDeleteDoc = async (docId) => {
    if (!userId) return
    setDocsError('')
    try {
      await apiJson('/api/documents/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: docId, user_id: userId }),
      })
      // only a confirmed delete removes it from the screen
      setDocuments(prev => prev.filter(d => d.id !== docId))
      if (selectedDocId === docId) setSelectedDocId('')
    } catch (e) {
      console.error('Delete failed:', e)
      setDocsError(`Could not delete the document. ${userMessage(e)}`)
    }
  }

  const handleDocQuery = async (e) => {
    e.preventDefault()
    if (!docQuestion.trim() || !userId || isQuerying) return
    setIsQuerying(true)
    setDocAnswer(null)

    try {
      const data = await apiJson('/api/documents/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: docQuestion,
          user_id: userId,
          document_id: selectedDocId || null,
        }),
      })
      setDocAnswer(data)
    } catch (err) {
      setDocAnswer({ error: userMessage(err) })
    } finally {
      setIsQuerying(false)
    }
  }

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-small-title">AI ASSISTANT</p>
          <h1>AI Assistant</h1>
          <p className="dashboard-subtitle">Your intelligent study companion — chat, ask questions, and learn.</p>
        </div>
        <div className="ai-tab-switcher">
          <button
            className={`ai-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            💬 Chat
          </button>
          <button
            className={`ai-tab-btn ${activeTab === 'docs' ? 'active' : ''}`}
            onClick={() => setActiveTab('docs')}
          >
            📚 Documents
          </button>
        </div>
      </header>

      {/* ── CHAT TAB ── */}
      {activeTab === 'chat' && (
        <section className="dashboard-card chat-card">
          <div className="chat-header">
            <div className="chat-header-info">
              <div className="ai-avatar">✦</div>
              <div>
                <strong>TaskMindAI</strong>
                <span className="ai-status">● Online</span>
              </div>
            </div>
            {messages.length > 0 && (
              <button className="ghost-btn" onClick={clearChat}>Clear chat</button>
            )}
          </div>

          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <div className="welcome-icon">✦</div>
                <h2>How can I help you study today{name ? `, ${name.split(' ')[0]}` : ''}?</h2>
                <p>Ask me anything — concepts, problems, study plans, or quick facts.</p>
                <div className="quick-prompts">
                  {QUICK_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      className="quick-prompt-btn"
                      onClick={() => sendMessage(p.text)}
                    >
                      <span>{p.icon}</span> {p.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map(msg => (
                <div
                  key={msg.id}
                  className={`chat-message ${msg.role === 'user' ? 'user-message' : 'ai-message'}`}
                >
                  {msg.role === 'model' && (
                    <div className="msg-avatar">✦</div>
                  )}
                  <div className="msg-bubble">
                    {msg.role === 'model' ? (
                      <div
                        className="msg-content markdown"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                    ) : (
                      <div className="msg-content">{msg.content}</div>
                    )}
                    {msg.streaming && (
                      <span className="typing-cursor">▌</span>
                    )}
                  </div>
                </div>
              ))
            )}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="chat-message ai-message">
                <div className="msg-avatar">✦</div>
                <div className="msg-bubble">
                  <div className="typing-indicator">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="chat-input-area">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Ask anything... (Shift+Enter for new line, Enter to send)"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isLoading}
            />
            <button
              className="chat-send-btn"
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim()}
            >
              ➤
            </button>
          </div>
        </section>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {activeTab === 'docs' && (
        <div className="docs-layout">
          {/* Upload + list panel */}
          <section className="dashboard-card docs-panel">
            <div className="card-header">
              <div>
                <h2>Your Documents</h2>
                <p>Upload PDFs or text files to ask questions about them</p>
              </div>
            </div>

            {/* Drop zone */}
            <div
              className="drop-zone"
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-icon">📄</div>
              <p><strong>Drop a file here</strong> or click to browse</p>
              <p className="drop-sub">Supports PDF and TXT files</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
                disabled={isUploading}
              />
            </div>

            {uploadProgress && (
              <div className="upload-progress">{uploadProgress}</div>
            )}

            {docsError && (
              <div className="doc-answer-error" role="alert" style={{ margin: '12px 0' }}>
                ❌ {docsError}{' '}
                <button type="button" className="ghost-btn small" onClick={() => fetchDocuments(userId)}>Retry</button>
              </div>
            )}

            {/* Document list */}
            <div className="doc-list">
              {documents.length === 0 ? (
                docsError ? null : <div className="empty-tasks">No documents uploaded yet.</div>
              ) : (
                documents.map(doc => (
                  <div
                    key={doc.id}
                    className={`doc-item ${selectedDocId === doc.id ? 'selected' : ''}`}
                    onClick={() => setSelectedDocId(selectedDocId === doc.id ? '' : doc.id)}
                  >
                    <div className="doc-icon">📄</div>
                    <div className="doc-info">
                      <span className="doc-name">{doc.filename}</span>
                      <span className="doc-date">{new Date(doc.created_at).toLocaleDateString()}</span>
                    </div>
                    <button
                      className="delete-task"
                      onClick={e => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
            {selectedDocId && (
              <p className="doc-filter-note">
                🔍 Searching only in: <strong>{documents.find(d => d.id === selectedDocId)?.filename}</strong>
                <button className="ghost-btn small" onClick={() => setSelectedDocId('')}>Clear</button>
              </p>
            )}
          </section>

          {/* Q&A panel */}
          <section className="dashboard-card docs-qa-panel">
            <div className="card-header">
              <div>
                <h2>Ask About Your Documents</h2>
                <p>Get AI answers grounded in your uploaded study materials</p>
              </div>
            </div>

            <form onSubmit={handleDocQuery} className="doc-query-form">
              <textarea
                className="chat-input"
                placeholder="What is the main concept explained in chapter 2?"
                value={docQuestion}
                onChange={e => setDocQuestion(e.target.value)}
                rows={3}
              />
              <button
                type="submit"
                className="primary-btn"
                disabled={isQuerying || !docQuestion.trim() || documents.length === 0}
              >
                {isQuerying ? 'Searching...' : '🔍 Ask AI'}
              </button>
            </form>

            {docAnswer && (
              <div className="doc-answer">
                {docAnswer.error ? (
                  <div className="doc-answer-error">❌ {docAnswer.error}</div>
                ) : (
                  <>
                    <div
                      className="doc-answer-text markdown"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(docAnswer.answer) }}
                    />
                    {docAnswer.sources?.length > 0 && (
                      <div className="doc-sources">
                        <strong>📎 Sources:</strong>
                        {docAnswer.sources.map((s, i) => (
                          <span key={i} className="source-badge">
                            {s.filename} · chunk {s.chunk_index + 1}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {documents.length === 0 && (
              <div className="coming-soon-placeholder" style={{ marginTop: '20px' }}>
                <div className="coming-soon-icon">📤</div>
                <h3>No documents yet</h3>
                <p>Upload a PDF or text file on the left to start asking questions about it.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}