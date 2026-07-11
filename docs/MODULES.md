# Guia de módulos — waves_client

Orientação para agentes que vão **criar ou estender features** neste repositório.
Leia também o [README](../README.md) (setup/multi-tenant) e o playbook Hermes/Waves
antes de codar.

---

## O que é um "módulo" aqui

Um módulo é uma **fatia coesa de funcionalidade** com:

1. **Pasta própria** (`src/modules/<nome>/` no front ou `server/<nome>/` no BFF)
2. **API pública explícita** — consumidores importam só de `index.ts` (front) ou do
   re-export canônico (back)
3. **Integração declarada** — rota registrada, hook exposto ou router montado no
   `index.ts` do server; nunca espalhar imports internos pelo resto do app

**Não é módulo:** um componente leaf usado numa única tela, helper de 10 linhas ou
hardcode solto no `ChatPage` / `server/index.ts`.

---

## Quando criar um módulo

| Situação | Onde | Exemplo |
|---|---|---|
| Feature reutilizável com schema/contrato próprio | `src/modules/<nome>/` | `input-form` |
| Página admin ou área gated por permissão | `src/components/<area>/` + entrada em `app-routes.tsx` | `architecture/`, `tokens/` |
| Domínio backend com >1 arquivo ou lógica testável | `server/<nome>/` | `chat/` |
| Upstream HTTP configurável (proxy BFF) | registrar em `upstream-registry.ts` | Waves |
| Config estática que hoje é hardcode | `runtime-config.ts` (até vir da Config API) | starters por porta |

**Prefira estender** um módulo existente antes de criar outro. Se a lógica cabe em
`src/components/chat/` ou `server/chat/`, não crie pasta paralela.

---

## Padrão frontend — `src/modules/`

Referência canônica: **`src/modules/input-form/`**.

### Árvore mínima

```
src/modules/<nome>/
  index.ts          ← única porta de entrada (exports públicos)
  <Component>.tsx   ← UI principal (se houver)
  schema.ts         ← parse/validação de dados externos (Zod ou funções puras)
  context.ts        ← montagem de payloads / estado derivado
  use-<nome>.ts     ← hook compartilhado (gate, side effects leves)
  <nome>.css        ← estilos locais (se necessário)
```

### Regras

1. **`index.ts` exporta só o contrato estável.** Tipos, componentes, hooks e funções
   que outros arquivos podem usar. Detalhes internos ficam privados à pasta.
2. **Consumidores importam de `@/modules/<nome>` ou `../modules/<nome>`** — nunca de
   `./modules/<nome>/schema` direto (exceto dentro do próprio módulo).
3. **Integração no chat:** preferir um *gate* fino em `src/components/` que chama o
   módulo (ex.: `ConversationLauncher.tsx` → `input-form`). O módulo não importa
   `ChatPage`.
4. **Dados do agente vêm do login** (`AgentItem`, `session.agents`). Não hardcode
   registry de profiles no módulo.
5. **Mock/QA:** isolar em arquivo explícito (`sample.*.ts`) e flag documentada;
   remover quando a Waves entregar o campo real.

### Exemplo — API pública (`input-form/index.ts`)

```ts
export { InputForm } from "./InputForm";
export type { InputFormProps } from "./InputForm";
export { parseInputForm, hasRenderableForm } from "./schema";
export { buildKickoffMessage } from "./context";
export { useInputFormGate } from "./use-input-form-gate";
```

### Rotas de página — `src/modules/app-routes.tsx`

Módulos que viram **página** (admin, dashboards) registram-se em `APP_ROUTES`:

```ts
{
  path: "/admin/<area>",
  adminOnly: true,           // ou permission: "..." quando waves-core expuser
  element: (session) => <MeuDashboard session={session} />,
}
```

O `App.tsx` só mapeia `APP_ROUTES` — **não adicione `<Route>` solto** no App.

Implementação da página fica em `src/components/<area>/` (pode crescer vários
arquivos); o módulo de rota é só o registro + guarda.

---

## Padrão frontend — split de página (`src/components/chat/`)

O chat foi desmembrado de um monolito (`ChatPage.tsx` ~1600 linhas) para:

```
src/components/
  ChatPage.tsx              shell fino (~260 linhas) — monta providers + layout
  chat/
    useChatPageState.ts     estado, effects, processMessage
    GenUIAssistantMessage.tsx
    ChatBridges.tsx
    WorkflowShortcuts.tsx
    ...
```

**Ao adicionar comportamento ao chat:**

- UI leaf → novo arquivo em `src/components/chat/`
- Estado compartilhado → `useChatPageState.ts` (ou hook dedicado na mesma pasta)
- **Não inflar** `ChatPage.tsx` de volta; meta ≤ ~300 linhas no shell
- **`processMessage`:** preservar ordem e campos do payload `/api/chat` (upload →
  workflow shortcut → montagem body). O BFF depende desse contrato.

Detalhe do split: `docs/SPLIT-PLAN.md` (Split 2).

---

## Padrão backend — `server/chat/`

Referência canônica: **`server/chat/`** (substituiu `server/chat.ts` monolítico).

### Árvore

```
server/
  chat.ts                 re-export fino (compatibilidade)
  chat/
    index.ts              orquestrador — handleChatRequest
    types.ts              tipos compartilhados
    hermes-gateway.ts     resolveHermesGateway + anti-SSRF
    handler-hermes.ts     branch Hermes (stream SSE)
    handler-codex.ts
    handler-openai.ts
    attachments.ts
    ...
```

### Regras

1. **Orquestrador fino** (`index.ts` ~150 linhas): sanitiza, despacha, não implementa
   provider inteiro inline.
2. **Exports públicos:** só o que `server/index.ts` e outros consumidores precisam.
   Hoje: `handleChatRequest`, `resolveHermesGateway` via `server/chat.ts`.
3. **Novo handler/provider:** novo `handler-*.ts` + branch no orquestrador; não
   acrescentar 500 linhas no `index.ts`.
4. **Hermes/Waves:** apps desacopladas — **só HTTP**. Nunca ler FS do Hermes a partir
   do waves_client.
5. **Anti-SSRF:** portas de gateway na faixa `18000–18999` (ou `HERMES_ALLOWED_PORTS`).
   Hosts remotos só via `HERMES_ALLOWED_HOSTS`.

### Nova rota HTTP no BFF

1. Preferir **router dedicado** (`server/uploads.ts` → `app.use("/api/uploads", …)`)
   quando a feature tiver >1 endpoint ou middleware.
2. Rotas pontuais no `server/index.ts` só se forem triviais (1 handler, sem estado).
3. Upstreams externos: considerar entrada em `upstream-registry.ts`.
4. Endpoints que consomem recurso (Whisper, export PDF, transcribe): usar
   `requireAuth` — Bearer validado contra a Waves.

Detalhe do split: `docs/SPLIT-PLAN.md` (Split 1).

---

## Checklist — novo módulo frontend

- [ ] Pasta `src/modules/<nome>/` com `index.ts` documentando a API pública
- [ ] Zero import de internals do módulo fora da pasta
- [ ] Integração via componente gate ou rota em `app-routes.tsx`
- [ ] Sem hardcode de tenant/profile/agent — dados do login ou `/api/tenant`
- [ ] CSS colocalizado ou classes existentes do design system
- [ ] `npm run build` verde
- [ ] Smoke manual descrito (1–3 cenários)

## Checklist — novo módulo backend

- [ ] Lógica em pasta ou arquivo dedicado; `index.ts` do server só monta rota
- [ ] Tenant via ALS (`getActiveTenant()`), nunca confiar em slug do cliente
- [ ] Auth: Bearer do usuário ou `X-Ingest-Key` server-to-server (documentar env)
- [ ] Timeouts em fetches upstream (`AbortSignal.timeout`)
- [ ] `npm run build` verde
- [ ] curl ou cenário de smoke documentado

---

## O que NÃO fazer

| Erro | Por quê |
|---|---|
| Registrar agente novo editando `index.ts` / criando `.key` no client | Agentes vêm do **login** (gateway re-registra na Waves ao subir) |
| Ler `.secrets/tenants.json` do Hermes (ou vice-versa) | Multi-tenant: cada app tem sua cópia; comunicação HTTP |
| Importar `server/chat/handler-hermes.ts` de fora de `chat/` | Quebra encapsulamento; use `server/chat.ts` |
| Colocar lógica de negócio em `ChatPage.tsx` | Shell só monta; use `chat/` ou `modules/` |
| Expor segredo no bundle (`VITE_*` com api_key real) | Proxy `/api/waves` injeta `X-API-KEY` server-side |
| Módulo genérico com nome de cliente (`bioshield-*` em `modules/` shared) | Isolamento: específico de cliente fica no profile Hermes ou config do tenant |

---

## Fluxo sugerido para o agente executor

```
1. Ler README + este doc + área afetada em docs/SPLIT-PLAN.md
2. Decidir: módulo novo vs estender existente
3. Criar pasta + index.ts (API pública primeiro)
4. Integrar (app-routes / ConversationLauncher / server/index.ts)
5. npm run build
6. Smoke manual (chat, login, tenant host)
7. Commit só se o usuário pedir
```

Deploy local (user `bot`):

```bash
cd /home/bot/waves_client && npm run build
sudo -u bot systemctl --user restart waves-client
```

Domínio de teste: `client.devellwaves.com.br`.

---

## Referências

| Doc | Conteúdo |
|---|---|
| [README.md](../README.md) | Setup, multi-tenant, env, systemd |
| [SPLIT-PLAN.md](./SPLIT-PLAN.md) | Mapa linha→arquivo dos splits chat/ChatPage |
| [REQUEST_LIFECYCLE.md](./REQUEST_LIFECYCLE.md) | Ciclo `/api/chat` + input_form |
| Playbook Hermes/Waves | Desacoplamento, DRY, anti-SSRF, naming |
