-- Study topics persistence (PYQ analysis results + per-topic weakness).
-- Additive migration: run once in Supabase Dashboard -> SQL Editor.
-- Requires backend/migrations/academic_intelligence.sql (academic_subjects) to be applied first.
-- Does not touch the existing `topics` table, which belongs to the document-upload pipeline.

CREATE TABLE IF NOT EXISTS study_topics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    subject_id UUID REFERENCES academic_subjects(id) ON DELETE CASCADE NOT NULL,
    -- The id /api/extract gives the topic (slug, e.g. "laplace-transform"). Unique per subject,
    -- so extracting the same PDFs again updates rows instead of duplicating them.
    topic_key TEXT NOT NULL,
    name TEXT NOT NULL,
    unit INTEGER NOT NULL DEFAULT 0 CHECK (unit >= 0),
    frequency INTEGER NOT NULL DEFAULT 0 CHECK (frequency >= 0),
    papers_total INTEGER NOT NULL DEFAULT 0 CHECK (papers_total >= 0),
    avg_marks NUMERIC NOT NULL DEFAULT 0 CHECK (avg_marks >= 0),
    years INTEGER[] NOT NULL DEFAULT '{}',
    weakness INTEGER NOT NULL DEFAULT 50 CHECK (weakness BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, subject_id, topic_key)
);

CREATE INDEX IF NOT EXISTS study_topics_user_subject_idx ON study_topics (user_id, subject_id);

ALTER TABLE study_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own study topics" ON study_topics;
-- WITH CHECK also requires the subject to belong to the same user, so a row can never point at
-- someone else's subject (a plain foreign key only checks that the subject exists).
CREATE POLICY "Users manage own study topics" ON study_topics
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM academic_subjects s
            WHERE s.id = study_topics.subject_id AND s.user_id = auth.uid()
        )
    );
