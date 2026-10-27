# Access Standard: kesesuaian aplikasi

Status tiap aplikasi terhadap [access-standard.md](access-standard.md) (versi 1.0). Diperbarui oleh siapa pun yang mengubah akses sebuah aplikasi, di commit yang sama.

Tanggal pemeriksaan: 2026-10-27. Isi tabel diambil dari pembacaan kode dan dokumen, bukan dari tes otomatis (belum ada, lihat AS-15). "Belum diperiksa" berarti belum dibaca, bukan berarti sesuai.

Lambang: **Ya** sesuai, **Sebagian** ada yang belum, **Tidak** belum, **?** belum diperiksa, **-** tidak berlaku.

Mulai `mws-central-auth` 0.13.0 ada satu implementasi bersama (`definePermissions`, `runPermissionsCli`, `createAccessResolver`, `mws-access check`). Aplikasi yang memakainya tidak perlu salinan sendiri; kolom "Kit" di bawah mencatat siapa yang sudah.

| Aplikasi | Memakai access kit |
| --- | --- |
| Hub, Learnspace, Daily, Exima, MTSS v2 | Belum (punya salinan sendiri untuk sinkron dan entitlement) |
| Woko | Ya, sebagian: `definePermissions`, `runPermissionsCli`, dan `mws-access check` (di CI). Belum memakai `createAccessResolver` karena belum login lewat Hub |

## Ringkasan

| Aturan | Hub | Learnspace | Daily | Exima | MTSS v2 | Woko |
| --- | --- | --- | --- | --- | --- | --- |
| AS-1 Kepemilikan (tanpa role/akses lokal) | Ya | Sebagian | ? | Sebagian | ? | Tidak |
| AS-2 Hanya permission | Ya | Sebagian | ? | Tidak | ? | Ya |
| AS-3 Format key | Ya | Tidak | ? | Ya | ? | Ya |
| AS-4 Manifest dan sinkron | Ya | Ya | Ya | Ya | ? | Ya |
| AS-5 Role hidup di Central | Ya | Ya | ? | Sebagian | ? | Tidak |
| AS-6 Gerbang tiap route | ? | ? | ? | ? | ? | Ya |
| AS-8 Scope data | - | Ya | ? | ? | ? | Sebagian |
| AS-10 Menerima entitlement | Ya | Ya | Ya | Ya | ? | Tidak |
| AS-11 Kesegaran 60 detik | ? | Sebagian | Tidak | Ya | ? | Tidak |
| AS-12 Admin pertama dan mode uji | ? | ? | ? | ? | ? | Tidak |
| AS-13 Role bawaan lewat preset | ? | Ya | ? | ? | ? | Ya |
| AS-15 Tes kesesuaian | Tidak | Tidak | Tidak | Sebagian | Tidak | Sebagian (dijalankan sekali dengan helper, belum jadi tes tetap) |

## Catatan per aplikasi

### Hub
- Manifest di `backend/src/lib/hub-permissions.ts` (`hub.use`, `hub.admin`), sinkron lewat `bun run permissions:sync`.
- Gerbang di `backend/src/lib/hub-access-gate.ts` (`userHasHubPermission`).
- Belum diperiksa: apakah setiap route admin lewat gerbang itu.

### Learnspace
- Manifest dan `permissions:sync` ada. Entitlement diproyeksikan dengan role key dan daftar permission apa adanya (ADR 0002).
- **AS-3 tidak sesuai**: key memakai titik dua (`journey:write`, `iep:submit`, `attendance:*`) kecuali `scope.*`. Perlu diganti nama dengan alur AS-14.
- **AS-1/AS-2 sebagian**: sebagian aturan scope di `*.policy` masih menyebut role lewat tabel `roleDerivedPermissions` sebagai default untuk keanggotaan lama (lihat ADR 0002, bagian keputusan).
- **AS-11 sebagian**: sinkron terjadwal 15 menit untuk data sekolah; kesegaran sesi mengikuti sesi bersama.

### Daily Check-in
- `permissions:sync` ada di `backend/package.json`. Menolak permission yang tidak ada di `PERMISSION_SET`.
- Model Person (satu koleksi untuk karyawan dan murid) dan sinkron 60 detik belum selesai (tahap 4).
- Format key dan gerbang route belum diperiksa.

### Exima
- `permissions:sync` dan `permissions:check` ada. Key berformat titik (`pos.checkout`, `inventory.export`).
- **AS-2 tidak sesuai**: `lib/access-control.ts` masih memiliki `ROLE_PERMISSIONS` sebagai cadangan. Harus dihapus.
- Dokumen rollout: `CENTRAL_SSO_ROLLOUT.md`.

### MTSS v2
- `docs/architecture.md` menyebut SSO, sesi, dan permission dari Central, tetapi belum ada kode permission yang saya temukan. Belum diperiksa lebih jauh.

### Woko
- Tidak ada nama role di kode; setiap route digerbang oleh permission (`requirePermission`, `requireAnyPermission` di `apps/api/src/auth.ts`). Kemungkinan akses tanpa gerbang diuji otomatis (tes integrasi dan helper `mws-central-auth/conformance`).
- **AS-3 sesuai**: key berformat titik, `woko.use` ada dan ditegakkan di `authenticate`, `users`, `settings`, `work-list`, dan `facilities` punya pasangan `read`. Migrasi `0028` dan `0029` memperbarui data yang tersimpan.
- **AS-4 sesuai**: manifest dengan deskripsi dan `requires` di `packages/domain/src/permissions.ts`, `npm run permissions:sync` dan `permissions:check` (memakai `fetch`, tanpa paket tambahan), serta layanan `permissions` Compose yang opsional (profil `central`). Sudah dijalankan terhadap kode Central yang sebenarnya pada database sementara: 28 permission diterima, format lama ditolak.
- **AS-13 sesuai**: `role-presets.json` dibuat dari paket permission dan dijaga oleh tes. Sudah diterima `seed:application-roles` Central (5 role dibuat pada database sementara).
- **AS-1 belum sesuai**: permission masih disimpan di tabel `user_permissions` milik Woko, dengan layar Akses Pengguna sendiri.
- Belum ada login lewat Hub atau entitlement Central (AS-10, AS-11, AS-12); login Google dan mode uji lokal.
- `mws-access check` (dari `access.config.json`) berjalan di CI pull request Woko: manifest, preset, typo key, nama role, dan 74 route ditolak untuk orang tanpa permission. Hasil terakhir 0 masalah, 0 peringatan. Woko menjadi aplikasi acuan untuk bentuk berkas: `packages/domain/src/permissions.ts` (definisi), `apps/api/src/scripts/permissions-cli.ts` (tiga baris), `apps/api/src/scripts/access-probe.ts` (probe), `access.config.json`, `role-presets.json`.
- Rencana ke Central: login Hub, `user_permissions` menjadi cache entitlement, hapus layar Akses Pengguna, pasang tes kesesuaian pustaka.

### Central (panel admin)
- Panel admin Central memakai `AdminRole` dan flag `can_*` sendiri. Itu bukan aplikasi penerima dan di luar cakupan v1.0. Bila nanti panel admin dipindah ke model ini, catat di sini.

## Daftar periksa untuk aplikasi

Salin ke PR yang mengubah akses sebuah aplikasi.

- [ ] AS-1: tidak ada tabel atau layar role/akses lokal selain cache entitlement.
- [ ] AS-2: `grep` nama role di kode logika tidak menemukan apa pun.
- [ ] AS-3: semua key cocok dengan pola; ada `<aplikasi>.use`.
- [ ] AS-4: manifest satu konstanta; `permissions:sync` dan `permissions:check` jalan di deploy dan CI.
- [ ] AS-5: role dibuat di Central; tidak ada penolakan entitlement karena nama role.
- [ ] AS-6: setiap route punya gerbang; daftar pengecualian sesuai aturan.
- [ ] AS-7: menu memakai konstanta yang sama dengan server.
- [ ] AS-8/9: scope dan keanggotaan kontekstual tidak menggantikan gerbang.
- [ ] AS-10/11: `is_active`, `organization_id`, permission asing, cache paling lama 60 detik, pencabutan.
- [ ] AS-12: admin pertama dari Central; mode uji hanya non-produksi.
- [ ] AS-13: `role-presets.json` sinkron dengan manifest (dijaga tes).
- [ ] AS-15: tes kesesuaian (a) sampai (d) ada dan lulus.
- [ ] Baris aplikasi ini di tabel atas sudah diperbarui.
