# Stage 1 — deps (cached unless package.json changes)
FROM node:20-alpine AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package*.json .npmrc ./
RUN npm ci --omit=dev

# Stage 2 — runtime image
FROM node:20-alpine AS runner
WORKDIR /app

# Puppeteer / Chromium deps
RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont

# chromium binary path differs between amd64 and arm64 on Alpine
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p uploads && chown -R appuser:appgroup /app
USER appuser

EXPOSE 4000
CMD ["node", "index.js"]
