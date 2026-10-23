-- Ocorrências do Opa e sino de OS nova sem repetir (José, 23/10/2026)
-- Projeto do portal: citrhumdkfivdzbmayde
--
-- Essas tarefas rodavam no celular a cada abertura do app (2 aparelhos juntos = cópia em dobro). Agora rodam
-- no servidor (src/lib/robos-servidor.ts, laço de 5 min do instrumentation.ts), que confere antes de gravar.
-- Os índices abaixo garantem no banco que a 2ª cópia não entra (o servidor ignora o erro 23505).

-- 1) Opa sem resolver: uma ocorrência por (tipo, Opa, técnico). Em 23/10/2026 não há repetidas (9 linhas).
create unique index if not exists mecanico_ocorrencias_opa_unica
  on mecanico_ocorrencias (tipo, id_ordem, tecnico_nome)
  where tipo in ('opa_dia1', 'opa_dia2');

-- 2) Sino "Nova OS": um aviso por (OS, técnico). Em 23/10/2026 há 31 pares repetidos (ex.: OS-0855 do Danilo
--    2 vezes). Conferir:
--
-- select link, tecnico_nome, count(*) from mecanico_notificacoes
--  where tipo = 'nova_os' group by 1, 2 having count(*) > 1 order by 3 desc;
--
-- Limpeza (fica o aviso mais antigo; se algum dos repetidos já foi lido, marca o que fica como lido):
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
