# MWS Central Database — Architecture Overview

> Dokumentasi teknis lengkap: dari client browser hingga database, mencakup semua lapisan sistem.

---

## Daftar Isi

1. [Gambaran Umum](#1-gambaran-umum)
2. [Infrastruktur & Deployment](#2-infrastruktur--deployment)
3. [Server — Lapisan Demi Lapisan](#3-server--lapisan-demi-lapisan)
4. [Client — Struktur & Data Flow](#4-client--struktur--data-flow)
5. [Autentikasi & Sesi](#5-autentikasi--sesi)
6. [Request Lifecycle (End-to-End)](#6-request-lifecycle-end-to-end)
7. [RBAC — Role & Permission](#7-rbac--role--permission)
8. [Internal API (Server-to-Server)](#8-internal-api-server-to-server)
9. [Database Schema](#9-database-schema)
10. [Rate Limiting](#10-rate-limiting)
11. [Error Handling](#11-error-handling)
12. [Storage & File Upload](#12-storage--file-upload)
13. [Audit Log](#13-audit-log)

---

## 1. Gambaran Umum

MWS Central Database adalah sistem manajemen data terpusat untuk sekolah MWS. Sistem ini mengelola data **siswa**, **karyawan**, **tahun ajaran**, **kelas**, **kesehatan**, **persetujuan (consent)**, dan lain-lain.

Ada dua jenis pengguna yang bisa login:
- **Admin** — akses penuh via UI dashboard (Google OAuth)
- **Employee** — akses terbatas, hanya bisa lihat data diri sendiri

Ada juga satu jalur khusus:
- **API Client** — aplikasi eksternal (misalnya `mws-daily-checkin`) yang mengakses data via Bearer Token dengan scope terbatas.

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│  React + Vite (Tailwind, React Query, React Hook Form)      │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP/REST (credentials: include)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  HONO SERVER (Bun Runtime)                  │
│  Middleware → Router → Controller → Service → Prisma        │
└──────┬──────────────┬──────────────────────────┬────────────┘
       │              │                          │
       ▼              ▼                          ▼
┌──────────┐   ┌──────────────┐         ┌───────────────┐
│ PostgreSQL│   │  MinIO (S3)  │         │  Redis        │
│ (Prisma) │   │  File Store  │         │  Rate Limiter │
└──────────┘   └──────────────┘         └───────────────┘
```

---

## 2. Infrastruktur & Deployment

Semua service dijalankan via Docker Compose.

### Services

| Service | Image | Port (Host) | Keterangan |
|---------|-------|-------------|------------|
| `db` | `postgres:16-alpine` | `5434` | Database utama |
| `minio` | `minio/minio` | `9010` (API), `9011` (Console) | Object storage |
| `redis` | `redis:7-alpine` | `6380` | Rate limiting |
| `server` | custom Dockerfile | `3010` | Hono API server |
| `client` | custom Dockerfile + Nginx | `5173` | React SPA |

### Dependency Order

```
db ──┐
     ├──▶ server ──▶ client
minio┘
redis┘
```

### Environment Variables (Server)

| Variable | Keterangan |
|----------|-----------|
| `DATABASE_URL` | Connection string PostgreSQL |
| `JWT_SECRET` | Secret untuk sign/verify JWT |
| `GOOGLE_CLIENT_ID / SECRET` | OAuth credentials Google |
| `GOOGLE_REDIRECT_URI` | Redirect URI setelah Google callback |
| `ALLOWED_DOMAIN` | Domain email yang diizinkan login (contoh: `mws.sch.id`) |
| `CORS_ORIGINS` | Origin yang diizinkan, pisahkan koma |
| `MINIO_*` | Konfigurasi object storage |
| `REDIS_HOST / PORT / PASSWORD` | Konfigurasi Redis |

### Environment Variables (Client)

| Variable | Keterangan |
|----------|-----------|
| `VITE_API_BASE_URL` | Base URL server API |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `VITE_GOOGLE_REDIRECT_URI` | Redirect URI Google |

> **Catatan:** Client mendukung runtime env via `window.__MWS_ENV__` (inject oleh Nginx) — ini yang memungkinkan satu Docker image dipakai di beberapa environment tanpa rebuild.

---

## 3. Server — Lapisan Demi Lapisan

Server dibangun dengan **Hono** di runtime **Bun**, menggunakan TypeScript. Arsitekturnya berlapis dengan alur yang ketat:

```
Request
  │
  ▼
[web.ts] — Global middleware (secureHeaders, CORS, CSRF, logger)
  │
  ▼
[api-router.ts] — Mount semua route di bawah /api
  │
  ├─── /api/auth          → authRouter
  ├─── /api/admin         → adminRouter  (adminAuthMiddleware + adminLimiterMiddleware)
  └─── /api/internal      → internalRouter (apiClientAuthMiddleware + internalLimiterMiddleware)
```

### 3.1 Entry Point (`src/index.ts`)

```typescript
export default {
  port: 3000,
  fetch: web.fetch,
  idleTimeout: 120, // diperpanjang karena bulk import bisa lama
}
```

### 3.2 Bootstrap (`src/application/web.ts`)

Global middleware yang diaplikasikan ke semua request:

| Middleware | Fungsi |
|------------|--------|
| `secureHeaders()` | Set security headers (X-Frame-Options, dll.) |
| `logger()` | Log setiap request ke stdout |
| `cors()` | Whitelist origin, allow credentials |
| `csrf()` | Cegah CSRF attack |
| `errorMiddleware` | Global error handler (catch-all) |

### 3.3 Router (`src/routes/`)

```
routes/
├── api-router.ts          ← Master router (/api)
├── auth/
│   └── auth-router.ts     ← /api/auth
├── admin/
│   ├── index.ts           ← /api/admin (apply auth + rate limiter)
│   ├── student-router.ts
│   ├── employee-router.ts
│   ├── academic-year-router.ts
│   ├── class-router.ts
│   └── ... (16 router files total)
└── internal/
    ├── index.ts            ← /api/internal (apply API client auth)
    ├── student-api-router.ts
    └── employee-api-router.ts
```

### 3.4 Controller (`src/controller/admin/`)

Controller menerima request dari router, memanggil service, dan mengembalikan response JSON.

```typescript
// Pola umum controller
static async get(c: Context) {
  const id = c.req.param('id')
  const result = await StudentService.get(id)
  return c.json({ data: result })
}
```

### 3.5 Service (`src/service/`)

Business logic sepenuhnya ada di sini. Service berinteraksi langsung dengan Prisma.

**Pola penting — write tanpa nested include:**
```typescript
// BENAR: write dulu, lalu fetch terpisah
const student = await prismaClient.student.create({ data: ... })
const full = await prismaClient.student.findUniqueOrThrow({
  where: { id: student.id },
  include: { person: true, ... }
})

// SALAH: nested include dalam write = race condition di adapter-pg
const student = await prismaClient.student.create({
  data: ...,
  include: { person: { include: { ... } } } // JANGAN
})
```

### 3.6 Validation (`src/validation/`)

Semua input divalidasi dengan **Zod** sebelum masuk ke service.

```typescript
const validated = Validation.validate(StudentValidation.CREATE, rawInput)
```

### 3.7 Model (`src/model/`)

Berisi TypeScript types dan fungsi `to*Response()` untuk membentuk shape response. Ini adalah "DTO" layer — memastikan data yang keluar dari API selalu konsisten dan tidak bocor field sensitif.

---

## 4. Client — Struktur & Data Flow

Client adalah **React 19 SPA** dibangun dengan **Vite**, menggunakan **TanStack Query** untuk server state dan **React Hook Form + Zod** untuk form.

### 4.1 Struktur Folder

```
src/
├── main.jsx          ← Entry point (BrowserRouter + AppProviders + App)
├── app/
│   ├── App.jsx       ← Route definitions (React Router v8)
│   └── AppProviders.jsx ← QueryClient + AuthProvider + Toaster
├── features/         ← Domain modules (tiap domain berdiri sendiri)
│   ├── auth/
│   ├── students/
│   ├── employees/
│   ├── academic/
│   ├── access/
│   ├── api-clients/
│   ├── audit/
│   ├── dashboard/
│   ├── master-data/
│   └── profile/
├── components/       ← Shared UI components (layout, dll.)
├── routes/           ← ProtectedRoute, RoleHome
├── hooks/            ← useDebounce, dll.
├── lib/              ← api.js, clientSession.js, format.js, dll.
└── config/           ← env.js
```

### 4.2 Struktur Per Feature

Setiap feature folder mengikuti pola yang sama:

```
features/students/
├── api/              ← Fungsi fetch ke server (studentsApi.js, dll.)
├── hooks/            ← Custom hooks berbasis TanStack Query
├── components/       ← Komponen UI khusus feature ini
└── pages/            ← Page components (StudentsPage, StudentDetailPage, dll.)
```

### 4.3 API Layer (`src/lib/api.js`)

Semua request ke server melewati `apiRequest()`:

```
apiRequest(path, options)
  │
  ├── performRequest()       ← fetch() dengan credentials: 'include'
  │
  ├── [jika 401] → refreshSession() → retry
  │                    │
  │                    └── POST /api/auth/refresh (pakai refresh token cookie)
  │
  └── parseResponse()        ← throw ApiError jika !response.ok
```

**Key behaviors:**
- `credentials: 'include'` — selalu kirim cookie (access_token, refresh_token)
- Auto-refresh — jika dapat 401, coba refresh dulu sebelum throw error
- Singleton promise — request refresh tidak didobel meski ada banyak request paralel yang 401 bersamaan
- `apiFileRequest()` — variant khusus download file, return `{ blob, fileName }`

### 4.4 Routing

```jsx
<Routes>
  <Route path="/login" element={<LoginPage />} />

  <Route element={<ProtectedRoute />}>   {/* cek isAuthenticated */}
    <Route element={<AppShell />}>       {/* layout: sidebar + header */}
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="students" element={<StudentsPage />} />
      <Route path="students/:id" element={<StudentDetailPage />} />
      {/* ... semua route lain */}
    </Route>
  </Route>

  <Route path="*" element={<Navigate to="/" />} />
</Routes>
```

`ProtectedRoute` — jika belum login, redirect ke `/login`. Jika masih loading session, tampilkan spinner.

---

## 5. Autentikasi & Sesi

Sistem menggunakan **Google OAuth + JWT**. Dua tipe user bisa login lewat satu endpoint yang sama.

### 5.1 Alur Login

```
Browser                    Server                      Google
   │                          │                            │
   │── klik "Login Google" ──▶│                            │
   │                          │── redirect ke Google ─────▶│
   │◀─ callback dengan code ──│◀──────────────────────────│
   │                          │
   │── POST /api/auth/google ─▶│
   │     body: { code }        │── verifyCode() ──▶ Google tokeninfo
   │                          │── cek email domain (@mws.sch.id)
   │                          │── cari di AdminUser
   │                          │   ├── ADMIN → buat JWT + refresh token
   │                          │   └── cari di Person (employee aktif)
   │                          │       ├── EMPLOYEE → buat JWT (tanpa refresh)
   │                          │       └── tidak ada → 403
   │◀── Set-Cookie: access_token (15 menit) ─────────────│
   │◀── Set-Cookie: refresh_token (7 hari, admin only) ──│
   │◀── body: { data: { type, email, role, ... } } ───────│
```

### 5.2 Token & Cookie

| Token | Disimpan di | Masa Berlaku | Notes |
|-------|-------------|--------------|-------|
| `access_token` | HttpOnly cookie | 15 menit | JWT (HS256), berisi `id`, `email`, `role` |
| `refresh_token` | HttpOnly cookie | 7 hari | Random hex, di-hash di DB. Hanya untuk Admin. |

Refresh token **tidak berlaku untuk Employee** — employee harus login ulang setelah 15 menit.

### 5.3 Session di Client (sessionStorage)

Client menyimpan metadata sesi di `sessionStorage` (bukan token — token ada di cookie):

```javascript
{
  type: 'admin' | 'employee',
  created_at: '2026-08-07T...',
  expires_at: '2026-08-14T...'  // 7 hari (admin) / 15 menit (employee)
}
```

`AuthContext` mengelola sesi ini:
- Saat mount: cek apakah session sudah expired. Jika iya, clear session dan tidak fetch `/me`.
- Saat session expired: auto-logout via `setTimeout`.
- Saat token 401: `api.js` auto-refresh, lalu `refreshAdminClientSession()` perpanjang sessionStorage.

### 5.4 Middleware Auth

| Middleware | Dipakai di | Yang dilakukan |
|------------|------------|----------------|
| `adminAuthMiddleware` | `/api/admin/*` | Verifikasi JWT, reject jika `type === 'employee'`, cek admin aktif di DB |
| `employeeAuthMiddleware` | Route employee | Verifikasi JWT, cek `type === 'employee'` |
| `apiClientAuthMiddleware` | `/api/internal/*` | Verifikasi Bearer token, cek prefix + hash, load scopes |

---

## 6. Request Lifecycle (End-to-End)

Contoh: **Admin mengambil daftar siswa** (`GET /api/admin/students`)

```
1. Browser
   └── studentsApi.list(params)
         └── apiRequest('/api/admin/students?page=1&...')
               └── fetch(url, { credentials: 'include' })

2. Server — Global Middleware (web.ts)
   ├── secureHeaders()
   ├── logger()
   ├── cors() — validasi Origin header
   └── csrf() — validasi CSRF

3. Server — Routing
   └── /api → apiRouter
         └── /admin → adminRouter
               ├── adminLimiterMiddleware — 100 req/3min untuk GET
               ├── adminAuthMiddleware — verifikasi JWT, load admin dari DB
               └── /students → studentRouter → StudentController.list()

4. Server — Controller
   └── baca query params → StudentService.list(params)

5. Server — Service
   └── prismaClient.student.findMany({ where, include, orderBy, skip, take })

6. Database (PostgreSQL via Prisma + adapter-pg)

7. Server — Response
   └── c.json({ data: students, meta: { page, total, ... } })

8. Browser — TanStack Query
   └── cache hasil → re-render komponen
```

---

## 7. RBAC — Role & Permission

### 7.1 Admin Roles

| Role | Deskripsi |
|------|-----------|
| `SUPER_ADMIN` | Akses penuh ke semua fitur |
| `DATABASE_ADMIN` | Bisa baca + tulis data, tidak bisa kelola admin user lain |
| `VIEWER` | Hanya bisa membaca data |

### 7.2 Permission Flags

| Flag | Keterangan |
|------|-----------|
| `can_write_data` | Boleh melakukan create/update/delete |
| `can_view_sensitive_data` | Boleh lihat data sensitif (NIK, NPWP, rekening, BPJS) |
| `after_hours_write_until` | Batas waktu boleh write di luar jam kantor |

### 7.3 `requireRole()` Middleware

```typescript
// Contoh di router
studentRouter.delete('/:id', requireRole(['SUPER_ADMIN']), StudentController.remove)
```

Middleware membaca `c.var.admin` (di-set oleh `adminAuthMiddleware`), lalu mengecek role.

---

## 8. Internal API (Server-to-Server)

Jalur `/api/internal` dikhususkan untuk aplikasi lain dalam infrastruktur MWS (bukan browser).

### 8.1 Autentikasi

Format Bearer Token: `{prefix}.{secret}`

```
Authorization: Bearer abc123.secretkey456
```

Flow verifikasi:
1. Pisahkan token di titik pertama → `tokenPrefix` dan `secret`
2. Cari `ApiClient` di DB berdasarkan `token_prefix`
3. Verifikasi `secret` dengan `token_hash` (bcrypt/hash)
4. Cek `is_active`, update `last_used_at`
5. Load scopes ke context request

### 8.2 Available Scopes

| Scope | Akses |
|-------|-------|
| `employees:read` | Baca data karyawan |
| `students:read` | Baca data siswa (basic) |
| `students:academic_history:read` | Riwayat akademik |
| `students:health:read` | Data kesehatan |
| `students:consent:read` | Consent records |
| `students:support_contacts:read` | Data support siswa |

### 8.3 Rate Limit Internal

300 request per 60 detik — lebih longgar dari admin karena traffic-nya server-to-server.

---

## 9. Database Schema

**PostgreSQL 16**, ORM **Prisma** dengan adapter `@prisma/adapter-pg`.

### 9.1 Model Utama

```
Person (shared identity — email, nama, gender, agama, tempat/tgl lahir)
├── Student
│   ├── ParentGuardian[]
│   ├── StudentClassEnrollment[]
│   ├── ConsentRecord[]
│   │   └── ConsentAttachment[]
│   ├── HealthRecord (1:1)
│   ├── HealthNote[]
│   ├── VaccineRecord[]
│   ├── PassionConnectionActivity[]
│   └── StudentSupportAssignment[]
│
└── Employee
    ├── ClassTeacherAssignment[]
    ├── StudentSupportAssignment[]
    └── PassionConnectionActivity[]
```

### 9.2 Master Data (Lookup Tables)

| Model | Dipakai oleh |
|-------|-------------|
| `MasterUnit` | Employee, AdminUser |
| `MasterJobPosition` | Employee |
| `MasterJobLevel` | Employee |
| `MasterBuilding` | Employee |
| `Grade` | Class, Student |
| `AcademicYear` | Class, Enrollment, PC Activity |
| `Class` | Enrollment, TeacherAssignment, Student |

### 9.3 Soft Delete

Model berikut punya `deleted_at DateTime?`:
`Person`, `Student`, `Employee`, `ParentGuardian`, `ConsentRecord`, `ConsentAttachment`, `HealthRecord`, `HealthNote`, `VaccineRecord`, `PassionConnectionActivity`, `StudentClassEnrollment`.

Query data aktif harus selalu filter `deleted_at: null`.

### 9.4 Partial Unique Index

Diimplementasikan via raw migration SQL (bukan `@@unique`) sehingga hanya berlaku untuk baris yang belum dihapus:

| Model | Constraint |
|-------|-----------|
| `ConsentRecord` | `(student_id, consent_type)` |
| `VaccineRecord` | `(student_id, vaccine_type)` |
| `StudentClassEnrollment` | `(student_id, academic_year_id)` |
| `PassionConnectionActivity` | `(student_id, day, academic_year_id)` |

---

## 10. Rate Limiting

Menggunakan **Redis** via `rate-limiter-flexible`. Key: `{METHOD}_{routePattern}_{IP}`.

| Limiter | Points | Window | Dipakai di |
|---------|--------|--------|------------|
| `authLimiterMiddleware` | 5 | 15 menit | `/api/auth/*` |
| `readLimiterMiddleware` | 100 | 3 menit | Admin GET |
| `writeLimiterMiddleware` | 20 | 1 menit | Admin POST/PUT/PATCH/DELETE |
| `internalLimiterMiddleware` | 300 | 1 menit | `/api/internal/*` |

`adminLimiterMiddleware` otomatis pilih read/write limiter berdasarkan HTTP method.

Response saat kena limit (`429`):
```json
{ "errors": "Too many requests. Try again in 42s." }
```

Headers yang dikembalikan: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.

> Rate limit dinonaktifkan saat `NODE_ENV=test` atau `CI=true`.

---

## 11. Error Handling

Semua error ditangkap oleh `web.onError(errorMiddleware)`.

| Error Type | HTTP Status | Response |
|------------|-------------|----------|
| `ZodError` | `400` | Pesan validasi digabung koma |
| `ResponseError` | Sesuai yang dilempar | Pesan dari service |
| `HTTPException` (Hono) | Dari exception | Misal 403 dari CSRF middleware |
| Prisma `P2002` (unique) | `400` | Pesan per field, misal "Email already registered" |
| Prisma `P2003` (foreign key) | `400` | Pesan berdasarkan nama constraint |
| Error lainnya | `500` | "Internal Server Error" + log Winston |

`ResponseError` dilempar dari service layer:
```typescript
throw new ResponseError(404, "Student not found")
```

---

## 12. Storage & File Upload

File (attachment consent, dll.) disimpan di **MinIO** (kompatibel S3).

- Bucket default: `mws-data-center`
- Bucket dibuat otomatis jika belum ada (`ensureBucketExists()`)
- `object_key` (path di MinIO) disimpan di tabel `ConsentAttachment`
- Download via `apiFileRequest()` di client — return `{ blob, fileName }`

---

## 13. Audit Log

Setiap aksi penting dicatat ke tabel `AuditLog` (tidak bisa dihapus).

### Yang dicatat:
- Login / logout / login gagal
- CRUD pada siswa, karyawan, data akademik, enrollment
- Import/export data, rollback import
- Upload/download/hapus file
- Perubahan role & permission, rotasi API token

### Field AuditLog:

| Field | Keterangan |
|-------|-----------|
| `action` | Enum `AuditAction` (contoh: `CREATE_STUDENT`) |
| `entity_type` | Jenis entitas (contoh: `"student"`) |
| `entity_id` | ID entitas tersebut |
| `admin_id` | Admin yang melakukan aksi (nullable) |
| `api_client_id` | API client yang melakukan aksi (nullable) |
| `old_values` | JSON — state sebelum perubahan |
| `new_values` | JSON — state setelah perubahan |
| `ip_address` | IP yang melakukan request |
| `user_agent` | Browser/client string |
| `source` | `UI` / `API` / `SYSTEM` / `IMPORT` |
