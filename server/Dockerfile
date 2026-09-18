FROM oven/bun:latest

WORKDIR /app

COPY package.json ./
RUN bun install

COPY . .

RUN bunx prisma generate

EXPOSE 3000

CMD bunx prisma migrate deploy && bun run src/index.ts
