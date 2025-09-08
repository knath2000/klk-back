FROM node:18-alpine

WORKDIR /app

# Copy all package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code - Copy current directory contents
COPY . .

# Build TypeScript
RUN npm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

USER nextjs

EXPOSE 3001

# Use exec form to ensure proper signal handling
CMD ["node", "dist/index.js"]
