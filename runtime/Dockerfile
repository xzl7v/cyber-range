FROM node:24-bookworm-slim

WORKDIR /app

COPY runtime/package.json runtime/package-lock.json ./
RUN npm ci --omit=dev

COPY runtime/server.mjs ./
COPY runtime/lab-definitions.json ./
COPY labs ./labs

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server.mjs"]
