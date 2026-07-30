FROM oven/bun:latest AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
RUN bun run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/ /docker-entrypoint.d/

# Expose port 80 
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
