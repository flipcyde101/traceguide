FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json tsup.config.ts ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
VOLUME ["/data"]
EXPOSE 4320
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4320", "--db", "/data/traceguide.db"]
