-- Cópia de segurança de todo relatório que o técnico envia (José, 12/11/2026)
-- Projeto do PORTAL: citrhumdkfivdzbmayde
--
-- Problema: o relatório só existia no celular até gravar em "Ordem_Servico_Tecnicos". Se o login tinha
-- vencido ou o sinal estava fraco, ficava na fila do aparelho e o app mostrava "guardada no celular" —
-- o portal não via nada (OS-0900 e OS-0893, 11/11). Agora o app manda o relatório inteiro para o servidor
-- no Enviar; o servidor guarda aqui e ele mesmo grava na OS. Do celular não depende mais.
--
-- Só o servidor (service_role) mexe: RLS ligada e nenhuma política para anon/authenticated.

create table if not exists public.relatorios_recebidos (
  id            bigserial primary key,
  ordem_servico text        not null,
  tipo          text        not null default 'final',   -- 'final' (paliativo continua no caminho dele)
  tecnico_nome  text,
  user_id       uuid,
  token_vencido boolean     not null default false,      -- chegou com o login já vencido
  payload       jsonb       not null,
  recebido_em   timestamptz not null default now(),
  aplicado_em   timestamptz,                              -- quando gravou em Ordem_Servico_Tecnicos
  id_os         integer,                                  -- IdOs da linha gravada
  erro          text                                      -- última falha ao gravar (o robô tenta de novo)
);

create index if not exists relatorios_recebidos_os on public.relatorios_recebidos (ordem_servico, recebido_em desc);
create index if not exists relatorios_recebidos_pendentes on public.relatorios_recebidos (recebido_em) where aplicado_em is null;

alter table public.relatorios_recebidos enable row level security;
revoke all on public.relatorios_recebidos from anon, authenticated;

-- Conferência:
-- select id, ordem_servico, tecnico_nome, token_vencido, recebido_em, aplicado_em, id_os, erro
--   from relatorios_recebidos order by id desc limit 20;
