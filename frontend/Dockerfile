# ==============================================================================
# Stage 1: Build estático React + TypeScript + Vite en Node 22.23
# ==============================================================================
FROM node:22.23-alpine3.24 AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/public ./public
COPY frontend/src ./src

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# ==============================================================================
# Stage 2: Servidor Nginx estable para SPA y proxy /api/
# ==============================================================================
FROM nginx:1.28.1-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://127.0.0.1:80/"]
