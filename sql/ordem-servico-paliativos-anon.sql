-- Conserto 06/11/2026 — projeto do PORTAL (citrhumdkfivdzbmayde)
-- Erro no app: "new row violates row-level security policy for table Ordem_Servico_Paliativos".
-- As policies só liberavam "authenticated"; quando a sessão do técnico expira no celular o app grava
-- como anon (igual já funciona em Ordem_Servico_Tecnicos) e a tabela recusava.
drop policy if exists p_os_paliativos_ins on "Ordem_Servico_Paliativos";
create policy p_os_paliativos_ins on "Ordem_Servico_Paliativos"
  for insert to anon, authenticated with check (true);
drop policy if exists p_os_paliativos_sel on "Ordem_Servico_Paliativos";
create policy p_os_paliativos_sel on "Ordem_Servico_Paliativos"
  for select to anon, authenticated using (true);
drop policy if exists p_os_paliativos_upd on "Ordem_Servico_Paliativos";
create policy p_os_paliativos_upd on "Ordem_Servico_Paliativos"
  for update to anon, authenticated using (true) with check (true);
