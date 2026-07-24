'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { MecanicoProfile } from '@/lib/types'

export function useAdmin() {
  const [admin, setAdmin] = useState<MecanicoProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const verificar = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          router.replace('/login')
          return
        }

        // 1. Checar portal_permissoes (is_admin = true)
        const { data: perm } = await supabase
          .from('portal_permissoes')
          .select('is_admin, mecanico_role, mecanico_tecnico_nome')
          .eq('user_id', session.user.id)
          .single()

        if (perm?.is_admin) {
          // Buscar nome do perfil do portal
          const { data: portalProfile } = await supabase
            .from('financeiro_usu')
            .select('nome, email, avatar_url')
            .eq('id', session.user.id)
            .single()

          setAdmin({
            id: session.user.id,
            tecnico_nome: portalProfile?.nome || 'Admin',
            tecnico_email: portalProfile?.email || session.user.email || '',
            telefone: null,
            avatar_url: portalProfile?.avatar_url || null,
            cpf: null,
            ativo: true,
            role: 'admin',
            nome_pos: perm.mecanico_tecnico_nome || null,
            mecanico_role: null,
          })
          return
        }

        // 2. Fallback: checar mecanico_usuarios (legado)
        const { data } = await supabase
          .from('mecanico_usuarios')
          .select('*')
          .eq('id', session.user.id)
          .eq('role', 'admin')
          .single()

        if (data) {
          setAdmin(data as MecanicoProfile)
          return
        }

        // Não é admin
        router.replace('/')
      } catch {
        router.replace('/login')
      } finally {
        setLoading(false)
      }
    }
    verificar()
  }, [router])

  const logout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return { admin, loading, logout }
}
