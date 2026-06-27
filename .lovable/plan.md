
# Chama AI Delivery — Plano de construção

SaaS white-label para disparo de campanhas WhatsApp via n8n. Front-end React + TanStack Start + Tailwind + shadcn/ui. Supabase para auth/DB/RLS. Todo disparo é feito por webhooks externos (n8n); o app só envia payloads e faz polling de status.

> Observação Supabase: o usuário configurará depois. O código já será escrito assumindo Lovable Cloud (cliente em `@/integrations/supabase/client`); basta ativar quando estiver pronto e rodar as migrations geradas.

## 1. Design system (src/styles.css)

- Paleta: branco, cinza claro, laranja `#FF5C00` como `--primary`.
- Tokens semânticos em OKLCH (background/foreground/card/muted/border/ring/destructive + sidebar tokens).
- Fonte Inter via `<link>` em `__root.tsx`, mapeada em `@theme` como `--font-sans`.
- Radius médio (0.625rem), botões com loading state padronizado.

## 2. Estrutura de rotas (TanStack Start, file-based)

```
src/routes/
  __root.tsx                       (Inter + HeadContent + Toaster sonner + onAuthStateChange)
  index.tsx                        (redirect → /auth ou /dashboard conforme sessão)
  auth.tsx                         (login + cadastro em tabs)
  _authenticated/
    route.tsx                      (gate ssr:false gerenciado)
    dashboard.tsx
    leads.tsx                      (split: árvore de pastas + tabela)
    campanhas.index.tsx            (lista)
    campanhas.nova.tsx             (stepper 3 etapas)
    campanhas.$id.tsx              (detalhes + polling)
    configuracoes.tsx
```

Layout autenticado renderiza `AppShell` com Sidebar (shadcn sidebar) fixo à esquerda, header com `SidebarTrigger`, conteúdo em `<Outlet/>`.

## 3. Componentes reutilizáveis (src/components)

- `app-shell.tsx`, `app-sidebar.tsx` (itens: Dashboard, Meus Leads, Nova Campanha, Campanhas, Configurações + logo/cor do tenant).
- `leads/folder-tree.tsx`, `leads/contacts-table.tsx`, `leads/import-csv-modal.tsx` (2 etapas), `leads/contact-modal.tsx`, `leads/bulk-actions-bar.tsx`, `leads/tag-pill.tsx`.
- `campanhas/stepper.tsx`, `campanhas/step-message.tsx` (com preview WhatsApp), `campanhas/step-contacts.tsx` (tabs CSV/lista salva), `campanhas/step-review.tsx`, `campanhas/whatsapp-bubble.tsx`, `campanhas/status-badge.tsx`.
- `dashboard/metric-card.tsx`, `dashboard/recent-campaigns-table.tsx`.
- `configuracoes/webhooks-form.tsx`, `configuracoes/uazapi-form.tsx`, `configuracoes/branding-form.tsx`.
- UI utilitários: `skeleton-table.tsx`, `confirm-dialog.tsx`, `empty-state.tsx`.

## 4. Lib / utilitários (src/lib)

- `phone.ts` — validação/normalização (`(11) 91234-5678` e `+5511912345678`) + máscara.
- `csv.ts` — parser (PapaParse) e exportador.
- `webhooks.ts` — `callWebhook(url, payload)` com tratamento de erro e toast amigável.
- `branding-context.tsx` — provider que lê `configuracoes` e aplica `--primary`, nome e logo em runtime.
- `queries.ts` — `queryOptions` para leads, pastas, campanhas, configurações.

## 5. Banco de dados (migrations Supabase)

Tabelas conforme spec: `usuarios` (sincronizada via trigger de `auth.users`), `configuracoes`, `pastas`, `leads`, `leads_tags`, `campanhas`, `contatos_campanha`.

- RLS habilitado em todas; policies `auth.uid() = usuario_id` (com join para `leads_tags` e `contatos_campanha`).
- GRANTs explícitos para `authenticated` e `service_role` (sem `anon`).
- Índices: `leads(usuario_id, pasta_id)`, `leads(usuario_id, telefone)`, `leads_tags(lead_id)`, `contatos_campanha(campanha_id)`.
- Trigger `handle_new_user` cria linha em `usuarios` + `configuracoes` (defaults vazios) + pasta raiz.
- View materializada simples ou função `contar_leads_por_pasta(usuario_id)` para contagem usada na árvore (evita trigger custoso); fallback: trigger AFTER INSERT/DELETE em `leads` atualizando `pastas.total_contatos`.
- Storage bucket `midias-campanhas` (privado, policies por usuário) para uploads da etapa 1.

## 6. Telas — comportamento chave

**Auth (`/auth`):** tabs login/cadastro, email+senha, `emailRedirectTo: window.location.origin`. Após login → `/dashboard`.

**Dashboard:** 4 metric cards (queries agregadas em `campanhas`) + tabela últimas 5 campanhas com link para detalhes. Skeletons enquanto carrega.

**Meus Leads:**
- Árvore (240px) com "Todos os leads" fixo, lista de pastas com contagem, menu 3-pontos (renomear/duplicar/mover/excluir com confirm), input inline para "+ Nova pasta".
- Tabela: busca em tempo real, importar CSV, adicionar contato, exportar, paginação 50/pg.
- Seleção múltipla → barra de ações (mover/tag/excluir).
- Drag-and-drop (dnd-kit) de linhas para pastas com highlight visual.
- Pills de tags + chips clicáveis de filtro.
- Telefones inválidos com badge vermelho.
- Excluir pasta com contatos: modal "mover para Todos os leads" ou "excluir contatos junto".

**Importar CSV (modal 2 etapas):** drag-drop, baixar template, autodetect colunas, mapeamento, prévia 3 linhas, seletor de pasta (+ criar nova), política de duplicatas (ignorar/atualizar/perguntar), toast com resultado.

**Nova campanha (stepper 3):**
1. Mensagem + variáveis `{nome}` `{empresa}` `{telefone}` + toggle mídia (upload para Storage) + preview WhatsApp ao vivo.
2. Tab CSV (parse + validação) ou tab Lista Salva (checkbox pastas + filtro tag + prévia + contador).
3. Resumo + slider delay 3–30s + imediato/agendado + botão "Disparar campanha" → cria registro em `campanhas` + `contatos_campanha` e dispara `POST webhook_criar`.

**Detalhes campanha:** status, barra de progresso, 4 cards (enviadas/entregues/erros/pendentes), tabela com status por contato, botões pausar/retomar/cancelar, polling `setInterval` 5s chamando `webhook_status` (limpa no unmount).

**Configurações:** form com 5 URLs de webhook + instância/token UAZAPI + seção branding (nome produto, cor primária com color picker, upload logo). Salvar atualiza `configuracoes` e re-aplica branding em runtime.

## 7. Webhooks (chamadas pelo front)

`src/lib/webhooks.ts` expõe `criarCampanha`, `pausar`, `retomar`, `cancelar`, `status` — cada uma lê URL de `configuracoes` do usuário e faz `fetch`. Erros → toast "Não foi possível contatar o serviço de disparo. Verifique a URL em Configurações." Payloads exatamente como na spec.

## 8. White-label runtime

`BrandingProvider` no `__root` busca `configuracoes` do usuário logado e:
- aplica `document.documentElement.style.setProperty('--primary', hexToOklch(cor))`,
- atualiza `<title>` e logo no sidebar,
- persiste em `localStorage` para evitar flash.

## 9. Dependências a instalar

`papaparse`, `@dnd-kit/core`, `@dnd-kit/sortable`, `react-hook-form` (já comum), `zod`, `date-fns`. Sonner e shadcn já presentes.

## 10. Ordem de implementação

1. Design tokens + Inter + sidebar shell + rotas vazias + auth (`/auth`, gate `_authenticated`).
2. Migrations Supabase + cliente + queries base + branding provider.
3. Meus Leads completo (árvore, CRUD pastas, tabela, CSV import/export, tags, DnD).
4. Configurações (webhooks + UAZAPI + branding) + lib webhooks.
5. Nova Campanha (stepper, upload mídia, dispatch).
6. Lista + Detalhes de campanha com polling.
7. Dashboard com métricas reais.
8. Polimento: skeletons, validações em tempo real, estados vazios, toasts, responsividade tablet.

## Observações

- Sem Edge Functions / sem lógica de disparo no front — apenas chamadas HTTP para os webhooks configurados.
- Comentários em português nos componentes principais.
- Após ativar o Supabase, basta rodar as migrations geradas e preencher as URLs em Configurações para o sistema ficar 100% funcional.
