import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'nt-mecanicos-auth',
  },
})

/**
 * Headers com o JWT da sessão atual, para chamar rotas /api que exigem login.
 * Uso: fetch(url, { headers: { ...(await authHeaders()), 'Content-Type': 'application/json' } })
 */
export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

/**
 * Busca todos os registros de uma tabela, paginando automaticamente
 * para contornar o limite padrão de 1000 linhas do Supabase.
 */
export async function fetchAll<T = Record<string, unknown>>(
  table: string,
  query?: {
    select?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filters?: (q: any) => any
    order?: { column: string; ascending?: boolean }
  },
): Promise<T[]> {
  const PAGE_SIZE = 1000
  const all: T[] = []
  let from = 0

  while (true) {
    let q: any = supabase.from(table).select(query?.select || '*')
    if (query?.filters) q = query.filters(q)
    if (query?.order) q = q.order(query.order.column, { ascending: query.order.ascending ?? true })
    q = q.range(from, from + PAGE_SIZE - 1)

    const { data, error } = await q
    if (error) {
      // Antes falhava em silêncio (retornava lista parcial/vazia como se fosse completa)
      console.error(`[fetchAll] ${table}:`, error.message)
      break
    }
    if (!data) break

    all.push(...(data as T[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return all
}
