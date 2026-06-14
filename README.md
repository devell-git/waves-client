# waves_client

Frontend de **chat com UI generativa** (openui-lang) da Waves: um React (Vite) +
um servidor Express (TypeScript/`tsx`) que serve a SPA **e** faz de proxy/gateway
para a API Waves e para o **Hermes** (engine de agentes).

> **App independente do Hermes.** O waves_client fala com o Hermes **somente por
> HTTP** (não acessa o filesystem do Hermes). Os dois podem rodar em servidores
> diferentes. Ver [Integração com o Hermes](#integração-com-o-hermes).

> **Multi-tenant de verdade:** um único deploy atende **vários tenants**,
> distinguidos pelo **Host HTTP**. Tudo gira em torno do
> [`.secrets/tenants.json`](#tenants-o-coração-do-setup). **Comece por ali.**

---

## Arquitetura em 1 minuto

```
Browser (https://app.<tenant>.com)
   │  mesma origem
   ▼
Express :3002  ──/ , /login, /chat  → serve a SPA (dist/)
   ├─ /api/tenant          → branding do tenant (resolvido pelo Host)
   ├─ /api/waves/<path>    → PROXY p/ a Waves do tenant (injeta X-API-KEY do tenant)
   ├─ /api/chat            → stream do chat → GATEWAY Hermes do agente (host:port do login)
   ├─ /api/threads*        → histórico/busca → gateway /api/sessions* e /api/sessions-search
   ├─ /api/share-recipients→ gateway /api/web-users
   └─ /api/specialist-jobs*→ rendered_api (:18861) dos sub-agentes
```

- **Quem é o tenant?** Decidido pelo **Host** da request (`resolveTenantByHost`).
- **Quais agentes o usuário vê?** Vêm do **login** (a Waves retorna o array
  `agents`, cada um com `profile_name`, `host`, `port`, `page_title`,
  `page_subtitle`, `starters`). **Não há lista de agentes em config** no client.
- **Com qual gateway o chat fala?** Com o `host:port` do **agente selecionado**
  (do login). Sem registry hardcoded.

---

## Pré-requisitos

- **Node ≥ 20** (usa `tsx`, Vite 6, `node:sqlite`).
- `npm`.
- Acesso de rede à **API Waves** de cada tenant (`api_url`) e ao(s) **gateway(s)
  Hermes** dos agentes (por padrão no loopback do mesmo host — ver
  [`HERMES_ALLOWED_HOSTS`](#variáveis-de-ambiente-env)).

---

## Setup passo a passo

```bash
# 1. Dependências
cd /caminho/para/waves_client
npm install

# 2. Configuração (ver seções abaixo)
cp .env.example .env                 # se não houver, crie do zero (ver tabela)
mkdir -p .secrets
$EDITOR .secrets/tenants.json        # ← O PASSO MAIS IMPORTANTE (multi-tenant)
chmod 600 .secrets/tenants.json

# 3. Build (frontend → dist/ + typecheck do server)
npm run build                        # = tsc -b && vite build

# 4. Subir
npm start                            # = tsx server/index.ts  (porta = $PORT, default 3002)
#   dev (hot reload web + api):
npm run dev
```

Acesse `http://localhost:3002` (em produção, atrás de um proxy/HTTPS que
preserve o **Host** — o tenant depende dele).

---

## Tenants: o coração do setup

Um arquivo, **fora do git**, mapeia **Host → tenant**. Default
`.secrets/tenants.json` (sobrescreva o caminho com `TENANTS_FILE`).

```json
{
  "tenants": [
    {
      "tenant":  "devell",
      "hosts":   ["app.devell.com.br", "localhost", "127.0.0.1"],
      "api_url": "https://waves.devell.com.br/api",
      "api_key": "<X-API-KEY do tenant na Waves>",
      "logo_white": "https://cdn/.../logo-branco.png",
      "logo_dark":  "https://cdn/.../logo-escuro.png",
      "img_login":  "https://cdn/.../bg-login.jpg"
    }
  ]
}
```

| Campo | O quê |
|-------|-------|
| `tenant` | **slug** do tenant (id interno; vai no `X-Hermes-Session-Id` → o Hermes resolve a Waves certa). |
| `hosts` | hosts HTTP que caem neste tenant (array; aceita também `host` string única). |
| `api_url` | base da API Waves do tenant **com** `/api` (o proxy normaliza). |
| `api_key` | `X-API-KEY` do tenant na Waves — **segredo**, só aqui. |
| `logo_white`/`logo_dark`/`img_login` | branding (servido em `/api/tenant`). |

**Regras de ouro:**

1. **Host sem tenant → HTTP 421.** O server **nunca** cai num tenant default
   (evita servir dados/branding do tenant errado). Para deploy single-tenant,
   defina `DEFAULT_TENANT=<slug>`.
2. **`api_key` não trafega pro browser nem pro Hermes.** O proxy `/api/waves`
   injeta o `X-API-KEY` do tenant server-side; o browser nunca o vê.
3. **Adicionar um tenant = editar só este arquivo** (e a cópia no Hermes — ver
   [Integração](#integração-com-o-hermes)). **Nada por-agente/por-profile** em
   config: os agentes vêm do login.

**Fluxo multi-tenant completo:**

```
Browser em app.<tenant>.com
  → /api/waves/login  (mesma origem; frontend usa VITE_WAVES_URL=/api/waves)
  → server resolve tenant pelo Host → POST {api_url}/login  com X-API-KEY={api_key}
  → Waves devolve accessToken + agents (profile_name/host/port/page_title/starters)
  → usuário escolhe um agente → chat vai pro gateway host:port DELE, com:
        Authorization: Bearer <accessToken do usuário>
        X-Hermes-Session-Id: waves-<slug>-user-<id>::<thread>   (slug = tenant)
```

---

## Variáveis de ambiente (`.env`)

| Var | Para quê |
|-----|----------|
| `PORT` | porta do Express (default `3002`). |
| `VITE_WAVES_URL` | **build-time**. Em produção = `/api/waves` (proxy de mesma origem → multi-tenant por host). |
| `VITE_WAVES_TOKEN` | build-time; **superado** pelo `api_key` do tenant no proxy. Mantenha um valor qualquer não-vazio. |
| `TENANTS_FILE` | caminho do `tenants.json` (default `.secrets/tenants.json`). |
| `DEFAULT_TENANT` | slug usado quando o Host não casa nenhum tenant (só p/ single-tenant). |
| `HERMES_ALLOWED_HOSTS` | CSV de hosts de gateway Hermes permitidos **além do loopback**. Vazio = só `127.0.0.1` (deploy co-locado). Defina quando o Hermes for **remoto**. |
| `OPENAI_PROVIDER` / `HERMES_BASE_URL` / `HERMES_MODEL` / `HERMES_KEY_PATH` | upstream de chat **default/fallback** (o gateway real vem do agente do login). `hermes` = roteia pros gateways Hermes. |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` / `CODEX_AUTH_PATH` | provider alternativo (OpenAI/Codex) quando não-Hermes. |
| `RENDERED_API_URL` | base do serviço de specialist-jobs (default `http://127.0.0.1:18861`). |
| `SPECIALIST_PROFILE_PREFIX` | prefixo `consult_*` → profile do sub-agente (default `bioshield-`). |
| `UPLOADS_SIGNING_SECRET` | assina URLs de arquivos do chat. |
| `NOTIFICATIONS_DB` | caminho do SQLite do "sino" (default `data/notifications.db`, **do próprio client**). |

> Nada de `*.db`/`.secrets`/`.env` no git.

---

## Integração com o Hermes

O waves_client **não toca o filesystem do Hermes** — tudo é HTTP:

| Recurso | Endpoint no gateway Hermes |
|---------|----------------------------|
| Histórico (listar/ler/renomear/excluir) | `GET/PATCH/DELETE /api/sessions*` |
| Busca FTS no histórico | `GET /api/sessions-search?q=` |
| Destinatários de compartilhamento | `GET /api/web-users` |
| Chat (stream) | `POST /v1/chat/completions` |
| Specialist jobs (Vigia/Cronos/…) | `rendered_api` em `:18861` (`/specialist-jobs/{id}/rendered`, `/latest`) |

Autenticação: o **Bearer do próprio usuário** (token Waves do login). O gateway
valida o token contra a Waves do tenant (resolvido pelo slug no
`X-Hermes-Session-Id`). **Co-locado:** os gateways escutam no loopback; deixe
`HERMES_ALLOWED_HOSTS` vazio. **Remoto:** liste os hosts dos gateways em
`HERMES_ALLOWED_HOSTS` (anti-SSRF).

> Para o lado Hermes (cópia do `tenants.json`, patches, gateways), veja o README
> do repositório do Hermes e `shared-knowledge/MULTI_TENANT_SETUP.md`.

---

## Rodar como serviço (systemd --user)

`~/.config/systemd/user/waves-client.service`:

```ini
[Unit]
Description=Waves Client — chat generative-UI (Express + tsx) na porta 3002
After=network.target

[Service]
WorkingDirectory=/home/bot/waves_client
ExecStart=/usr/bin/node /home/bot/waves_client/node_modules/tsx/dist/cli.mjs server/index.ts
Restart=always
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/usr/local/bin:/home/bot/waves_client/node_modules/.bin

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now waves-client.service
systemctl --user status waves-client.service
journalctl --user -u waves-client.service -f
```

> Mudou **server** (`server/*.ts`)? Basta `restart` (`tsx` transpila on-the-fly).
> Mudou **frontend** (`src/**`)? Rode `npm run build` (gera `dist/`) e depois
> `restart`.

---

## Verificação rápida (smoke)

```bash
# server no ar
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/        # 200
# branding do tenant (precisa do Host casando um tenant)
curl -s http://localhost:3002/api/tenant -H "Host: app.devell.com.br"  # JSON ou 404/421
# histórico exige Bearer (sem token → 401)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3002/api/threads?profile=<p>&port=<porta>"  # 401
```

Fluxo completo: login no host de um tenant → o select de agentes lista os agentes
daquele login → abrir um agente mostra page_title/subtitle/starters dele → chat
roteia pro gateway `host:port` do agente.

---

## Estrutura

```
server/            Express (TS, roda via tsx)
  index.ts         rotas (tenant, proxy /api/waves, threads, skills?, uploads, share, specialist)
  chat.ts          pipeline do chat → gateway Hermes (stream SSE)
  tenants.ts       resolução de tenant por Host (ALS) + branding
  thread-history.ts histórico via HTTP do gateway (/api/sessions*)
  specialist-jobs.ts latest job via rendered_api (HTTP)
  ...
src/               React (Vite) → dist/
  api/             clientes HTTP (waves-api, threads, tasks, …)
  components/      ChatPage, LoginPage, ProfileSelect, FilePreviewer, …
docs/              REQUEST_LIFECYCLE.md, OTIMIZACOES-TOKEN.md
.secrets/          tenants.json (FORA do git)
```

Detalhe do ciclo de request: `docs/REQUEST_LIFECYCLE.md`.
