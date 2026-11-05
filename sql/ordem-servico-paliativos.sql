-- Relatórios PALIATIVOS (José, 05/11/2026) — projeto do PORTAL (citrhumdkfivdzbmayde)
-- O técnico fez um serviço só para ajudar o cliente na hora, mas a OS não terminou. Cada visita paliativa vira
-- UMA linha aqui (a OS pode ter várias); o relatório FINALIZADO continua em "Ordem_Servico_Tecnicos" (um por OS).
-- A OS fica na fase "Preenchido Paliativo" até o técnico mandar o finalizado. O POS soma as horas/km de todos.
create table if not exists "Ordem_Servico_Paliativos" (
  id               bigserial primary key,
  "Ordem_Servico"  text not null,
  "TecResp1"       text,
  "TecResp2"       text,
  -- Falta de Peças | Falta de Identificar o Problema | Falta Ferramenta | Falta de Auxilio |
  -- Falta de Serviço de Terceiro | Falta de Tempo
  motivo           text not null,
  "DataInicio"     text,
  "DataFinal"      text,
  "TotalHora"      text,
  "TotalKm"        text,
  "NumPlaca"       text,
  -- o relatório inteiro, com as mesmas chaves de Ordem_Servico_Tecnicos (dias, fotos, peças, assinaturas…)
  dados            jsonb not null default '{}'::jsonb,
  pdf_url          text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_os_paliativos_os on "Ordem_Servico_Paliativos" ("Ordem_Servico", created_at);

alter table "Ordem_Servico_Paliativos" enable row level security;
drop policy if exists p_os_paliativos_ins on "Ordem_Servico_Paliativos";
create policy p_os_paliativos_ins on "Ordem_Servico_Paliativos"
  for insert to authenticated with check (true);
drop policy if exists p_os_paliativos_sel on "Ordem_Servico_Paliativos";
create policy p_os_paliativos_sel on "Ordem_Servico_Paliativos"
  for select to authenticated using (true);
drop policy if exists p_os_paliativos_upd on "Ordem_Servico_Paliativos";
create policy p_os_paliativos_upd on "Ordem_Servico_Paliativos"
  for update to authenticated using (true) with check (true);

-- Conferência (deve voltar 0)
select count(*) from "Ordem_Servico_Paliativos";
