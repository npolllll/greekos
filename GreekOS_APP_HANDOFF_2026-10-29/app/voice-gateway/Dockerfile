# GreekOS voice gateway — the long-lived WebSocket process of the live conversation (a Vercel function
# cannot hold it). Cloud providers only in production: Azure Speech (recognition and voice),
# Anthropic (dialogue), Supabase (data). Build from the app folder:
#   docker build -f voice-gateway/Dockerfile -t greekos-voice .
ARG BASE=node:22-bookworm-slim
FROM ${BASE}
WORKDIR /app
ENV NODE_ENV=production VOICE_GATEWAY_SKIP_ENV_FILE=1 VOICE_GATEWAY_HOST=0.0.0.0 VOICE_GATEWAY_PORT=8080 APP_ENV=production
COPY package.json package-lock.json ./
# Runtime dependencies only (no build scripts), plus the TypeScript runner the gateway runs with
# (global: it is a devDependency of the app, which a production install leaves out).
# An optional CA certificate (secret `npm_ca`) lets the build run behind a TLS-inspecting proxy without
# disabling verification; builders without it (Fly, CI) use the public chain.
RUN --mount=type=secret,id=npm_ca,required=false sh -c '\
  if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm_config_cafile=/run/secrets/npm_ca; fi; \
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund && \
  npm install --global --ignore-scripts --no-audit --no-fund tsx@4.23.15 && npm cache clean --force'
COPY tsconfig.json ./
COPY src ./src
COPY voice-gateway/server.ts ./voice-gateway/server.ts
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["tsx", "--conditions=react-server", "voice-gateway/server.ts"]
