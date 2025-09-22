FROM node:18-alpine

WORKDIR /app

# Install required system libs for Prisma on Alpine
RUN apk add --no-cache openssl libc6-compat

# Copy package files for reproducible install
COPY package.json package-lock.json ./

# COPY Prisma schema BEFORE npm install so postinstall "prisma generate" can find it
COPY prisma ./prisma

# Install dependencies; postinstall will run prisma generate now that schema exists
RUN npm install

# (Optional but safe) Re-run prisma generate explicitly (idempotent)
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
