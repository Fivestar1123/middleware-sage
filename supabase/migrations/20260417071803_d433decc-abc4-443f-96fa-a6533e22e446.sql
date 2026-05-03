-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create log_knowledge table for semantic search
CREATE TABLE public.log_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(1536),
  log_level TEXT,
  log_time TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for vector similarity search
CREATE INDEX ON public.log_knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- RPC function for similarity search
CREATE OR REPLACE FUNCTION match_logs(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM public.log_knowledge
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

ALTER TABLE public.log_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read knowledge base"
ON public.log_knowledge
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert knowledge"
ON public.log_knowledge
FOR INSERT
TO authenticated
WITH CHECK (true);