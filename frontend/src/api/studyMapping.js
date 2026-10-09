// Pure helpers (no Supabase / React) for saving PYQ topics. Kept separate so they can be unit tested
// with `npm test`. DB calls live in studyDb.js.

const MAX_SUBJECT_LENGTH = 80
export const DEFAULT_SUBJECT = 'General'

const toCount = (value) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

// "  engineering   maths " -> "engineering maths"; empty -> "General"
export function normalizeSubjectName(name) {
  const cleaned = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT_LENGTH)
  return cleaned || DEFAULT_SUBJECT
}

// Same subject regardless of letter case: "Maths" and "maths" must not become two subjects
export const findSubjectByName = (subjects, name) => {
  const wanted = normalizeSubjectName(name).toLowerCase()
  return subjects.find((s) => s.name.toLowerCase() === wanted)
}

// /api/extract Topics -> study_topics rows.
// `weakness` is deliberately NOT sent: new rows get the DB default (50) and re-extracting the same
// PDFs keeps whatever weakness the quizzes already produced.
export function rowsFromTopics(userId, subjectId, topics) {
  const seen = new Set()
  const rows = []
  for (const topic of topics || []) {
    const key = String(topic?.id ?? '').trim()
    const name = String(topic?.name ?? '').trim()
    if (!key || !name || seen.has(key)) continue
    seen.add(key)
    const avg = Number(topic.avg_marks)
    rows.push({
      user_id: userId,
      subject_id: subjectId,
      topic_key: key,
      name,
      unit: toCount(topic.unit),
      frequency: toCount(topic.frequency),
      papers_total: toCount(topic.papers_total),
      avg_marks: Number.isFinite(avg) && avg > 0 ? avg : 0,
      years: (Array.isArray(topic.years) ? topic.years : [])
        .map(Number)
        .filter((y) => Number.isInteger(y)),
      updated_at: new Date().toISOString(),
    })
  }
  return rows
}

// study_topics row -> the Topic object the rest of the app (and /api/priorities) expects
export const topicFromRow = (row) => ({
  id: row.topic_key,
  name: row.name,
  unit: row.unit ?? 0,
  frequency: row.frequency ?? 0,
  papers_total: row.papers_total ?? 0,
  avg_marks: Number(row.avg_marks) || 0,
  years: row.years || [],
  weakness: row.weakness ?? 50,
})

// Same order /api/extract uses: most frequent first, then higher marks
const byImportance = (a, b) => b.frequency - a.frequency || b.avg_marks - a.avg_marks

// rows -> { [subject_id]: [Topic] }
export function groupTopicsBySubject(rows) {
  const grouped = {}
  for (const row of rows || []) {
    if (!grouped[row.subject_id]) grouped[row.subject_id] = []
    grouped[row.subject_id].push(topicFromRow(row))
  }
  for (const id of Object.keys(grouped)) grouped[id].sort(byImportance)
  return grouped
}

// Supabase re-fires SIGNED_IN on tab refocus, which reloads the data. Keep the old reference when
// nothing changed, otherwise Priorities/Study Now think the topics changed ("stale" notice).
export const keepIfEqual = (prev, next) =>
  JSON.stringify(prev) === JSON.stringify(next) ? prev : next

// Keep the current subject if it still exists, else the remembered one, else the first
export function pickActiveSubjectId(subjects, currentId, rememberedId) {
  const exists = (id) => id && subjects.some((s) => s.id === id)
  if (exists(currentId)) return currentId
  if (exists(rememberedId)) return rememberedId
  return subjects[0]?.id || ''
}

export const clampWeakness = (value) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null
}
