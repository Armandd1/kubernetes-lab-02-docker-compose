# syntax=docker/dockerfile:1

# ==========================================
# Stage 1: Build stage (TypeScript compiler)
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Cache dependencies layer
COPY package*.json ./
RUN npm ci

# Copy configuration and TypeScript source
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# ==========================================
# Stage 2: Runtime stage (Minimal Alpine)
# ==========================================
FROM node:22-alpine AS runner

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data

WORKDIR /app

# Prepare persistent data directory with proper non-root permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Install production dependencies only
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy only the compiled output from the builder stage (source code is hidden)
COPY --from=builder --chown=node:node /app/dist ./dist

# Declare persistent volume
VOLUME ["/app/data"]

# Run as non-root user
USER node

# Expose service port
EXPOSE 8080

# Extra points: Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
