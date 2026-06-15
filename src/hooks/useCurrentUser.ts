'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { MecanicoProfile } from '@/lib/types'

const PROFILE_KEY = 'nt-mecanicos-profile'
const AUTH_TIMEOUT = 8000

function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('auth timeout')), AUTH_TIMEOUT)),
  ])
}

function getCachedProfile(): MecanicoProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function setCachedProfile(profile: MecanicoProfile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch { /* quota exceeded, ignore */ }
}

function clearCachedProfile() {
  try { localStorage.removeItem(PROFILE_KEY) } catch { /* */ }
}

export function useCurrentUser() {
  const [user, setUser] = useState<MecanicoProfile | null>(() => getCachedProfile())
  const [loading, setLoading] = useState(() => !getCachedProfile())
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = () => setRefreshKey(k => k + 1)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      // Se offline e tem perfil cacheado, usa direto sem tentar rede
      if (!navigator.onLine && getCachedProfile()) {
        setLoading(false)
        return
      }

      try {
        const { data: { session } } = await withTimeout(supabase.auth.getSession())

        if (!session) {
          // Se sem internet (ou internet instável) e tem perfil cacheado, usa o cache
          const cached = getCachedProfile()
          if (cached) {
            setUser(cached)
            setLoading(false)
            return
          }
          clearCachedProfile()
          routerRef.current.replace('/login')
          return
        }

        // 1. Checar portal_permissoes
        const { data: perm, error: permError } = await withTimeout(supabase
          .from('portal_permissoes')
          .select('is_admin, mecanico_role, mecanico_tecnico_nome')
          .eq('user_id', session.user.id)
          .single())

        // Se a query falhou (offline/rede instável), usar cache ao invés de continuar
        if (permError && !perm) {
          const cached = getCachedProfile()
          if (cached) {
            setUser(cached)
            setLoading(false)
            return
          }
        }

        if (cancelled) return

        if (perm && (perm.mecanico_role || perm.is_admin)) {
          const { data: portalProfile } = await withTimeout(supabase
            .from('financeiro_usu')
            .select('nome, email, avatar_url, ativo')
            .eq('id', session.user.id)
            .single())

          if (cancelled) return

          // Usuário inativado no portal: bloquear acesso ao app
          if (portalProfile && (portalProfile as { ativo?: boolean }).ativo === false) {
            clearCachedProfile()
            await supabase.auth.signOut()
            routerRef.current.replace('/login')
            return
          }

          if (perm.is_admin && !perm.mecanico_role) {
            routerRef.current.replace('/admin')
            return
          }

          const profile: MecanicoProfile = {
            id: session.user.id,
            tecnico_nome: portalProfile?.nome || 'Usuário',
            tecnico_email: portalProfile?.email || session.user.email || '',
            telefone: null,
            avatar_url: portalProfile?.avatar_url || null,
            ativo: true,
            role: perm.is_admin ? 'admin' : 'tecnico',
            nome_pos: perm.mecanico_tecnico_nome || null,
            mecanico_role: perm.mecanico_role as 'tecnico' | 'observador' | null,
          }
          setUser(profile)
          setCachedProfile(profile)
          setLoading(false)
          return
        }

        // 2. Fallback: checar mecanico_usuarios (legado)
        const { data, error: legacyError } = await withTimeout(supabase
          .from('mecanico_usuarios')
          .select('*')
          .eq('id', session.user.id)
          .single())

        if (cancelled) return

        if (data) {
          const profile = data as MecanicoProfile
          const email = profile.tecnico_email?.trim()

          if (email && !profile.nome_pos) {
            const { data: reqUser } = await withTimeout(supabase
              .from('req_usuarios')
              .select('nome')
              .ilike('email', `%${email}%`)
              .maybeSingle())

            let nomePOS = reqUser?.nome || null

            if (!nomePOS) {
              const { data: tecApp } = await withTimeout(supabase
                .from('Tecnicos_Appsheet')
                .select('UsuNome')
                .ilike('UsuEmail', `%${email}%`)
                .maybeSingle())
              nomePOS = tecApp?.UsuNome?.trim() || null
            }

            if (nomePOS) {
              const { data: tecExato } = await withTimeout(supabase
                .from('Tecnicos_Appsheet')
                .select('UsuNome')
                .ilike('UsuNome', `%${nomePOS}%`)
                .maybeSingle())
              if (tecExato?.UsuNome) nomePOS = tecExato.UsuNome.trim()
              profile.nome_pos = nomePOS
            }
          }

          if (cancelled) return
          setUser(profile)
          setCachedProfile(profile)
          setLoading(false)
          return
        }

        // Queries falharam (offline) — usar cache antes de redirecionar
        if ((permError || legacyError) && getCachedProfile()) {
          setLoading(false)
          return
        }

        clearCachedProfile()
        routerRef.current.replace('/login')
      } catch (err) {
        console.error('Erro ao carregar usuário:', err)
        // Se falhou (offline ou rede instável) e tem cache, usa o cache
        const cached = getCachedProfile()
        if (cached) {
          setUser(cached)
          setLoading(false)
          return
        }
        if (!cancelled) routerRef.current.replace('/login')
      }
    }
    load()

    return () => { cancelled = true }
  }, [refreshKey])

  const logout = async () => {
    clearCachedProfile()
    await supabase.auth.signOut()
    routerRef.current.replace('/login')
  }

  return { user, loading, logout, refresh }
}
