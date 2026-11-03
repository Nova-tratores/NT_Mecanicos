-- Ciência das ocorrências no BANCO (03/11/2026)
-- O "Li e entendi" do pop-up de ocorrência (−3/−5 do Opa sem resolver) só era
-- lembrado no localStorage do celular: celular cheio/trocado = o pop-up voltava
-- a cada abertura. Agora a rota /api/ocorrencias/ciente grava ciente_em.
-- Sem esta coluna o app segue como antes (só o celular lembra). Idempotente.

ALTER TABLE mecanico_ocorrencias ADD COLUMN IF NOT EXISTS ciente_em TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
