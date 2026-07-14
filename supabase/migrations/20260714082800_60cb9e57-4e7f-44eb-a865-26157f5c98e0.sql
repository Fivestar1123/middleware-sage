ALTER TABLE public.split_history ADD COLUMN IF NOT EXISTS analysis jsonb;
ALTER TABLE public.split_history ADD COLUMN IF NOT EXISTS is_zip boolean NOT NULL DEFAULT false;
-- allow updating for backfilling analysis after split
DROP POLICY IF EXISTS "Users can update their own split history" ON public.split_history;
CREATE POLICY "Users can update their own split history" ON public.split_history FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);