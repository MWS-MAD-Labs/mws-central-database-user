# MWS Data Center — Development Plan

## Tech Stack

### Backend (`/server`)

| Layer        | Tool                                                    |
| ------------ | ------------------------------------------------------- |
| Runtime      | Bun                                                     |
| Framework    | Hono                                                    |
| ORM          | Prisma + PrismaPg adapter                               |
| Database     | PostgreSQL                                              |
| File Storage | MinIO                                                   |
| Auth         | Google OAuth 2.0 + JWT (HS256) + Refresh Token (SHA256) |
| Validation   | Zod                                                     |
| Logger       | Winston                                                 |
| Testing      | bun:test                                                |

### Frontend (`/client`)

| Layer       | Tool                        |
| ----------- | --------------------------- |
| Bundler     | Vite                        |
| Framework   | React + TypeScript          |
| Styling     | MWS-UI-Kit + Tailwindcss    |
| State       | TBD (Zustand / React Query) |
| HTTP Client | TBD (fetch / axios)         |

Note : Mungkin Masih ada yang di tambahkan dan menyesuaikan Kebutuhan

---

## Backend Route Groups

| Group        | Prefix         | Auth                                |
| ------------ | -------------- | ----------------------------------- |
| Public       | `/api/auth/*`  | Tidak ada                           |
| Admin Panel  | `/api/admin/*` | JWT cookie (`access_token`)         |
| Internal API | `/api/v1/*`    | API Token (`Authorization: Bearer`) |

---

## Development Phases

### Phase 1 — Auth (Admin Login)

- [x] Prisma schema: `AdminUser`
- [x] Google OAuth redirect & callback
- [x] JWT access token (15 menit) + refresh token (7 hari, SHA256 di DB)
- [x] Cookie: `access_token` + `refresh_token` (httpOnly)
- [x] Middleware: `adminAuthMiddleware`
- [ ] Endpoint: `GET /api/auth/me`
- [ ] Endpoint: `POST /api/auth/refresh`
- [ ] Endpoint: `POST /api/auth/logout`
- [ ] Test: auth flow lengkap

---

## Catatan

- Setiap phase diselesaikan beserta test sebelum lanjut ke phase berikutnya
- Soft delete via `deleted_at` untuk Student dan Employee
- Role guard: SUPER_ADMIN > DATABASE_ADMIN > VIEWER
