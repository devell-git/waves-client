# Ciclo de vida de uma requisição — waves_client ↔ Steve

Documento descreve, ponta-a-ponta, o que acontece desde o usuário digitar uma
mensagem no chat até a UI renderizar a resposta como componentes OpenUI.
Foco no modo `OPENAI_PROVIDER=hermes` (canal com `hermes-bioshield-steve`).
Versão do snapshot: **2026-05-25**.

---

## 0. Visão geral em 10 segundos

```
┌────────┐   1. fetch /api/chat   ┌────────────┐   3. POST /v1/chat/completions    ┌──────────────┐
│Browser │ ─────────────────────▶ │  Express   │ ─────────────────────────────────▶│ Hermes       │
│ React  │    (com userScope)     │  (3002)    │    Authorization: Bearer KEY      │ api_server   │
│        │ ◀───── 11. SSE ─────── │  tsx       │ ◀────── 8. SSE openai compat ──── │ (18860)      │
└────────┘   openui-lang chunks   └────────────┘  data: {…choices[0].delta.content}└──────┬───────┘
   ▲                                                                                      │
   │ openuiAdapter → openuiChatLibrary                                                    │ 4. Skills/MCP
   │ → Renderer monta Card/Tabs/ListBlock/FollowUpItem                                    │ 5. Steve agent
                                                                                          │ 6. OpenAI Codex
                                                                                          │ 7. Stream tokens
                                                                                          ▼
                                                                                   ChatGPT backend
                                                                                   (chatgpt.com)
```

---

## 1. Browser — o usuário digita

**Origem:** `src/components/ChatPage.tsx`

O usuário digita na caixa de input do `<FullScreen>` (componente do
`@openuidev/react-ui`). Quando dá Enter:

1. `<FullScreen>` chama a prop `processMessage({ messages, abortController })`.
2. `messages` chega no formato interno do openui. É convertido pra formato
   OpenAI via `openAIMessageFormat.toApi(messages)`.
3. O fetch é montado com o corpo:

```ts
fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    messages: openAIMessageFormat.toApi(messages),
    wavesSession: { environment, accessToken },     // token Sanctum da Babble
    defaultWorkflowId,
    persona,
    permissions: session.effectivePermissions,
    user: { id, name, email, type },
    roles: session.roles,
    userScope: { workflows, assistants, bookings, funnels, ... },
  }),
  signal: abortController.signal,
});
```

> **Importante:** `wavesSession.accessToken` é o Bearer do **Babble** (não do
> Hermes). Trafega pra que tools do branch clássico possam bater na Waves
> em nome do usuário. No branch hermes ele só fica no scopeContext (Steve
> usa skills próprias).

---

## 2. Express recebe — roteamento

**Origem:** `server/index.ts`

Rotas relevantes:

| Rota | Handler |
|---|---|
| `POST /api/chat` | `handleChatRequest(req.body)` em `chat.ts` |
| `GET /api/skills` | Lê `~/.hermes/skills/{bioshield,waves,shared}` + skill hub |
| `GET /api/skills/:name` | Retorna `SKILL.md` cru de uma skill |
| `POST /api/skills/:name/start` | Wrapper: monta `Execute a skill X…` e redireciona pro `/api/chat` |
| `ALL /api/waves/*` | Proxy reverso pra `https://waves.devell.com.br/api/*` injetando `X-API-KEY` server-side |
| `GET /api/health` | provider + baseURL + credentialPreview + model |

O Express usa `express.json({ limit: "2mb" })` — `req.body` já vem parseado.

---

## 3. Dispatcher por provider

**Origem:** `server/chat.ts:handleChatRequest`

1. Valida `wavesSession.accessToken` (401 se faltar).
2. Carrega credencial via `getOpenAiCredential()` (`load-env.ts`):
   - `provider=codex` → lê `~/.codex/auth.json`, cache 5min
   - `provider=hermes` → lê inline `HERMES_API_KEY` ou
     `/home/bot/waves_client/.secrets/hermes-steve.key`
   - `provider=openai` → `OPENAI_API_KEY` clássica
3. Monta `scopeContext` (string markdown injetada no system prompt) com:
   - **Data atual** (resolução de "próxima semana" pelo LLM)
   - **Usuário** (id, name, email, type)
   - **Roles** + **persona** + **permissions** (top 15)
   - **Workflows visíveis** (até 30, com ids e nomes)
   - **Assistentes visíveis** (até 25)
   - **Agendas visíveis** (até 25)
   - **Funis visíveis** (até 12, com até 8 stages cada inline)
4. Chama o handler do provider:
   - `provider=codex` → `handleChatRequestCodex`
   - `provider=hermes` → `handleChatRequestHermes` ← **este documento**
   - `provider=openai` → branch padrão com `OpenAI({ apiKey, baseURL }).chat.completions.runTools`

---

## 4. Branch `hermes` — proxy pro Steve

**Origem:** `server/chat.ts:handleChatRequestHermes`

```ts
// 4.1 Limpa mensagens — drop role=tool, drop tool_calls de assistant
const cleanMessages = (messages as Array<Record<string, unknown>>)
  .filter((m) => m.role !== "tool")
  .map(stripToolCalls);

// 4.2 System prompt = OpenUI Lang prompt + scopeContext da Waves
const systemPrompt = buildWavesSystemPrompt() + scopeContext;

// 4.3 Session-id estável por user — Steve mantém thread por X-Hermes-Session-Id
const sessionId = user?.id != null ? `waves-user-${user.id}` : "waves-anon";

// 4.4 Request pro api_server do Steve
const upstream = await fetch(`${baseURL}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,           // key gerada na config
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-Hermes-Session-Id": sessionId,            // continuidade entre turnos
  },
  body: JSON.stringify({
    model: process.env.HERMES_MODEL || "hermes-agent",
    messages: [{ role: "system", content: systemPrompt }, ...cleanMessages],
    stream: true,
  }),
});

// 4.5 Pass-through do stream — frontend já parseia chat.completions
return new Response(upstream.body, {
  status: 200,
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  },
});
```

> **Por que não usar OpenAI SDK aqui?** Pass-through manual do `upstream.body`
> evita uma cópia/parse intermediária — o Hermes já emite SSE no formato
> exato que o `openAIAdapter` do `@openuidev/react-headless` consome.

---

## 5. Hermes api_server — recepção

**Origem:** `gateway/platforms/api_server.py` (Hermes-agent)

O api_server (escuta em `127.0.0.1:18860`):

1. **Auth middleware**: valida `Authorization: Bearer <key>` contra
   `API_SERVER_KEY` do `.env` do profile. 401 se faltar.
2. **Rate limit**: `max_concurrent=5` requests simultâneas (config).
3. **Normaliza content**: aceita string ou array de parts (`type: text`,
   `type: input_text`, etc.) — flatten pra string.
4. **Session lookup**: usa `X-Hermes-Session-Id` pra recuperar conversa
   prévia. Se não existir, cria nova session vinculada à plataforma
   `api_server`. Session reset honra `session_reset.idle_minutes: 1440`
   do config.yaml do profile, MAS `notify_exclude_platforms = ("api_server",
   "webhook")` — não dispara notificação automática.
5. **Monta prompt completo**:
   - SOUL.md do Steve (sempre)
   - Memórias da session (`memory.memory_enabled: true`)
   - User profile (se `user_profile_enabled: true`)
   - System prompt do request (o `buildWavesSystemPrompt` + scopeContext)
   - Histórico de mensagens da session
   - Nova mensagem do user
6. **Skills disponíveis** carregadas via:
   - `~/.hermes/skills/bioshield/` (external_dir do config)
   - `~/.hermes/skills/waves/` (external_dir)
   - `~/.hermes/skills/.hub/` (skills do agentskills.io — onde a `openui`
     aterrissou)
7. **MCP servers** levantados:
   - `bioshield_mcp` (`/home/bot/.hermes/shared-knowledge/bioshield/bioshield_mcp/server.py`)

---

## 6. Steve agent — orquestração

**Origem:** `hermes_agent/agent_core.py` (loop de execução)

O Steve recebe o prompt completo e roda em loop:

1. **Discovery**: olha skills disponíveis (só `name` + `description` em
   contexto — progressive disclosure do padrão agentskills.io).
2. **Decide ação**: chama o modelo LLM (`openai-codex/gpt-5.4` configurado
   em `config.yaml`) com o histórico + skills disponíveis + MCP tools.
3. **Possíveis caminhos:**
   - **Sem skill/tool**: responde direto. Emite tokens via SSE.
   - **Activation de skill**: lê `SKILL.md` completo da skill (ex.: `openui`)
     e usa o conteúdo como contexto extra antes da próxima geração.
   - **Tool MCP/builtin**: chama (ex.: `bioshield_mcp.list_panels`),
     emite evento `hermes.tool.progress` no stream:
     ```
     event: hermes.tool.progress
     data: {"tool": "skill_view", "emoji": "📚", "label": "steve/projeto-bioshield"}
     ```
4. **Stream de tokens**: cada chunk da resposta do modelo vira:
   ```
   data: {"id":"chatcmpl-…", "object":"chat.completion.chunk",
          "choices":[{"delta":{"content":"Sou"},"finish_reason":null}]}
   ```
5. **Hooks**: `agent:start` e `agent:end` rodam (registram em
   `state/events/steve_events_YYYY-MM-DD.jsonl`).
6. **Memória**: se algo importante surgir, agendar nudge pra escrever em
   memória (`compression.enabled: true`).
7. **Encerra**: `data: [DONE]`.

---

## 7. Stream sobe — Hermes → Express → Browser

O `upstream.body` é um `ReadableStream`. O Express **encaminha bytes
diretamente** (sem parsear nem mutar). Os chunks chegam no browser na
ordem:

```
data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n
event: hermes.tool.progress
data: {"tool":"skill_view","emoji":"📚","label":"steve/projeto-bioshield"}\n\n
data: {"choices":[{"delta":{"content":"\n\nroot"}}]}\n\n
data: {"choices":[{"delta":{"content":" ="}}]}\n\n
data: {"choices":[{"delta":{"content":" Card"}}]}\n\n
...
data: [DONE]\n\n
```

> **Eventos `hermes.tool.progress`** são *non-standard* OpenAI mas o
> openuiAdapter ignora silenciosamente (linhas que não começam com
> `data: ` ou cujo JSON não bate com o schema padrão). Ficam visíveis no
> DevTools (Network → EventStream) e podem ser usadas pra UI de
> "Steve está pensando…".

---

## 8. Frontend reassembling

**Origem:** `src/components/ChatPage.tsx`, `@openuidev/react-headless`

O `<FullScreen>` está configurado com `streamProtocol={openAIAdapter()}`.
O adapter:

1. **Lê chunks** do `Response.body.getReader()` (Web Streams API).
2. **Split por `\n\n`** (delimiter SSE).
3. **Parse `data: {…}`** — junta `delta.content` no buffer textual.
4. **Token-level stream pro Renderer** — cada token vai pro parser
   OpenUI Lang line-by-line.

O **parser de OpenUI Lang** (`openuiChatLibrary`):

1. **Reconhece bindings** linha a linha:
   ```
   root = Card([header, list, followUps])
   header = CardHeader("Skill executada: openui", "Resumo…")
   list = ListBlock([item1, item2, item3])
   item1 = ListItem("Skill 1", "desc")
   followUps = FollowUpBlock([fu1, fu2])
   fu1 = FollowUpItem("Próxima pergunta")
   ```
2. **Constrói árvore tipada** validando contra schemas Zod do
   `defineComponent`.
3. **Stream-rendering**: assim que `root` resolve, renderiza Card. Quando
   `header` chega depois, atualiza o Card. Cada componente aparece
   progressivamente.

---

## 9. UI renderiza

O `<Renderer>` mapeia cada elemento da árvore pra componente React:

| OpenUI element | React component |
|---|---|
| `Card([...])` | `<Card>` |
| `CardHeader(title, subtitle)` | `<CardHeader>` |
| `Tabs([...])` | `<Tabs>` |
| `TabItem(id, label, children)` | `<TabItem>` |
| `Table([cols])` | `<Table>` |
| `ListBlock([items])` | `<ul>` |
| `ListItem(title, desc, ?img, ?cta, ?action)` | `<li>` com action handlers |
| `FollowUpBlock([items])` | barra de sugestões clicáveis |
| `FollowUpItem(text)` | botão que dispara `processMessage` com o texto |
| `Action([@ToAssistant("…")])` | handler que envia nova mensagem ao chat |
| `PieChart(labels, values, type)` | gráfico (donut/pie) |
| `TextContent(text, variant)` | parágrafo estilizado |

> **Click handler de `FollowUpItem`/`Action`**: chama internamente o
> mesmo `processMessage` do passo 1 — **fecha o loop**.

---

## Variante: `POST /api/skills/:name/start`

Pra disparar uma skill diretamente (botão "Iniciar X" na UI):

```
POST /api/skills/openui/start
{ "params": {…}, "wavesSession": {…}, "user": {…} }
```

**Server (`server/index.ts`)**:

1. Valida que `~/.hermes/skills/.../openui/SKILL.md` existe (404 se não).
2. Monta prompt natural:
   ```
   Execute a skill `openui`.
   
   Parâmetros:
   ```json
   { "x": 1 }
   ```
   
   Retorne o resultado em openui-lang (Card + componentes).
   ```
3. Importa dinamicamente `handleChatRequest` e injeta a mensagem como se
   fosse um `POST /api/chat`.
4. A partir daqui é **o mesmo pipeline** dos passos 3 → 9.

> Steve faz **Discovery → Activation → Execution** sozinho — não há
> "tool call" REST. A magia é só ter a skill no `~/.hermes/skills/.hub/`
> e mandar a frase certa.

---

## Variante: `OPENAI_PROVIDER=codex` (ChatGPT backend)

Quando o `.env` está com `OPENAI_PROVIDER=codex` (mode anterior):

1. Tudo até o passo 3 é igual.
2. `handleChatRequestCodex` (`server/chat.ts` + `server/codex-client.ts`):
   - Carrega `access_token` de `~/.codex/auth.json`.
   - Extrai `ChatGPT-Account-ID` do JWT (claim
     `https://api.openai.com/auth.chatgpt_account_id`).
   - Adiciona headers `originator: codex_cli_rs`, UA Codex, etc. (bypass
     Cloudflare).
   - Bate em `https://chatgpt.com/backend-api/codex/responses` (Responses
     API, NÃO Chat Completions).
   - Loop multi-turn manual: a cada `function_call_output`, refaz
     `responses.create` com o histórico estendido.
   - **Tools** custom da Waves (`list_workflows`, `get_workflow_kanban`,
     `list_appointments`, `get_assistant_funnel`, etc.) são executadas
     pelo Express, NÃO pelo Codex.
3. Stream Responses API tem schema diferente (`response.output_text.delta`)
   — `codex-client.ts` converte pro formato `chat.completion.chunk` que o
   frontend espera.
4. Chunking de tool_call_args em pedaços de 4KB (`CHUNK_SIZE = 4096`) pra
   não estourar o buffer do adapter SSE do `@openuidev/react-headless`.

---

## Variante: `OPENAI_PROVIDER=openai` (API tradicional)

- `handleChatRequest` cai no branch padrão (sem hermes/codex).
- Usa `OpenAI({ apiKey, baseURL }).chat.completions.runTools({ tools, ... })`.
- Tools custom da Waves rodam aqui (executor é o próprio SDK).
- Stream pass-through pro frontend.

---

## Arquitetura de auth — quem fala com quem

```
Browser ────────── nenhum token ────────────▶ Express :3002
                                              (mesma origem)

Browser ──────── Bearer(Babble) ─────────────▶ Express /api/waves/*
                                              ↓
                                              X-API-KEY (tenant) injetado
                                              ↓
                                              waves.devell.com.br/api/*

Express ──── Authorization: Bearer KEY ─────▶ Hermes api_server :18860
                                              ↓
                                              Steve agent
                                              ↓
                                  openai-codex OAuth (auth.json)
                                              ↓
                                              chatgpt.com/backend-api/codex
```

- O **token Sanctum do Babble** (Bearer do user logado) NUNCA é exposto
  pro frontend depois do login. Fica salvo no localStorage do browser
  e é usado direto pelas chamadas `/api/waves/*` (proxy injeta apenas
  X-API-KEY).
- O **HERMES_API_KEY** vive em `.secrets/hermes-steve.key` (chmod 600) e
  só o Express acessa. Browser nunca vê.
- O **token Codex** vive em `~/.codex/auth.json` (refresh por cron a cada
  7 dias via `/home/bot/shared-scripts/refresh-codex-oauth.sh`).

---

## Tempos típicos (medidos no smoke test 2026-05-25)

| Etapa | Tempo |
|---|---|
| Login Babble + fetchUserScope (workflows+assistants+bookings+funnels) | ~1.5–3 s |
| Express → Steve (warm session) | ~200–500 ms até primeiro token |
| Stream completo (resposta 3 KB OpenUI Lang) | ~3–8 s |
| Skill ativada via Discovery | +1–2 s (carga do SKILL.md) |
| First-paint do Card na UI | ~250 ms após primeiro token |

---

## Pontos de falha conhecidos

1. **`crypto.randomUUID` em HTTP**: polyfill em `src/lib/crypto-polyfill.ts`
   (contexto não-secure).
2. **Buffer SSE estourando ~16 KB**: tool_call args chunkados a cada 4 KB
   (`chat.ts:CHUNK_SIZE`). Só afeta branch codex/openai com tools custom.
3. **Codex 403 Cloudflare**: precisa `originator: codex_cli_rs` + UA +
   `ChatGPT-Account-ID`. Sentinela em `codex-client.ts:buildCodexHeaders`.
4. **OPENAI_PROVIDER errado**: `load-env.ts` lança erro descritivo se
   credencial faltar (codex → diz onde está o auth.json; hermes → diz onde
   está a key).
5. **Dist com permissions root** (legado de build com sudo): `npm run build`
   falha. Fix: `sudo rm -rf dist/assets && npm run build`.
6. **Telegram do Steve cai por timeout** (não afeta api_server): polling
   reconecta automaticamente com backoff exponencial.

---

## Como reproduzir o pipeline localmente

```bash
# 1. Garantir Steve com api_server ativo
systemctl --user status hermes-gateway-bioshield-steve.service
ss -tlnp | grep 18860      # esperado: LISTEN no 127.0.0.1:18860

# 2. Smoke do canal direto
KEY=$(cat /home/bot/waves_client/.secrets/hermes-steve.key)
curl -sN -X POST http://127.0.0.1:18860/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"oi"}],"stream":true}'

# 3. Smoke via Express (com provider=hermes no .env)
cd /home/bot/waves_client
npm run dev   # ou: ./node_modules/.bin/tsx server/index.ts

curl http://127.0.0.1:3002/api/health        # confirma provider
curl http://127.0.0.1:3002/api/skills | jq   # 42 skills do Steve

# 4. Browser
# http://127.0.0.1:5173  (Vite HMR)
```

---

## 12. input_form — gate de abertura de conversa (2026-07)

Quando o agente cadastrado na Waves traz `input_form` (schema jQuery FormBuilder)
no payload de login:

1. **Nova conversa** com chat vazio → `ConversationLauncher` renderiza o form
   **dentro de um balão do assistente** (mesma área de scroll das mensagens).
2. Campos com `className` contendo `ai-target` **não são renderizados** — vão
   pro `<context>` da 1ª mensagem com `label` + `prompt` + valores permitidos.
3. O usuário preenche só os campos visíveis; o botão usa `submit_button_text`
   (envelope do form ou `AgentItem.submit_button_text`).
4. Submit → auto-send via `processMessage` com `<content>` (campos do user) +
   `<context>` (`user_inputs` + `ai_targets`). O balão some; a bolha do user
   aparece na mesma thread; o composer é liberado.
5. Módulo reutilizável: `src/modules/input-form/` (parser, renderer React,
   `buildKickoffMessage`). Glue no chat: `src/components/ConversationLauncher.tsx`.

**Arquitetura-alvo (5 projetos):** WebApp (este repo) → BFF Express → Waves-core
(login/perm) + agent-gateway (conversa) + integration-core (config/PEP, futuro
Integration Manager). Canais (WhatsApp) falam só com agent-gateway, não com
integration-core.

# OU  http://127.0.0.1:3002 (servindo dist/)
```
