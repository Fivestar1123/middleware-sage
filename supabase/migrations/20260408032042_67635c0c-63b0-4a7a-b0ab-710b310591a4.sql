
CREATE TABLE public.split_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  filename TEXT NOT NULL,
  original_size BIGINT NOT NULL,
  chunk_size_mb INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.split_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own split history"
  ON public.split_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own split history"
  ON public.split_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own split history"
  ON public.split_history FOR DELETE
  USING (auth.uid() = user_id);
