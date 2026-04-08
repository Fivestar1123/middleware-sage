
-- Create storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('split-files', 'split-files', false);

-- Storage policies
CREATE POLICY "Users can upload their own split files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'split-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own split files"
ON storage.objects FOR SELECT
USING (bucket_id = 'split-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own split files"
ON storage.objects FOR DELETE
USING (bucket_id = 'split-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Add file_path column to split_history
ALTER TABLE public.split_history ADD COLUMN file_path TEXT;
