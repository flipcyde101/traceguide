FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json tsup.config.ts ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV TRACEGUIDE_HOST=0.0.0.0
ENV TRACEGUIDE_PORT=4320
ENV TRACEGUIDE_DB=/data/traceguide.db
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4320
ENTRYPOINT ["node", "/app/dist/cli.js", "serve"]
