// MOCKED-backend browser tests (see support/mockBackend.js): they verify the UI, state handling, persistence
// logic and that the session token is attached. They do NOT verify real Supabase, RLS or Gemini.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi, SAMPLE_TOPICS, USER } from './support/mockBackend.js'

const PDF = { name: 'pyq2023.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mock') }

async function goto(page, name) {
  await page.getByRole('link', { name }).click()
}

async function extract(page, subject, file = PDF) {
  await goto(page, /PYQ Analysis/)
  await page.locator('#pyq-subject').fill(subject)
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('button', { name: /Extract Topics/ }).click()
}

const topicRows = (mock) => mock.tables.study_topics

test('PYQ extract saves topics per subject, never duplicates, and they survive a refresh', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)

  await extract(page, 'Maths')
  await expect(page.getByText('Saved to "Maths"')).toBeVisible()
  await expect(page.locator('.task-title')).toHaveCount(3)
  expect(topicRows(mock)).toHaveLength(3)
  expect(mock.tables.academic_subjects).toHaveLength(1)
  expect(mock.tables.academic_subjects[0].user_id).toBe(USER.id)
  expect(topicRows(mock).every((r) => r.user_id === USER.id && r.subject_id === mock.tables.academic_subjects[0].id)).toBe(true)

  // The token was attached to the API call
  const extractCall = mock.apiCalls.find((c) => c.path === '/api/extract')
  expect(extractCall.authorization).toBe('Bearer mock-access-token-1')

  // Same PDFs again (different letter case for the subject): updated in place, not duplicated
  await extract(page, '  maths  ')
  await expect(page.getByText(/Saved to/)).toBeVisible()
  expect(topicRows(mock)).toHaveLength(3)
  expect(mock.tables.academic_subjects).toHaveLength(1)

  // Refresh: topics come back from the (mocked) database
  await page.reload()
  await goto(page, /PYQ Analysis/)
  await expect(page.locator('.task-title')).toHaveCount(3)
  await expect(page.locator('#study-subject')).toHaveValue(mock.tables.academic_subjects[0].id)
  expect(mock.consoleErrors).toEqual([])
})

test('priorities, study plan, quiz and "Update Priorities" persist the new weakness', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)
  await extract(page, 'Maths')
  await expect(page.getByText('Saved to "Maths"')).toBeVisible()

  // Priorities
  await goto(page, /Priorities/)
  await page.locator('#days-left').fill('5')
  await page.getByRole('button', { name: /Calculate Priorities/ }).click()
  await expect(page.locator('.priority-table tbody tr')).toHaveCount(3)
  await expect(page.locator('.priority-table tbody tr').first()).toContainText('Laplace Transform')

  // Study plan
  await goto(page, /Study Now/)
  await page.locator('#study-hours').fill('2')
  await page.getByRole('button', { name: /Generate Plan/ }).click()
  await expect(page.getByText('Quiz / Active recall')).toBeVisible()
  await expect(page.locator('.timeline-item')).toHaveCount(4)

  // Quiz: 3 right, 2 wrong
  await goto(page, /Quiz/)
  await page.getByRole('button', { name: /Start Quiz/ }).click()
  for (let i = 0; i < 5; i++) {
    const pick = i < 3 ? `A${i}` : `B${i}`
    await page.locator('.quiz-option', { hasText: pick }).click()
    if (i < 4) await page.getByRole('button', { name: /Next/ }).click()
  }
  await page.getByRole('button', { name: 'Submit Quiz' }).click()
  await expect(page.getByText('3 / 5')).toBeVisible()

  // Submitting alone does NOT save anything...
  expect(topicRows(mock).every((r) => r.weakness === 50)).toBe(true)
  const submitCall = mock.apiCalls.find((c) => c.path === '/api/quiz/submit')
  expect(submitCall.body.current_weakness).toBe(50)
  expect(submitCall.authorization).toBe('Bearer mock-access-token-1')

  // ..."Update Priorities" does: 0.4*50 + 0.6*40 = 44
  await page.getByRole('button', { name: 'Update Priorities' }).click()
  await expect(page).toHaveURL(/\/priorities/)
  await expect.poll(() => topicRows(mock).find((r) => r.topic_key === 'laplace-transform').weakness).toBe(44)
  expect(topicRows(mock).filter((r) => r.weakness !== 50)).toHaveLength(1)

  // Persists across a refresh and is shown on the quiz topic list
  await page.reload()
  await goto(page, /Quiz/)
  await expect(page.locator('select.quiz-topic-select option', { hasText: 'Laplace Transform' })).toHaveText(/weakness 44/)

  // Extracting the same PDFs again keeps the quiz result (weakness is not overwritten)
  await extract(page, 'Maths')
  await expect(page.getByText(/Saved to/)).toBeVisible()
  expect(topicRows(mock).find((r) => r.topic_key === 'laplace-transform').weakness).toBe(44)
  expect(mock.consoleErrors).toEqual([])
})

test('a sample-mode quiz never saves weakness or re-ranks real priorities', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)
  await extract(page, 'Maths')
  await expect(page.getByText('Saved to "Maths"')).toBeVisible()
  await goto(page, /Priorities/)                      // a ranking exists, so the old code would re-rank after the quiz
  await page.getByRole('button', { name: /Calculate Priorities/ }).click()
  await expect(page.locator('.priority-table tbody tr')).toHaveCount(3)
  const rankingBefore = await page.locator('.priority-table tbody tr').allInnerTexts()
  const weaknessBefore = topicRows(mock).map((r) => [r.topic_key, r.weakness])

  mock.quizFails = true                               // the quiz service is down: the app says so, and sample practice is an explicit choice
  await goto(page, /Quiz/)
  await page.getByRole('button', { name: /Start Quiz/ }).click()
  await expect(page.getByRole('alert')).toContainText('Could not start the quiz')
  await expect(page.getByText('Sample mode')).toHaveCount(0)               // nothing silently replaced the real quiz
  await page.getByRole('button', { name: /Practice with sample questions/ }).click()
  await expect(page.getByText('Sample mode')).toBeVisible()
  for (let i = 0; i < 4; i++) {
    await page.locator('.quiz-option').first().click()
    if (i < 3) await page.getByRole('button', { name: /Next/ }).click()
  }
  await page.getByRole('button', { name: 'Submit Quiz' }).click()

  // Result screen: clearly marked, with no way to save, only a way back
  await expect(page.getByText(/score was not saved/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Not saved', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update Priorities' })).toHaveCount(0)
  const callsBefore = mock.apiCalls.length
  await page.getByRole('button', { name: 'Back to Priorities' }).click()
  await expect(page).toHaveURL(/\/priorities/)

  // Nothing real changed: stored weakness, API calls, ranking, and it stays that way after a refresh
  expect(topicRows(mock).map((r) => [r.topic_key, r.weakness])).toEqual(weaknessBefore)
  expect(mock.apiCalls.slice(callsBefore).filter((c) => c.path === '/api/priorities')).toHaveLength(0)
  expect(mock.apiCalls.some((c) => c.path === '/api/quiz/submit')).toBe(false)
  expect(await page.locator('.priority-table tbody tr').allInnerTexts()).toEqual(rankingBefore)   // same ranking, same numbers
  await expect(page.getByText(/Topics have changed/)).toHaveCount(0)
  await page.reload()
  expect(topicRows(mock).every((r) => r.weakness === 50)).toBe(true)
  expect(mock.consoleErrors.filter((e) => !e.includes('503'))).toEqual([])
})

test('a failed database save is reported as a failure, not as success', async ({ page }) => {
  const mock = await installMockBackend(page)
  mock.failStudyTopicWrites = true
  await loginThroughUi(page)
  await extract(page, 'Maths')

  await expect(page.getByText(/could not be saved/i)).toBeVisible()
  await expect(page.getByText(/Saved to/)).toHaveCount(0)
  await expect(page.locator('.task-title')).toHaveCount(3)               // still usable this session
  await expect(page.locator('#study-subject option')).toContainText(['Maths (not saved)'])
  expect(topicRows(mock)).toHaveLength(0)
})

test('switching subject shows that subject\'s topics only', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)
  await extract(page, 'Maths')
  await expect(page.getByText('Saved to "Maths"')).toBeVisible()

  mock.extractTopics = [{ ...SAMPLE_TOPICS[2], id: 'optics', name: 'Optics' }]
  await extract(page, 'Physics')
  await expect(page.getByText('Saved to "Physics"')).toBeVisible()
  await expect(page.locator('.task-title')).toHaveText(['Optics'])
  expect(mock.tables.academic_subjects).toHaveLength(2)

  await page.locator('#study-subject').selectOption({ label: 'Maths' })
  await expect(page.locator('.task-title')).toHaveCount(3)
  await expect(page.locator('.task-title').first()).toHaveText('Laplace Transform')

  // Other pages follow the active subject
  await goto(page, /Priorities/)
  await expect(page.getByRole('button', { name: /Calculate Priorities \(3 topics\)/ })).toBeVisible()
})

test('priorities and quiz without topics send the user to PYQ Analysis', async ({ page }) => {
  await installMockBackend(page)
  await loginThroughUi(page)
  for (const name of [/Priorities/, /Study Now/, /Quiz/]) {
    await goto(page, name)
    await expect(page.getByText(/No topics yet/)).toBeVisible()
  }
})

test('refocusing the tab does not make fresh priorities look stale', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)
  await extract(page, 'Maths')
  await expect(page.getByText('Saved to "Maths"')).toBeVisible()
  await goto(page, /Priorities/)
  await page.getByRole('button', { name: /Calculate Priorities/ }).click()
  await expect(page.locator('.priority-table tbody tr')).toHaveCount(3)

  const readsBefore = mock.apiCalls.length
  await page.evaluate(() => {
    const setState = (value) => Object.defineProperty(document, 'visibilityState', { value, configurable: true })
    setState('hidden'); document.dispatchEvent(new Event('visibilitychange'))
    setState('visible'); document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await page.waitForTimeout(1500)
  await expect(page.getByText(/Topics have changed/)).toHaveCount(0)
  await expect(page.locator('.priority-table tbody tr')).toHaveCount(3)
  expect(mock.apiCalls.length).toBe(readsBefore)                          // no spurious API calls either
})
