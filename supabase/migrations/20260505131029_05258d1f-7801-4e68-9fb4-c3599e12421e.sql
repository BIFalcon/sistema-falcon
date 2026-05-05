ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS cnpj text;
COMMENT ON COLUMN public.hotels.cnpj IS 'CNPJ do hotel — usado para validar se documentos vinculados pertencem ao hotel correto.';