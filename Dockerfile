# Этап 1: сборка фронтенда на Node (Vite требует современный Node)
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Этап 2: финальный образ — только Bun и статика
FROM oven/bun:1.1

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY README.md LICENSE ./

EXPOSE 5335
ENV NODE_ENV=production

CMD ["bun", "start"]
