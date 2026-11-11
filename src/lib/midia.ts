// Links públicos dos arquivos com o domínio da Nova (midia.novatratores.com).
//
// O Supabase tem o domínio próprio `midia.novatratores.com` (CNAME na Namecheap →
// <ref>.supabase.co, add-on "Custom Domain"). Qualquer link
// `https://<ref>.supabase.co/storage/v1/object/public/...` vale igual em
// `https://midia.novatratores.com/storage/v1/object/public/...`.
//
// Só os LINKS PÚBLICOS mudam: o login e as consultas continuam no endereço do
// Supabase (trocar o NEXT_PUBLIC_SUPABASE_URL mudaria a chave da sessão e
// deslogaria todo mundo). Uploads também seguem pelo endereço original.
//
// Uso: `comMidia(createClient(...))` nos clientes que geram link com
// getPublicUrl, e `urlMidia(url)` em link montado à mão.

const MIDIA = (process.env.NEXT_PUBLIC_MIDIA_URL || 'https://midia.novatratores.com').replace(/\/+$/, '');

function origemSupabase(): string | null {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

const TRECHO_PUBLICO = '/storage/v1/object/public/';

/** Host do domínio dos arquivos (para listas de hosts permitidos). */
export function hostMidia(): string | null {
  if (MIDIA === 'off') return null;
  try {
    return new URL(MIDIA).host;
  } catch {
    return null;
  }
}

/** Link público de um arquivo, já no domínio da Nova (para montar à mão). */
export function urlPublica(bucket: string, caminho: string): string {
  const base = MIDIA === 'off' ? (process.env.NEXT_PUBLIC_SUPABASE_URL || '') : MIDIA;
  return `${base.replace(/\/+$/, '')}${TRECHO_PUBLICO}${bucket}/${caminho.replace(/^\/+/, '')}`;
}

/** Troca o endereço do Supabase pelo domínio da Nova num link PÚBLICO de arquivo. */
export function urlMidia<T extends string | null | undefined>(url: T, origem = origemSupabase()): T {
  if (!url || !origem || MIDIA === 'off') return url;
  const s = url as string;
  if (!s.startsWith(origem + TRECHO_PUBLICO)) return url;
  return (MIDIA + s.slice(origem.length)) as T;
}

type ComStorage = { storage: { from: (bucket: string) => { getPublicUrl: (...a: never[]) => { data: { publicUrl: string } } } } };

/** Faz o getPublicUrl deste cliente devolver o link com o domínio da Nova. */
export function comMidia<C>(cliente: C): C {
  const c = cliente as unknown as ComStorage;
  const storage = c?.storage;
  if (!storage || (storage as { __midia?: boolean }).__midia) return cliente;
  const fromOriginal = storage.from.bind(storage);
  storage.from = (bucket: string) => {
    const api = fromOriginal(bucket);
    const original = api.getPublicUrl.bind(api) as (...a: unknown[]) => { data: { publicUrl: string } };
    (api as { getPublicUrl: unknown }).getPublicUrl = (...args: unknown[]) => {
      const r = original(...args);
      return { ...r, data: { ...r.data, publicUrl: urlMidia(r.data.publicUrl) } };
    };
    return api;
  };
  (storage as { __midia?: boolean }).__midia = true;
  return cliente;
}
