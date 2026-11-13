FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential dumb-init python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1

COPY . .
# The local Lógos package compiles TypeScript in its prepare hook. Install the
# build-only dependencies first, then remove them from the final runtime layer.
RUN npm ci --include=dev --legacy-peer-deps --no-audit --no-fund \
  && npm prune --omit=dev --legacy-peer-deps --no-audit --no-fund

COPY docker/entrypoint.sh /usr/local/bin/thinkiac-entrypoint
RUN chmod 0755 /usr/local/bin/thinkiac-entrypoint \
  && mkdir -p /data \
  && chown -R node:node /app /data

USER node
EXPOSE 5040
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5040/__health').then(r => process.exit(r.ok || r.status === 401 ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/thinkiac-entrypoint"]
CMD ["node", "index.js"]
