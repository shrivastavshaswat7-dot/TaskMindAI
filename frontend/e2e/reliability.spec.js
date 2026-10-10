// MOCKED-backend browser tests (see support/mockBackend.js) for what happens when things go wrong: failed data loads, failed
// actions, double clicks, slow / dead / erroring servers, and the chat and document flows. They verify that the app tells the
// user the truth (no empty state for data that did not load, no success for a failed save) and that loading always ends.
// They do NOT verify the real Supabase or the real server.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi, SAMPLE_TOPICS, USER } from './support/mockBackend.js'

const U = USER.id
const dayToday = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
const SEED = {
  tasks: [
    { id: 't1', user_id: U, title: 'Submit lab record', completed: false, priority: 'high', created_at: '2026-10-01T00:00:00Z' },
    { id: 't2', user_id: U, title: 'Read chapter 4', completed: true, priority: 'low', created_at: '2026-10-02T00:00:00Z' },
  ],
  subjects: [{ id: 's1', user_id: U, name: 'Maths', total_classes: 20, attended_classes: 17, created_at: '2026-10-01T00:00:00Z' }],
  timetable_entries: [
    { id: 'e1', user_id: U, day_of_week: dayToday, subject: 'Engineering Maths II', start_time: '09:00:00', end_time: '10:00:00', room: 'B-204', teacher: 'Dr. Rao', color: '#6d5dfc' },
  ],
  academic_subjects: [{ id: 'as1', user_id: U, name: 'Maths', created_at: '2026-10-01T00:00:00Z' }],
  study_topics: SAMPLE_TOPICS.map((t, i) => ({
    id: `st${i}`, user_id: U, subject_id: 'as1', topic_key: t.id, name: t.name, unit: t.unit, frequency: t.frequency,
    papers_total: t.papers_total, avg_marks: t.avg_marks, years: t.years, weakness: 50,
  })),
}

const alert = (page, text) => page.getByRole('alert').filter({ hasText: text })
const link = (page, name) => page.getByRole('navigation').getByRole('link', { name })
const stat = (page, label) => page.locator('.dx-stat', { hasText: label })

async function start(page, { tables = SEED, setup } = {}) {
  const mock = await installMockBackend(page, { tables })
  if (setup) setup(mock)
  await loginThroughUi(page)
  await expect(page.getByText('STUDENT DASHBOARD')).toBeVisible()
  return mock
}

// ---------------------------------------------------------------------------------------------------------------------
test.describe('loading the user\'s data', () => {
  test('a failed load is reported with a Retry button and never shown as "no tasks yet"', async ({ page }) => {
    const mock = await start(page, { setup: (m) => m.restFail.add('GET tasks') })

    await expect(alert(page, 'Could not load your tasks')).toBeVisible()
    await expect(page.getByText('Your tasks could not be loaded')).toBeVisible()
    await expect(page.getByText('No pending tasks!')).toHaveCount(0)               // not a fake empty state
    await expect(stat(page, 'Pending tasks').locator('strong')).toHaveText('—')   // not a fake zero
    await expect(stat(page, 'Study topics').locator('strong')).toHaveText('3')     // the parts that did load are fine

    mock.restFail.clear()
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Submit lab record')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(stat(page, 'Pending tasks').locator('strong')).toHaveText('1')
  })

  test('while data is still loading, pages say so instead of showing empty states', async ({ page }) => {
    const mock = await installMockBackend(page, { tables: SEED })
    mock.restDelayMs = 1500
    await loginThroughUi(page)

    await expect(page.getByText('Loading your tasks…')).toBeVisible()
    await expect(page.getByText('No pending tasks!')).toHaveCount(0)
    await expect(stat(page, 'Pending tasks').locator('strong')).toHaveText('…')
    await expect(page.getByRole('heading', { name: 'Loading your study progress…' })).toBeVisible()

    await expect(page.getByText('Submit lab record')).toBeVisible()               // then the real data
    await expect(stat(page, 'Pending tasks').locator('strong')).toHaveText('1')
  })

  test('the tasks, timetable and attendance pages follow the same rule', async ({ page }) => {
    await start(page, { setup: (m) => ['GET tasks', 'GET timetable_entries', 'GET subjects'].forEach((k) => m.restFail.add(k)) })
    await expect(alert(page, 'Could not load your tasks, timetable, attendance subjects')).toBeVisible()

    await link(page, 'Tasks').click()
    await expect(page.getByText('Your tasks could not be loaded')).toBeVisible()
    await expect(page.getByText('No tasks yet')).toHaveCount(0)

    await link(page, 'Timetable').click()
    await expect(page.getByText('Your timetable could not be loaded')).toBeVisible()
    await expect(page.getByText(/No classes scheduled/)).toHaveCount(0)

    await link(page, 'Attendance').click()
    await expect(page.getByText('Your attendance could not be loaded')).toBeVisible()
    await expect(page.getByText('No subjects added yet')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
test.describe('actions only report success when the server confirmed it', () => {
  test('adding a task: failure keeps the text and tells the user; a double click adds it once', async ({ page }) => {
    const mock = await start(page)
    const input = page.getByPlaceholder('Add a new task...')

    mock.restFail.add('POST tasks')
    await input.fill('Buy notebook')
    await page.getByRole('button', { name: '+ Add Task' }).click()
    await expect(alert(page, 'Could not add the task')).toBeVisible()
    await expect(input).toHaveValue('Buy notebook')                                // nothing lost
    await expect(page.getByText('Buy notebook', { exact: true })).toHaveCount(0)
    expect(mock.tables.tasks).toHaveLength(2)

    mock.restFail.clear()
    await page.getByRole('button', { name: '+ Add Task' }).dblclick()              // two clicks, one task
    await expect(page.getByText('Buy notebook')).toBeVisible()
    await page.waitForTimeout(400)
    expect(mock.tables.tasks.filter((t) => t.title === 'Buy notebook')).toHaveLength(1)
    await expect(input).toHaveValue('')
  })

  test('completing and deleting a task: failures are reported and nothing changes on screen', async ({ page }) => {
    const mock = await start(page)

    mock.restFail.add('PATCH tasks')
    await page.getByRole('button', { name: 'Mark as done' }).click()
    await expect(alert(page, 'Could not update the task')).toBeVisible()
    await expect(page.getByText('Submit lab record')).toBeVisible()
    expect(mock.tables.tasks.find((t) => t.id === 't1').completed).toBe(false)

    mock.restFail.add('DELETE tasks')
    await page.getByRole('button', { name: 'Delete task' }).click()
    await expect(alert(page, 'Could not delete the task')).toBeVisible()
    await expect(page.getByText('Submit lab record')).toBeVisible()
    expect(mock.tables.tasks.some((t) => t.id === 't1')).toBe(true)

    mock.restFail.clear()
    await page.getByRole('button', { name: 'Mark as done' }).click()              // and it works once the server does
    await expect.poll(() => mock.tables.tasks.find((t) => t.id === 't1').completed).toBe(true)
  })

  test('timetable: a failed save keeps the form open and filled; a confirmed save closes it', async ({ page }) => {
    const mock = await start(page)
    await link(page, 'Timetable').click()
    await page.getByRole('button', { name: /Add Class/ }).click()
    await page.getByPlaceholder('Subject (e.g. Data Structures)').fill('Operating Systems')
    await page.locator('input[type=time]').first().fill('14:00')
    await page.locator('input[type=time]').nth(1).fill('15:00')

    mock.restFail.add('POST timetable_entries')
    await page.getByRole('button', { name: 'Save Class' }).click()
    await expect(alert(page, 'Could not add the class')).toBeVisible()
    await expect(page.getByPlaceholder('Subject (e.g. Data Structures)')).toHaveValue('Operating Systems')
    await expect(page.locator('input[type=time]').first()).toHaveValue('14:00')
    await expect(page.getByRole('button', { name: 'Save Class' })).toBeEnabled()    // the button is not stuck
    expect(mock.tables.timetable_entries).toHaveLength(1)

    mock.restFail.clear()
    await page.getByRole('button', { name: 'Save Class' }).click()
    await expect(page.getByPlaceholder('Subject (e.g. Data Structures)')).toHaveCount(0)   // form closed
    await expect(page.getByText('Operating Systems')).toBeVisible()
    expect(mock.tables.timetable_entries).toHaveLength(2)
  })

  test('attendance: a mark whose total cannot be saved is rolled back; a double click counts once', async ({ page }) => {
    const mock = await start(page)
    await link(page, 'Attendance').click()
    await expect(page.getByText('17', { exact: true })).toBeVisible()

    mock.restFail.add('PATCH subjects')
    await page.getByRole('button', { name: 'Present' }).click()
    await expect(alert(page, 'Could not update the attendance total')).toBeVisible()
    expect(mock.tables.attendance_records).toHaveLength(0)                          // the record was removed again
    expect(mock.tables.subjects[0]).toMatchObject({ total_classes: 20, attended_classes: 17 })
    await expect(page.getByRole('button', { name: 'Present' })).toBeVisible()       // can be tried again

    mock.restFail.clear()
    await page.getByRole('button', { name: 'Present' }).dblclick()
    await expect(page.getByText(/Marked as:/)).toBeVisible()
    await page.waitForTimeout(400)
    expect(mock.tables.attendance_records).toHaveLength(1)
    expect(mock.tables.subjects[0]).toMatchObject({ total_classes: 21, attended_classes: 18 })
  })

  test('attendance: adding a subject that fails keeps the form and the typed name', async ({ page }) => {
    const mock = await start(page)
    await link(page, 'Attendance').click()
    await page.getByRole('button', { name: /Add Subject/ }).first().click()
    mock.restFail.add('POST subjects')
    await page.getByPlaceholder(/Subject Name/).fill('Operating Systems')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(alert(page, 'Could not add the subject')).toBeVisible()
    await expect(page.getByPlaceholder(/Subject Name/)).toHaveValue('Operating Systems')
    expect(mock.tables.subjects).toHaveLength(1)
  })

  test('the message goes away when dismissed', async ({ page }) => {
    const mock = await start(page)
    mock.restFail.add('POST tasks')
    await page.getByPlaceholder('Add a new task...').fill('x')
    await page.getByRole('button', { name: '+ Add Task' }).click()
    await expect(alert(page, 'Could not add the task')).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss message' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
test.describe('a server that is slow, down or erroring', () => {
  async function priorities(page, setup) {
    const mock = await start(page, { setup })
    await link(page, 'Priorities').click()
    return mock
  }
  const calculate = (page) => page.getByRole('button', { name: /Calculate Priorities|Calculating/ })

  test('a request that never gets an answer times out, the button is released, and a retry works', async ({ page }) => {
    const mock = await priorities(page)
    mock.apiMode['/api/priorities'] = 'hang'
    await calculate(page).click()
    await expect(calculate(page)).toHaveText('Calculating...')
    await expect(calculate(page)).toBeDisabled()

    await expect(page.getByText(/The server took too long to respond \(over 3 seconds\)/)).toBeVisible({ timeout: 10_000 })
    await expect(calculate(page)).toBeEnabled()                                    // loading ended

    delete mock.apiMode['/api/priorities']
    await calculate(page).click()
    await expect(page.locator('.priority-table tbody tr')).toHaveCount(3)
    await expect(page.getByText(/took too long/)).toHaveCount(0)
  })

  test('a dead server gives a readable message, not "Failed to fetch"', async ({ page }) => {
    const mock = await priorities(page)
    mock.apiMode['/api/priorities'] = 'abort'
    await calculate(page).click()
    await expect(page.getByText(/Could not reach the server/)).toBeVisible()
    await expect(page.getByText('Failed to fetch')).toHaveCount(0)
    await expect(calculate(page)).toBeEnabled()
  })

  test('a proxy error page (HTML) and a rate limit are explained in plain words', async ({ page }) => {
    const mock = await priorities(page)
    mock.apiMode['/api/priorities'] = 'html'
    await calculate(page).click()
    await expect(page.getByText(/busy or waking up/)).toBeVisible()
    await expect(calculate(page)).toBeEnabled()

    delete mock.apiMode['/api/priorities']
    mock.apiFail['/api/priorities'] = 429
    await calculate(page).click()
    await expect(page.getByText('Too many requests. Please wait a moment and try again.')).toBeVisible()
    await expect(page.getByText(/busy or waking up/)).toHaveCount(0)
    await expect(calculate(page)).toBeEnabled()
  })

  test('the AI task prioritizer reports a failure instead of doing nothing', async ({ page }) => {
    const mock = await start(page)
    mock.apiFail['/api/tasks/prioritize'] = 503
    await link(page, 'Tasks').click()
    await page.getByRole('button', { name: /AI Prioritize/ }).click()
    await expect(alert(page, 'busy or waking up')).toBeVisible()
    await expect(page.getByRole('button', { name: /AI Prioritize/ })).toBeEnabled()
  })

  test('the email assistant explains a gateway error and can be retried', async ({ page }) => {
    const mock = await start(page)
    mock.apiMode['/api/email/draft-reply'] = 'html'
    await link(page, 'Email Assistant').click()
    await page.getByPlaceholder(/Paste the email here/).fill('Please submit the assignment by Friday.')
    await page.getByRole('button', { name: /Generate Reply/ }).click()
    await expect(page.getByText(/busy or waking up/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Generate Reply/ })).toBeEnabled()

    delete mock.apiMode['/api/email/draft-reply']
    await page.getByRole('button', { name: /Generate Reply/ }).click()
    await expect(page.getByText('Dear Professor, thank you.')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
test.describe('AI assistant chat', () => {
  async function chat(page, mode) {
    const mock = await start(page, { setup: (m) => { m.chatMode = mode } })
    await link(page, 'AI Assistant').click()
    return mock
  }
  const ask = async (page, text = 'Explain Laplace transforms') => {
    await page.getByPlaceholder(/Ask anything/).fill(text)
    await page.locator('.chat-send-btn').click()
  }

  test('an error sent by the server inside the stream is shown, not swallowed', async ({ page }) => {
    await chat(page, 'error-event')
    await ask(page)
    await expect(page.getByText(/Sorry, something went wrong: The AI request failed\. Please try again\./)).toBeVisible()
    await expect(page.getByPlaceholder(/Ask anything/)).toBeEnabled()               // not stuck "thinking"
  })

  test('an empty answer is an error, not a blank bubble', async ({ page }) => {
    await chat(page, 'empty')
    await ask(page)
    await expect(page.getByText(/The assistant returned an empty answer/)).toBeVisible()
  })

  test('an answer that breaks off keeps what arrived and says it was cut off', async ({ page }) => {
    await chat(page, 'partial-then-error')
    await ask(page)
    await expect(page.getByText(/Laplace transforms turn/)).toBeVisible()
    await expect(page.getByText(/The answer was cut off: The AI request failed/)).toBeVisible()
  })

  test('a rate limit on the chat shows the server\'s own message', async ({ page }) => {
    const mock = await chat(page, 'ok')
    mock.apiFail['/api/ai/chat'] = 429
    await ask(page)
    await expect(page.getByText(/Too many requests\. Please wait a moment and try again\./)).toBeVisible()
    await expect(page.getByPlaceholder(/Ask anything/)).toBeEnabled()
  })

  test('a normal answer still streams in', async ({ page }) => {
    await chat(page, 'ok')
    await ask(page)
    await expect(page.getByText('Hello from the mocked assistant.')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
test.describe('documents', () => {
  const openDocs = async (page) => {
    await link(page, 'AI Assistant').click()
    await page.getByRole('button', { name: /Documents/ }).click()
  }

  test('a failed document list is an error with Retry, not "No documents uploaded yet"', async ({ page }) => {
    const mock = await start(page, { setup: (m) => { m.apiFail['/api/documents/list/' + USER.id] = 500 } })
    await openDocs(page)
    await expect(alert(page, 'Could not load your documents')).toBeVisible()
    await expect(page.getByText('No documents uploaded yet.')).toHaveCount(0)

    delete mock.apiFail['/api/documents/list/' + USER.id]
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.doc-name', { hasText: 'notes.pdf' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('a document is only removed from the screen when the server deleted it', async ({ page }) => {
    const mock = await start(page)
    await openDocs(page)
    await expect(page.locator('.doc-name', { hasText: 'notes.pdf' })).toBeVisible()

    mock.apiFail['/api/documents/delete'] = 403
    await page.locator('.doc-item .delete-task').click()
    await expect(alert(page, 'Could not delete the document')).toBeVisible()
    await expect(alert(page, 'You do not have access to this.')).toBeVisible()
    await expect(page.locator('.doc-name', { hasText: 'notes.pdf' })).toBeVisible()  // still there

    delete mock.apiFail['/api/documents/delete']
    await page.locator('.doc-item .delete-task').click()
    await expect(page.locator('.doc-name', { hasText: 'notes.pdf' })).toHaveCount(0)
  })

  test('a failed question is shown as an error and the button is released', async ({ page }) => {
    const mock = await start(page)
    mock.apiFail['/api/documents/query'] = 500
    await openDocs(page)
    await page.getByPlaceholder(/main concept/).fill('What is in my notes?')
    await page.getByRole('button', { name: /Ask AI/ }).click()
    await expect(page.getByText(/Something went wrong on the server/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Ask AI/ })).toBeEnabled()
  })
})
