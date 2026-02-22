FROM node:22-alpine

WORKDIR /app

# Install dependencies using lockfile (faster, deterministic)
COPY package*.json ./
RUN npm ci

# Copy source code (node_modules excluded by .dockerignore)
COPY . .

# Build the Vite frontend
RUN npm run build

# Start the Express server
# PORT is injected by Railway at runtime — do NOT hardcode it
CMD ["node", "server.js"]
