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

# Instalar git para clonar repositórios de skills + wget pro healthcheck
RUN apk add --no-cache git wget

# Copiar apenas o necessário do build
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copiar apenas o dist (skills bundled NÃO vão pro container —
# usamos só o repositório GitHub via SKILLS_DIR)
COPY --from=builder /app/dist ./dist

# Criar diretório para cache do GitHub
RUN mkdir -p /app/.skilljack-cache

# Skills e modo HTTP/static via ENV da imagem
# (não depende de Start Command do Railway)
ENV SKILLS_DIR=github.com/lucascardososilva-sudo/skills-teste-docker
ENV SKILLJACK_HTTP=true
ENV SKILLJACK_STATIC=true

# Health check — usa PORT do Railway (fallback 8080)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-8080}/health || exit 1

EXPOSE 8080

# ENTRYPOINT só sobe o server; repo vem de SKILLS_DIR
ENTRYPOINT ["node", "dist/index.js", "--http", "--static"]
CMD []