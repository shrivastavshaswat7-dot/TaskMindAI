// MOCKED-backend browser tests for the Quiz page (see support/mockBackend.js). They prove the page's behaviour: a real
// quiz is shown as a real quiz, every failure is reported with its reason and a Retry, and sample questions are only
// ever an explicit choice that never saves anything. They do NOT prove that the live AI service works.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi, SAMPLE_TOPICS, USER } from './support/mockBackend.js'

const U = USER.id
const SEED = {
  academic_subjects: [{ id: 'as1', user_id: U, name: 'Maths', created_at: '2026-10-01T00:00:00Z' }],
  study_topics: SAMPLE_TOPICS.map((t, i) => ({
    id: `st${i}`, user_id: U, subject_id: 'as1', topic_key: t.id, name: t.name, unit: t.unit, frequency: t.frequency,
    papers_total: t.papers_total, avg_marks: t.avg_marks, years: t.years, weakness: 50,
  })),
}

async function openQuiz(page, mockOptions = {}) {
  const mock = await installMockBackend(page, { tables: SEED, ...mockOptions })
  await loginThroughUi(page)
  await page.getByRole('link', { name: 'Quiz' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a Topic' })).toBeVisible()
  return mock
}

const start = (page) => page.getByRole('button', { name: /Start Quiz/ })
const quizCalls = (mock) => mock.apiCalls.filter((c) => c.path === '/api/quiz')
const alert = (page) => page.getByRole('alert')

test('a real quiz: the questions come from the service for the chosen topic and are not marked as sample', async ({ page }) => {
  const mock = await openQuiz(page)
  await start(page).click()
  await expect(page.getByText(/Question 1 of 5/)).toBeVisible()
  await expect(page.getByText('Sample mode')).toHaveCount(0)
  await expect(page.getByText(/Sample questions/)).toHaveCount(0)
  expect(quizCalls(mock)).toHaveLength(1)
  expect(quizCalls(mock)[0].body).toMatchObject({ topic_id: expect.any(String), topic_name: expect.any(String) })
  expect(quizCalls(mock)[0].authorization).toBe('Bearer mock-access-token-1')     // sent as the signed-in user
})

test('a failing service is reported with its reason and a Retry; it never silently becomes a sample quiz', async ({ page }) => {
  const mock = await openQuiz(page)
  mock.quizFails = true                                                            // 503: provider busy
  await start(page).click()
  await expect(alert(page)).toContainText('Could not start the quiz')
  await expect(alert(page)).toContainText('usage limit reached')
  await expect(page.getByText('Sample mode')).toHaveCount(0)
  await expect(page.getByText(/Question 1 of/)).toHaveCount(0)

  mock.quizFails = false                                                           // service recovers: Retry gives the real quiz
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText(/Question 1 of 5/)).toBeVisible()
  await expect(page.getByText('Sample mode')).toHaveCount(0)
  expect(quizCalls(mock)).toHaveLength(2)
})

test('a slow service (504) says so', async ({ page }) => {
  const mock = await openQuiz(page)
  mock.quizFails = 504
  await start(page).click()
  await expect(alert(page)).toContainText('took too long')
})

test('network failure and a server that never answers are explained, not hidden', async ({ page }) => {
  const mock = await openQuiz(page)
  mock.apiMode['/api/quiz'] = 'abort'
  await start(page).click()
  await expect(alert(page)).toContainText(/connect|network|reach/i)
  mock.apiMode['/api/quiz'] = 'hang'                                               // the test server times out after 3 s
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(alert(page)).toContainText(/too long|not respond|waiting/i, { timeout: 10_000 })
  await expect(page.getByText('Sample mode')).toHaveCount(0)
})

test('an answer without usable questions is an error, not an empty or sample quiz', async ({ page }) => {
  const mock = await openQuiz(page)
  for (const body of [{ questions: [] }, { questions: [{ q: 'No options?', options: [] }, null] }, { nothing: true }]) {
    mock.quizBody = body
    await start(page).click()
    await expect(alert(page)).toContainText('without usable questions')
    await expect(page.getByText(/Question 1 of/)).toHaveCount(0)
    await expect(page.getByText('Sample mode')).toHaveCount(0)
  }
})

test('an expired session (401) sends the user to the login screen instead of a fake quiz', async ({ page }) => {
  const mock = await openQuiz(page)
  mock.apiFail['/api/quiz'] = 401
  await start(page).click()
  await expect(page.getByPlaceholder('Enter your email')).toBeVisible()           // refreshed once, then signed out
  await expect(page.getByText('Sample mode')).toHaveCount(0)
})

test('double-clicking Start asks the service once', async ({ page }) => {
  const mock = await openQuiz(page)
  await start(page).dblclick()
  await expect(page.getByText(/Question 1 of 5/)).toBeVisible()
  expect(quizCalls(mock)).toHaveLength(1)
})

test('sample practice is an explicit choice, is labelled, and its result is never saved', async ({ page }) => {
  const mock = await openQuiz(page)
  mock.quizFails = true
  await start(page).click()
  const topicsBefore = JSON.stringify(mock.tables.study_topics)
  await page.getByRole('button', { name: /Practice with sample questions/ }).click()
  await expect(page.getByText('Sample mode')).toBeVisible()
  await expect(page.getByText(/practice only/i)).toBeVisible()
  for (let i = 0; i < 4; i++) {
    await page.locator('.quiz-option').first().click()
    if (i < 3) await page.getByRole('button', { name: /Next/ }).click()
  }
  await page.getByRole('button', { name: 'Submit Quiz' }).click()
  await expect(page.getByText(/score was not saved/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update Priorities' })).toHaveCount(0)
  expect(mock.apiCalls.some((c) => c.path === '/api/quiz/submit' || c.path === '/api/priorities')).toBe(false)
  expect(JSON.stringify(mock.tables.study_topics)).toBe(topicsBefore)
})

test('a real quiz still saves the new weakness through Update Priorities', async ({ page }) => {
  const mock = await openQuiz(page)
  await start(page).click()
  for (let i = 0; i < 5; i++) {
    await page.locator('.quiz-option').first().click()
    if (i < 4) await page.getByRole('button', { name: /Next/ }).click()
  }
  await page.getByRole('button', { name: 'Submit Quiz' }).click()
  await expect(page.getByRole('button', { name: 'Update Priorities' })).toBeVisible()
  expect(mock.apiCalls.some((c) => c.path === '/api/quiz/submit')).toBe(true)
  await page.getByRole('button', { name: 'Update Priorities' }).click()
  await expect.poll(() => mock.tables.study_topics.some((t) => t.weakness !== 50)).toBe(true)
})
