FROM node:18-alpine

WORKDIR /app

# Copy package files for npm install
COPY package.json package-lock.json ./

# Install dependencies with npm ci for reproducibility
RUN npm ci

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code and config
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

USER nextjs

EXPOSE 3001

CMD ["node", "dist/index.js"]
