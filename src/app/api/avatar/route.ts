import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/app/api/_lib/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

export async function POST(req: NextRequest) {
  // Só o próprio usuário troca a própria foto
  const auth = await requireUser(req)
  if (auth instanceof NextResponse) return auth

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY nao configurada no servidor' }, { status: 500 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const userId = auth.user.id
    if (!file) return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    if (!(file.type || '').startsWith('image/')) return NextResponse.json({ error: 'Envie uma imagem' }, { status: 400 })
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Imagem muito grande' }, { status: 413 })

    const path = `${userId}.jpg`
    const bytes = new Uint8Array(await file.arrayBuffer())

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, bytes, { upsert: true, contentType: file.type })
    if (upErr) return NextResponse.json({ error: `Upload falhou: ${upErr.message}` }, { status: 500 })

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const avatarUrl = urlData.publicUrl + '?t=' + Date.now()

    await Promise.all([
      supabase.from('financeiro_usu').update({ avatar_url: avatarUrl }).eq('id', userId),
      supabase.from('mecanico_usuarios').update({ avatar_url: avatarUrl }).eq('id', userId),
    ])

    return NextResponse.json({ avatar_url: avatarUrl })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
