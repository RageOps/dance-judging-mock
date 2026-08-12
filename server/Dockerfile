FROM node:22-alpine AS base
WORKDIR /app
COPY server/package*.json ./
RUN npm ci

FROM base AS dev
COPY server/ ./
CMD ["npm", "run", "dev"]

FROM base AS build
COPY server/ ./
RUN npm run build

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY server/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
CMD ["./docker-entrypoint.sh"]
