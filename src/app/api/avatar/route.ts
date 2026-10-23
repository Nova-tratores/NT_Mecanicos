import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario, supabaseAdmin } from '@/lib/apiAuth'

// Foto de perfil: só a do próprio usuário do token — o userId do formulário é ignorado (José, 23/10/2026)
export async function POST(req: NextRequest) {
  try {
    const u = await exigirUsuario(req)
    if (u instanceof NextResponse) return u
    const supabase = supabaseAdmin()

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Foto grande demais' }, { status: 413 })
    if (file.type && !file.type.startsWith('image/')) return NextResponse.json({ error: 'Envie uma imagem' }, { status: 400 })

    const userId = u.userId
    const path = `${userId}.jpg`
    const bytes = new Uint8Array(await file.arrayBuffer())

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, bytes, { upsert: true, contentType: file.type || 'image/jpeg' })
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
