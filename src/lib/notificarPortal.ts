import { supabase } from './supabase'
import { offlineWrite } from './offlineWrite'
import { offlineGet } from './offlineCache'

interface PermissaoPortal {
  user_id: string
  is_admin?: boolean
  modulos_permitidos?: string[] | null
}

/**
 * Busca usuários do portal que devem receber notificação.
 * Online: consulta o Supabase. Offline (ou falha): usa o cache do prefetch,
 * para que a notificação possa ser enfileirada e enviada ao reconectar.
 */
async function getUsuariosPortal(modulo?: string): Promise<PermissaoPortal[]> {
  let permissoes: PermissaoPortal[] | null = null

  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const { data } = await supabase
        .from('portal_permissoes')
        .select('user_id, is_admin, modulos_permitidos')
      permissoes = (data as PermissaoPortal[]) || null
    } catch { /* cai no cache abaixo */ }
  }

  if (!permissoes || permissoes.length === 0) {
    permissoes = await offlineGet<PermissaoPortal[]>('prefetch:portal-permissoes')
  }

  if (!permissoes || permissoes.length === 0) return []
  return permissoes.filter(
    (p) => p.is_admin || (!!modulo && !!p.modulos_permitidos && p.modulos_permitidos.includes(modulo)),
  )
}

/** Insere as notificações (uma por usuário) via fila offline — sobe ao reconectar. */
async function inserirNotificacoes(
  usuarios: PermissaoPortal[],
  base: { tipo: string; titulo: string; descricao: string; link: string },
) {
  await Promise.all(
    usuarios.map((u) =>
      offlineWrite({
        table: 'portal_notificacoes',
        action: 'insert',
        data: { user_id: u.user_id, ...base },
      }),
    ),
  )
}

/** Notifica usuários do portal que têm acesso ao módulo de requisições. */
export async function notificarPortalReq(titulo: string, descricao: string) {
  try {
    const usuarios = await getUsuariosPortal('requisicoes')
    if (usuarios.length === 0) return
    await inserirNotificacoes(usuarios, { tipo: 'requisicao', titulo, descricao, link: '/requisicoes' })
  } catch (err) {
    console.error('Erro ao notificar portal (req):', err)
  }
}

/** Notifica portal quando técnico envia uma OS (relatório técnico). */
export async function notificarPortalOS(ordemServico: string, tecnico: string, cliente: string) {
  try {
    const usuarios = await getUsuariosPortal('pos')
    if (usuarios.length === 0) return
    await inserirNotificacoes(usuarios, {
      tipo: 'os_tecnico',
      titulo: `OS ${ordemServico} enviada`,
      descricao: `${tecnico} enviou o relatório técnico da OS ${ordemServico} (${cliente})`,
      link: `/pos/ordens/${ordemServico}`,
    })
  } catch (err) {
    console.error('Erro ao notificar portal (OS):', err)
  }
}
