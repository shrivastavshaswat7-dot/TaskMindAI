// MOCKED-backend browser tests (see support/mockBackend.js) for the dashboard shell and page: everything shown comes from
// the app's own data, with real empty states, and the navigation works on desktop and on a phone-sized screen.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi, SAMPLE_TOPICS, USER } from './support/mockBackend.js'

const U = USER.id
const dayToday = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
const SEED = {
  tasks: [
    { id: 't1', user_id: U, title: 'Submit lab record', completed: false, priority: 'high', created_at: '2026-10-01T00:00:00Z' },
    { id: 't2', user_id: U, title: 'Read chapter 4', completed: true, priority: 'low', created_at: '2026-10-02T00:00:00Z' },
  ],
  timetable_entries: [
    { id: 'e1', user_id: U, day_of_week: dayToday, subject: 'Engineering Maths II', start_time: '09:00:00', end_time: '10:00:00', room: 'B-204', teacher: 'Dr. Rao', color: '#6d5dfc' },
  ],
  subjects: [{ id: 's1', user_id: U, name: 'Maths', total_classes: 20, attended_classes: 17, created_at: '2026-10-01T00:00:00Z' }],
  academic_subjects: [{ id: 'as1', user_id: U, name: 'Maths', created_at: '2026-10-01T00:00:00Z' }],
  study_topics: SAMPLE_TOPICS.map((t, i) => ({
    id: `st${i}`, user_id: U, subject_id: 'as1', topic_key: t.id, name: t.name, unit: t.unit, frequency: t.frequency,
    papers_total: t.papers_total, avg_marks: t.avg_marks, years: t.years, weakness: 50,
  })),
}

const stat = (page, label) => page.locator('.dx-stat', { hasText: label })
const dashboard = (page) => page.getByText('STUDENT DASHBOARD')

test('a new user sees honest empty states and a clear first step (nothing invented)', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)
  await expect(dashboard(page)).toBeVisible()

  const hero = page.getByRole('region', { name: 'Exam preparation' })
  await expect(hero.getByRole('heading', { name: 'Turn your past papers into a study plan' })).toBeVisible()
  await expect(stat(page, 'Pending tasks').locator('strong')).toHaveText('0')
  await expect(stat(page, 'Study topics').locator('strong')).toHaveText('0')
  await expect(stat(page, 'Attendance').locator('strong')).toHaveText('—')            // not a made-up 100%
  await expect(stat(page, 'Attendance')).toContainText('No classes tracked yet')
  await expect(page.getByText('No pending tasks!')).toBeVisible()
  await expect(page.getByText('No classes today!')).toBeVisible()

  await hero.getByRole('button', { name: /Analyse past papers/ }).click()
  await expect(page).toHaveURL(/\/pyq/)
  expect(mock.consoleErrors).toEqual([])
})

test('the dashboard reflects the real tasks, attendance, schedule and study progress', async ({ page }) => {
  const mock = await installMockBackend(page, { tables: SEED })
  await loginThroughUi(page)
  await expect(dashboard(page)).toBeVisible()

  await expect(stat(page, 'Pending tasks').locator('strong')).toHaveText('1')
  await expect(stat(page, 'Completed').locator('strong')).toHaveText('1')
  await expect(stat(page, 'Attendance').locator('strong')).toHaveText('85%')
  await expect(stat(page, 'Study topics').locator('strong')).toHaveText('3')
  await expect(page.getByText('Engineering Maths II')).toBeVisible()
  await expect(page.getByText('Submit lab record')).toBeVisible()

  // topics exist but no ranking yet: the hero asks for the next real step
  const hero = page.getByRole('region', { name: 'Exam preparation' })
  await expect(hero.getByRole('heading', { name: /3 topics ready in Maths/ })).toBeVisible()
  await hero.getByRole('button', { name: /Calculate priorities/ }).click()
  await expect(page).toHaveURL(/\/priorities/)

  // after ranking, the dashboard names the real top topic and the journey shows real progress
  await page.getByRole('button', { name: /Calculate Priorities/ }).click()
  await expect(page.locator('.priority-table tbody tr')).toHaveCount(3)
  await page.getByRole('link', { name: /Dashboard/ }).click()
  await expect(hero.getByRole('heading', { name: 'Laplace Transform' })).toBeVisible()
  await expect(hero.getByText('Priority 83')).toBeVisible()
  await expect(page.locator('.dx-step.done')).toHaveCount(2)                          // papers uploaded + topics ranked
  await expect(page.getByRole('button', { name: /Build a study plan/ })).not.toHaveClass(/done/)

  // the hero's quiz button opens the quiz for that topic
  await hero.getByRole('button', { name: /Take a quiz/ }).click()
  await expect(page).toHaveURL(/\/quiz/)
  await expect(page.locator('select.quiz-topic-select')).toHaveValue('laplace-transform')
  expect(mock.consoleErrors).toEqual([])
})

test('adding and completing a task from the dashboard still works', async ({ page }) => {
  const mock = await installMockBackend(page, { tables: SEED })
  await loginThroughUi(page)
  await page.getByPlaceholder('Add a new task...').fill('Prepare viva')
  await page.getByRole('button', { name: '+ Add Task' }).click()
  await expect(page.getByText('Prepare viva')).toBeVisible()
  expect(mock.tables.tasks.some((t) => t.title === 'Prepare viva' && t.user_id === USER.id)).toBe(true)

  await page.getByRole('button', { name: 'Mark as done' }).first().click()
  await expect.poll(() => mock.tables.tasks.filter((t) => t.completed).length).toBe(2)
})

test('the sidebar groups every page and marks the current one', async ({ page }) => {
  await installMockBackend(page)
  await loginThroughUi(page)
  const nav = page.getByRole('navigation')
  for (const group of ['Workspace', 'AI tools', 'Exam prep']) {
    await expect(nav.getByRole('group', { name: group })).toBeVisible()
  }
  for (const name of ['Dashboard', 'Tasks', 'Timetable', 'Attendance', 'AI Assistant', 'Email Assistant', 'PYQ Analysis', 'Priorities', 'Study Now', 'Quiz']) {
    await expect(nav.getByRole('link', { name })).toBeVisible()
  }
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveClass(/active/)
  await nav.getByRole('link', { name: 'Timetable' }).click()
  await expect(nav.getByRole('link', { name: 'Timetable' })).toHaveClass(/active/)
  await expect(nav.getByRole('link', { name: 'Dashboard' })).not.toHaveClass(/active/)
})

test.describe('phone-sized screen', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('navigation lives in a drawer that opens, navigates and closes; no sideways scrolling', async ({ page }) => {
    const mock = await installMockBackend(page, { tables: SEED })
    await loginThroughUi(page)
    await expect(dashboard(page)).toBeVisible()

    await expect(page.getByRole('link', { name: 'Tasks' })).not.toBeInViewport()        // drawer closed
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('link', { name: 'Tasks' })).toBeInViewport()
    await page.getByRole('link', { name: 'Tasks' }).click()                              // picking a page closes the drawer
    await expect(page.getByRole('heading', { name: 'Your Tasks' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Tasks' })).not.toBeInViewport()

    await page.getByRole('button', { name: 'Open menu' }).click()                        // the scrim closes it as well
    await page.locator('.sidebar-scrim').click({ position: { x: 370, y: 400 } })
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()

    await page.getByRole('button', { name: 'Open menu' }).click()                        // logout is reachable from the drawer
    await page.getByRole('button', { name: /Logout/ }).click()
    await expect(page.getByPlaceholder('Enter your email')).toBeVisible()
    expect(mock.consoleErrors).toEqual([])
  })
})
