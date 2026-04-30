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

    try {
      const result = await fetcherRef.current()
      cacheSet(keyRef.current, result)
      setData(result)
    } catch (e) {
      console.error(`[cache] Erro ao buscar ${keyRef.current}:`, e)
      // Se falhou (offline), tenta IndexedDB
      const persisted = await cacheGetPersisted<T>(keyRef.current)
      if (persisted) setData(persisted)
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
