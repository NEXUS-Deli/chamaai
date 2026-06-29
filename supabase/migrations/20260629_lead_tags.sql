-- Add tags array to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
