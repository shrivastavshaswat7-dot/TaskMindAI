// MOCKED backend for the browser tests. NOTHING here talks to the real Supabase or Gemini:
//  - Supabase auth (/auth/v1/*) and PostgREST (/rest/v1/*) are replaced by a small in-memory implementation
//  - the FastAPI endpoints (/api/*) are replaced by canned, contract-shaped responses
// So these tests verify the UI, the state handling and that the session token is attached to every API call.
// They do NOT verify real Supabase (RLS, constraints) or real Gemini behaviour.

export const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.test', name: 'Test Student' }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range',
}

export const SAMPLE_TOPICS = [
  { id: 'laplace-transform', name: 'Laplace Transform', unit: 1, frequency: 4, papers_total: 4, avg_marks: 10, years: [2021, 2022, 2023, 2024], weakness: 50 },
  { id: 'fourier-series', name: 'Fourier Series', unit: 2, frequency: 3, papers_total: 4, avg_marks: 8, years: [2021, 2023, 2024], weakness: 50 },
  { id: 'matrices', name: 'Matrices', unit: 3, frequency: 1, papers_total: 4, avg_marks: 5, years: [2022], weakness: 50 },
]

const QUESTIONS = Array.from({ length: 5 }, (_, i) => ({
  q: `Sample question ${i + 1}?`,
  options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`],
  answer: `A${i}`,
  subtopic: `Subtopic ${i + 1}`,
}))

// Same formula as backend/routers/priority.py (so the UI sees realistic rankings)
function rank(topics, daysLeft) {
  const maxMarks = Math.max(0, ...topics.map((t) => Number(t.avg_marks) || 0))
  const proximity = daysLeft <= 1 ? 100 : daysLeft <= 3 ? 90 : daysLeft <= 7 ? 70 : daysLeft <= 14 ? 50 : 30
  return topics
    .map((t) => {
      const weakness = Math.max(0, Math.min(100, Number(t.weakness ?? 50)))
      const freq = t.papers_total > 0 ? (t.frequency / t.papers_total) * 100 : 0
      const marks = maxMarks > 0 ? (t.avg_marks / maxMarks) * 100 : 0
      const priority = Math.floor(0.35 * freq + 0.25 * marks + 0.25 * weakness + 0.15 * proximity)
      return { ...t, priority, reason: `${t.frequency}/${t.papers_total} papers, weakness ${weakness}` }
    })
    .sort((a, b) => b.priority - a.priority)
}

export async function installMockBackend(page, options = {}) {
  const state = {
    token: 'mock-access-token-1',     // the only token the mocked API accepts
    refreshCount: 0,
    refreshFails: false,              // true: token refresh is rejected (session really expired)
    failStudyTopicWrites: false,      // true: POST/PATCH on study_topics returns 500
    loginError: false,                // true: wrong email or password
    loginErrorCode: null,             // 'email_not_confirmed' | 'invalid_credentials' (real GoTrue error shapes)
    signupMode: 'confirm',            // 'confirm': needs email verification | 'duplicate': email already registered | 'immediate': confirmation is off
    passwordLogins: 0,                // how many email+password logins reached the (mocked) server
    signups: [],                      // { email, redirectTo } of every sign-up request
    tables: {
      tasks: [], timetable_entries: [], subjects: [], attendance_records: [],
      academic_subjects: [], study_topics: [], ...(options.tables || {}),
    },
    documents: [{ id: 'doc-1', filename: 'notes.pdf', created_at: '2026-01-01T00:00:00Z' }],
    apiCalls: [],                     // { method, path, authorization, body }
    consoleErrors: [],
    nextId: 1,
    extractTopics: options.extractTopics || SAMPLE_TOPICS,
  }
  const newId = () => `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`

  page.on('console', (msg) => {
    if (msg.type() === 'error') state.consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => state.consoleErrors.push(`pageerror: ${err.message}`))

  const session = () => ({
    access_token: state.token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `mock-refresh-${state.refreshCount}`,
    user: {
      id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email,
      user_metadata: { name: USER.name }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z',
    },
  })

  const json = (route, status, body, headers = {}) =>
    route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

  // ---- Supabase auth ------------------------------------------------------------------------------
  await page.route(/\/auth\/v1\//, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (url.pathname.endsWith('/token')) {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'password') {
        state.passwordLogins += 1
        if (state.loginErrorCode === 'email_not_confirmed') {
          return json(route, 400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' })
        }
        if (state.loginError || state.loginErrorCode === 'invalid_credentials') {
          return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
        }
        return json(route, 200, session())
      }
      if (grant === 'refresh_token') {
        if (state.refreshFails) return json(route, 400, { error: 'invalid_grant', error_description: 'Refresh token expired' })
        state.refreshCount += 1
        state.token = `mock-access-token-${state.refreshCount + 1}`
        return json(route, 200, session())
      }
    }
    if (url.pathname.endsWith('/signup')) {
      const body = req.postDataJSON()
      state.signups.push({ email: body.email, redirectTo: url.searchParams.get('redirect_to') })
      if (state.signupMode === 'immediate') return json(route, 200, session())          // confirmation off: session right away
      const user = {
        id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', role: '', email: body.email,
        user_metadata: body.data || {}, app_metadata: {}, created_at: '2026-01-01T00:00:00Z',
        // Supabase's answer for an already registered email has NO identities (and no error)
        identities: state.signupMode === 'duplicate' ? [] : [{ id: 'identity-1', provider: 'email' }],
      }
      return json(route, 200, user)                                                          // no session: verification needed
    }
    if (url.pathname.endsWith('/user')) return json(route, 200, session().user)
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: CORS })
    return json(route, 404, { error: 'not mocked' })
  })

  // ---- Supabase PostgREST -------------------------------------------------------------------------
  const FILTER_SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
  const matches = (row, params) => {
    for (const [key, value] of params) {
      if (FILTER_SKIP.has(key)) continue
      if (value.startsWith('eq.') && String(row[key]) !== value.slice(3)) return false
    }
    return true
  }
  const TABLE_DEFAULTS = {
    study_topics: { unit: 0, frequency: 0, papers_total: 0, avg_marks: 0, years: [], weakness: 50 },
  }

  await page.route(/\/rest\/v1\//, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const table = url.pathname.split('/rest/v1/')[1]
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (!(table in state.tables)) return json(route, 404, { code: 'PGRST205', message: `no table ${table}` })

    const rows = state.tables[table]
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object+json')
    const prefer = req.headers()['prefer'] || ''
    const reply = (data, status = 200) => {
      if (wantsObject) {
        if (data.length !== 1) return json(route, 406, { code: 'PGRST116', message: 'The result contains 0 rows' })
        return json(route, status, data[0])
      }
      return json(route, status, data)
    }

    if (req.method() === 'GET') return reply(rows.filter((r) => matches(r, url.searchParams)))

    if (req.method() === 'POST') {
      if (table === 'study_topics' && state.failStudyTopicWrites) {
        return json(route, 500, { code: 'XX000', message: 'simulated database failure' })
      }
      const body = req.postDataJSON()
      const incoming = Array.isArray(body) ? body : [body]
      const conflictCols = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean)
      const upsert = prefer.includes('resolution=merge-duplicates') && conflictCols.length > 0
      const result = []
      for (const item of incoming) {
        const existing = upsert ? rows.find((r) => conflictCols.every((c) => r[c] === item[c])) : null
        if (existing) {
          Object.assign(existing, item)          // merge only the columns that were sent
          result.push(existing)
          continue
        }
        if (table === 'academic_subjects' && rows.some((r) => r.user_id === item.user_id && r.name === item.name)) {
          return json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint' })
        }
        const row = { id: newId(), created_at: new Date().toISOString(), ...(TABLE_DEFAULTS[table] || {}), ...item }
        rows.push(row)
        result.push(row)
      }
      if (prefer.includes('return=representation')) return reply(result, 201)
      return route.fulfill({ status: 201, headers: CORS, body: '' })
    }

    if (req.method() === 'PATCH') {
      if (table === 'study_topics' && state.failStudyTopicWrites) return json(route, 500, { code: 'XX000', message: 'simulated' })
      const patch = req.postDataJSON()
      const hit = rows.filter((r) => matches(r, url.searchParams))
      hit.forEach((r) => Object.assign(r, patch))
      return prefer.includes('return=representation') ? reply(hit) : route.fulfill({ status: 204, headers: CORS })
    }

    if (req.method() === 'DELETE') {
      state.tables[table] = rows.filter((r) => !matches(r, url.searchParams))
      return route.fulfill({ status: 204, headers: CORS })
    }
    return json(route, 405, { message: 'not mocked' })
  })

  // ---- FastAPI endpoints --------------------------------------------------------------------------
  // Only real API calls (path starts with /api/), NOT Vite's own /src/api/*.js modules
  // options.mockApi === false lets /api/* reach a real backend (used for one-off integration runs)
  if (options.mockApi !== false) await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    let body = null
    try { body = req.postDataJSON() } catch { /* multipart or empty */ }
    const authorization = req.headers()['authorization'] || ''
    state.apiCalls.push({ method: req.method(), path, authorization, body })

    // Like the real backend: no / wrong / old token -> 401
    if (authorization !== `Bearer ${state.token}`) return json(route, 401, { detail: 'Invalid or expired session.' })

    if (path === '/api/extract') return json(route, 200, { topics: state.extractTopics })
    if (path === '/api/priorities') return json(route, 200, { ranked: rank(body.topics, Number(body.days_left)) })
    if (path === '/api/plan') {
      const top = body.ranked.slice(0, 3)
      return json(route, 200, {
        blocks: [
          ...top.map((t) => ({ topic: t.name, minutes: 30, why: `Priority ${t.priority}` })),
          { topic: 'Quiz / Active recall', minutes: 20, why: 'Recall what you studied' },
        ],
      })
    }
    if (path === '/api/quiz') return json(route, 200, { questions: QUESTIONS })
    if (path === '/api/quiz/submit') {
      const { answers, questions, current_weakness: current } = body
      const score = questions.filter((q, i) => answers[i] === q.answer).length
      const perf = 100 - (score / questions.length) * 100
      return json(route, 200, {
        score, total: questions.length,
        weak_subtopics: questions.filter((q, i) => answers[i] !== q.answer).map((q) => q.subtopic),
        updated_weakness: Math.round(0.4 * (current ?? 50) + 0.6 * perf),
      })
    }
    if (path === '/api/tasks/prioritize') return json(route, 200, { prioritized_tasks: [] })
    if (path === '/api/email/draft-reply') return json(route, 200, { draft: 'Dear Professor, thank you.', subject_line: 'Re: your email' })
    if (path === '/api/ai/chat') {
      return route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'text/event-stream' },
        body: `data: ${JSON.stringify({ chunk: 'Hello from the mocked assistant.' })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`,
      })
    }
    if (path.startsWith('/api/documents/list/')) return json(route, 200, { documents: state.documents })
    if (path === '/api/documents/upload') {
      state.documents.push({ id: `doc-${state.documents.length + 1}`, filename: 'uploaded.txt', created_at: new Date().toISOString() })
      return json(route, 200, { document_id: 'doc-x', filename: 'uploaded.txt', chunk_count: 1, message: 'Uploaded', processing_status: 'uploaded' })
    }
    if (path === '/api/documents/delete') return json(route, 200, { message: 'Document deleted successfully.' })
    if (path === '/api/documents/query') {
      return json(route, 200, { answer: 'The mocked answer from your notes.', sources: [{ filename: 'notes.pdf', chunk_index: 0, document_id: 'doc-1' }] })
    }
    return json(route, 404, { detail: 'not mocked' })
  })

  return state
}

// Logs in through the real login form (against the mocked auth endpoint)
export async function loginThroughUi(page) {
  await page.goto('/')
  await page.getByPlaceholder('Enter your email').fill(USER.email)
  await page.getByPlaceholder('Enter your password').fill('not-a-real-password')
  await page.getByRole('button', { name: 'Login', exact: true }).click()
}
