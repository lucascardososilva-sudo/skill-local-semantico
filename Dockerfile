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