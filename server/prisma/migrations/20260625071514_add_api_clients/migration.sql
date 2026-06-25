-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_scopes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "api_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_client_scopes" (
    "client_id" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,

    CONSTRAINT "api_client_scopes_pkey" PRIMARY KEY ("client_id","scope_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_name_key" ON "api_clients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_token_prefix_key" ON "api_clients"("token_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_scopes_name_key" ON "api_scopes"("name");

-- AddForeignKey
ALTER TABLE "api_client_scopes" ADD CONSTRAINT "api_client_scopes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_client_scopes" ADD CONSTRAINT "api_client_scopes_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "api_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
