FROM oven/bun:latest AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-runtime-env.sh /docker-entrypoint.d/40-runtime-env.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
