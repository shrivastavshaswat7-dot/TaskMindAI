// Run with: npm test   (node's built-in test runner, no extra dependencies)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampWeakness,
  findSubjectByName,
  keepIfEqual,
  pickActiveSubjectId,
  groupTopicsBySubject,
  normalizeSubjectName,
  rowsFromTopics,
  topicFromRow,
} from './studyMapping.js'

const topic = (over = {}) => ({
  id: 'laplace-transform', name: 'Laplace Transform', unit: 1, frequency: 7,
  papers_total: 10, avg_marks: 10, years: [2019, 2023], weakness: 50, ...over,
})

test('normalizeSubjectName trims, collapses spaces, defaults to General', () => {
  assert.equal(normalizeSubjectName('  Engineering   Maths '), 'Engineering Maths')
  assert.equal(normalizeSubjectName('   '), 'General')
  assert.equal(normalizeSubjectName(undefined), 'General')
  assert.equal(normalizeSubjectName('x'.repeat(200)).length, 80)
})

test('findSubjectByName matches case-insensitively', () => {
  const subjects = [{ id: 's1', name: 'Maths' }]
  assert.equal(findSubjectByName(subjects, ' maths ')?.id, 's1')
  assert.equal(findSubjectByName(subjects, 'Physics'), undefined)
})

test('rowsFromTopics never sends weakness (re-extract keeps quiz results)', () => {
  const [row] = rowsFromTopics('u1', 's1', [topic({ weakness: 90 })])
  assert.equal('weakness' in row, false)
  assert.equal(row.user_id, 'u1')
  assert.equal(row.subject_id, 's1')
  assert.equal(row.topic_key, 'laplace-transform')
})

test('rowsFromTopics drops duplicates and invalid topics (no duplicate rows)', () => {
  const rows = rowsFromTopics('u1', 's1', [
    topic(), topic({ name: 'Laplace again' }), { id: '', name: 'x' }, { id: 'a' }, null,
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Laplace Transform')
})

test('rowsFromTopics sanitizes numbers and years', () => {
  const [row] = rowsFromTopics('u1', 's1', [
    topic({ unit: '2', frequency: -3, papers_total: 'x', avg_marks: 'abc', years: [2020, 'n/a', 2021.5, '2022'] }),
  ])
  assert.equal(row.unit, 2)
  assert.equal(row.frequency, 0)
  assert.equal(row.papers_total, 0)
  assert.equal(row.avg_marks, 0)
  assert.deepEqual(row.years, [2020, 2022])
})

test('topicFromRow restores the Topic contract shape', () => {
  const t = topicFromRow({
    topic_key: 'fourier', name: 'Fourier', unit: 2, frequency: 3, papers_total: 4,
    avg_marks: '7.5', years: [2021], weakness: 80, subject_id: 's1',
  })
  assert.deepEqual(t, {
    id: 'fourier', name: 'Fourier', unit: 2, frequency: 3, papers_total: 4,
    avg_marks: 7.5, years: [2021], weakness: 80,
  })
})

test('groupTopicsBySubject separates subjects and sorts by frequency then marks', () => {
  const row = (subject_id, topic_key, frequency, avg_marks) => ({
    subject_id, topic_key, name: topic_key, frequency, avg_marks,
  })
  const grouped = groupTopicsBySubject([
    row('s1', 'b', 1, 5), row('s2', 'x', 9, 9), row('s1', 'a', 3, 1), row('s1', 'c', 1, 8),
  ])
  assert.deepEqual(grouped.s1.map((t) => t.id), ['a', 'c', 'b'])
  assert.deepEqual(grouped.s2.map((t) => t.id), ['x'])
})

test('clampWeakness rounds, clamps and rejects junk', () => {
  assert.equal(clampWeakness(44.6), 45)
  assert.equal(clampWeakness(150), 100)
  assert.equal(clampWeakness(-5), 0)
  assert.equal(clampWeakness('abc'), null)
})

test('keepIfEqual keeps the old reference when data is unchanged', () => {
  const prev = { s1: [{ id: 'a', weakness: 50 }] }
  assert.equal(keepIfEqual(prev, { s1: [{ id: 'a', weakness: 50 }] }), prev)
  const next = { s1: [{ id: 'a', weakness: 80 }] }
  assert.equal(keepIfEqual(prev, next), next)
})

test('pickActiveSubjectId prefers current, then remembered, then first', () => {
  const subjects = [{ id: 's1' }, { id: 's2' }]
  assert.equal(pickActiveSubjectId(subjects, 's2', 's1'), 's2')
  assert.equal(pickActiveSubjectId(subjects, 'gone', 's2'), 's2')
  assert.equal(pickActiveSubjectId(subjects, '', 'gone'), 's1')
  assert.equal(pickActiveSubjectId([], 's1', 's1'), '')
})
