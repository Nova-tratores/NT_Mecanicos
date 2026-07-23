import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const userId = formData.get('userId') as string
    if (!file || !userId) return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })

    const ext = file.name.split('.').pop() || 'jpg'
    const path = `avatars/${userId}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supabase.storage
      .from('mecanico-files')
      .upload(path, buffer, { upsert: true, contentType: file.type })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const { data: urlData } = supabase.storage.from('mecanico-files').getPublicUrl(path)
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
