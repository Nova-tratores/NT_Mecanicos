-- Adicionar campos Fazenda e Cidade na tabela Ordem_Servico_Tecnicos
ALTER TABLE "Ordem_Servico_Tecnicos"
ADD COLUMN IF NOT EXISTS "Fazenda" text,
ADD COLUMN IF NOT EXISTS "Cidade" text;
