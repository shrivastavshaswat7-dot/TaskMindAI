-- Academic intelligence layer
-- Additive migration. Does not replace backend/supabase_schema.sql.

-- 1. Typed document processing metadata
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_kind TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_kind IN ('syllabus', 'notes', 'pyq', 'other'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS subject_name TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (processing_status IN ('uploaded', 'processing', 'processed', 'failed'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- 2. Academic subjects (separate from attendance `subjects`)
CREATE TABLE IF NOT EXISTS academic_subjects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, name)
);

ALTER TABLE academic_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own academic subjects" ON academic_subjects;
CREATE POLICY "Users manage own academic subjects" ON academic_subjects
    FOR ALL USING (auth.uid() = user_id);

-- 3. Topics / subtopics
-- source_document_id ON DELETE CASCADE removes extracted topics when that document is deleted.
-- subject_id ON DELETE CASCADE only runs if the academic subject itself is deleted, not when a document is deleted.
CREATE TABLE IF NOT EXISTS topics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    subject_id UUID REFERENCES academic_subjects(id) ON DELETE CASCADE NOT NULL,
    parent_id UUID REFERENCES topics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source_document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own topics" ON topics;
CREATE POLICY "Users manage own topics" ON topics
    FOR ALL USING (auth.uid() = user_id);

-- 4. Extracted PYQ questions
-- document_id ON DELETE CASCADE removes PYQs extracted from that document.
-- topic_id ON DELETE SET NULL unmaps PYQs if a topic row is removed without deleting the PYQ's source document.
CREATE TABLE IF NOT EXISTS pyq_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    subject_id UUID REFERENCES academic_subjects(id) ON DELETE CASCADE NOT NULL,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    marks INTEGER,
    year INTEGER,
    difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pyq_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own pyq items" ON pyq_items;
CREATE POLICY "Users manage own pyq items" ON pyq_items
    FOR ALL USING (auth.uid() = user_id);
