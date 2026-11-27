# syntax=docker/dockerfile:1
# Build from the repository root: docker build -t nodo-api backend
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm ci
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production PORT=3000 PGSSLMODE=verify-full
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm ci --omit=dev && npm cache clean --force
# Public CA certificates only; keep TLS verification for both PostgreSQL and HTTPS.
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    mkdir -p /app/certs && node -e "fetch('https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem').then(r=>{if(!r.ok)throw new Error('RDS CA download failed');return r.text()}).then(c=>require('node:fs').writeFileSync('/app/certs/rds.pem',c)).catch(()=>process.exit(1))"
ENV NODE_EXTRA_CA_CERTS=/app/certs/rds.pem
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
