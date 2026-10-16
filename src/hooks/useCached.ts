import { useEffect, useState, useCallback, useRef } from 'react'
import { cacheGet, cacheSet, cacheIsFresh, cacheGetPersisted } from '@/lib/cache'

interface UseCachedOptions {
  skip?: boolean
}

interface UseCachedResult<T> {
  data: T | null
  loading: boolean
  refreshing: boolean
  refresh: () => void
}

const FETCH_TIMEOUT = 8000

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT) }),
  ]).finally(() => clearTimeout(timer))
}

export function useCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: UseCachedOptions,
): UseCachedResult<T> {
  const [data, setData] = useState<T | null>(() => cacheGet<T>(key))
  const [loading, setLoading] = useState(() => !cacheGet<T>(key))
  const [refreshing, setRefreshing] = useState(false)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const keyRef = useRef(key)
  keyRef.current = key
  const fetchingRef = useRef(false)

  const doFetch = useCallback(async (background: boolean) => {
    if (fetchingRef.current) return
    fetchingRef.current = true

    if (!background) setLoading(true)
    else setRefreshing(true)

    // Key do momento da busca: se a key mudar no meio, o resultado não pode
    // ser gravado/mostrado como se fosse da key nova
    const k = keyRef.current
    try {
      const result = await withTimeout(fetcherRef.current())
      // Só persiste se estiver online — evita sobrescrever cache offline com dados vazios
      if (navigator.onLine) {
        cacheSet(k, result)
      }
      if (keyRef.current === k) setData(result)
    } catch (e) {
      console.error(`[cache] Erro ao buscar ${k}:`, e)
      // Se falhou (offline), tenta IndexedDB
      const persisted = await cacheGetPersisted<T>(k)
      if (persisted && keyRef.current === k) setData(persisted)
    } finally {
      setLoading(false)
      setRefreshing(false)
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (options?.skip) {
      setLoading(false)
      return
    }

    const cached = cacheGet<T>(key)

    if (cached) {
      setData(cached)
      setLoading(false)
      if (!cacheIsFresh(key)) {
        doFetch(true)
      }
    } else {
      // Tenta IndexedDB antes de ir na rede
      cacheGetPersisted<T>(key).then((persisted) => {
        if (persisted) {
          setData(persisted)
          setLoading(false)
          // Dados do IndexedDB são stale, revalida em background
          doFetch(true)
        } else {
          doFetch(false)
        }
      })
    }
  }, [key, options?.skip])

  const refresh = useCallback(() => {
    const cached = cacheGet<T>(keyRef.current)
    doFetch(cached !== null)
  }, [doFetch])

  return { data, loading, refreshing, refresh }
}
