# 🛠️ Plano: Expor as Tools de Configuração (UI) no Servidor MCP do Railway

> **Objetivo**: fazer com que o servidor MCP no Railway exponha **todas as tools que realmente existem no projeto** — não só `load-skill` e `skill-resource`, mas também a **UI de configuração das skills** (`skill-config-*`) e a **UI de exibição/controle** (`skill-display-*`, `skill-toggle`).
>
> **Contexto do usuário**: "no servidor do railway só subimos o MCP, sem API" → o Railway expõe **apenas o endpoint `/mcp`** (protocolo MCP). Não há API REST separada. Portanto, este plano trata de expor as tools **dentro do MCP**, e **descarta** qualquer exposição via API.

---

## 1. Diagnóstico: por que hoje só `load-skill` e `skill-resource` aparecem?

A resposta está em **dois arquivos** que estruturamos para subir o servidor:

### 1.1 `src/http-transport.ts` (o servidor do Railway)

Quando o servidor sobe em modo **HTTP** (que é o caso do Railway), a função `buildCoreServer()` cria, a cada request, um `McpServer` que registra:

```ts
registerSkillTool(server, skillState, catalogMode);   // → load-skill + skill-resource
registerSkillResources(server, skillState);            // → skill:// resources
registerSkillPrompts(server, skillState);              // → /skill prompts
```

**As tools de UI NÃO são registradas aqui.**

### 1.2 `src/index.ts` (o caminho stdio/local)

As tools de UI **existem** em arquivos separados, mas só são registradas no caminho stdio:

```ts
// NO MODO STDIO (local), fora do static mode:
if (!isStatic) {
  registerSkillConfigTool(server, skillState, ...);   // → skill-config-*
  registerSkillDisplayTool(server, skillState, ...);  // → skill-display-*, skill-toggle
}
```

E perceba: no `main()`, quando o modo é HTTP, o código faz `return` logo depois de iniciar o servidor HTTP — **nunca chega** a registrar as tools de UI.

### Resumo do problema

| Tool | Arquivo que a define | Registrada no stdio? | Registrada no HTTP (Railway)? |
|------|----------------------|----------------------|-------------------------------|
| `load-skill` | `skill-tool.ts` | ✅ Sim | ✅ Sim |
| `skill-resource` | `skill-tool.ts` | ✅ Sim | ✅ Sim |
| `skill-config-*` (UI) | `skill-config-tool.ts` | ✅ Sim (se não-static) | ❌ **Não** |
| `skill-display-*` (UI) | `skill-display-tool.ts` | ✅ Sim (se não-static) | ❌ **Não** |
| `skill-toggle` | `skill-display-tool.ts` | ✅ Sim (se não-static) | ❌ **Não** |

> **Causa raiz**: `buildCoreServer()` em `http-transport.ts` não chama `registerSkillConfigTool` e `registerSkillDisplayTool`.

---

## 2. Decisões de arquitetura (leia antes de implementar)

### 2.1 Limitação documentada: UI MCP Apps é "stdio-only"

O README do projeto diz textualmente:

> "The MCP-Apps configuration UI is stdio-only."

Isso significa que a **renderização** da UI (via recursos `ui://...mcp-app.html` / `ui://...skill-display.html`) é pensada para clientes que suportam MCP Apps (como o Claude Desktop). **Expor as tools via HTTP é possível tecnicamente**, mas a UI só "abre" em clientes compatíveis. Fora isso, as tools continuam chamáveis (retornando dados estruturados via `structuredContent`).

### 2.2 Problema com os callbacks (`onDirectoriesChanged` / `onInvocationChanged`)

No stdio, essas tools recebem um callback que faz `refreshSkills(...)` — atualiza o tool via `skillTool.update()`, envia notificações (`tools/listChanged`), etc.

No HTTP **stateless**, não há um único servidor persistente para "empurrar" notificações. O padrão do projeto (visto no `main()`) é:

```ts
startHttpServer(port, skillState, catalogMode);
// Dentro do HTTP: watchers chamam refreshSkillState(dirs) — só troca o estado
```

Ou seja: no HTTP, o refresh deve ser **state-only** (`refreshSkillState`), nunca o `refreshSkills` cheio.

### 2.3 Conflito com `--static` (produção)

No `index.ts`, as UI tools são registradas **apenas se `!isStatic`**. Mas no Railway rodamos com `SKILLJACK_STATIC=true` (ver Dockerfile). Logo, mesmo que `buildCoreServer()` chamasse `registerSkillConfigTool`, o static mode não é o que bloqueia lá — quem bloqueia é simplesmente a ausência do registro no `buildCoreServer()`.

> Decisão sugerida: expor as UI tools **independente do static mode**, com os callbacks adaptados para **state-only refresh**. Isso porque, no HTTP, cada request é stateless e lê o `skillState` fresco — o static mode só "congela" o file-watching inicial, não impede leitura do estado atual.

---

## 3. Plano de implementação (passo a passo)

### ✅ Passo 1 — Registrar as UI tools no caminho HTTP

**Arquivo:** `src/http-transport.ts`

Dentro de `buildCoreServer()`, adicionar o registro das UI tools e dos recursos de UI:

```ts
import { registerSkillConfigTool } from "./skill-config-tool.js";
import { registerSkillDisplayTool } from "./skill-display-tool.js";

export function buildCoreServer(skillState, catalogMode = "instructions") {
  // ...código existente (registerSkillTool, registerSkillResources, registerSkillPrompts)...

  // NOVO: registrar UI de configuração de diretórios
  registerSkillConfigTool(server, skillState, () => {
    // Em HTTP, refresh é state-only (sem server persistente para push).
    // Pequeno helper para re-scan das skills é suficiente:
    console.error("Config changed via HTTP. Refresh handled by next request.");
    // Opcional: se quiser re-validar o estado aqui, chame um state-only refresh.
  });

  // NOVO: registrar UI de exibição/controle de skills
  registerSkillDisplayTool(server, skillState, () => {
    console.error("Invocation changed via HTTP. Refresh handled by next request.");
  });

  return server;
}
```

> ⚠️ **Atenção**: `registerSkillConfigTool` e `registerSkillDisplayTool` usam `path.join(import.meta.dirname, "ui", ...)` para achar o HTML. Isso funciona a partir de `dist/`. **Garanta que `dist/ui/` esteja na imagem Docker** (ver Passo 3).

### ✅ Passo 2 — Adaptar os callbacks para HTTP (state-only refresh)

Em vez de apenas logar, o ideal é chamar um helper que re-descubra as skills e troque o `skillState`. Como `buildCoreServer` já recebe `skillState`, e o `main()` do HTTP passa `refreshSkillState` para os watchers, a opção mais simples é:

- No `index.ts`, **exportar** uma função `refreshSkillStateForHttp()` (ou reutilizar `refreshSkillState`, já existente).
- Passar essa função como callback ao `buildCoreServer` e repassar aos `registerSkillConfigTool` / `registerSkillDisplayTool`.

Mas para o **MVP do plano**, registrar as tools com um callback que apenas loga é suficiente para **fazer as tools aparecerem** em `tools/list` e serem chamáveis (retornam dados). O refresh real das skills já é tratado pelos file-watchers/polling do HTTP.

> **Decisão recomendada (fase 1)**: registrar com callback de log simples. Depois (fase 2), conectar ao `refreshSkillState` para fazer o "dinâmico" completo.

### ✅ Passo 3 — Garantir que `dist/ui/` esteja na imagem do Railway

**Arquivo:** `Dockerfile`

O `npm run build` gera os arquivos HTML da UI em `dist/ui/`. O Dockerfile atual faz:

```dockerfile
COPY --from=builder /app/dist ./dist
```

Isso **já copia todo o `dist/`**, incluindo `dist/ui/`. ✅ **Nenhuma mudança necessária no Dockerfile** para os arquivos HTML.

Porém, **confirme no build** rodando localmente:

```bash
cd skill-local-semantico
npm run build
ls dist/ui/   # deve listar mcp-app.html e skill-display.html
```

> Se `dist/ui/` não existir, o problema é o build da UI — e aí sim seria um ajuste no `vite.config.ts`/scripts. Mas por padrão `build:ui` e `build:ui:display` já geram os dois.

### ✅ Passo 4 — (Recomendado) Parar de rodar em `--static` se quiser mudanças dinâmicas

O `Dockerfile` define:

```dockerfile
ENV SKILLJACK_STATIC=true
```

Isso é **bom para estabilidade** (skills congeladas no boot, sem watcher). Mas, se você quiser que as alterações via UI (ex.: toggle de skill, mudar invocação) **reflitam imediatamente**, o static mode atrapalha o refresh automático.

**Duas opções:**

- **Opção A (mantém static, recomendada p/ MVP estrito de exposição):** Mantém `SKILLJACK_STATIC=true`. As UI tools são expostas e chamáveis (retornam os dados estruturados). Mudanças de configuração escrevem em `~/.skilljack/config.json`, mas **só valem no próximo restart** — aceitável para MVP.

- **Opção B (desliga static, p/ dinamismo):** No Railway, remover/desligar `SKILLJACK_STATIC`. Aí o HTTP liga os file-watchers/polling (como o `main()` já faz para HTTP) e as mudanças valem sem restart. Em troca, há um pequeno custo de observação de arquivos.

### ✅ Passo 5 — Validar a exposição das tools

Após o deploy, testar contra o Railway:

```bash
# 1) Listar tools → deve incluir skill-config*, skill-display*, skill-toggle
curl -X POST https://SEU-APP.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Resultado esperado** (além do `load-skill`/`skill-resource`):

```
skill-config
skill-config-add-directory
skill-config-remove-directory
skill-config-add-allowed-org
skill-config-remove-allowed-org
skill-config-add-allowed-origin
skill-config-remove-allowed-origin
skill-config-set-static-mode
skill-display
skill-display-update-invocation
skill-display-reset-override
skill-toggle
```

### ✅ Passo 6 — Testar uma tool de UI via HTTP

```bash
# 2) Abrir a UI de exibição/controle (retorna dados estruturados)
curl -X POST https://SEU-APP.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"skill-display","arguments":{}},"id":2}'
```

- Responderá com o `structuredContent` (lista de skills + configurações de invocação). ✅
- A **renderização visual** abre apenas em clientes MCP-Apps (ex.: Claude Desktop). Em clientes que só falam texto, a tool ainda é útil porque retorna dados estruturados.

---

## 4. Arquivos que precisam mudar (resumo)

| Arquivo | Mudança |
|---------|---------|
| `src/http-transport.ts` | Chamar `registerSkillConfigTool` e `registerSkillDisplayTool` dentro de `buildCoreServer()` |
| `src/index.ts` *(opcional/fase 2)* | Exportar `refreshSkillState` (ou um helper) para conectar aos callbacks das UI tools via HTTP |
| `Dockerfile` | **Nenhuma** (já copia `dist/ui`) — apenas confirmar que o build gera `dist/ui/` |
| Railway | **Opcional**: remover `SKILLJACK_STATIC=true` se quiser dinamismo (Passo 4) |

---

## 5. Ordem de execução

1. ✅ **[Fase 1 — Expor] IMPLEMENTADA E VALIDADA**
   - Alterado `src/http-transport.ts` para chamar `registerSkillConfigTool` e `registerSkillDisplayTool` em `buildCoreServer()`.
   - Compilado com `npm run build` (sucesso; gera `dist/ui/mcp-app.html` e `dist/ui/skill-display.html`).
   - Testado localmente com `node dist/index.js --http=3001 --static ./skills`.
   - **`tools/list` agora retorna 14 tools** (antes só 2): `load-skill`, `skill-resource`, `skill-config`, `skill-config-add-directory`, `skill-config-remove-directory`, `skill-config-add-allowed-org`, `skill-config-remove-allowed-org`, `skill-config-add-allowed-origin`, `skill-config-remove-allowed-origin`, `skill-config-set-static-mode`, `skill-display`, `skill-display-update-invocation`, `skill-display-reset-override`, `skill-toggle`.
   - ⚠️ **Nota de teste**: como o transporte é Streamable HTTP, o `curl` precisa do header `Accept: application/json, text/event-stream` (senão retorna erro "Not Acceptable"). Comando validado:
     ```bash
     curl -s -X POST http://localhost:3001/mcp \
       -H "Content-Type: application/json" \
       -H "Accept: application/json, text/event-stream" \
       -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
     ```
2. **[Fase 2 — Tornar dinâmico]** (pendente)
   - Exportar o state-only refresh do `index.ts`.
   - Conectar os callbacks das UI tools a esse refresh (para o `skillState` refletir mudanças sem restart, quando não-static).
   - Avaliar desligar `SKILLJACK_STATIC` no Railway se quiser dinamismo total.
3. **[Fase 3 — Teste no cliente]** (pendente) No Claude Desktop, conectado via URL do Railway, verificar se a UI MCP Apps abre (ou pelo menos que as tools respondem).

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| UI MCP Apps não renderiza em http stateless | É limitação conhecida; as tools **continuam úteis** via `structuredContent` |
| Callbacks de refresh incompletos no HTTP | Fase 1 usa log simples; Fase 2 conecta ao state-only refresh (padrão já usado pelos watchers HTTP) |
| `dist/ui` ausente na imagem | Confirmar com `npm run build` + `ls dist/ui` antes do deploy |
| Static mode congela mudanças | Opção B (desligar `SKILLJACK_STATIC`) se dinamismo for necessário |
| Caminho do HTML (`import.meta.dirname/ui`) | Funciona a partir de `dist/`; validar no deploy |

---

## 7. Exposição via API — descartada (por enquanto)

Conforme feedback: **no Railway só sobimos o MCP (`/mcp`), sem API REST separada**. Portanto:

- ❌ **Não criar** rotas HTTP "bonitas" tipo `GET /skills`, `GET /skills/:name`.
- ✅ Tudo é via **MCP JSON-RPC em `POST /mcp`** (tools `load-skill`, `skill-resource`, `resource/read`, `tools/call`, etc.).
- O guia de integração (`INTEGRACAO-CLAUDE-API.md`) deve ser ajustado para **remover a seção de "API pública"** e deixar claro que o acesso é **exclusivamente via MCP**.

---

## 8. Entregáveis deste plano

- [x] Diagnóstico da causa raiz (`http-transport.ts` vs `index.ts`)
- [x] Mapa de quais tools existem e onde são registradas
- [x] Plano de implementação em 3 fases
- [x] Lista de arquivos a alterar
- [x] Riscos e mitigações
- [x] Decisão de descartar exposição via API no Railway

> **Sugestão de próximo passo**: fazer o **deploy no Railway** com a Fase 1 já codificada e validada, e confirmar que o `tools/list` remoto responde com as 14 tools (usando o header `Accept` correto). Depois, seguir para a Fase 2 (dinamismo) se necessário.
