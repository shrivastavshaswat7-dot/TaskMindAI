// Docs/CONTRACT.md ke endpoints. Pages yahin se call karein, fetch duplicate na karein.

async function request(url, options) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`)
  return data
}

const postJson = (url, body) =>
  request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// PYQ PDFs -> { topics: [Topic] }
export function extractTopics(files) {
  const formData = new FormData()
  for (const file of files) formData.append('files', file)
  return request('/api/extract', { method: 'POST', body: formData })
}

// { topics, days_left } -> { ranked: [Topic + priority + reason] }
export const getPriorities = (topics, daysLeft) =>
  postJson('/api/priorities', { topics, days_left: daysLeft })

// { ranked, hours, days_left } -> { blocks: [{ topic, minutes, why }] }
export const getPlan = (ranked, hours, daysLeft) =>
  postJson('/api/plan', { ranked, hours, days_left: daysLeft })

// { topic_id } -> { questions: [{ q, options, answer, subtopic }] }
export const getQuiz = (topicId) =>
  postJson('/api/quiz', { topic_id: topicId })

// { topic_id, answers } -> { score, total, weak_subtopics, updated_weakness }
// answers: har question ke liye chuna hua option (question order mein)
export const submitQuiz = (topicId, answers) =>
  postJson('/api/quiz/submit', { topic_id: topicId, answers })
