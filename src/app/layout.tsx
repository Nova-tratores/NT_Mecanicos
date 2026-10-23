import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import SessaoExpirada from "@/components/SessaoExpirada";

export const metadata: Metadata = {
  title: "NT Mecânicos",
  description: "App de campo para técnicos da Nova Tratores",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "NT Mecânicos" },
};

// viewportFit 'cover' (José, 23/10/2026): com black-translucent o app desenha sob o notch do iPhone; com 'cover'
// o env(safe-area-inset-*) passa a valer e o header/sino descem para fora do notch.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#FEFEFE",
};

// O script do <head> com versão própria ('v27') que apagava TODOS os caches e desregistrava o service worker saiu
// (José, 23/10/2026): a versão agora é uma só, a do public/sw.js, e o cache de páginas/OS offline nunca é apagado
// por troca de versão. A atualização aparece como faixa "Atualização pronta" (ServiceWorkerRegister).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="apple-touch-icon" href="/Logo_Nova.png" />
      </head>
      <body>
        <ServiceWorkerRegister />
        <SessaoExpirada />
        {children}
      </body>
    </html>
  );
}
