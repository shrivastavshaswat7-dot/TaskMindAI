import { useState } from 'react'

const TONES = [
  { value: 'formal', label: '🎩 Formal', desc: 'Official & professional' },
  { value: 'semi-formal', label: '👔 Semi-formal', desc: 'Polite but friendly' },
  { value: 'casual', label: '😊 Casual', desc: 'Relaxed & warm' },
  { value: 'apologetic', label: '🙏 Apologetic', desc: 'Sorry & understanding' },
  { value: 'requesting', label: '✋ Requesting', desc: 'Politely asking' },
]

const CONTEXTS = [
  { value: 'professor', label: '👩‍🏫 Professor', desc: 'Academic instructor' },
  { value: 'classmate', label: '🤝 Classmate', desc: 'Fellow student' },
  { value: 'admin', label: '🏛️ Administration', desc: 'University staff' },
  { value: 'company', label: '🏢 Company', desc: 'Employer / internship' },
  { value: 'ta', label: '📐 Teaching Assistant', desc: 'TA or tutor' },
]

export default function EmailAssistant() {
  const [originalEmail, setOriginalEmail] = useState('')
  const [tone, setTone] = useState('semi-formal')
  const [context, setContext] = useState('professor')
  const [additionalContext, setAdditionalContext] = useState('')
  const [draft, setDraft] = useState('')
  const [subjectLine, setSubjectLine] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedSubject, setCopiedSubject] = useState(false)

  const generateReply = async (adjust = null) => {
    if (!originalEmail.trim()) return
    setIsGenerating(true)
    setError('')

    try {
      const body = {
        original_email: originalEmail,
        tone,
        context,
        additional_context: additionalContext || null,
        adjust,
      }

      const res = await fetch('/api/email/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to generate reply')

      setDraft(data.draft || '')
      setSubjectLine(data.subject_line || '')
    } catch (err) {
      setError(err.message)
    } finally {
      setIsGenerating(false)
    }
  }

  const copyToClipboard = async (text, setCopiedFn) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedFn(true)
      setTimeout(() => setCopiedFn(false), 2000)
    } catch {
      setCopiedFn(false)
    }
  }

  const wordCount = draft.split(/\s+/).filter(Boolean).length

  return (
    <>
      <header className="dashboard-header">
        <div>
          <p className="dashboard-small-title">EMAIL ASSISTANT</p>
          <h1>Email Assistant</h1>
          <p className="dashboard-subtitle">Paste any email you received and get a polished AI reply in seconds.</p>
        </div>
      </header>

      <div className="email-layout">
        {/* ── LEFT: INPUT PANEL ── */}
        <div className="email-input-panel">
          {/* Original email */}
          <section className="dashboard-card">
            <div className="card-header">
              <div>
                <h2>📨 Received Email</h2>
                <p>Paste the email you want to reply to</p>
              </div>
            </div>
            <textarea
              className="email-textarea"
              placeholder="Paste the email here...

Example:
Dear Student,
I noticed you missed the last two lab sessions. Please visit my office hours to discuss this..."
              value={originalEmail}
              onChange={e => setOriginalEmail(e.target.value)}
              rows={8}
            />
          </section>

          {/* Tone selector */}
          <section className="dashboard-card">
            <div className="card-header">
              <div>
                <h2>🎭 Tone</h2>
                <p>How should the reply sound?</p>
              </div>
            </div>
            <div className="tone-grid">
              {TONES.map(t => (
                <button
                  key={t.value}
                  className={`tone-btn ${tone === t.value ? 'active' : ''}`}
                  onClick={() => setTone(t.value)}
                >
                  <span className="tone-label">{t.label}</span>
                  <span className="tone-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Context selector */}
          <section className="dashboard-card">
            <div className="card-header">
              <div>
                <h2>👤 Recipient</h2>
                <p>Who are you replying to?</p>
              </div>
            </div>
            <div className="tone-grid">
              {CONTEXTS.map(c => (
                <button
                  key={c.value}
                  className={`tone-btn ${context === c.value ? 'active' : ''}`}
                  onClick={() => setContext(c.value)}
                >
                  <span className="tone-label">{c.label}</span>
                  <span className="tone-desc">{c.desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Additional context */}
          <section className="dashboard-card">
            <div className="card-header">
              <div>
                <h2>💡 Additional Context <span style={{ fontWeight: 400, fontSize: '13px', color: '#9ca3af' }}>(optional)</span></h2>
                <p>Extra info for the AI — e.g. "I need a deadline extension"</p>
              </div>
            </div>
            <textarea
              className="email-textarea small"
              placeholder="e.g. I was sick and need to request a make-up lab session..."
              value={additionalContext}
              onChange={e => setAdditionalContext(e.target.value)}
              rows={3}
            />
          </section>

          <button
            className="primary-btn generate-btn"
            onClick={() => generateReply()}
            disabled={isGenerating || !originalEmail.trim()}
          >
            {isGenerating ? (
              <><span className="spinner" />Generating...</>
            ) : (
              <>✨ Generate Reply</>
            )}
          </button>
        </div>

        {/* ── RIGHT: OUTPUT PANEL ── */}
        <div className="email-output-panel">
          <section className={`dashboard-card email-output-card ${draft ? 'has-draft' : ''}`}>
            <div className="card-header">
              <div>
                <h2>✉️ AI Draft Reply</h2>
                {draft && <p>{wordCount} words · {draft.length} characters</p>}
              </div>
            </div>

            {!draft && !isGenerating && (
              <div className="coming-soon-placeholder email-placeholder">
                <div className="coming-soon-icon">✉️</div>
                <h3>Your AI-drafted reply will appear here</h3>
                <p>Fill in the email on the left and click "Generate Reply"</p>
              </div>
            )}

            {isGenerating && (
              <div className="coming-soon-placeholder email-placeholder">
                <div className="ai-generating">
                  <div className="gen-dot" /><div className="gen-dot" /><div className="gen-dot" />
                </div>
                <p style={{ marginTop: '16px', color: '#9ca3af' }}>Crafting your reply...</p>
              </div>
            )}

            {error && (
              <div className="doc-answer-error" style={{ margin: '20px 0' }}>
                ❌ {error}
              </div>
            )}

            {draft && !isGenerating && (
              <>
                {/* Subject line */}
                {subjectLine && (
                  <div className="subject-line-box">
                    <div className="subject-line-label">Suggested Subject:</div>
                    <div className="subject-line-text">{subjectLine}</div>
                    <button
                      className="copy-small-btn"
                      onClick={() => copyToClipboard(subjectLine, setCopiedSubject)}
                    >
                      {copiedSubject ? '✅ Copied' : '📋 Copy'}
                    </button>
                  </div>
                )}

                {/* Draft email */}
                <textarea
                  className="email-draft-output"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={16}
                />

                {/* Action buttons */}
                <div className="email-actions">
                  <button
                    className="primary-btn copy-btn"
                    onClick={() => copyToClipboard(draft, setCopied)}
                  >
                    {copied ? '✅ Copied!' : '📋 Copy to Clipboard'}
                  </button>
                  <button
                    className="ghost-btn"
                    onClick={() => generateReply()}
                    disabled={isGenerating}
                  >
                    🔄 Regenerate
                  </button>
                </div>

                {/* Adjustments */}
                <div className="adjustment-section">
                  <p className="adjustment-label">Adjust the reply:</p>
                  <div className="adjustment-btns">
                    {[
                      { label: '📏 Shorter', val: 'shorter' },
                      { label: '📝 Longer', val: 'longer' },
                      { label: '🎩 More Formal', val: 'more formal' },
                      { label: '😊 More Casual', val: 'more casual' },
                      { label: '🙏 More Apologetic', val: 'more apologetic and sincere' },
                    ].map(a => (
                      <button
                        key={a.val}
                        className="adjust-btn"
                        onClick={() => generateReply(a.val)}
                        disabled={isGenerating}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  )
}