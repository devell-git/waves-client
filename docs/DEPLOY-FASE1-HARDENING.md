# Deploy — Fase 1 (hardening de segurança)

> Runbook para propagar as mudanças da **Fase 1** (críticos de segurança) para
> os demais servidores que rodam o `waves_client`. Cada servidor tem seu próprio
> `.env`/`.secrets` (fora do git), então parte do deploy é **manual por-servidor**.

## O que muda nesta fase

| Mudança | Natureza | Propaga como |
|---------|----------|--------------|
| `server/chat.ts` — validação de `attachments[].path`/`contentPath` (anti leitura arbitrária) | Código | `git pull` |
| `server/uploads.ts` — helper `isOwnedUploadPath` | Código | `git pull` |
| `.gitignore` — passa a ignorar `*.log` | Código | `git pull` |
| `server.log` removido do versionamento (continha preview de credencial) | Código | `git pull` (apaga o arquivo rastreado) |
| `.env` → permissão `600` | **Manual por-servidor** | SSH |
| `.secrets/` → permissão `700` | **Manual por-servidor** | SSH |
| Remover `.secrets/tenants.json.bak*` (backup com credenciais) | **Manual por-servidor** | SSH |
| `OPENAI_API_KEY` removida/rotacionada no `.env` | **Manual por-servidor** | SSH |

> Só arquivos em `server/*.ts` mudaram (o front em `src/` **não** foi tocado).
> O app roda via `tsx` (transpila on-the-fly), então **basta restart** — o
> `npm run build` do hook de deploy é inofensivo, mas não é necessário aqui.

## Topologia (referência)

- **Repo:** `git@github.com:devell-git/waves-client.git`, branch `master`.
- **Deploy automático (produção `45.79.137.141`):** push em `master` → GitHub
  Actions (`.github/workflows/deploy.yml`) → SSH `root@45.79.137.141` →
  `cd /var/www/html/waves-client && git pull` → hook `post-merge`
  (`npm install` se deps mudaram + `npm run build` + restart do
  `waves-client.service`).
- **Máquina de dev (`devell`, esta):** `/home/bot/waves_client`, roda como
  usuário `bot` via `systemd --user` (`systemctl --user ... waves-client`).

---

## Passo 0 — Publicar o código (a partir da máquina de dev)

```bash
cd /home/bot/waves_client
git -c safe.directory=$PWD add .gitignore server/chat.ts server/uploads.ts
git -c safe.directory=$PWD rm --cached --ignore-unmatch server.log   # já feito nesta box
git -c safe.directory=$PWD commit -m "fix(security): fase 1 — valida path de anexos, remove server.log do git, ignora *.log"
git -c safe.directory=$PWD push origin master
```

O push dispara o deploy automático em `45.79.137.141`. **Antes** que o hook rode,
veja o Passo 1 (cuidado com `server.log`), senão o `git pull` pode abortar.

---

## Passo 1 — CUIDADO com `server.log` no pull (uma vez por servidor)

Este commit **remove `server.log` do versionamento**. Em cada servidor onde o
arquivo ainda estiver rastreado **e** com modificações locais (é um log vivo), o
`git pull` aborta com *"Your local changes would be overwritten by merge"*, o
que **quebra o deploy automático**. Previna rodando **uma vez, antes do pull**,
em cada servidor:

```bash
cd <dir-do-waves-client>            # ex.: /var/www/html/waves-client
# tira o log vivo da frente pra o pull poder remover o arquivo rastreado
[ -f server.log ] && mv server.log server.log.pre-deploy.bak
git rm --cached --ignore-unmatch server.log 2>/dev/null || true
```

Depois disso o `git pull` (manual ou pelo hook) roda limpo. O `server.log` que o
app recriar já cai no `.gitignore` novo (`*.log`).

---

## Passo 2 — Atualizar o código em cada servidor

### 2a. Produção `45.79.137.141` (automático)
Já ocorre pelo push do Passo 0. Se precisar rodar à mão:

```bash
ssh root@45.79.137.141
cd /var/www/html/waves-client
git pull origin master
systemctl restart waves-client.service    # se o hook não reiniciar
```

### 2b. Outros servidores / tenants (manual)
Para cada servidor adicional que roda o `waves_client`:

```bash
cd <dir-do-waves-client>
git pull origin master
# restart conforme o supervisor daquele host:
systemctl restart waves-client.service              # se root/systemd de sistema
# ou, se rodar como usuário via systemd --user:
systemctl --user restart waves-client.service
```

---

## Passo 3 — Ajustes manuais de segredo/permissão (TODO servidor)

`.env` e `.secrets/` **não** vêm pelo git. Faça em **cada** servidor:

```bash
cd <dir-do-waves-client>

# 1) Permissões restritivas
chmod 600 .env
chmod 700 .secrets

# 2) Remover backup de credenciais de tenant, se existir
rm -f .secrets/tenants.json.bak* 

# 3) OPENAI_API_KEY: remover/comentar do .env (só é usada se OPENAI_PROVIDER=openai).
#    Se estava preenchida, ROTACIONE a chave no painel da OpenAI (esteve exposta).
#    Edite o .env e comente a linha:
#      # OPENAI_API_KEY=...
```

> O `.env` deve ser legível pelo usuário que roda o serviço. Se o serviço roda
> como `root`, `600` de dono `root` serve; se roda como `bot` (systemd --user),
> o `.env` precisa ser de dono `bot`. Confira: `stat -c '%A %U:%G' .env`.

---

## Passo 4 — Verificação (smoke) por servidor

```bash
# App no ar
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/            # 200
curl -s http://127.0.0.1:3002/api/health                                    # {"ok":true,...}

# Permissões aplicadas
stat -c '%A %U:%G %n' .env .secrets                                         # -rw------- e drwx------

# server.log não rastreado
git ls-files | grep -c '\.log$'                                             # 0

# Teste funcional: login → anexar um arquivo legítimo → enviar no chat.
#   Deve funcionar normalmente. No log NÃO deve aparecer, para anexos legítimos:
#   "[chat:attach] caminho local fora do escopo do dono descartado"
```

---

## Rollback

- **Código:** `git revert <hash-do-commit-fase1> && git push` (ou `git checkout
  <hash-anterior> -- server/chat.ts server/uploads.ts` e restart). O app volta
  ao comportamento anterior de anexos.
- **Permissões:** são endurecimento; reverter não é recomendado. Se algo quebrou
  por permissão, confira o **dono** do `.env` vs. o usuário do serviço (Passo 3),
  não afrouxe para `644`.
- **`server.log`:** o backup ficou em `server.log.pre-deploy.bak` (Passo 1).

## Notas

- Nada de segredo entra no git: `.env`, `.secrets/`, `*.db`, `*.log` são
  gitignored. Revise `git diff --cached` antes de qualquer commit.
- O `tenants.json` recarrega por `mtime` (sem restart); os ajustes de permissão
  não alteram o conteúdo, então não afetam o mapeamento de tenants.
