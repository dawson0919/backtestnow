FROM node:22-alpine

WORKDIR /app

# Install only production dependencies (dist is pre-built and committed)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source + pre-built dist (no vite build step needed)
COPY . .

ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]
