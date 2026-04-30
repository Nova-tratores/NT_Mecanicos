-- Adicionar campos de almoço na tabela Ordem_Servico_Tecnicos
ALTER TABLE "Ordem_Servico_Tecnicos"
  ADD COLUMN IF NOT EXISTS "TemAlmoco" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ValorAlmoco" numeric(10,2),
  ADD COLUMN IF NOT EXISTS "FotoAlmoco" text;
