FROM oven/bun:1.1

WORKDIR /app

# Копируем манифесты для более эффективного кеширования
COPY package.json tsconfig.json ./
COPY frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/

# Устанавливаем зависимости (корень + фронтенд)
RUN bun install
RUN cd frontend && bun install

# Копируем исходники
COPY src ./src
COPY frontend ./frontend
COPY README.md LICENSE ./

# Сборка фронтенда (создаётся frontend/dist)
RUN bun run build

# Порт приложения (можно переопределить переменной окружения PORT)
EXPOSE 5335

ENV NODE_ENV=production

# Запуск Bun-сервера
CMD ["bun", "start"]

