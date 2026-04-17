ALTER TABLE public.log_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read knowledge base"
ON public.log_knowledge
FOR SELECT
TO authenticated
USING (true);