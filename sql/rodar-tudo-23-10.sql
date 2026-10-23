-- TUDO de 23/10/2026 num arquivo só — app dos técnicos (NT_Mecanicos)
-- Projeto Supabase: citrhumdkfivdzbmayde (o MESMO do Portal). Colar inteiro no SQL Editor e rodar.
-- Pode rodar de novo sem estragar.

-- 1) Relatórios repetidos: sai o rascunho duplicado, fica o enviado (OS-0526: fica o rascunho mais novo, 200).
--    Cópia das linhas apagadas guardada antes (backup-ost-duplicados.json no computador do José).
delete from "Ordem_Servico_Tecnicos"
 where "IdOs" in (158,159,160,161,172,197,198,199,203,204,206,207,208,209,210,211,396)
   and "Status" = 'rascunho';

-- 2) Um relatório por OS daqui para frente
create unique index if not exists ordem_servico_tecnicos_os_unico
  on "Ordem_Servico_Tecnicos" ("Ordem_Servico");

-- 3) "Bom dia" das 6h30 sem sair em dobro
create table if not exists robos_execucoes (
  chave     text primary key,
  criado_em timestamptz not null default now()
);
alter table robos_execucoes enable row level security;

-- 4) Opa e sino "Nova OS" sem repetir (limpa os 31 avisos repetidos, fica o mais antigo)
create unique index if not exists mecanico_ocorrencias_opa_unica
  on mecanico_ocorrencias (tipo, id_ordem, tecnico_nome)
  where tipo in ('opa_dia1', 'opa_dia2');

update mecanico_notificacoes m set lida = true
  from (select link, tecnico_nome from mecanico_notificacoes
         where tipo = 'nova_os' group by 1, 2 having count(*) > 1 and bool_or(lida)) r
 where m.tipo = 'nova_os' and m.link = r.link and m.tecnico_nome = r.tecnico_nome;

delete from mecanico_notificacoes m
 using (select id, row_number() over (partition by link, tecnico_nome order by id) as n
          from mecanico_notificacoes where tipo = 'nova_os') d
 where m.id = d.id and d.n > 1;

create unique index if not exists mecanico_notificacoes_nova_os_unica
  on mecanico_notificacoes (link, tecnico_nome)
  where tipo = 'nova_os';

-- 5) Falhas da fila do celular passam a ficar registradas (a tabela nunca existiu)
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
drop policy if exists p_sync_failures_ins on sync_failures;
create policy p_sync_failures_ins on sync_failures
  for insert to anon, authenticated with check (true);
drop policy if exists p_sync_failures_sel on sync_failures;
create policy p_sync_failures_sel on sync_failures
  for select to authenticated using (true);

-- Conferência (deve voltar vazio)
select "Ordem_Servico", count(*) from "Ordem_Servico_Tecnicos" group by 1 having count(*) > 1;
