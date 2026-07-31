# 🧠 Guia Completo: Integrar as Skills Jurídicas ao Claude + Acesso via API

> **Objetivo deste guia**: ensinar, de forma simples e passo a passo, como o servidor MCP de skills jurídicas funciona, como conectá-lo ao **Claude** e como **qualquer pessoa pode acessá-lo via API** — inclusive depois que ele estiver no ar no **Railway**.

---

## 📖 Sumário

1. [O que é este projeto?](#1-o-que-é-este-projeto)
2. [Conceitos que você precisa entender](#2-conceitos-que-você-precisa-entender)
3. [Mapeamento completo do projeto](#3-mapeamento-completo-do-projeto)
4. [Caminho A: Conectar localmente no Claude Desktop](#4-caminho-a-conectar-localmente-no-claude-desktop)
5. [Caminho B: Acessar via API (HTTP)](#5-caminho-b-acessar-via-api-http)
6. [Caminho C: Deploy no Railway e acesso remoto](#6-caminho-c-deploy-no-railway-e-acesso-remoto)
7. [Exemplos de requisições API prontos para copiar](#7-exemplos-de-requisições-api-prontos-para-copiar)
8. [Solução de problemas (FAQ)](#8-solução-de-problemas-faq)
9. [Checklist final](#9-checklist-final)

---

## 1. O que é este projeto?

Este diretório (`skill-local-semantico`) contém um **servidor MCP** que "injeta" um catálogo de **skills jurídicas** diretamente na "cabeça" do modelo de IA (Claude).

**Na prática:**

```
Você (usuário)  →  Claude  →  MCP Server (este projeto)  →  Skills jurídicas (.md)
```

Quando você pede algo como *"redija uma petição de extinção"*, o Claude:

1. **Vê o catálogo de skills** disponíveis (enviado na conexão).
2. **Escolhe a skill certa** (ex.: `motion-to-dismiss`).
3. **Chama a ferramenta `load-skill`** do servidor para carregar o passo a passo completo.
4. **Segue as instruções da skill** para gerar o documento.

### Por que isso é poderoso?

- ✅ As skills ficam **versionadas no GitHub** (fácil de atualizar com `git push`).
- ✅ O Claude **aprende a fazer tarefas jurídicas** sem precisar de código.
- ✅ Qualquer pessoa pode **chamar via API** os comandos do servidor.

---

## 2. Conceitos que você precisa entender

### 2.1 O que é MCP?

**MCP (Model Context Protocol)** é um "padrão de tomada" (plug) que permite que modelos de IA (como o Claude) **conectem-se a ferramentas externas** de forma padronizada.

Pense assim:

- **Sem MCP**: o Claude só tem o conhecimento dele mesmo (texto).
- **Com MCP**: o Claude ganha "mãos e olhos" — ele pode carregar skills, ler arquivos, consultar dados, etc.

### 2.2 O que é JSON-RPC?

O MCP usa **JSON-RPC 2.0** para se comunicar. É basicamente um jeito de pedir coisas ao servidor usando JSON.

Um pedido simples tem esta cara:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

- `jsonrpc` → versão do protocolo (sempre `"2.0"`).
- `method` → o que você quer fazer (ex.: `tools/list`, `initialize`, `resources/read`).
- `id` → um número que identifica seu pedido (para combinar com a resposta).

### 2.3 As duas formas de se conectar

| Forma | Transporte | Quando usar |
|-------|------------|-------------|
| **stdio** | Pipes (padrão local) | Claude Desktop no mesmo computador |
| **HTTP** | Requisições web (`POST /mcp`) | Acesso remoto via API ou Railway |

Este guia cobre **as duas**.

---

## 3. Mapeamento completo do projeto

### 3.1 Principais endpoints

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/mcp` | `POST` | Onde o MCP "escuta" (JSON-RPC) |
| `/health` | `GET` | Verifica se o servidor está vivo (usado pelo Railway) |

### 3.2 Ferramentas (Tools) expostas

| Tool | Descrição |
|------|-----------|
| `load-skill` | Carrega a skill completa (o `SKILL.md` da skill escolhida) |
| `skill-resource` | Lê arquivos de apoio da skill (scripts, templates) |

### 3.3 Recursos (Resources) expostos

| URI | Descrição |
|-----|-----------|
| `skill://<nome>/SKILL.md` | O conteúdo completo de uma skill |
| `skill://index.json` | Índice (catálogo) de todas as skills |

### 3.4 Estrutura de arquivos importante

```
skill-local-semantico/
├── src/
│   ├── index.ts           # Ponto de entrada (inicializa o servidor)
│   ├── http-transport.ts  # Servidor HTTP (POST /mcp + GET /health)
│   ├── skill-tool.ts      # Tools: load-skill e skill-resource
│   ├── skill-resources.ts # Resources: skill://...
│   ├── skill-discovery.ts # Descobre e lê as skills
│   ├── github-config.ts   # Configuração de repositórios GitHub
│   └── skill-config.ts    # Configuração (~/.skilljack/config.json)
├── skills/
│   └── legal-doc-library/ # 📚 Seu catálogo de skills jurídicas!
│       ├── Analysis/      #  (resumos de caso, due diligence...)
│       ├── Drafting/      #  (petições, contratos...)
│       ├── Research/      #  (pesquisa jurídica...)
│       └── ...
├── Dockerfile            # 🐳 Para deploy no Railway
├── DEPLOY-RAILWAY.md     # 📄 Guia de deploy já existente
└── package.json          # Dependências e scripts
```

### 3.5 Variáveis de ambiente mais importantes

| Variável | O que faz | Exemplo |
|----------|-----------|---------|
| `SKILLS_DIR` | Lista de pastas/repos de skills (separadas por vírgula) | `github.com/seu-user/skills` |
| `SKILLJACK_HTTP` | Liga o modo HTTP | `true` |
| `SKILLJACK_HTTP_PORT` / `PORT` | Porta do servidor HTTP | `3000` / `8080` |
| `SKILLJACK_STATIC` | "Congela" a lista de skills no boot (recomendado em produção) | `true` |
| `GITHUB_TOKEN` | Token para clonar repositórios de skills | `ghp_...` |
| `GITHUB_ALLOWED_ORGS` | Quais donos de repo estão liberados | `lucascardososilva-sudo` |
| `GITHUB_POLL_INTERVAL_MS` | De quanto em quanto tempo verifica novas skills no GitHub | `300000` (5 min) |

### 3.6 Como uma skill é escrita?

Cada skill é um arquivo `.md` com um **cabeçalho (frontmatter) YAML** + o corpo com as instruções:

```markdown
---
name: contract-analysis
description: >
  Analisa contratos e identifica cláusulas de risco.
  Use quando o usuário enviar um contrato para revisão.
---

# Análise de Contrato

1. Leia o contrato com atenção.
2. Liste as cláusulas de risco.
3. Sugira correções...
```

> ✨ **Regra de ouro**: o `description` é o que o Claude usa para decidir *quando* acionar a skill. Escreva descrições claras!

---

## 4. Caminho A: Conectar localmente no Claude Desktop

Este é o jeito mais simples para **você mesmo** testar no seu computador.

### Passo 4.1 — Compile o projeto (se ainda não estiver compilado)

Abra o terminal na pasta `skill-local-semantico`:

```bash
npm install
npm run build
```

Isso gera o código em `dist/`.

### Passo 4.2 — Descubra o caminho da pasta de skills

As skills já estão em:

```
c:\Users\Lucas Cardoso\Desktop\sanfran\MCP\skill-local-semantico\skills
```

### Passo 4.3 — Configure o Claude Desktop

1. Abra o **Claude Desktop**.
2. Vá em **Settings (Configurações)** → **Developer (Desenvolvedor)** → **MCP Servers**.
3. Clique em **Edit Config** (ou abra o arquivo `claude_desktop_config.json`).
4. Adicione a configuração abaixo substituindo `SEU_CAMINHO` pela pasta real:

```json
{
  "mcpServers": {
    "Sanfran.md": {
      "command": "node",
      "args": [
        "c:\\Users\\Lucas Cardoso\\Desktop\\sanfran\\MCP\\skill-local-semantico\\dist\\index.js",
        "c:\\Users\\Lucas Cardoso\\Desktop\\sanfran\\MCP\\skill-local-semantico\\skills"
      ]
    }
  }
}
```

> 💡 **Nota**: o segundo argumento (`skills`) é o diretório onde estão as skills. É *exatamente* isso que o servidor usa para encontrar o catálogo.

### Passo 4.4 — Teste!

Reinicie o Claude Desktop e tente:

> "Use a skill de análise de contrato para revisar este texto: [cole um contrato]"

Se tudo funcionou, o Claude vai **acionar a skill automaticamente** e seguir as instruções dela.

---

## 5. Caminho B: Acessar via API (HTTP)

Aqui está o que **outras pessoas (ou sistemas)** usam para acessar as skills **remotamente** — sem precisar do Claude Desktop.

### Passo 5.1 — Inicie o servidor em modo HTTP

No terminal:

```bash
cd skill-local-semantico
node dist/index.js --http=3000 --static ./skills
```

Ou usando variáveis de ambiente:

```bash
set SKILLJACK_HTTP=true
set SKILLJACK_STATIC=true
node dist/index.js ./skills
```

Você verá algo como:

```
Skilljack ready on http://localhost:3000/mcp (stateless HTTP). I know kung fu.
```

### Passo 5.2 — Teste o health check

```bash
curl http://localhost:3000/health
```

**Resposta esperada:**

```json
{"status":"ok","skills":30,"timestamp":"2026-07-31T18:00:00.000Z"}
```

Isso confirma que o servidor está de pé e quantas skills ele encontrou.

### Passo 5.3 — Primeira chamada de API (initialize)

Antes de usar as ferramentas, o protocolo MCP exige o *handshake* `initialize`:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "meu-cliente", "version": "1.0.0" }
    },
    "id": 1
  }'
```

Na resposta você verá as **capacidades do servidor** e — no `instructions` — o **catálogo inicial de skills** (é assim que o Claude "enxerga" as skills disponíveis).

### Passo 5.4 — Liste as ferramentas (tools/list)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'
```

**Resposta esperada** (ferramentas disponíveis):

```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      { "name": "load-skill",      "description": "Load a skill's full instructions on demand..." },
      { "name": "skill-resource",  "description": "Read files referenced by skill instructions..." }
    ]
  },
  "id": 2
}
```

### Passo 5.5 — Carregue uma skill (tools/call)

Aqui é onde a mágica acontece. Você pede ao servidor para **carregar** uma skill:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "load-skill",
      "arguments": { "name": "analysis__contract-analysis" }
    },
    "id": 3
  }'
```

> 🧪 **Atenção ao nome da skill**: o servidor **prefixa** os nomes. Uma skill dentro da pasta local vira `NOMEDAPASTA__nomeskill`. Se você não souber o nome exato, use `findMatchingSkills` (veja a seção de dicas) ou peça a lista completa.

**Resposta esperada:** o conteúdo completo do `SKILL.md` da skill escolhida.

> 💡 **Dica de ouro**: para descobrir os **nomes exatos** das skills, cheque o catálogo que veio na resposta do `initialize`, ou procure por "available_skills" no texto das `instructions`.

---

## 6. Caminho C: Deploy no Railway e acesso remoto

Agora vamos colocar o servidor **no ar** (Railway) para que **qualquer pessoa** possa acessar via URL.

> ⚠️ **IMPORTANTE (por enquanto)**: no Railway **só publicamos o MCP** — ou seja, a única porta de entrada é o endpoint **`POST /mcp`** (protocolo MCP/JSON-RPC). **Não existe** uma API REST separada (tipo `GET /skills`). Todas as funcionalidades (carregar skill, listar tools, ler recursos) são acessadas **via MCP**, como mostra a seção [5](#5-caminho-b-acessar-via-api-http).

> 📄 Existe um guia bem detalhado em [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md). Aqui vai o resumo didático.

### Passo 6.1 — O Dockerfile já está pronto

O projeto já tem um `Dockerfile` que:

- Compila o código.
- Instala o `git` (para clonar repositórios de skills).
- Expoe a porta (Railway injeta via `PORT`).
- Define uma skill de teste: `github.com/lucascardososilva-sudo/skills-teste-docker`.

### Passo 6.2 — Crie o projeto no Railway

1. Entre em [railway.app](https://railway.app) e faça login com GitHub.
2. Clique em **New Project** → **Deploy from GitHub repo**.
3. Escolha o repositório deste servidor (ex.: `lucascardososilva-sudo/sanfran`).

### Passo 6.3 — Configure as variáveis de ambiente

No Railway, vá em **Variables** e adicione:

| Variável | Valor sugerido | Obrigatória? |
|----------|----------------|--------------|
| `SKILLS_DIR` | `github.com/lucascardososilva-sudo/skills-teste-docker` | ✅ Sim |
| `SKILLJACK_HTTP` | `true` | ✅ Sim |
| `SKILLJACK_STATIC` | `true` | ✅ Sim |
| `GITHUB_TOKEN` | `ghp_...` (marcar como *sensitive*) | ✅ Sim (para clonar) |
| `GITHUB_ALLOWED_ORGS` | `lucascardososilva-sudo` | ✅ Sim |
| `GITHUB_POLL_INTERVAL_MS` | `300000` | ✳️ Opcional |

> ✅ **Como o Dockerfile já define `SKILLS_DIR`, `SKILLJACK_HTTP` e `SKILLJACK_STATIC`**, elas funcionam por padrão. Mas é sempre melhor **declará-las explicitamente** no Railway para ficar claro e fácil de editar.

### Passo 6.4 — Gere um domínio público

1. Vá em **Settings** → **Networking** → **Generate Domain**.
2. O Railway vai criar algo como: `https://seu-app.somethingsomething.up.railway.app`.

> 🎯 **Anote essa URL** — é ela que você vai compartilhar para as pessoas acessarem via API!

### Passo 6.5 — Faça o deploy e teste

1. Vá em **Deployments** → **Deploy**.
2. Acompanhe os logs. Você deve ver algo como `Skilljack ready on http://...`.
3. Teste o health check:

```bash
curl https://seu-app.somethingsomething.up.railway.app/health
```

### Passo 6.6 — Use o servidor remoto como se fosse local (via MCP)

Agora você pode usar **todos os comandos da seção 5**, mas trocando `http://localhost:3000` pela URL do Railway. **Lembre-se**: tudo é via MCP (`POST /mcp`), não via API REST:

```bash
curl -X POST https://seu-app.somethingsomething.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### Passo 6.7 — No Claude, conecte via URL

No Claude Desktop (Settings → Developer → MCP Servers → Edit Config):

```json
{
  "mcpServers": {
    "Sanfran.md": {
      "url": "https://seu-app.somethingsomething.up.railway.app/mcp"
    }
  }
}
```

Assim o Claude **não depende mais do seu computador local** — ele conversa direto com o servidor no Railway.

---

## 7. Exemplos de requisições API prontos para copiar

Substitua `SEU_URL` por `http://localhost:3000` (local) ou pela URL do Railway (remoto).

### Verificar se o servidor está vivo

```bash
curl SEU_URL/health
```

### Listar as ferramentas disponíveis

```bash
curl -X POST SEU_URL/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### Listar os recursos (skills) disponíveis

```bash
curl -X POST SEU_URL/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"resources/list","id":2}'
```

### Ler uma skill específica (via recurso)

```bash
curl -X POST SEU_URL/mcp -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"resources/read",
    "params": { "uri": "skill://legal-doc-library/Analysis/contract-analysis/SKILL.md" },
    "id": 3
  }'
```

> 🔍 **Nota**: a URI exata depende da estrutura real das skills. Consulte `resources/list` para descobrir os URIs válidos.

### Listar os prompts

```bash
curl -X POST SEU_URL/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"prompts/list","id":4}'
```

### Carregar uma skill (via ferramenta)

```bash
curl -X POST SEU_URL/mcp -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params": {
      "name": "load-skill",
      "arguments": { "name": "NOME_EXATO_DA_SKILL" }
    },
    "id": 5
  }'
```

### Descobrir o nome exato de uma skill (pesquisa)

```bash
# Depois do initialize, busque no texto "instructions" o bloco <available_skills>.
# Os nomes aparecem entre <name>...</name>.
```

---

## 8. Solução de problemas (FAQ)

### ❓ "Discovered 0 skill(s)" / nenhuma skill encontrada

- Verifique se a variável `SKILLS_DIR` aponta para uma pasta (ou repo GitHub) **que contém arquivos `.md` com frontmatter válido** (`name:` e `description:`).
- Confirme que os arquivos têm o formato `SKILL.md` com `---` no início e no fim.
- No Railway, veja os logs: o servidor imprime exatamente o que está vendo em `process.env.SKILLS_DIR`.

### ❓ "Blocked: ... not in allowed orgs/users"

- Configure `GITHUB_ALLOWED_ORGS` (ou `GITHUB_ALLOWED_USERS`) com o dono do repositório de skills.
- Ou defina `GITHUB_TOKEN` — quando há token, o servidor permite qualquer repo (comportamento de MVP).

### ❓ "Authentication failed"

- O `GITHUB_TOKEN` está inválido ou sem permissão `repo`. Gere um novo em https://github.com/settings/tokens.

### ❓ `ECONNREFUSED` no health check

- O servidor não subiu. Veja os logs completos (o `main()` imprime `Fatal error` se algo der errado).

### ❓ O Claude Desktop não vê as skills

- Reinicie o Claude Desktop após editar o `claude_desktop_config.json`.
- Confirme que o caminho do `dist/index.js` está correto e que você já rodou `npm run build`.

### ❓ Qual é o nome exato da skill para `load-skill`?

- Os nomes são **prefixados com a pasta de origem** no formato `pasta__nome`. Ex.: uma skill `contract-analysis` dentro da pasta local vira `legal-doc-library__contract-analysis` (dependendo da estrutura).
- Use o `initialize` e leia o bloco `<available_skills>` — ali estão os nomes exatos.
- Ou use `findMatchingSkills`: chame `load-skill` com um nome errado e o servidor **sugere as skills parecidas**.

---

## 9. Checklist final

### Local (teste)
- [ ] `npm run build` funcionou
- [ ] Servidor sobe em HTTP com `node dist/index.js --http=3000 --static ./skills`
- [ ] `curl http://localhost:3000/health` responde `{"status":"ok",...}`
- [ ] `curl -X POST http://localhost:3000/mcp ... tools/list` lista `load-skill`
- [ ] Claude Desktop conectado via stdio e aciona uma skill

### Railway (produção)
- [ ] Projeto criado no Railway
- [ ] Variáveis de ambiente configuradas (`SKILLS_DIR`, `SKILLJACK_HTTP`, `SKILLJACK_STATIC`, `GITHUB_TOKEN`, `GITHUB_ALLOWED_ORGS`)
- [ ] Domínio público gerado
- [ ] Deploy bem-sucedido (logs sem erro)
- [ ] `curl https://SEU-APP.up.railway.app/health` responde 200
- [ ] `curl https://SEU-APP.up.railway.app/mcp ... tools/list` responde
- [ ] Claude Desktop conectado via URL do Railway

### Compartilhamento
- [ ] Você tem a URL pública anotada
- [ ] Enviou um exemplo de requisição `curl` para a pessoa testar
- [ ] (Opcional) Fez um README curto para quem consumir sua API

---

## 🎉 Resumo do fluxo de integração

```mermaid
flowchart LR
    A[Você] --> B[Claude]
    B -->|MCP JSON-RPC| C[Servidor MCP<br/>Railway / local]
    C -->|lê skills| D[GitHub repo de skills]
    D -->|SKILL.md| C
    C -->|load-skill| B
    B --> A
```

1. **A pessoa (ou o Claude)** chama o servidor MCP via **API (`POST /mcp`)**.
2. O servidor **encontra a skill certa** no catálogo (GitHub ou pasta local).
3. A skill é **carregada** (`load-skill`) e o Claude **segue as instruções** da skill.

Pronto! Agora você sabe **como integrar ao Claude** e **como qualquer pessoa acessa via API** — local ou pelo Railway. 🚀