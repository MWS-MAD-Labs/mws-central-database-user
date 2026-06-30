FROM oven/bun:latest

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN bun install

COPY . .

# Generate prisma client
RUN bunx prisma generate

# Expose port 
EXPOSE 3000

CMD bunx prisma db push && bun run src/index.ts