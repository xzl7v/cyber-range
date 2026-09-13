FROM node:24-bookworm-slim AS frontend

WORKDIR /labs
COPY labs-module/package.json labs-module/package-lock.json ./
RUN npm ci
COPY labs-module/ ./
RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app

COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci --omit=dev

COPY gateway/server.mjs ./
COPY gateway/public ./public
COPY labs-module/server/labs.js ./labs-module/server/labs.js
COPY --from=frontend /labs/dist ./labs-module/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.mjs"]
