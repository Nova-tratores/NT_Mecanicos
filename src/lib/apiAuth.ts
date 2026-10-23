// Login das rotas /api do app (José, 23/10/2026): toda rota que lê dado sensível ou grava exige o
// "Authorization: Bearer <access token do Supabase>" (o cliente manda sozinho — lib/apiFetch.ts).
// Nome, cpf e user_id do técnico vêm SEMPRE do banco pelo usuário do token, nunca do corpo do pedido.
// Mesma regra de nome do /api/feed: portal_permissoes.mecanico_tecnico_nome; se vazio, financeiro_usu.nome;
// se vazio, o cadastro legado mecanico_usuarios.
import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'
import { serverEnv } from '@/lib/server-env'
import { cleanName } from '@/lib/relatorios'

type Rec = Record<string, unknown>

export interface UsuarioApi {
  userId: string
  email: string
  /** nome do técnico como o app grava (mecanico_tecnico_nome → financeiro_usu.nome → legado) */
  nome: string
  /** todos os jeitos de escrever o nome dele (POS, portal, legado) — para conferir nome que veio da tela */
  nomes: string[]
  cpf: string | null
  isAdmin: boolean
  mecanicoRole: string | null
}

const sem = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

let _sb: SupabaseClient | null = null
/** cliente com service_role; falha (não cai para a chave anon) se faltar a chave */
export function supabaseAdmin(): SupabaseClient {
  if (_sb) return _sb
  const url = serverEnv('NEXT_PUBLIC_SUPABASE_URL'), key = serverEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor')
  _sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return _sb
}

const nao = (msg: string, status = 401) => NextResponse.json({ error: msg }, { status })

/** confere o login; devolve o usuário ou a resposta 401/500 pronta */
export async function exigirUsuario(req: Request): Promise<UsuarioApi | NextResponse> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return nao('sem login')
  let sb: SupabaseClient
  try { sb = supabaseAdmin() } catch (e) { return nao((e as Error).message, 500) }
  const { data: auth, error } = await sb.auth.getUser(token)
  const uid = auth?.user?.id
  if (error || !uid) return nao('login inválido')

  const [perm, fu, mu] = await Promise.all([
    sb.from('portal_permissoes').select('is_admin, mecanico_role, mecanico_tecnico_nome').eq('user_id', uid).maybeSingle(),
    sb.from('financeiro_usu').select('nome, cpf, ativo').eq('id', uid).maybeSingle(),
    sb.from('mecanico_usuarios').select('tecnico_nome').eq('id', uid).maybeSingle(),
  ])
  const p = (perm.data || {}) as Rec, f = (fu.data || {}) as Rec, m = (mu.data || {}) as Rec
  if (f.ativo === false) return nao('usuário inativo', 403)
  const nomes = [p.mecanico_tecnico_nome, f.nome, m.tecnico_nome].map((x) => String(x || '').trim()).filter(Boolean)
  return {
    userId: uid,
    email: auth.user?.email || '',
    nome: nomes[0] || '',
    nomes: [...new Set(nomes)],
    cpf: (f.cpf as string) || null,
    isAdmin: p.is_admin === true,
    mecanicoRole: (p.mecanico_role as string) || null,
  }
}

/** só admin logado (rotas que eram da área /admin, desligada — a gestão é no Portal) */
export async function exigirAdmin(req: Request): Promise<UsuarioApi | NextResponse> {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  return u.isAdmin ? u : nao('sem permissão', 403)
}

/** o nome que veio da tela é um dos nomes do próprio usuário? (admin pode qualquer um) */
export function ehDoUsuario(u: UsuarioApi, nome: unknown): boolean {
  if (u.isAdmin) return true
  const n = sem(nome)
  return !!n && u.nomes.some((x) => sem(x) === n)
}

/** usa o nome da tela só se for dele; senão o nome do token */
export function nomeDoUsuario(u: UsuarioApi, daTela?: unknown): string {
  return daTela && ehDoUsuario(u, daTela) ? String(daTela).trim() : u.nome
}

/** chamada de servidor (portal, robôs): header "x-push-secret" igual ao env PUSH_SECRET */
export function segredoServidor(req: Request): boolean {
  const esperado = serverEnv('PUSH_SECRET')
  const veio = req.headers.get('x-push-secret') || ''
  if (!esperado || !veio) return false
  const a = Buffer.from(esperado), b = Buffer.from(veio)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** tira do texto de busca o que quebra/injeta filtro no .or() do PostgREST */
export function limparBusca(s: unknown, max = 80): string {
  return String(s ?? '').replace(/[,()%*\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** o nome (do GPS, da tela) é do usuário, comparando pelo nome canônico do relatório? (admin pode qualquer um) (José, 23/10/2026) */
export function nomeBateComUsuario(u: UsuarioApi, nome: unknown): boolean {
  if (ehDoUsuario(u, nome)) return true
  const alvo = cleanName(String(nome ?? ''))
  return !!alvo && u.nomes.some((n) => canonicoBate(alvo, cleanName(n)))
}

function canonicoBate(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const pa = a.split(' ').filter((w) => w.length >= 3), pb = b.split(' ').filter((w) => w.length >= 3)
  if (pa.length < 2 || pb.length < 2) return false
  return pa.every((w) => pb.includes(w)) || pb.every((w) => pa.includes(w))
}

const soPlaca = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** placas (sem hífen) e adesões do RotaExata do carro do usuário: tecnico_veiculos + frota_donos_relatorio
 *  (José, 23/10/2026) — técnico só vê rota/infrações do próprio carro; admin passa direto (quem chama confere isAdmin) */
export async function veiculosDoUsuario(u: UsuarioApi): Promise<{ placas: Set<string>; adesoes: Set<string> }> {
  const placas = new Set<string>(), adesoes = new Set<string>()
  const sb = supabaseAdmin()
  const [tv, fd] = await Promise.all([
    sb.from('tecnico_veiculos').select('tecnico_nome, placa, adesao_id'),
    sb.from('frota_donos_relatorio').select('chave, dono').not('dono', 'is', null),
  ])
  for (const r of (tv.data || []) as Rec[]) {
    if (!nomeBateComUsuario(u, r.tecnico_nome)) continue
    if (r.placa) placas.add(soPlaca(r.placa))
    if (r.adesao_id != null) adesoes.add(String(r.adesao_id))
  }
  for (const r of (fd.data || []) as Rec[]) if (r.chave && nomeBateComUsuario(u, r.dono)) placas.add(soPlaca(r.chave))
  placas.delete('')
  return { placas, adesoes }
}

/** a placa pedida é de um carro do usuário? (admin: sempre) */
export async function placaDoUsuario(u: UsuarioApi, placa: unknown): Promise<boolean> {
  if (u.isAdmin) return true
  const p = soPlaca(placa)
  return !!p && (await veiculosDoUsuario(u)).placas.has(p)
}
