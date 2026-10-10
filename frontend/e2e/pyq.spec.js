// MOCKED-backend browser tests (see support/mockBackend.js) for the PYQ Analysis page: file selection, honest progress,
// results, errors and the hand-off to Priorities. The analysis itself is mocked, so these verify the UI and its wiring,
// not Gemini.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi, SAMPLE_TOPICS, USER } from './support/mockBackend.js'

const pdf = (name, bytes = 2048) => ({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(bytes, 1) })
const MB = 1024 * 1024

const openPage = async (page) => {
  await loginThroughUi(page)
  await page.getByRole('link', { name: /PYQ Analysis/ }).click()
  await expect(page.getByRole('heading', { name: 'Previous Year Papers' })).toBeVisible()
}
const fileInput = (page) => page.locator('input[type=file]')
const extractButton = (page) => page.getByRole('button', { name: /Extract Topics|Analyzing papers/ })
const count = (page) => page.locator('.pyq-count')

test('a new user sees an empty state and the three steps, with nothing invented', async ({ page }) => {
  await installMockBackend(page)
  await openPage(page)
  await expect(page.getByRole('list', { name: 'How it works' }).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByRole('heading', { name: 'No topics yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Rank these topics/ })).toHaveCount(0)
  await expect(page.getByText('No files yet')).toBeVisible()
  await expect(extractButton(page)).toBeDisabled()
})

test('selected papers are listed with their size and can be removed; skipped, duplicate and extra files are explained', async ({ page }) => {
  await installMockBackend(page)
  await openPage(page)

  await fileInput(page).setInputFiles([pdf('paper-2023.pdf', 300 * 1024), { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }])
  await expect(page.getByText('paper-2023.pdf')).toBeVisible()
  await expect(page.locator('.pyq-file-size')).toHaveText('300 KB')
  await expect(count(page)).toHaveText('1/10 · 300 KB')
  await expect(page.getByText('1 file was skipped: only PDFs are supported.')).toBeVisible()
  await expect(extractButton(page)).toBeEnabled()
  await expect(extractButton(page)).toHaveText('✨ Extract Topics (1)')

  await fileInput(page).setInputFiles(pdf('paper-2023.pdf', 300 * 1024))           // the same file again
  await expect(count(page)).toHaveText('1/10 · 300 KB')
  await expect(page.getByText('1 duplicate ignored.')).toBeVisible()

  const more = Array.from({ length: 10 }, (_, i) => pdf(`extra-${i}.pdf`, 1000 + i))   // 1 + 10 = 11 > 10
  await fileInput(page).setInputFiles(more)
  await expect(page.locator('.pyq-files li')).toHaveCount(10)
  await expect(page.getByText('Maximum 10 PDFs allowed at once: 1 not added.')).toBeVisible()

  await page.getByRole('button', { name: 'Remove extra-3.pdf' }).click()
  await expect(page.locator('.pyq-files li')).toHaveCount(9)
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.getByText('No files yet')).toBeVisible()
  await expect(extractButton(page)).toBeDisabled()
})

test('analysis shows honest progress, then a summary, the topics, and a hand-off to Priorities', async ({ page }) => {
  const mock = await installMockBackend(page)
  mock.extractDelayMs = 1500
  await openPage(page)
  await page.locator('#pyq-subject').fill('Maths')
  await fileInput(page).setInputFiles([pdf('a.pdf'), pdf('b.pdf')])
  await extractButton(page).click()

  // while working: clearly in progress, nothing can be changed, no invented percentage
  await expect(page.getByText('Reading 2 papers and finding repeated topics…')).toBeVisible()
  await expect(extractButton(page)).toBeDisabled()
  await expect(extractButton(page)).toHaveText('Analyzing papers...')
  await expect(page.locator('#pyq-subject')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove a.pdf' })).toBeDisabled()
  await expect(page.getByText(/\d+%/)).toHaveCount(0)

  // done: saved, summary, topics with real numbers
  await expect(page.getByText('Saved to "Maths"')).toBeVisible()
  await expect(page.getByText('Found 3 topics in 2 papers.')).toBeVisible()
  await expect(page.locator('.task-title')).toHaveText(['Laplace Transform', 'Fourier Series', 'Matrices'])
  await expect(page.locator('.pyq-chip', { hasText: 'topics' }).locator('strong')).toHaveText('3')
  await expect(page.locator('.pyq-chip', { hasText: 'Subject' })).toContainText('Maths')
  await expect(page.locator('.pyq-chip', { hasText: 'papers analysed' }).locator('strong')).toHaveText('4')
  await expect(page.locator('.pyq-chip', { hasText: 'Years' })).toContainText('2021–2024')
  await expect(page.locator('.pyq-topic').first()).toContainText('4/4 papers')
  await expect(page.locator('.pyq-topic').first()).toContainText('avg 10 marks')
  expect(mock.tables.study_topics).toHaveLength(3)

  // the analysed topics flow straight into the priorities workflow
  await page.getByRole('button', { name: 'Rank these topics →' }).first().click()
  await expect(page).toHaveURL(/\/priorities/)
  await page.getByRole('button', { name: /Calculate Priorities \(3 topics\)/ }).click()
  await expect(page.locator('.priority-table tbody tr')).toHaveCount(3)
  await expect(page.locator('.priority-table tbody tr').first()).toContainText('Laplace Transform')
  expect(mock.consoleErrors).toEqual([])
})

test('a network failure gets a clear message, keeps the files, and a retry works', async ({ page }) => {
  const mock = await installMockBackend(page)
  mock.extractMode = 'abort'
  await openPage(page)
  await fileInput(page).setInputFiles(pdf('retry.pdf'))
  await extractButton(page).click()

  await expect(page.getByText(/Could not reach the analysis server/)).toBeVisible()
  await expect(page.getByText(/may be waking up/)).toBeVisible()
  await expect(page.getByText('Failed to fetch')).toHaveCount(0)               // not the raw browser message
  await expect(page.getByText('retry.pdf')).toBeVisible()                      // still selected
  await expect(extractButton(page)).toBeEnabled()

  mock.extractMode = 'ok'
  await extractButton(page).click()
  await expect(page.getByText(/Saved to "General"/)).toBeVisible()
  await expect(page.getByText(/Could not reach the analysis server/)).toHaveCount(0)
  await expect(page.locator('.task-title')).toHaveCount(3)
})

test('a server error is shown as the server described it, and the files stay selected', async ({ page }) => {
  const mock = await installMockBackend(page)
  mock.extractMode = 'fail'
  await openPage(page)
  await fileInput(page).setInputFiles([pdf('x.pdf'), pdf('y.pdf')])
  await extractButton(page).click()

  await expect(page.getByRole('alert').filter({ hasText: 'The AI service failed to analyze the PDFs' })).toBeVisible()
  await expect(page.locator('.pyq-files li')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'No topics yet' })).toBeVisible()   // nothing was fabricated
  expect(mock.tables.study_topics).toHaveLength(0)
})

test('more than 18 MB in total is blocked before anything is sent', async ({ page }) => {
  const mock = await installMockBackend(page)
  await openPage(page)
  await fileInput(page).setInputFiles([pdf('big-1.pdf', 10 * MB), pdf('big-2.pdf', 10 * MB)])

  await expect(page.getByRole('alert').filter({ hasText: 'the limit is 18 MB' })).toBeVisible()
  await expect(count(page)).toHaveClass(/bad/)
  await expect(extractButton(page)).toBeDisabled()
  expect(mock.apiCalls.filter((c) => c.path === '/api/extract')).toHaveLength(0)

  await page.getByRole('button', { name: 'Remove big-2.pdf' }).click()
  await expect(extractButton(page)).toBeEnabled()
})

test('the drop zone is keyboard accessible', async ({ page }) => {
  await installMockBackend(page)
  await openPage(page)
  const zone = page.getByRole('button', { name: 'Add PYQ PDF files' })
  await zone.focus()
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  const fileChooser = await chooser
  expect(fileChooser.isMultiple()).toBe(true)
})

test.describe('phone-sized screen', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('long file names and many topics do not cause sideways scrolling', async ({ page }) => {
    const U = USER.id
    const tables = {
      academic_subjects: [{ id: 'as1', user_id: U, name: 'Engineering Mathematics II', created_at: '2026-10-01T00:00:00Z' }],
      study_topics: SAMPLE_TOPICS.map((t, i) => ({
        id: `st${i}`, user_id: U, subject_id: 'as1', topic_key: t.id, name: t.name, unit: t.unit, frequency: t.frequency,
        papers_total: t.papers_total, avg_marks: t.avg_marks, years: t.years, weakness: 50,
      })),
    }
    await installMockBackend(page, { tables })
    await loginThroughUi(page)
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('link', { name: /PYQ Analysis/ }).click()
    await expect(page.locator('.pyq-topic')).toHaveCount(3)

    await fileInput(page).setInputFiles(pdf('End-Semester-Examination-Engineering-Mathematics-II-December-2023-Regular-Batch-Question-Paper.pdf'))
    await expect(page.locator('.pyq-files li')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(extractButton(page)).toBeVisible()
  })
})
