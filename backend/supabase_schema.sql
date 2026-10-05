-- Phase 2: Enhanced Tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_priority_score FLOAT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_priority_reason TEXT;

-- Phase 3: Timetable Management
CREATE TABLE IF NOT EXISTS timetable_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Monday
    subject TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room TEXT,
    teacher TEXT,
    color TEXT DEFAULT '#6d5dfc',
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own timetable" ON timetable_entries;
CREATE POLICY "Users can manage own timetable" ON timetable_entries
    FOR ALL USING (auth.uid() = user_id);

-- Phase 4: Attendance Tracking
CREATE TABLE IF NOT EXISTS subjects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    total_classes INT DEFAULT 0,
    attended_classes INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own subjects" ON subjects;
CREATE POLICY "Users manage own subjects" ON subjects FOR ALL USING (auth.uid() = user_id);

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own attendance" ON attendance_records;
CREATE POLICY "Users manage own attendance" ON attendance_records FOR ALL USING (auth.uid() = user_id);

-- Phase 6: RAG Document Assistant
CREATE TABLE IF NOT EXISTS documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_index INT NOT NULL,
    -- embedding VECTOR(768), -- Enable pgvector extension and uncomment this if using vector embeddings
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Uncomment these lines if you have pgvector enabled on your Supabase instance:
-- CREATE EXTENSION IF NOT EXISTS vector;
-- ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding VECTOR(768);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own documents" ON documents;
CREATE POLICY "Users manage own documents" ON documents FOR ALL USING (auth.uid() = user_id);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own chunks" ON document_chunks;
CREATE POLICY "Users manage own chunks" ON document_chunks FOR ALL USING (auth.uid() = user_id);
