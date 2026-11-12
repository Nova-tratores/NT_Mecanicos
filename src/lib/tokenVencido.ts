// Login vencido também identifica o técnico (José, 12/11/2026).
// O relatório não pode ficar preso no celular porque o login venceu: o servidor confere a ASSINATURA do token
// com a chave pública do Supabase (ES256, /auth/v1/.well-known/jwks.json) e aceita token vencido há até 30 dias.
// A assinatura prova quem é; só o prazo é relevado. Usado SÓ para receber relatório (não dá acesso a mais nada).
import { createPublicKey, verify, type JsonWebKey } from 'crypto'
import { serverEnv } from '@/lib/server-env'

const TOLERANCIA_S = 30 * 24 * 3600
let chaves: { em: number; lista: (JsonWebKey & { kid?: string })[] } | null = null

async function jwks(): Promise<(JsonWebKey & { kid?: string })[]> {
  if (chaves && Date.now() - chaves.em < 3600_000) return chaves.lista
  const url = serverEnv('NEXT_PUBLIC_SUPABASE_URL')
  if (!url) return []
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`, { cache: 'no-store' })
    const j = (await r.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
    chaves = { em: Date.now(), lista: j.keys || [] }
  } catch { return chaves?.lista || [] }
  return chaves.lista
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** id do usuário de um token com assinatura válida, mesmo vencido (até 30 dias). null = não confere. */
export async function usuarioDoTokenVencido(token: string): Promise<{ uid: string; email: string } | null> {
  const partes = token.split('.')
  if (partes.length !== 3) return null
  let cab: { alg?: string; kid?: string }, corpo: { sub?: string; email?: string; exp?: number; role?: string }
  try {
    cab = JSON.parse(b64url(partes[0]).toString('utf8'))
    corpo = JSON.parse(b64url(partes[1]).toString('utf8'))
  } catch { return null }
  if (cab.alg !== 'ES256' || !corpo.sub || corpo.role !== 'authenticated') return null
  if (corpo.exp && corpo.exp + TOLERANCIA_S < Date.now() / 1000) return null

  const chave = (await jwks()).find((k) => !cab.kid || k.kid === cab.kid)
  if (!chave) return null
  try {
    const ok = verify(
      'sha256',
      Buffer.from(`${partes[0]}.${partes[1]}`),
      { key: createPublicKey({ key: chave, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      b64url(partes[2]),
    )
    return ok ? { uid: corpo.sub, email: corpo.email || '' } : null
  } catch { return null }
}
