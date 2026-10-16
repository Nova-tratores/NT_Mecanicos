import { useEffect, useCallback, useRef } from 'react'
import { offlineGet, offlineSet, offlineDelete } from '@/lib/offlineCache'

/**
 * Salva automaticamente o estado do formulário no localStorage.
 *
 * Uso:
 *   const { restore, clear, saveNow } = useFormBackup(`os-preencher-${id}`, getFormData, setFormData)
 *
 * - getFormData: função que retorna todos os campos do form como objeto
 * - setFormData: função que recebe o objeto e seta os campos
 * - Chame restore() manualmente APÓS carregar dados iniciais (Supabase, etc.)
 * - Chame clear() após salvar/enviar com sucesso
 * - Chame saveNow() para forçar um save imediato
 *
 * Fotos tiradas offline ficam no form como base64 (centenas de KB cada) e
 * estouram os ~5MB do localStorage — antes o setItem falhava calado e o backup
 * inteiro (inclusive os textos) parava de ser atualizado. Agora, se não couber
 * no localStorage, o backup vai para o IndexedDB (cota bem maior). O restore
 * usa a cópia mais recente das duas.
 */
export function useFormBackup(
  key: string,
  getFormData: () => Record<string, unknown>,
  setFormData: (data: Record<string, unknown>) => void,
  deps: unknown[] = [],
) {
  const prefixedKey = `nt-form:${key}`
  const idbKey = `form-backup:${key}`
  const getRef = useRef(getFormData)
  getRef.current = getFormData
  const setRef = useRef(setFormData)
  setRef.current = setFormData
  const readyRef = useRef(false)
  // Último getFormData salvo: se a identidade não mudou (useCallback com as
  // mesmas deps), os dados não mudaram — evita serializar MBs de base64 a cada 1s.
  const lastSavedRef = useRef<unknown>(null)

  const save = useCallback(() => {
    if (!readyRef.current) return
    const getter = getRef.current
    if (getter === lastSavedRef.current) return
    try {
      const data = getter()
      const hasData = Object.values(data).some(v =>
        v !== '' && v !== false && v !== null && v !== undefined &&
        !(Array.isArray(v) && v.length === 0)
      )
      if (!hasData) return
      lastSavedRef.current = getter
      // blob: (preview de foto ainda subindo) não sobrevive a um reload —
      // salvar como vazio para o técnico ver o quadro vazio e tirar de novo,
      // em vez de uma imagem quebrada que some no envio.
      const json = JSON.stringify({ _t: Date.now(), ...data }, (_k, v) =>
        typeof v === 'string' && v.startsWith('blob:') ? '' : v,
      )
      try {
        localStorage.setItem(prefixedKey, json)
        offlineDelete(idbKey).catch(() => {})
      } catch {
        // localStorage cheio (fotos base64) → IndexedDB
        try { localStorage.removeItem(prefixedKey) } catch { /* indisponível */ }
        offlineSet(idbKey, json).catch(() => {})
      }
    } catch {
      // dados não serializáveis — ignora
    }
  }, [prefixedKey, idbKey])

  // Salvar a cada 1 segundo
  useEffect(() => {
    const interval = setInterval(save, 1000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, ...deps])

  // Salvar quando minimiza/troca de aba/fecha
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') save()
    }
    const handleBeforeUnload = () => save()

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handleBeforeUnload)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handleBeforeUnload)
    }
  }, [save])

  const restore = useCallback(async (): Promise<boolean> => {
    try {
      const parse = (raw: unknown): Record<string, unknown> | null => {
        if (typeof raw !== 'string' || !raw) return null
        try {
          const d = JSON.parse(raw)
          return d && typeof d === 'object' ? d : null
        } catch { return null }
      }
      let local: Record<string, unknown> | null = null
      try { local = parse(localStorage.getItem(prefixedKey)) } catch { /* indisponível */ }
      const idb = parse(await offlineGet<string>(idbKey))
      const data = (idb && (!local || Number(idb._t || 0) > Number(local._t || 0))) ? idb : local
      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _t, ...fields } = data
        setRef.current(fields)
        console.log(`[backup] Restaurado: ${key}`)
        return true
      }
    } catch {
      // dados corrompidos, ignora
    } finally {
      readyRef.current = true
    }
    return false
  }, [prefixedKey, idbKey, key])

  // Limpar backup após envio com sucesso
  const clear = useCallback(() => {
    try { localStorage.removeItem(prefixedKey) } catch { /* indisponível */ }
    offlineDelete(idbKey).catch(() => {})
    // um save que já estava agendado não deve recriar o backup recém-limpo
    lastSavedRef.current = getRef.current
    console.log(`[backup] Limpo: ${key}`)
  }, [prefixedKey, idbKey, key])

  return { restore, clear, saveNow: save }
}
