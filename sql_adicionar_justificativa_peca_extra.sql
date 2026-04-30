-- ============================================
-- Adicionar coluna 'JustificativaPecaExtra' na tabela Ordem_Servico_Tecnicos
-- Preenchida pelo técnico quando adiciona peças/serviços extras manualmente
-- ============================================

ALTER TABLE "Ordem_Servico_Tecnicos"
ADD COLUMN IF NOT EXISTS "JustificativaPecaExtra" TEXT;
