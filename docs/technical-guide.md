# Technical Guide

Panduan ini ditujukan untuk developer, DevOps internal, dan pemilik aplikasi internal yang akan memakai MWS Data Center.

## 1. Ringkasan Sistem

MWS Data Center adalah centralized user database untuk:

- Student data.
- Employee data.
- Academic year, grade, class, dan enrollment history.
- Parent/guardian, consent, attachment, health, vaccine, dan PC activity.
- Admin access control.
- Internal API untuk aplikasi MWS.
- Audit log.
- Import/export data migrasi.

Stack utama:

- Backend: Bun, Hono, Prisma, PostgreSQL.
- Frontend: React, Vite, Tailwind CSS, TanStack Query.
- Auth: Google OAuth 2.0 untuk admin login.
- Object storage: MinIO untuk consent attachment.
- Rate limit store: Redis.
- Internal API auth: Bearer API client token.

## 2. Struktur Aplikasi

### Backend

Folder utama:

- `server/src/routes`
  HTTP route group.

- `server/src/controller`
  Membaca request dan meneruskan ke service.

- `server/src/service`
  Business logic, permission, audit, dan Prisma write.

- `server/src/model`
  Request/response DTO dan mapper.

- `server/src/validation`
  Zod validation.

- `server/src/middleware`
  Auth, rate limit, error handling.

- `server/prisma/schema.prisma`
  Database schema.

### Frontend

Folder utama:

- `client/src/app`
  Route tree frontend.

- `client/src/components`
  Layout dan reusable UI components.

- `client/src/features`
  Feature modules seperti students, employees, academic, access, API clients, audit, master data.

- `client/src/lib/api.js`
  Fetch wrapper, auth refresh, error parsing.

## 3. Request Flow

Admin panel request:

1. Frontend memanggil `/api/admin/*` dengan cookie session.
2. Backend melewati rate limiter.
3. `adminAuthMiddleware` membaca `access_token`.
4. Controller memanggil service.
5. Service melakukan permission check, validation, dan database operation.
6. Mutation menulis audit log.
7. Response dikembalikan ke frontend.

Internal API request:

1. Aplikasi internal memanggil `/api/internal/*`.
2. Header memakai `Authorization: Bearer <token>`.
3. `apiClientAuthMiddleware` memvalidasi token.
4. `requireScope` mengecek scope endpoint.
5. Controller dan service mengembalikan data sesuai kontrak internal API.
6. Usage dan blocked access dicatat di audit log.

## 4. Environment Variables

### Backend

Required:

- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ALLOWED_DOMAIN`
- `CLIENT_URL`

Storage:

- `MINIO_ENDPOINT`
- `MINIO_PORT`
- `MINIO_USE_SSL`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`

Redis:

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`

### Frontend

Required:

- `VITE_API_BASE_URL`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_GOOGLE_REDIRECT_URI`

Untuk Docker Compose, `VITE_API_BASE_URL` dapat dikosongkan agar request `/api` memakai same-origin proxy dari Nginx.

## 5. Local Setup

Backend local:

```sh
cd server
bun install
bun run dev
```

Frontend local:

```sh
cd client
bun install
bun run dev
```

Docker Compose dari root:

```sh
docker compose up -d --build
```

Port default:

- Frontend: `http://localhost:5173`
- Backend direct local: `http://localhost:3000`
- Backend via Docker Compose: `http://localhost:3010`
- PostgreSQL host port: `5434`
- MinIO API: `9000`
- MinIO Console: `9001`
- Redis host port: `6380`

## 6. Google OAuth

Konfigurasi Google OAuth harus konsisten antara FE, BE, dan Google Cloud Console.

Untuk local frontend:

- Redirect URI: `http://localhost:5173`
- FE env `VITE_GOOGLE_REDIRECT_URI` harus sama.
- BE env `GOOGLE_REDIRECT_URI` harus sama dengan redirect yang dipakai frontend.

Jika popup OAuth muncul tetapi callback gagal, cek:

- Client ID FE.
- Client ID dan Secret BE.
- Redirect URI.
- Allowed domain.
- Admin user aktif.

## 7. Role dan Permission

Role utama:

- `SUPER_ADMIN`
- `DATABASE_ADMIN`
- `VIEWER`

Flag tambahan:

- `can_write_data`
- `can_view_sensitive_data`
- after-hours grant
- working Saturdays

Prinsip:

- SUPER_ADMIN tidak dibatasi unit.
- DATABASE_ADMIN dibatasi unit.
- VIEWER read-only.
- Delete, restore, admin user management, API client management, dan import hanya untuk SUPER_ADMIN.
- Sensitive data membutuhkan permission khusus.

## 8. Internal API

Prefix:

- `/api/internal/students`
- `/api/internal/employees`

Auth:

```txt
Authorization: Bearer <api_client_token>
```

Scopes:

- `employees:read`
- `students:read`
- `students:academic_history:read`
- `students:health:read`
- `students:consent:read`

Endpoint utama:

| Method | Endpoint | Scope |
| --- | --- | --- |
| GET | `/api/internal/employees` | `employees:read` |
| GET | `/api/internal/employees/lookup` | `employees:read` |
| GET | `/api/internal/students` | `students:read` |
| GET | `/api/internal/students/lookup` | `students:read` |
| GET | `/api/internal/students/:id/academic-history` | `students:academic_history:read` |
| GET | `/api/internal/students/:id/consent-status` | `students:consent:read` |
| GET | `/api/internal/students/:id/health` | `students:health:read` |

API token dibuat dari menu API Clients oleh SUPER_ADMIN. Token plaintext hanya muncul saat create atau rotate.

## 9. API Client Lifecycle

Create:

- SUPER_ADMIN membuat client.
- Pilih scope.
- Simpan token plaintext di secret manager aplikasi internal.

Rotate:

- Token lama tidak berlaku.
- Token baru muncul sekali.
- Update secret di aplikasi internal.

Revoke:

- Client tidak dapat mengakses internal API.
- Record tidak dihapus agar audit tetap utuh.

## 10. Import dan Export

Frontend menggunakan tombol import/export di page Students dan Employees.

Backend endpoint:

- Student preview: `/api/admin/students/import/preview`
- Student commit: `/api/admin/students/import/:jobId/commit`
- Student rollback: `/api/admin/students/import/:jobId/rollback`
- Student fields: `/api/admin/students/import/fields`
- Student export: `/api/admin/students/export`
- Employee preview: `/api/admin/employees/import/preview`
- Employee commit: `/api/admin/employees/import/:jobId/commit`
- Employee rollback: `/api/admin/employees/import/:jobId/rollback`
- Employee fields: `/api/admin/employees/import/fields`
- Employee export: `/api/admin/employees/export`

Student import behavior:

- `nis` optional untuk create.
- Jika `nis` kosong, backend auto-generate.
- Jika `nis` diisi, backend melakukan validation pattern untuk data migrasi.
- `entry_type` wajib untuk create.

Rollback:

- Dipakai untuk membatalkan import yang sudah committed.
- Data relation seperti parent, health, consent, dan PC activity mengikuti staged relation write yang dibuat saat import.

## 11. NIS Generation

NIS dibuat 7 digit:

```txt
YY + U + E + NNN
```

Keterangan:

- `YY`: tahun masuk dari academic year.
- `U`: unit code dari grade level.
- `E`: entry type code.
- `NNN`: sequence per prefix.

Entry type:

- `PRE_K`
- `PSB`
- `TRANSFER`

Grade mapping:

- Level 0 ke bawah: Kindergarten.
- Level 1 sampai 6: Elementary.
- Level 7 sampai 9: Junior High.

NIS dibuat sekali saat create dan tidak diedit dari frontend.

## 12. Consent Attachment Storage

Consent attachment memakai MinIO.

Pastikan env berikut tidak kosong:

- `MINIO_ENDPOINT`
- `MINIO_PORT`
- `MINIO_USE_SSL`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`

Jika upload gagal dengan pesan credential, cek:

- MinIO container hidup.
- Access key dan secret key benar.
- Bucket tersedia atau backend bisa membuat bucket.
- Backend sudah restart setelah env berubah.

## 13. Audit Log

Audit log mencatat:

- Create/update/delete/restore data.
- Role change.
- API client create/revoke/rotate.
- Import/export.
- Unauthorized access.
- Internal API usage.

Frontend Audit Logs menampilkan data ringkas:

- Time.
- Action.
- Source.
- Actor.
- Entity.

Detail before/after values dibuka melalui modal/detail view.

Audit log tidak memiliki delete flow dari admin panel.

## 14. Backup dan Restore

Yang perlu dibackup:

- PostgreSQL database.
- MinIO bucket untuk consent attachments.
- Environment variables dan secrets.

Prinsip restore:

1. Restore PostgreSQL terlebih dahulu.
2. Restore MinIO bucket.
3. Pastikan env MinIO menunjuk bucket yang sama.
4. Jalankan smoke test login, student detail, employee detail, attachment download, dan internal API lookup.

Jangan rotate JWT secret tanpa rencana logout massal. Token lama akan invalid.

## 15. Deployment Internal

Repository menyediakan Docker Compose untuk stack internal:

- `db`
- `minio`
- `redis`
- `server`
- `client`

Di Komodo atau environment internal lain:

- Masukkan secrets lewat Stack Environment.
- Jangan mengandalkan `server/.env` karena file itu gitignored.
- Pastikan `CLIENT_URL` dan Google redirect URI cocok dengan URL frontend production.
- Pastikan `VITE_API_BASE_URL` sesuai pola hosting. Kosongkan jika memakai same-origin proxy.
- Pastikan port publik dan internal tidak konflik.

Pre-deploy checklist:

- `client bun run lint`
- `client bun run build`
- `server bun run typecheck`
- Migration sudah diterapkan.
- Seeder dev tidak berjalan di production.
- SUPER_ADMIN production tersedia.
- MinIO dan Redis reachable dari server.

## 16. Security Notes

- Admin login hanya lewat Google Sign-In.
- API internal hanya memakai scoped API client token.
- Token plaintext API client tidak disimpan di database.
- Rotate token jika token bocor.
- Revoke token untuk aplikasi yang tidak aktif.
- Data sensitif dibatasi permission.
- Attachment access lewat backend endpoint, bukan public object URL.
- Audit log harus dijaga sebagai append-only operational record.

## 17. Troubleshooting

### Port frontend sudah dipakai

Vite default memakai `5173`. Tutup proses lama atau jalankan port lain.

### Backend gagal port 3000

Ada server Bun lain yang masih berjalan. Hentikan proses lama sebelum menjalankan `bun run dev`.

### Database unreachable

Cek:

- PostgreSQL berjalan.
- `DATABASE_URL` benar.
- Port local `5434` jika memakai Docker Compose.

### Google OAuth invalid code

Cek:

- Redirect URI FE dan BE sama.
- Authorization code hanya dipakai sekali.
- Google client ID FE dan BE benar.

### API client rotate error audit enum

Pastikan migration dan generated Prisma client sudah sinkron dengan enum audit action terbaru.

### Import preview kosong

Cek:

- Sheet yang dipilih benar.
- Header row terbaca.
- Mapping field sesuai.
- Revalidate setelah edit preview.

## 18. Dokumentasi Lanjutan

Dokumentasi API manual yang lebih rinci tersedia di:

- `server/docs/student-walkthrough.md`
- `server/docs/employee-walkthrough.md`
- `server/docs/academic-class-walkthrough.md`

Jika endpoint baru ditambahkan, update dokumen ini dan Admin Guide di commit yang sama.
