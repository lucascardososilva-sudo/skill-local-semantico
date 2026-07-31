# ✅ Testes do Servidor MCP no Railway — Domínio Público

> **Domínio público**: `https://sanfranmd.up.railway.app/mcp`
>
> **Importante**: o transporte é **Streamable HTTP**. Todo `curl` para `/mcp` **precisa** do header `Accept: application/json, text/event-stream`, senão o servidor responde `Not Acceptable`.

---

## 1. Health check (servidor está vivo?)

```bash
curl https://sanfranmd.up.railway.app/health
```

**Resposta esperada:**
```json
{"status":"ok","skills":14,"timestamp":"2026-07-31T18:45:38.768Z"}
```

- `status: ok` → servidor no ar.
- `skills: 14` → quantidade de skills carregadas (vai depender do repo configurado).

---

## 2. Listar todas as ferramentas (tools/list)

> **Objetivo**: confirmar que as 14 tools estão expostas — **é aqui que se verifica se o novo deploy chegou**.

```bash
curl -s -X POST https://sanfranmd.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Antes do meu commit** (comportamento antigo), retornava só 2 tools:
- `load-skill`
- `skill-resource`

**Depois do commit `465e73a`** (novo comportamento), deve retornar **14 tools**:
1. `load-skill`
2. `skill-resource`
3. `skill-config`
4. `skill-config-add-directory`
5. `skill-config-remove-directory`
6. `skill-config-add-allowed-org`
7. `skill-config-remove-allowed-org`
8. `skill-config-add-allowed-origin`
9. `skill-config-remove-allowed-origin`
10. `skill-config-set-static-mode`
11. `skill-display`
12. `skill-display-update-invocation`
13. `skill-display-reset-override`
14. `skill-toggle`

> ⚠️ **Se ainda retornar só 2 tools**: o Railway precisa concluir o **redeploy** (rebuild do Docker). Aguarde alguns minutos ou, se o auto-deploy estiver desligado, clique em **Redeploy** no dashboard do projeto Railway.

---

## 3. Listar os recursos (resources/list)

```bash
curl -s -X POST https://sanfranmd.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"resources/list","id":2}'
```

---

## 4. Listar os prompts (prompts/list)

```bash
curl -s -X POST https://sanfranmd.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"prompts/list","id":3}'
```

---

## 5. Carregar uma skill (tools/call → load-skill)

```bash
curl -s -X POST https://sanfranmd.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"load-skill","arguments":{"name":"NOME_DA_SKILL"}},"id":4}'
```

> Substitua `NOME_DA_SKILL` pelo nome exato de uma skill (ex.: `contract-analysis`). Para descobrir os nomes, use a dica da seção 6.

---

## 6. Abrir a UI de exibição de skills (tools/call → skill-display)

> **Só disponível após o novo deploy chegar** (se `tools/list` mostrar 14 tools).

```bash
curl -s -X POST https://sanfranmd.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"skill-display","arguments":{}},"id":5}'
```

**Resposta esperada**: retorna o `structuredContent` com a lista de skills e configurações de invocação (o `totalCount` e cada skill com `assistantInvocable` / `userInvocable`).

---

## 7. Dica: descobrir o nome exato de uma skill

- Na resposta do **`initialize`** (handshake), vem o catálogo `instructions` com `<available_skills>`, cada skill entre `<name>...</name>`.
- Ou chame `load-skill` com um nome errado: o servidor **sugere skills parecidas** no erro ("Did you mean...").

---

## 8. Checklist de validação do deploy

- [ ] `GET /health` → `{"status":"ok","skills":N,...}`
- [ ] `POST /mcp tools/list` → retorna **14 tools** (não só 2)
- [ ] `POST /mcp resources/list` → retorna os recursos `skill://...`
- [ ] `POST /mcp prompts/list` → retorna os prompts `/skill`
- [ ] `POST /mcp tools/call skill-display` → retorna `structuredContent` com as skills
- [ ] `POST /mcp tools/call load-skill` → carrega uma skill real

---

## Observação

O commit que habilita essas 14 tools foi **feito e enviado** para o GitHub (commit `465e73a`). Se o `tools/list` remoto ainda mostrar apenas `load-skill` e `skill-resource`, é porque o Railway ainda não concluiu o rebuild — **aguarde alguns minutos ou force um Redeploy no dashboard do Railway**.