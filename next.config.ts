import type { NextConfig } from "next";

// Tira espaços/quebras coladas por engano nas variáveis do Railway
// (28/10: a anon key com 6 espaços derrubou o app inteiro com 401).
const semEspaco = (v?: string) => (v || '').replace(/\s+/g, '')

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_SUPABASE_URL: semEspaco(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: semEspaco(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  },
  allowedDevOrigins: ['192.168.0.121'],
};

export default nextConfig;
