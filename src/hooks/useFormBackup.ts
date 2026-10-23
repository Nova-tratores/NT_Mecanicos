import { useEffect, useCallback, useRef, useState } from 'react'
import { offlineGet, offlineSetOuErro, offlineDelete } from '@/lib/offlineCache'

/**
 * Salva automaticamente o estado do formulário no celular.
 *
 * Uso:
 *   const { restore, clear, saveNow, aviso } = useFormBackup(`os-preencher-${id}`, getFormData, setFormData)
 *
 * - getFormData: função que retorna todos os campos do form como objeto
 * - setFormData: função que recebe o objeto e seta os campos
 * - Chame restore() manualmente APÓS carregar dados iniciais (Supabase, etc.) — devolve Promise<boolean>
 * - Chame clear() após salvar/enviar com sucesso
 * - Chame saveNow() para forçar um save imediato
 * - aviso: texto para mostrar ao técnico quando o backup não coube no celular ('' = tudo certo)
 *
 * Guardado no IndexedDB (José, 23/10/2026): no localStorage o limite é ~5 MB e as fotos/assinaturas em base64
 * estouravam sem ninguém saber — o backup parava de salvar. Backups antigos do localStorage são migrados.
 */
/** mesmo valor: referência igual ou, para lista/objeto, mesmo conteúdo */
function mesmoValor(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
}

export function useFormBackup(
  key: string,
  getFormData: () => Record<string, unknown>,
  setFormData: (data: Record<string, unknown>) => void,
  deps: unknown[] = [],
) {
  const prefixedKey = `nt-form:${key}`
  const getRef = useRef(getFormData)
  getRef.current = getFormData
  const setRef = useRef(setFormData)
  setRef.current = setFormData
  const readyRef = useRef(false)
  const ultimoRef = useRef<Record<string, unknown> | null>(null)
  const gravandoRef = useRef(false)
  const geracaoRef = useRef(0)
  const [aviso, setAviso] = useState('')

  const save = useCallback(() => {
    if (!readyRef.current || gravandoRef.current) return
    try {
      const data = getRef.current()
      const hasData = Object.values(data).some(v =>
        v !== '' && v !== false && v !== null && v !== undefined &&
        !(Array.isArray(v) && v.length === 0)
      )
      if (!hasData) return
      // nada mudou desde a última gravação: compara por referência e, em lista/objeto recriado a cada chamada
      // (ex.: pecasGarantia), pelo conteúdo — antes regravava tudo a cada 1 s (José, 23/10/2026)
      const ult = ultimoRef.current
      if (ult && Object.keys(data).length === Object.keys(ult).length && Object.keys(data).every((k) => mesmoValor(data[k], ult[k]))) return
      gravandoRef.current = true
      const geracao = geracaoRef.current
      offlineSetOuErro(prefixedKey, { _t: Date.now(), ...data })
        .then(() => {
          // limpou enquanto gravava: apaga de novo
          if (geracao !== geracaoRef.current) { void offlineDelete(prefixedKey); return }
          ultimoRef.current = data; setAviso('')
        })
        .catch((err) => {
          const nome = String((err as { name?: string })?.name || '')
          const msg = String((err as { message?: string })?.message || err)
          console.warn('[backup] não salvou:', nome, msg)
          setAviso(/quota/i.test(nome + msg)
            ? 'O celular está sem espaço: o rascunho deste formulário não está sendo guardado. Libere espaço ou envie assim que puder.'
            : 'Não foi possível guardar o rascunho no celular. Envie assim que puder.')
        })
        .finally(() => { gravandoRef.current = false })
    } catch {
      // storage indisponível
    }
  }, [prefixedKey])

  // Salvar a cada 1 segundo (só grava quando algo mudou)
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
    let data: Record<string, unknown> | null = null
    try {
      data = await offlineGet<Record<string, unknown>>(prefixedKey)
      // backup antigo (localStorage): migra e apaga de lá
      if (!data) {
        const antigo = localStorage.getItem(prefixedKey)
        if (antigo) data = JSON.parse(antigo)
      }
      try { localStorage.removeItem(prefixedKey) } catch { /* sem localStorage */ }
    } catch {
      // dados corrompidos, ignora
    }
    if (data && typeof data === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _t, ...fields } = data
      setRef.current(fields)
      console.log(`[backup] Restaurado: ${key}`)
      readyRef.current = true
      return true
    }
    readyRef.current = true
    return false
  }, [prefixedKey, key])

  // Limpar backup após envio com sucesso: marca o que está na tela como "já salvo" (só mudança nova regrava).
  // clear(true) = formulário encerrado: NÃO grava mais até abrir a tela de novo (restore) — no relatório, a
  // atualização do PPV regravava o rascunho e, ao reeditar, ele voltava por cima do banco (José, 23/10/2026)
  const clear = useCallback((parar = false) => {
    geracaoRef.current++
    if (parar) readyRef.current = false
    try { ultimoRef.current = getRef.current() } catch { ultimoRef.current = null }
    void offlineDelete(prefixedKey)
    try { localStorage.removeItem(prefixedKey) } catch { /* sem localStorage */ }
    console.log(`[backup] Limpo: ${key}`)
  }, [prefixedKey, key])

  return { restore, clear, saveNow: save, aviso }
}
