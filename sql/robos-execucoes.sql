-- Controle "já rodou hoje" dos robôs do servidor do app (José, 23/10/2026)
-- Projeto do portal: citrhumdkfivdzbmayde
--
-- O "Bom dia! Suas ordens estão no celular" (src/lib/vigia-os-push.ts) guardava o envio só na memória: se o
-- servidor reiniciasse entre 6h30 e 7h30 mandava de novo, e com 2 instâncias saía em dobro. Agora o servidor
-- grava aqui a chave do dia (ex.: 'bom-dia:2026-10-23') antes de mandar; a 2ª cópia bate na chave primária e
-- não manda. Enquanto esta tabela não existir, o app continua como antes (controle em memória).
-- Só o servidor (service_role) usa: RLS ligado e sem política para anon/authenticated.

create table if not exists robos_execucoes (
  chave     text primary key,
  criado_em timestamptz not null default now()
);

alter table robos_execucoes enable row level security;
