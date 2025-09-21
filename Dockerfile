FROM node:18-alpine

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy package files
COPY package*.json pnpm-lock.yaml ./

# Install dependencies with pnpm
RUN pnpm ci

# Copy Prisma schema for client generation
COPY prisma ./prisma

# Generate Prisma client
RUN pnpm exec prisma generate

# Copy the rest of the source code
COPY . .

# Build TypeScript
RUN pnpm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

USER nextjs

EXPOSE 3001

# Use exec form to ensure proper signal handling
CMD ["node", "dist/index.js"]
