-- Sugestões de integridade (área admin / rotas /api). NÃO foi executado em nenhum banco.
-- Revisar e aplicar manualmente no SQL Editor do Supabase.
--
-- Motivo: várias rotas fazem "consulta se existe → insere" sem trava. Duas abas
-- (ou dois admins/técnicos abrindo o app ao mesmo tempo) inserem em duplicidade.
-- Um índice único faz o 2º insert falhar em vez de duplicar (as rotas já tratam o erro).
--
-- ATENÇÃO: se já existirem duplicados, o CREATE UNIQUE INDEX falha. Rode antes a
-- consulta de diagnóstico de cada bloco e limpe os duplicados.

-- 1) /api/opa/escalar — chamado no load do layout admin E do layout técnico.
--    Diagnóstico:
--    select tipo, id_ordem, tecnico_nome, count(*) from mecanico_ocorrencias
--     where tipo in ('opa_dia1', 'opa_dia2') group by 1, 2, 3 having count(*) > 1;
create unique index if not exists uq_mecanico_ocorrencias_opa
  on mecanico_ocorrencias (tipo, id_ordem, tecnico_nome)
  where tipo in ('opa_dia1', 'opa_dia2');

-- 2) /api/mecanicos?nome=... (GET) insere alertas detectados; requisições
--    simultâneas (realtime + clique) podem gravar o mesmo alerta duas vezes.
--    Diagnóstico:
--    select tecnico_nome, tipo, id_ordem, count(*) from mecanico_alertas
--     group by 1, 2, 3 having count(*) > 1;
--    Obs.: a rota insere os novos alertas em lote; com o índice, um conflito faz o
--    lote inteiro falhar (é refeito no próximo carregamento). Depois de criar o
--    índice, vale trocar o .insert(...) da rota por
--    .upsert(..., { onConflict: 'tecnico_nome,tipo,id_ordem', ignoreDuplicates: true }).
create unique index if not exists uq_mecanico_alertas_tec_tipo_os
  on mecanico_alertas (tecnico_nome, tipo, id_ordem);

-- 3) /api/clientes acao=salvar_etiqueta — duplo clique gravava a mesma etiqueta 2x.
--    Diagnóstico:
--    select cnpj_cpf, etiqueta_id, count(*) from cliente_etiqueta_map
--     group by 1, 2 having count(*) > 1;
create unique index if not exists uq_cliente_etiqueta_map
  on cliente_etiqueta_map (cnpj_cpf, etiqueta_id);
