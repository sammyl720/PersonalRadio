FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && ffmpeg -version | head -1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY packages ./packages
COPY apps/worker ./apps/worker
ENV NODE_ENV=production
CMD ["node","--import","tsx","apps/worker/src/index.ts"]
