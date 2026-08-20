-- Tabela de falhas permanentes da fila offline do app dos mecânicos.
-- O syncManager JÁ tenta gravar aqui (logFailureToServer) desde sempre,
-- mas a tabela nunca existiu — as falhas morriam em silêncio no aparelho.
-- Aplicar no SQL Editor do Supabase do portal.

create table if not exists sync_failures (
  id            bigserial primary key,
  tabela        text not null,
  acao          text not null,
  payload       jsonb,
  match_filter  jsonb,
  erro          text,
  os_id         text,
  criado_em     timestamptz not null default now(),
  resolvido_em  timestamptz
);

create index if not exists idx_sync_failures_os on sync_failures (os_id);
create index if not exists idx_sync_failures_criado on sync_failures (criado_em desc);

alter table sync_failures enable row level security;

-- O app dos técnicos grava com a chave anon (auth própria do app);
-- leitura fica pro service role (portal server-side) e autenticados.
drop policy if exists p_sync_failures_ins on sync_failures;
create policy p_sync_failures_ins on sync_failures
  for insert to anon, authenticated with check (true);

drop policy if exists p_sync_failures_sel on sync_failures;
create policy p_sync_failures_sel on sync_failures
  for select to authenticated using (true);
