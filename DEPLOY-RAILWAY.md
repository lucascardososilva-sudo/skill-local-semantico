# Deploy do Servidor MCP no Railway — Guia Completo

> Documento passo a passo para preparar e fazer deploy do servidor MCP de skills jurídicas no Railway, usando GitHub como fonte de skills (modelo skill.legal).

---

## Índice

1. [Arquitetura](#1-arquitetura)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Passo 1: Criar o repositório de skills no GitHub](#3-passo-1-criar-o-repositório-de-skills-no-github)
4. [Passo 2: Preparar o servidor para produção](#4-passo-2-preparar-o-servidor-para-produção)
5. [Passo 3: Criar o Dockerfile](#5-passo-3-criar-o-dockerfile)
6. [Passo 4: Configurar variáveis de ambiente](#6-passo-4-configurar-variáveis-de-ambiente)
7. [Passo 5: Fazer deploy no Railway](#7-passo-5-fazer-deploy-no-railway)
8. [Passo 6: Testar a conexão](#8-passo-6-testar-a-conexão)
9. [Passo 7: Configurar polling de atualizações](#9-passo-7-configurar-polling-de-atualizações)
10. [Manutenção e operação](#10-manutenção-e-operação)
11. [Checklist final](#11-checklist-final)

---

## 1. Arquitetura

```
┌─────────────────────────────────────┐
│  GitHub (público)                    │
│  github.com/sanfran/skills           │
│                                      │
│  skills/                             │
│  ├── motion-to-dismiss.md            │
│  ├── contratos/                      │
│  │   ├── contrato-prestacao.md       │
│  │   └── nda.md                      │
│  ├── compliance/                     │
│  │   └── lgpd-checklist.md           │
│  └── ...                             │
└──────────────┬──────────────────────┘
               │ git clone / git pull
               ▼
┌─────────────────────────────────────┐
│  Railway (servidor MCP)              │
│                                      │
│  node dist/index.js --http --static  │
│                                      │
│  Na inicialização:                   │
│  1. Clona repositório GitHub         │
│  2. Descobre skills .md              │
│  3. Serve via HTTP em /mcp           │
│                                      │
│  Polling a cada N minutos:           │
│  - git pull no repositório           │
│  - rediscovery de skills             │
└──────────────┬──────────────────────┘
               │ POST /mcp (MCP protocol)
               ▼
┌─────────────────────────────────────┐
│  Cliente MCP (Claude, Tess, etc.)    │
│                                      │
│  Configuração:                       │
│  URL: https://seu-app.railway.app    │
│  /mcp                                │
└─────────────────────────────────────┘
```

### Decisões de arquitetura para o MVP

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Fonte de skills | GitHub público | Zero infra de banco, versionamento nativo, colaboração via PR |
| Transporte | HTTP stateless | Clientes MCP fazem req/resp, não precisam de push |
| Modo | Static (`--static`) | Sem file watcher em produção, polling via GitHub |
| Autenticação | Nenhuma (público) | MVP — depois adiciona-se repositório privado |
| Banco de dados | Nenhum no MVP | Métricas podem vir depois com Supabase |

---

## 2. Pré-requisitos

### Contas necessárias

- [ ] **GitHub**: conta para criar o repositório de skills
- [ ] **Railway**: conta em [railway.app](https://railway.app) (login com GitHub)
- [ ] **GitHub Token**: personal access token com permissão `repo` (para clonar repositórios)

### Ferramentas locais

- [ ] Node.js >= 18
- [ ] npm
- [ ] Git
- [ ] Railway CLI (opcional, `npm i -g @railway/cli`)

---

## 3. Passo 1: Criar o repositório de skills no GitHub

### 3.1. Criar o repositório

1. Acesse [github.com/new](https://github.com/new)
2. Nome: `skills` (ou `sanfran-skills`, `juridicas-skills`)
3. Visibilidade: **Public** (no MVP)
4. Não inicializar com README (vamos criar manualmente)

### 3.2. Estrutura de diretórios

Cada skill é um arquivo `.md` com frontmatter YAML. A estrutura segue o formato que o servidor já reconhece:

```
skills/
├── SKILLS_INDEX.md              # Opcional: índice do catálogo
├── motion-to-dismiss.md         # Skill raiz
├── contratos/
│   ├── contrato-prestacao-servicos.md
│   └── nda.md
├── compliance/
│   ├── lgpd-checklist.md
│   └── anticorrupcao.md
├── litigation/
│   ├── peticao-inicial-trabalhista.md
│   └── contestacao.md
└── corporate/
    └── due-diligence-checklist.md
```

### 3.3. Formato de uma skill

Cada arquivo `.md` deve ter frontmatter YAML + corpo:

```markdown
---
name: motion-to-dismiss
description: >
  Gera minuta de petição de extinção do processo sem resolução do mérito
  (CPC, arts. 485, 487). Acionar quando houver preliminares de mérito,
  decadência, prescrição, coisa julgada, ou falta de interesse processual.
---

# Motion to Dismiss (Petição de Extinção)

## Quando usar
Use esta skill quando o processo contiver matéria preliminar que possa
extinguir o feito sem julgamento do mérito (CPC art. 485) ou com julgamento
(CPC art. 487).

## Template

EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA [...] VARA [...] DA COMARCA DE [...]

Autos nº: [número do processo]

[Nome do Autor], já qualificado nos autos em epígrafe, por seu advogado que
esta subscreve, vem, respeitosamente, à presença de Vossa Excelência, com
fundamento no art. 485 do Código de Processo Civil, apresentar

**PEDIDO DE EXTINÇÃO DO PROCESSO SEM RESOLUÇÃO DO MÉRITO**

pelos fatos e fundamentos a seguir expostos.

[...]
```

**Regras:**
- `name`: identificador único da skill (sem espaços, usar hífens)
- `description`: descrição precisa que o LLM usará para decidir quando acionar
- O corpo é o template/instrução que será injetado no contexto do LLM

### 3.4. Commitar e fazer push

```bash
# No seu computador local
mkdir skills
cd skills
git init
# criar os arquivos .md conforme estrutura acima
git add .
git commit -m "feat: initial skills catalog"
git branch -M main
git remote add origin https://github.com/seu-usuario/skills.git
git push -u origin main
```

### 3.5. Gerar GitHub Token

1. Acesse: https://github.com/settings/tokens
2. Clique em "Generate new token (classic)"
3. Nome: `railway-mcp-server`
4. Escopo: marcar **repo** (full control)
5. Gerar e **copiar o token** (vai precisar no Railway)

---

## 4. Passo 2: Preparar o servidor para produção

### 4.1. Adicionar endpoint de health check

O Railway precisa de um endpoint HTTP que retorne 200 para saber que o servidor está vivo. O servidor atual só responde `POST /mcp`. Vamos adicionar `GET /health`.

Edite `src/http-transport.ts`:

```typescript
// Dentro do createServer, ANTES do bloco POST /mcp:
const httpServer = http.createServer(async (req, res) => {
    const url = req.url ?? "";

    // === NOVO: Health check para o Railway ===
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        skills: skillState.skillMap.size,
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // Resto do código existente...
    if (req.method !== "POST" || !(url === "/mcp" || url.startsWith("/mcp?"))) {
      res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
      res.end(JSONRPC_ERROR(-32000, "Only POST /mcp is supported (stateless mode)"));
      return;
    }
    // ...
});
```

### 4.2. Ajustar cache directory para produção

O `github-config.ts` usa `~/.skilljack/github-cache` como cache padrão. No Railway, o diretório home pode não existir. Vamos usar um caminho relativo.

Edite `src/github-config.ts`:

```typescript
// Linha 39: alterar DEFAULT_CACHE_DIR
const DEFAULT_CACHE_DIR = process.env.SKILLJACK_CACHE_DIR || path.join(process.cwd(), '.skilljack-cache');
```

### 4.3. Ajustar allowlist para aceitar repositórios públicos

No `github-config.ts`, a função `isRepoAllowed()` nega todos os repositórios se não houver allowlist configurada. Para o MVP (tudo público), precisamos permitir repositórios sem token.

**Opção A (recomendada para MVP):** Configurar `GITHUB_ALLOWED_ORGS` com seu usuário/organização no Railway.

**Opção B (se quiser aceitar qualquer repo público):** Modificar a lógica para permitir quando não há token configurado:

```typescript
export function isRepoAllowed(spec: GitHubRepoSpec, config: GitHubConfig): boolean {
  // Se não há token, assume repositório público — permite
  if (!config.token) {
    return true;
  }
  // Se há token, aplica allowlist
  if (config.allowedOrgs.length === 0 && config.allowedUsers.length === 0) {
    return false;
  }
  // ... resto igual
}
```

### 4.4. Rebuild do projeto

```bash
cd skill-local-semantico
npm run build
```

Isso gera os arquivos em `dist/`.

---

## 5. Passo 3: Criar o Dockerfile

Crie o arquivo `Dockerfile` na raiz do projeto (`skill-local-semantico/Dockerfile`):

```dockerfile
# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar arquivos de dependência
COPY package*.json ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY vitest.config.ts ./

# Instalar dependências (incluindo dev para build)
RUN npm ci

# Copiar source
COPY src/ ./src/
COPY evals/ ./evals/
COPY skills/ ./skills/

# Build
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS production

WORKDIR /app

# Instalar git para clonar repositórios de skills
RUN apk add --no-cache git

# Copiar apenas o necessário do build
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copiar dist e skills bundled
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/skills ./skills

# Criar diretório para cache do GitHub
RUN mkdir -p /app/.skilljack-cache

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-8080}/health || exit 1

# Porta
EXPOSE ${PORT:-8080}

# Comando de entrada
# O servidor recebe o repositório GitHub como argumento
# Exemplo: github.com/seu-usuario/skills
ENTRYPOINT ["node", "dist/index.js", "--http", "--static"]
CMD []
```

### Explicação do Dockerfile

- **Two-stage build**: reduz o tamanho da imagem final (sem devDependencies)
- **Git instalado**: necessário para clonar repositórios de skills
- **HEALTHCHECK**: Railway usa isso para saber se o servidor está vivo
- **PORT**: Railway define a porta via variável de ambiente
- **ENTRYPOINT + CMD**: permite passar o repositório GitHub como argumento no Railway

---

## 6. Passo 4: Configurar variáveis de ambiente

### 6.1. Variáveis necessárias no Railway

| Variável | Valor | Obrigatória | Descrição |
|----------|-------|-------------|-----------|
| `GITHUB_TOKEN` | `ghp_...` | Sim | Token para clonar repositórios |
| `GITHUB_ALLOWED_ORGS` | `seu-usuario` | Sim | Seu user/org no GitHub |
| `SKILLJACK_HTTP` | `true` | Sim | Habilita modo HTTP |
| `SKILLJACK_STATIC` | `true` | Sim | Desativa file watcher |
| `SKILLJACK_CACHE_DIR` | `/app/.skilljack-cache` | Não | Cache de repositórios clonados |
| `GITHUB_POLL_INTERVAL_MS` | `300000` | Não | Polling a cada 5 min (0 = desligado) |

### 6.2. Comando de start no Railway

No Railway, o comando para iniciar o servidor será:

```
node dist/index.js --http --static github.com/seu-usuario/skills
```

Isso faz o servidor:
1. Iniciar em modo HTTP na porta definida pelo Railway
2. Modo static (sem file watcher)
3. Clonar o repositório `github.com/seu-usuario/skills`
4. Descobrir todas as skills `.md` dentro dele
5. Servir via MCP em `POST /mcp`

---

## 7. Passo 5: Fazer deploy no Railway

### 7.1. Via GitHub (recomendado)

1. Faça push do código do servidor para um repositório GitHub (pode ser privado)
2. Acesse [railway.app](https://railway.app) e clique em "New Project"
3. Selecione "Deploy from GitHub repo"
4. Escolha o repositório do servidor
5. Railway detecta o `Dockerfile` automaticamente

### 7.2. Configurar variáveis de ambiente no Railway

1. No dashboard do projeto, vá em **Variables**
2. Adicione cada variável da tabela acima
3. **Importante:** `GITHUB_TOKEN` deve ser marcada como sensitive

### 7.3. Configurar o comando de start

1. Vá em **Settings** → **Deploy**
2. Em **Start Command**, coloque:
   ```
   node dist/index.js --http --static github.com/seu-usuario/skills
   ```
   (substitua `seu-usuario` pelo seu GitHub user)

### 7.4. Configurar domínio público

1. Vá em **Settings** → **Networking**
2. Clique em "Generate Domain"
3. Railway gera um domínio tipo `seu-app.up.railway.app`
4. Anote esse domínio — você vai usar para conectar os clientes MCP

### 7.5. Fazer deploy

1. Vá em **Deployments**
2. Clique em "Deploy"
3. Acompanhe os logs para ver se o servidor iniciou corretamente
4. Você deve ver algo como:
   ```
   Syncing 1 GitHub repo(s)...
   Successfully synced 1/1 repo(s)
   Discovered 5 skill(s)
   Skilljack ready on http://localhost:8080/mcp (stateless HTTP). I know kung fu.
   ```

### 7.6. Verificar health check

```bash
curl https://seu-app.up.railway.app/health
# Resposta esperada:
# {"status":"ok","skills":5,"timestamp":"2026-07-28T04:30:00.000Z"}
```

---

## 8. Passo 6: Testar a conexão

### 8.1. Testar com curl (requisição MCP)

```bash
curl -X POST https://seu-app.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

Resposta esperada: lista de ferramentas MCP disponíveis (incluindo `load-skill`).

### 8.2. Testar no Claude Desktop

1. Abra o Claude Desktop
2. Vá em Settings → Developer → MCP Servers
3. Adicione um novo servidor MCP com:
   - **Name:** Sanfran Skills
   - **Type:** URL
   - **URL:** `https://seu-app.up.railway.app/mcp`
4. Salve e teste com um prompt como:
   > "Use a skill de motion to dismiss para redigir uma petição"

### 8.3. Testar no Claude Web (claude.ai)

Se o Claude Web suportar MCP remoto (verificar disponibilidade):
1. Vá em Settings → MCP Servers
2. Adicione a URL do servidor
3. Teste com um prompt jurídico

### 8.4. Testar no Tess AI (se suportar MCP)

Siga as instruções da Tess AI para conectar um servidor MCP remoto.

---

## 9. Passo 7: Configurar polling de atualizações

O servidor já tem suporte a polling de repositórios GitHub via `GITHUB_POLL_INTERVAL_MS`.

### 9.1. Habilitar polling

No Railway, configure a variável:
```
GITHUB_POLL_INTERVAL_MS=300000
```

Isso faz o servidor verificar novos commits a cada 5 minutos. Quando detecta mudanças, rediscovery as skills automaticamente.

### 9.2. Verificar se o polling está funcionando

Nos logs do Railway, você deve ver algo como:
```
GitHub polling started for seu-usuario/skills (interval: 300000ms)
```

E quando houver atualizações:
```
GitHub update detected for seu-usuario/skills
Refreshing skills...
Skills refreshed: 5 -> 7 skill(s)
```

### 9.3. Limitação do stateless HTTP

Como estamos usando HTTP stateless (sem sessão), o servidor **não envia notificações push** para clientes conectados. Isso significa que:

- Clientes existentes só veem as novas skills quando fizerem uma nova requisição `tools/list`
- Para o Claude, isso geralmente significa reiniciar a conversa ou reconectar
- **Não é um problema para o MVP** — skills mudam com pouca frequência

---

## 10. Manutenção e operação

### 10.1. Adicionar nova skill

1. Crie um arquivo `.md` no repositório GitHub
2. Faça commit e push
3. O servidor detecta a mudança no próximo polling (até 5 min)
4. Pronto — a skill está disponível

### 10.2. Atualizar skill existente

1. Edite o arquivo `.md` no repositório GitHub
2. Faça commit e push
3. O servidor atualiza na próxima verificação

### 10.3. Remover skill

1. Delete o arquivo `.md` no repositório GitHub
2. Faça commit e push
3. O servidor remove a skill na próxima verificação

### 10.4. Ver logs do servidor

No Railway:
1. Acesse o dashboard do projeto
2. Vá em **Deployments** → deployment atual
3. Clique em **View Logs**

### 10.5. Atualizar o servidor

1. Faça as alterações no código
2. Faça push para o repositório do servidor
3. Railway faz deploy automático (se configurado)
4. Ou clique em "Redeploy" no dashboard

---

## 11. Checklist final

### Antes do deploy

- [ ] Repositório de skills criado no GitHub com pelo menos 1 skill `.md`
- [ ] GitHub Token gerado com escopo `repo`
- [ ] Código do servidor com health check (`GET /health`)
- [ ] `Dockerfile` criado na raiz do projeto
- [ ] Build local funciona (`npm run build`)
- [ ] Teste local com `node dist/index.js --http --static --http=3000 github.com/seu-usuario/skills` funciona
- [ ] Teste local: `curl http://localhost:3000/health` retorna 200
- [ ] Teste local: `curl -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'` retorna lista de tools

### No Railway

- [ ] Projeto criado no Railway
- [ ] Variáveis de ambiente configuradas:
  - `GITHUB_TOKEN`
  - `GITHUB_ALLOWED_ORGS`
  - `SKILLJACK_HTTP=true`
  - `SKILLJACK_STATIC=true`
- [ ] Start command configurado: `node dist/index.js --http --static github.com/seu-usuario/skills`
- [ ] Domínio público gerado
- [ ] Deploy bem-sucedido (logs sem erros)
- [ ] Health check responde: `curl https://seu-app.up.railway.app/health`
- [ ] MCP responde: `curl -X POST https://seu-app.up.railway.app/mcp ...`

### Pós-deploy

- [ ] Testar no Claude Desktop
- [ ] Testar no Claude Web (se suportar)
- [ ] Testar no Tess AI (se suportar)
- [ ] Compartilhar URL com usuários beta
- [ ] Criar guia de contribuição (como fazer PR para adicionar skills)

---

## Apêndice: Comandos úteis

### Testar localmente com Docker

```bash
# Build da imagem
docker build -t sanfran-mcp .

# Rodar localmente
docker run -p 8080:8080 \
  -e GITHUB_TOKEN=ghp_seu_token \
  -e GITHUB_ALLOWED_ORGS=seu-usuario \
  -e SKILLJACK_HTTP=true \
  -e SKILLJACK_STATIC=true \
  sanfran-mcp \
  node dist/index.js --http --static github.com/seu-usuario/skills

# Testar
curl http://localhost:8080/health
curl -X POST http://localhost:8080/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### Railway CLI

```bash
# Instalar
npm i -g @railway/cli

# Login
railway login

# Link com projeto
railway link

# Deploy
railway up

# Ver logs
railway logs

# Abrir dashboard
railway open
```

### Debug de problemas comuns

| Problema | Causa provável | Solução |
|----------|---------------|---------|
| `Blocked: ... not in allowed orgs/users` | `GITHUB_ALLOWED_ORGS` não configurado | Adicionar variável no Railway |
| `Error: Authentication failed` | Token inválido ou sem permissão | Regenerar token com escopo `repo` |
| `Warning: Skills directory not found` | Repositório não foi clonado | Verificar logs de sync |
| `ECONNREFUSED` no health check | Servidor não iniciou | Verificar logs completos |
| `0 skill(s) discovered` | Skills não estão no formato esperado | Verificar se os arquivos têm frontmatter `name:` |

---

> **Próximos passos pós-MVP:**
> - Repositório privado para skills pagas
> - Autenticação via GitHub App por organização
> - Supabase para métricas de uso
> - Pipeline de submissão de skills via `submit-skill`
> - Busca semântica com embeddings