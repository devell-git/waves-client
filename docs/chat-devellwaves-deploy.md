# Deploy & Troubleshooting — chat.devellwaves.com.br (Waves Client)

> Documento de conhecimento. Como o acesso a `chat.devellwaves.com.br` está montado,
> a causa-raiz do incidente de 16/06/2026 e como diagnosticar de novo.

## Arquitetura

```
Usuário
  │
  ▼
chat.devellwaves.com.br   (DNS → 173.255.225.208)
  │
  ▼
173.255.225.208  ── Nginx Proxy Manager (Docker) + SSL  ── termina o TLS
  │
  ▼
http://45.79.137.141:80   ── Caddy (reverse proxy)
  │
  ▼
127.0.0.1:3002            ── Node.js / Waves Client (multi-tenant)
```

- **App (Waves Client):** `45.79.137.141`, Node na porta `3002`, serviço via systemd.
- **Proxy de borda + SSL:** `173.255.225.208`, **Nginx Proxy Manager (NPM)** em Docker.
- **Proxy local no app:** **Caddy** (`:80 → 127.0.0.1:3002`) — NÃO há nginx instalado no `.141`.
- **Tenant** resolvido pelo app via header `Host` (mapeado em `.secrets/tenants.json`).

## Incidente 16/06/2026 — sintomas

Ao abrir `https://chat.devellwaves.com.br/login`:
- `GET /api/tenant` → **404** (`{"error":"Nenhum tenant configurado para este host."}`)
- `POST /api/waves/login` → **421** (Misdirected Request)
- Imagens de branding (logo/fundo) não carregavam.

> Os três sintomas têm a **mesma causa**: o request não chegava no app certo / com o Host certo,
> então o tenant não resolvia. O branding (logos + `img_login`) vem do `/api/tenant`.

## Causa-raiz

O **Nginx Proxy Manager** (`.208`) continuava encaminhando o domínio para o **servidor ANTIGO**
`192.168.210.205:3002` após o Waves Client ter sido migrado para `45.79.137.141`.

## Correção aplicada

### Camada de PROXY (task #756)
1. `.141` não tinha nginx → reverse proxy local é o **Caddy**: `:80 → 127.0.0.1:3002`.
   - Validar: `caddy validate --config /etc/caddy/Caddyfile`
   - Conferir: `curl http://45.79.137.141` → HTML do app.
2. `.208` (NPM em Docker) — config do domínio em `/data/nginx/proxy_host/68.conf`:
   ```
   # ANTES (errado):
   set $server "192.168.210.205";
   set $port   3002;
   # DEPOIS:
   set $server "45.79.137.141";
   set $port   80;
   ```
3. `docker restart nginx-proxy-manager-app-1`
4. Conferir: `curl https://chat.devellwaves.com.br` → HTML do app.

### Camada de TENANT (task #757)
- Garantir o host no tenant `devell` em `/var/www/html/waves-client/.secrets/tenants.json` (`.141`):
  ```bash
  jq '(.tenants[] | select(.tenant=="devell") | .hosts) |= (. + ["chat.devellwaves.com.br"] | unique)' \
     tenants.json > t.tmp && mv t.tmp tenants.json
  ```
  Recarrega por `mtime` — **sem restart**.
- Validar: `curl -H "Host: chat.devellwaves.com.br" http://127.0.0.1:3002/api/tenant`
  → retorna o tenant `devell` com branding.

## Playbook de diagnóstico (se voltar a falhar)

```bash
# 1) Pra onde o domínio aponta?
getent hosts chat.devellwaves.com.br          # deve ser 173.255.225.208

# 2) Quem responde no público e o que serve?
curl -sI https://chat.devellwaves.com.br/api/tenant   # Server: openresty (NPM) / X-Powered-By: Express

# 3) O app local resolve o tenant? (isola do proxy/TLS)
curl -s -H "Host: chat.devellwaves.com.br" http://127.0.0.1:3002/api/tenant   # no .141

# 4) NPM (.208) — destino do proxy_host correto?
#    /data/nginx/proxy_host/<id>.conf  →  set $server "45.79.137.141"; set $port 80;

# 5) Caddy (.141) — proxy + Host
#    Caddyfile: chat ... reverse_proxy 127.0.0.1:3002  (Caddy preserva o Host por padrão)
```

### Regras de ouro
- **404 em `/api/tenant`** ou **421 em `/api/waves/*`** = "host não mapeado / Host errado chegando no app".
- O proxy de borda **deve preservar o header `Host`** (NPM/Caddy fazem por padrão).
- O `tenants.json` é do **waves_client** (mapeia host→Waves API), recarrega por `mtime`, **nunca** precisa restart.
- Migrou o app de servidor? **Conferir o destino do NPM** — é o ponto que esquece.
