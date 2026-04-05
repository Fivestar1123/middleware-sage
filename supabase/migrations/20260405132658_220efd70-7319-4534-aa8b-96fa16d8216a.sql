
CREATE TABLE public.analysis_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  filename TEXT NOT NULL DEFAULT 'unknown',
  log_content TEXT NOT NULL,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.analysis_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own history"
ON public.analysis_history FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own history"
ON public.analysis_history FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own history"
ON public.analysis_history FOR DELETE
USING (auth.uid() = user_id);

CREATE INDEX idx_analysis_history_user_id ON public.analysis_history (user_id);
CREATE INDEX idx_analysis_history_created_at ON public.analysis_history (created_at DESC);
