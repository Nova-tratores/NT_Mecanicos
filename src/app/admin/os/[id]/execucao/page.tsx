import { redirect } from 'next/navigation'

// Next 16: `params` é uma Promise (acesso síncrono gerava /admin/os/undefined)
export default async function ExecucaoRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/os/${encodeURIComponent(id)}`)
}
