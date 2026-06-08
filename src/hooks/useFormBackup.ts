import { useEffect, useCallback, useRef } from 'react'

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
 */
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

  const save = useCallback(() => {
    if (!readyRef.current) return
    try {
      const data = getRef.current()
      const hasData = Object.values(data).some(v =>
        v !== '' && v !== false && v !== null && v !== undefined &&
        !(Array.isArray(v) && v.length === 0)
      )
      if (hasData) {
        localStorage.setItem(prefixedKey, JSON.stringify({ _t: Date.now(), ...data }))
      }
    } catch {
      // storage cheio ou indisponível
    }
  }, [prefixedKey])

  // Salvar a cada 1 segundo
  useEffect(() => {
    const interval = setInterval(save, 1000)
    return () => clearInterval(interval)
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

  const restore = useCallback(() => {
    try {
      const saved = localStorage.getItem(prefixedKey)
      if (saved) {
        const data = JSON.parse(saved)
        if (data && typeof data === 'object') {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { _t, ...fields } = data
          setRef.current(fields)
          console.log(`[backup] Restaurado: ${key}`)
          readyRef.current = true
          return true
        }
      }
    } catch {
      // dados corrompidos, ignora
    }
    readyRef.current = true
    return false
  }, [prefixedKey, key])

  // Limpar backup após envio com sucesso
  const clear = useCallback(() => {
    localStorage.removeItem(prefixedKey)
    console.log(`[backup] Limpo: ${key}`)
  }, [prefixedKey, key])

  return { restore, clear, saveNow: save }
}
