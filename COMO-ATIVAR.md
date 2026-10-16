# Como colocar no ar: offline + notificações + correções

Este branch (`melhorias-offline-push`) deixa o app dos mecânicos:
- **abrindo na hora, mesmo sem internet**;
- **recebendo notificação de OS nova com o app fechado**;
- **sem os bugs e as falhas de segurança** encontrados na revisão.

Siga os passos na ordem. Leva uns 15 minutos.

---

## 1. Publicar o app dos mecânicos

O Railway publica sozinho o que está no `main`. Para levar este branch para o `main`:

1. Abra: https://github.com/Nova-tratores/NT_Mecanicos/compare/main...melhorias-offline-push
2. Clique em **Create pull request** e depois em **Merge pull request**.
3. Espere o deploy terminar no Railway (serviço `ntmecanicos-production`).

> Quando cada celular abrir o app com internet pela primeira vez depois disso, ele apaga a versão antiga sozinho e baixa a nova. Os dados guardados offline (OS em preenchimento, fila de envio) **não** são apagados.

## 2. Publicar a alteração do Portal

O Portal manda as notificações de OS nova para o app dos mecânicos. Ele ganhou um ajuste para mandar uma senha junto, porque agora o app só aceita envio de quem é conhecido.

1. Abra: https://github.com/Nova-tratores/Portal_Nova_Tratores/compare/main...push-mecanicos-segredo
2. **Create pull request** → **Merge pull request**.

> Pode publicar o Portal antes ou depois do app: enquanto o passo 3 não for feito, tudo continua funcionando como antes.

## 3. Criar a senha nos dois serviços do Railway

No Railway, em **Variables**, crie a mesma variável **nos dois serviços**, no app dos mecânicos (`ntmecanicos-production`) e no Portal:

```
PUSH_API_SECRET=cdd92e1ddadeec8d2ab5cec836f56b2ed4eb23004a2c6408
```

Os dois serviços reiniciam sozinhos. A partir daí, ninguém de fora consegue mandar notificação falsa para os técnicos.

> ⚠️ Tem que ser **exatamente o mesmo valor** nos dois. Se ficar diferente, o Portal para de notificar os técnicos.

## 4. Conferir as variáveis que o app já usa

No serviço do app dos mecânicos, confira se estas variáveis existem (elas já deviam estar lá):

| Variável | Para que serve |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | endereço do banco |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave pública do banco |
| `SUPABASE_SERVICE_ROLE_KEY` | chave do servidor |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | chave pública das notificações |
| `VAPID_PRIVATE_KEY` | chave privada das notificações |

Se a `NEXT_PUBLIC_VAPID_PUBLIC_KEY` estiver faltando, as notificações não funcionam.

## 5. Em cada celular (uma vez só)

**Android**
1. Abra o app no Chrome e instale: menu ⋮ → **Instalar app** (ou **Adicionar à tela inicial**).
2. Abra pelo ícone e toque em **Ativar** na faixa azul de notificações.
3. Se a faixa estiver laranja, dizendo **"Notificações bloqueadas"**: toque no cadeado ao lado do endereço → **Permissões** → **Notificações** → **Permitir**.
4. Em celulares Xiaomi, Samsung e Motorola: Configurações → Apps → Chrome (ou NT Mecânicos) → **Bateria** → **Sem restrições**. Sem isso, o celular segura as notificações para economizar bateria.

**iPhone** (precisa de iOS 16.4 ou mais novo)
1. No Safari: **Compartilhar** → **Adicionar à Tela de Início**.
2. Abra **pelo ícone** (pelo Safari não funciona) e toque em **Ativar**.

**Celular que já usou outra conta** (como o seu, que entrou com a conta do Nicolas): saia da conta pelo **Perfil** → **Sair** e entre com a conta certa. Ao sair, o celular deixa de receber os avisos daquele técnico.

## 6. Testar

**Offline**
1. Abra o app com internet e espere uns 30 segundos (ele baixa todas as telas).
2. Ligue o **modo avião**, feche o app completamente e abra de novo.
3. O app deve abrir na hora e navegar entre as telas. Uma OS que nunca foi aberta com internet mostra o aviso "Esta tela ainda não foi baixada", e isso é normal.

**Notificação**
1. Com o app **fechado**, crie no Portal uma OS para o técnico.
2. A notificação deve chegar em poucos segundos. Ao tocar nela, abre a OS.

**Troca de conta**
1. Saia da conta, entre com outro técnico e crie uma OS para cada um.
2. Cada notificação só pode chegar no celular de quem está logado.

Se algo não funcionar, anote **qual celular, qual técnico e o horário**: isso permite achar o problema nos registros.

---

## Importante: segurança (fazer assim que possível)

O arquivo `.env.production` está **dentro do GitHub** com a chave mestra do banco (`SUPABASE_SERVICE_ROLE_KEY`) e a chave privada das notificações. Quem tem acesso ao repositório tem acesso total ao banco.

1. Confirme que **todas** as variáveis do arquivo estão no Railway (passo 4).
2. Tire o arquivo do git: `git rm --cached .env.production`, faça o commit e publique.
3. **Gere chaves novas** no Supabase (Settings → API) e atualize no Railway e no Portal, porque as antigas continuam no histórico do GitHub.

> Não apague o arquivo antes do passo 1: o build do Railway pode estar usando ele.

## O que ainda ficou para depois

- `/api/checklist-veiculo`, `/api/infracoes` e `/api/veiculos-mapa` ainda funcionam sem login.
- Uma OS enviada offline continua aparecendo como "a preencher" na lista até sincronizar.
- `sql/sugestoes-integridade-admin.sql`: índices sugeridos contra registros duplicados. **Não foi rodado**; leia o arquivo antes de usar.

## O que mudou (resumo)

- **Offline:** novo service worker (`src/app/sw.js/route.ts` + `public/sw-core.js`). Cada versão do app baixa todas as suas telas e arquivos de uma vez. O app abre direto do celular e atualiza em segundo plano, sem recarregar no meio do serviço.
- **Notificações:** a permissão só é pedida pelo botão (pedir sozinho faz o Chrome bloquear de vez). A inscrição com a chave errada é refeita. O logout limpa o celular. A notificação sai com prioridade alta. O painel admin parou de mandar avisos repetidos.
- **Segurança:** a rota que devolvia a senha do cartão Veloe para qualquer pessoa agora exige login e só mostra o veículo do próprio técnico. Também passaram a exigir login a troca de foto, o rastreamento, o carrinho de peças e os envios de notificação.
- **Bugs:**
  - Datas erradas depois das 21h.
  - Foto do checklist apagada ao corrigir uma resposta.
  - Lousa sem OS.
  - Opa sem aviso aos mecânicos.
  - Fila de envio travando ou duplicando relatório.
  - Telas carregando para sempre com sinal fraco.
  - Envio em dobro.
  - Zoom no iPhone.
  - Botões atrás do entalhe da tela.
  - Ícone do app no tamanho errado.
