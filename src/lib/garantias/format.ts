export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function fmtMoeda(n: number | null | undefined): string {
  return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function tempoDecorrido(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const ms = Date.now() - d.getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const dias = Math.floor(h / 24)
  return `há ${dias}d`
}

export function diasEntre(aIso: string | null | undefined, bIso?: string | null): number | null {
  if (!aIso) return null
  const a = new Date(aIso).getTime()
  const b = bIso ? new Date(bIso).getTime() : Date.now()
  if (isNaN(a) || isNaN(b)) return null
  return Math.max(0, Math.floor((b - a) / 86400000))
}
