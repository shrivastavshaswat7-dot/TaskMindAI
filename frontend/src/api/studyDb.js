// Supabase persistence for PYQ topics. Uses the signed-in user's session, so the row-level security
// policies on academic_subjects / study_topics apply (never the service-role key).
// Schema: backend/migrations/study_topics.sql
import { supabase } from '../supabase'
import {
  clampWeakness,
  findSubjectByName,
  groupTopicsBySubject,
  normalizeSubjectName,
  rowsFromTopics,
} from './studyMapping'

const UNIQUE_VIOLATION = '23505'

export async function loadStudyData(userId) {
  const [subjectsRes, topicsRes] = await Promise.all([
    supabase
      .from('academic_subjects')
      .select('id, name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase.from('study_topics').select('*').eq('user_id', userId),
  ])
  if (subjectsRes.error) throw subjectsRes.error
  if (topicsRes.error) throw topicsRes.error
  return {
    subjects: subjectsRes.data || [],
    topicsBySubject: groupTopicsBySubject(topicsRes.data),
  }
}

// Returns the existing subject (case-insensitive) or creates it
export async function ensureSubject(userId, name, knownSubjects) {
  const existing = findSubjectByName(knownSubjects, name)
  if (existing) return existing

  const subjectName = normalizeSubjectName(name)
  const { data, error } = await supabase
    .from('academic_subjects')
    .insert([{ user_id: userId, name: subjectName }])
    .select('id, name, created_at')
    .single()
  if (!error) return data

  // Created meanwhile (other tab / double click): read it back instead of failing
  if (error.code === UNIQUE_VIOLATION) {
    const { data: found, error: readError } = await supabase
      .from('academic_subjects')
      .select('id, name, created_at')
      .eq('user_id', userId)
      .eq('name', subjectName)
      .single()
    if (!readError) return found
  }
  throw error
}

// Upsert on (user_id, subject_id, topic_key): same PDFs again updates stats, never duplicates,
// and keeps the stored weakness. Returns the subject's full topic list afterwards.
export async function saveTopics(userId, subjectId, topics) {
  const rows = rowsFromTopics(userId, subjectId, topics)
  if (rows.length > 0) {
    const { error } = await supabase
      .from('study_topics')
      .upsert(rows, { onConflict: 'user_id,subject_id,topic_key' })
    if (error) throw error
  }
  const { data, error } = await supabase
    .from('study_topics')
    .select('*')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
  if (error) throw error
  return groupTopicsBySubject(data)[subjectId] || []
}

export async function saveWeakness(userId, subjectId, topicKey, weakness) {
  const value = clampWeakness(weakness)
  if (value === null) return
  const { error } = await supabase
    .from('study_topics')
    .update({ weakness: value, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .eq('topic_key', topicKey)
  if (error) throw error
}
