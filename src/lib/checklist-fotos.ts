// Fotos do checklist de veículo em pasta PRIVADA (bucket `frota-checklist`),
// a mesma regra do portal (Portal_Nova_Tratores: lib/frota/checklist-fotos).
// O banco guarda "frota-checklist/<caminho>"; quem mostra assina um link de
// 1 hora depois de conferir o login. Fotos antigas (URL pública do bucket
// `requisicoes`) passam como estão até o script do portal movê-las.
import type { SupabaseClient } from '@supabase/supabase-js'

export const BUCKET_CHECKLIST = 'frota-checklist'
const PREFIXO = `${BUCKET_CHECKLIST}/`

export function caminhoPrivado(fotoUrl: string | null | undefined): string | null {
  return fotoUrl && fotoUrl.startsWith(PREFIXO) ? fotoUrl.slice(PREFIXO.length) : null
}

export async function subirFotoChecklist(sb: SupabaseClient, caminho: string, buffer: Buffer, contentType: string): Promise<{ ref: string } | { erro: string }> {
  const subir = () => sb.storage.from(BUCKET_CHECKLIST).upload(caminho, buffer, { upsert: true, contentType })
  let { error } = await subir()
  if (error && /bucket not found/i.test(error.message)) {
    await sb.storage.createBucket(BUCKET_CHECKLIST, { public: false })
    ;({ error } = await subir())
  }
  return error ? { erro: error.message } : { ref: PREFIXO + caminho }
}

export async function assinarFotos<T extends { foto_url?: string | null }>(sb: SupabaseClient, linhas: T[]): Promise<T[]> {
  const caminhos = [...new Set(linhas.map((l) => caminhoPrivado(l.foto_url)).filter((c): c is string => !!c))]
  if (caminhos.length === 0) return linhas
  const { data } = await sb.storage.from(BUCKET_CHECKLIST).createSignedUrls(caminhos, 3600)
  const porCaminho = new Map((data || []).map((d) => [d.path, d.signedUrl]))
  return linhas.map((l) => {
    const c = caminhoPrivado(l.foto_url)
    return c ? { ...l, foto_url: porCaminho.get(c) || null } : l
  })
}

/** Usuário logado (token do Supabase Auth no header Authorization). */
export async function usuarioDoToken(sb: SupabaseClient, authorization: string | null): Promise<string | null> {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data, error } = await sb.auth.getUser(token)
  return error || !data?.user ? null : data.user.id
}
