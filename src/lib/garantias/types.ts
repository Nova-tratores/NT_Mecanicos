// Tipos do módulo de Garantias (espelhado do portal; mesma base Supabase).

export type GarantiaStatus =
  | 'aberta'
  | 'em_analise'
  | 'bo_tecnico'
  | 'enviada'
  | 'info_pendente'
  | 'aprovada'
  | 'rejeitada'

export type GarantiaResultado = 'aprovada' | 'rejeitada'
export type PendenciaTipo = 'bo' | 'info_fabrica'
export type PendenciaStatus = 'aberta' | 'respondida'
export type PecaOrigem = 'ppv' | 'pecasinfo_manual'
export type PecaResultado = 'pendente' | 'aprovada' | 'rejeitada'
export type AnexoCategoria =
  | 'tecnico'
  | 'garantista'
  | 'pendencia_pedido'
  | 'pendencia_resposta'
  | 'retorno_fabrica'
  | 'envio_fabrica'

export type ChecklistFieldTipo =
  | 'secao'
  | 'texto'
  | 'numero'
  | 'data'
  | 'checkbox'
  | 'select'
  | 'file'

export interface ChecklistField {
  id: string
  tipo: ChecklistFieldTipo
  label: string
  obrigatorio: boolean
  opcoes?: string[]
  ajuda?: string
}

export interface Montadora {
  id: string
  nome: string
  ativo: boolean
  checklist_def: ChecklistField[]
  cor: string | null
  logo_url: string | null
  contato_fabrica: string | null
  created_at: string
  updated_at: string
}

export interface GarantiaPeca {
  id: string
  garantia_id: string
  cod_produto: string | null
  descricao: string
  quantidade: number
  preco_unitario: number
  origem: PecaOrigem | null
  fonte_ppv_id: string | null
  resultado: PecaResultado
  created_at: string
}

export interface GarantiaPendencia {
  id: string
  garantia_id: string
  tipo: PendenciaTipo
  status: PendenciaStatus
  descricao: string
  exige_visita: boolean
  criado_por: string
  resposta_texto: string | null
  respondido_por: string | null
  respondido_em: string | null
  created_at: string
}

export interface GarantiaAnexo {
  id: string
  garantia_id: string
  pendencia_id: string | null
  categoria: AnexoCategoria
  url: string
  nome_arquivo: string | null
  content_type: string | null
  enviado_por: string | null
  created_at: string
}

export interface Garantia {
  id: string
  numero: string
  id_ordem: string
  chassis: string | null
  modelo: string | null
  cliente: string | null
  ppv_ids: string | null
  montadora_id: string | null
  status: GarantiaStatus
  tecnico_nome: string
  garantista_nome: string | null
  tecnico_horas: number
  tecnico_km: number
  tecnico_obs: string | null
  garantista_horas: number | null
  garantista_km: number | null
  garantista_obs: string | null
  resultado: GarantiaResultado | null
  motivo_recusa: string | null
  retorno_fabrica_url: string | null
  valor_pago_horas: number | null
  valor_pago_km: number | null
  valor_pago_pecas: number | null
  valor_pago_total: number | null
  enviada_fabrica_em: string | null
  finalizada_em: string | null
  created_at: string
  updated_at: string
}

export interface GarantiaResumo extends Garantia {
  montadora: { id: string; nome: string; cor: string | null } | null
  pecas: { id: string }[]
  pendencias: {
    id: string
    tipo: PendenciaTipo
    status: PendenciaStatus
    descricao: string
    exige_visita: boolean
  }[]
  anexos: {
    id: string
    categoria: AnexoCategoria
    url: string
    nome_arquivo: string | null
    created_at: string
  }[]
}

export interface GarantiaDetalhe extends Garantia {
  montadora: Montadora | null
  pecas: GarantiaPeca[]
  pendencias: GarantiaPendencia[]
  anexos: GarantiaAnexo[]
}

export interface PecaOS {
  cod_produto: string | null
  descricao: string
  quantidade: number
  preco_unitario: number
  origem: PecaOrigem
  fonte_ppv_id: string | null
}

export interface OSElegivel {
  id_ordem: string
  cliente: string
  chassis: string | null
  data: string
  tipo_servico: string
  serv_solicitado: string
}
