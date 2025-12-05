-- ============================================
-- StudyOCR History Table
-- ============================================
-- Run this after the main schema to add history storage

-- ============================================
-- HISTORY TABLE
-- ============================================
-- Stores all OCR/analysis results for users
CREATE TABLE IF NOT EXISTS history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- File info
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_type TEXT NOT NULL, -- 'image', 'pdf', 'spreadsheet', 'text', 'screenshot'
  
  -- Result
  text TEXT NOT NULL, -- The extracted/analyzed text
  
  -- Token usage
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  
  -- Cost (what user was charged)
  cost DECIMAL(10, 6) NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_user_date ON history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_file_name ON history(user_id, file_name);

-- Enable Row Level Security
ALTER TABLE history ENABLE ROW LEVEL SECURITY;

-- Users can only access their own history
CREATE POLICY "Users can view own history" ON history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own history" ON history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own history" ON history
  FOR DELETE USING (auth.uid() = user_id);

-- Grant service role permissions (for backend)
GRANT ALL ON history TO service_role;

