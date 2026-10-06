# Application Access: catatan serah terima

Branch kerja: `feat/role-registry` (belum di-push, belum di-merge). Semua kode sudah di-commit. Balas user dalam bahasa Indonesia. Ikuti aturan di `CLAUDE.md` repo (commit satu baris `feat:`/`update:`/`fix:`/`docs:`, tanpa trailer Claude, jangan nested include pada write Prisma, komentar singkat, alur feature, staging, main).

## Gambaran fitur
Super Admin mengatur siapa yang boleh membuka tiap aplikasi (exima, daily-checkin, hub, dst.) dan dengan role apa. Satu sumber kebenaran RBAC di Central. Aplikasi lain membaca lewat `GET /api/internal/application-entitlements/lookup` (kontrak tidak berubah: role, permissions, version, organization_id; akses dari group mengembalikan `id: group:<ruleId>`, `version: 0`).

Konsep:
- **Aplikasi**: dibuat dengan satu isian Application ID (huruf kecil, angka, `-`, `_`; spasi otomatis jadi `_` di form). Organization ID dibuat otomatis sekali, tidak pernah diketik.
- **Role**: kunci `UPPER_SNAKE` per aplikasi, urutan manual (`rank`, 0 = tertinggi, ditampilkan paling atas di semua pilihan role). Role baru masuk paling bawah. Dilarang ada dua role aktif dengan himpunan permission sama persis dalam satu aplikasi (create dan ubah permission; mengaktifkan kembali ke bentrokan juga ditolak).
- **Group** (`ApplicationAccessRule`): audience (EMPLOYEES, STUDENTS, EMPLOYEES_AND_STUDENTS) ditambah scope unit, job position, job level (daftar kosong = semua). Dasar akses sebuah aplikasi.
- **Exception** (`ApplicationEntitlement`): akses per orang, hanya boleh di dalam scope sebuah group dan dengan role berbeda dari group itu. Boleh diblokir (revoke). Orang yang dipegang group yang lebih sempit tidak muncul sebagai kandidat group yang lebih luas (exception mereka ditambahkan di group sempit).
- **Aturan hierarki** (server, `application-access-gate.ts`): paling spesifik menang; group dalam group tidak boleh memberi role yang sama dengan induk terdekatnya; group tidak bisa dihapus/dimatikan/dipersempit selama masih ada exception atau group anak yang bergantung padanya (pesan menyebut nama); melebarkan group tidak boleh membuat group/orang di dalamnya jadi redundan; orang yang diblokir tetap diblokir.
- **Aturan master data untuk scope** (`application-scope-rules.ts`): kombinasi (unit, posisi, level) hanya sah bila posisi diizinkan di unit (`MasterJobPositionUnit`, daftar kosong = semua unit), level diizinkan di unit (`MasterJobLevelUnit`), dan pasangan posisi-level cocok (`jobPositionAndJobLevelAreCompatible` di `utils/employee-role-rules.ts`: teaching dengan teaching, Special Education Teacher hanya dengan SE Teacher). Server menolak simpan scope yang berisi nilai yang tidak mungkin ada orangnya (`assertScopeCanHoldPeople`, hanya untuk audience karyawan, dan hanya bila scope diubah). Unit sentinel "Unknown / Legacy" (konstanta di `server/src/utils/legacy-unit.ts`, `client/.../utils/legacyUnit.js`) ditolak server dan disembunyikan di UI.

## Peta kode
Server (`server/src`):
- `service/application-entitlement-service.ts`: `ApplicationEntitlementService`, `ApplicationRoleService` (list, create, reorder, update), `ApplicationOrganizationService`, `ApplicationAccessRuleService` (create/update/delete, `assertRuleReferences`), `ApplicationAccessService` (applications, createApplication, `application()` detail grup dengan `covered_count`, `own_count`, `remaining`, `exceptions()`, `candidates()`, `roleOptions()`, `scopeCatalog()`).
- `service/application-access-gate.ts`: `ruleSpecificity`, `covers`, `parentRule`, `inheritedRole`, `loadGateState`, `checkRuleGate` (opsi `roleOnly`), `assertRuleGate`, `assertPersonException`.
- `service/application-scope-rules.ts`: katalog master, `buildFeasibility().combos`, `projection`, `scopePairFits`.
- `controller/admin/application-entitlement-controller.ts`, `routes/admin/application-role-router.ts` (rute `/api/admin/application-access/...`: `applications`, `apps/:id`, `apps/:id/exceptions`, `apps/:id/role-options`, `scope-catalog`, `candidates`), `validation/application-entitlement-validation.ts`, `model/application-entitlement-model.ts`.
- Migrasi: `20261006090000_application_role_rank` (kolom `rank`, enum audit `APPLICATION_CREATE`).
- Test: `src/test/application-role.test.ts`, `application-entitlement.test.ts`, `application-access-rule.test.ts`, `application-access-gate.test.ts`, `application-access-apps.test.ts`.

Klien (`client/src/features/application-access`):
- Halaman: `ApplicationAccessPage` (daftar aplikasi, paging server), `AppCreatePage`, `AppAccessPage` (tab Access dan Roles, `?tab=`), `GroupFormPage`, `GroupAccessEditPage`, `ExceptionAddPage`, `RoleFormPage` (rute di bawah `/application-access/apps/:applicationId/...`).
- Komponen utama: `GroupCard` (baris ringkas yang bisa dibuka, akordion satu per satu), `ExceptionsCard` (card exception di bawah tiap group), `ExceptionsPanel` (tabel, paging server per group atau `other`), `GroupSummary` (ScopeGrid, GroupFacts, RemainingScope, RolePill), `ListPopover` dan `PermissionPopover` (daftar ter-portal; scroll di dalam daftar tidak menutupnya), `GroupFilters` + `MultiCheckList` (chip), `AppRolesTab`, `CopyableId`, `RoleName`, `Tip`.
- Util dan hook: `utils/scopeRules.js` (aturan scope murni dari katalog server: `combos`, `allowedValues`, `settle`), `utils/groupFilterState.js` (`useGroupFilterState(initial, rules)`), `hooks/useScopeCatalog.js`, `hooks/useRoleAvailability.js`, `hooks/useApplicationRoles.js`, `utils/roleOptions.js`, `utils/groupSummary.js`.
- Test: `client/test/features/application-access/*` (bun, jsdom). Catatan: ada sesuatu di luar sesi ini yang memformat ulang file (tanda kutip ganda, titik koma) setelah diedit; baca ulang file sebelum edit string.

## Cara menjalankan test
Server (butuh DB yang namanya mengandung "test"): ada kontainer `mws-claude-testdb` (port 5499, DB `mws-center-test`, user `root`, sandi `t`, migrasi sudah dideploy, master data di-seed).
```
cd server
export DATABASE_URL="postgresql://root:t@localhost:5499/mws-center-test?schema=public"
bun run typecheck
bun test src/test/application-access-apps.test.ts   # jalankan per file
```
Kontainer itu sementara; hapus dengan `docker rm -f mws-claude-testdb` bila sudah tidak perlu. Klien: `cd client && bun test test/features/application-access && bunx eslint src test && bun run build`.
Jangan reset sequence `admin_no` dan jangan memulihkan DB dev tanpa tanya (lihat memori proyek).

## Keputusan desain dari user (jangan dibalik tanpa tanya)
- Gaya UI: tombol aksi kecil berupa ikon (Add role, Add exception, Add permission, Manage). Tidak ada tombol Copy; klik teks id langsung menyalin (tanpa background, pointer, hover burgundy). Nama role selalu burgundy tebal (`RoleName`). Angka di kolom Roles/Groups/Exceptions rata tengah. Hitungan ditulis `3 Employees`, `0 Exceptions`. Jangan pakai teks berformat "Label - penjelasan" atau em dash di UI (terdengar AI).
- Scope di baris group ditulis hitungan (`All Units · 12 Positions · All Levels`), nama lengkap ada di badan yang dibuka lewat `N units` yang bisa diklik.
- Group luas dengan group anak menampilkan blok "After Narrower Groups": kiri "Still held by this group" (nilai `All`, `All except N`, `N positions`, nama tunggal, atau `None left`), kanan "Taken by narrower groups" dengan grid yang sama.
- Pilihan role di Add group hanya memuat role yang tidak bentrok (server menjawab lewat `role-options`, aturan identik dengan saat simpan).
- Kandidat exception tampil sebagai tabel berkolom dengan paging dan filter (unit, posisi, level, employment type), tanpa filter Current role (dihitung di memori, akan merusak paging).

## Bug terbuka (kerjakan ini dulu)
Di Add group (dan Edit group), pada daftar Units/Positions/Levels: user melepas posisi yang "ada di unit MAD Lab" tetapi **chip unit MAD Lab tidak ikut terhapus**. Harapan user: bila tidak ada lagi posisi (atau level) terpilih yang bisa ada di MAD Lab, unit itu ikut hilang, dan sebaliknya (cascade dua arah, dengan catatan "Also removed because they no longer fit the other choices").

Logika ada di `client/src/features/application-access/utils/scopeRules.js` (`settle(selection, changed, { wipe })`) dan `utils/groupFilterState.js`. Diagnosis sejauh ini:
1. `settle` sudah bekerja untuk kasus bersih. Simulasi dengan data uji: unit `[MAD]`, posisi `[Tutor]` (hanya di Elementary) setelah mengubah posisi menghapus MAD; unit `[MAD]`, posisi `[Tutor, Aide]` **tidak** menghapus MAD, karena `Aide` tidak dibatasi unit (`unit_ids: []`) sehingga menurut master data sah ada di MAD Lab. Kemungkinan besar inilah yang terlihat user: posisi yang tersisa adalah posisi "semua unit", jadi unit dianggap masih punya pendukung. Aturan master data memang begitu ("Empty allows this position in any unit").
2. Kemungkinan lain yang perlu diperiksa langsung di browser: (a) saat "All Positions" aktif lalu satu per satu dilepas, `toggle` di `MultiCheckList.jsx` membentuk daftar dari `items` yang sudah disaring `allowed`, jadi daftar eksplisit hanya berisi posisi yang sah untuk unit terpilih; (b) bila Units masih `All`, pilihan All tidak pernah dipangkas (hanya chip yang disaring), jadi "unit tidak terhapus" bisa berarti `All Units` tetap menyala; (c) `rules` (katalog) belum termuat saat klik, sehingga tidak ada cascade (lihat helper `rulesLoaded` di `GroupFormPage.test.jsx`).
3. Keputusan yang perlu dikonfirmasi ke user sebelum mengubah perilaku: apakah posisi/level yang tidak dibatasi unit (sah di semua unit) boleh dianggap mendukung sebuah unit? Pilihan: (i) tetap (sesuai master data) tetapi tampilkan petunjuk mengapa unit bertahan, mis. "MAD Lab stays because Aide and Coach exist in every unit"; (ii) hanya hitung posisi yang secara eksplisit mencantumkan unit itu untuk mendukung pilihan unit eksplisit (lebih sesuai harapan user, tetapi bertentangan dengan server yang menerima kombinasi itu, jadi server dan `settle` harus disamakan atau ada aturan khusus UI). Rekomendasi: reproduksi dulu di browser dengan data master asli, pastikan skenario mana (1 atau 2a/2b/2c), baru pilih.
4. Mengosongkan satu daftar (melepas nilai terakhir lewat chip, bukan lewat tombol All) mengosongkan pilihan eksplisit di dua daftar lain (`wipe`), karena tidak ada lagi yang mendukungnya. User sudah diberi tahu dan bisa meminta versi yang lebih lunak (hanya menandai).

Uji regresi yang harus ada setelah perbaikan: `client/test/features/application-access/scopeRules.test.js` (murni) dan `GroupFormPage.test.jsx` ("drops what only existed because of an unchecked unit and says so").

## Hal lain yang belum dikerjakan
- Panduan integrasi aplikasi: `docs/application-access-integration.md`. Hub sudah generik (kolom Central entitlement app id per aplikasi), tapi Daily Check-in perlu penyesuaian aturan `version` sebelum gerbang Central dinyalakan untuknya.
- Hub, Exima, Daily Check-in belum membaca role dari Central dengan kunci `UPPER_SNAKE` baru (perlu branch tindak lanjut di repo masing-masing dan koordinasi deploy; sesi UserSession dipotong saat deploy migrasi SSO, lihat memori proyek).
- Merge: feature branch ke `staging` dulu, baru `staging` ke `main`. Jangan push tanpa diminta.
- Review pasca-fitur (RBAC, soft-delete, audit, race condition) sesuai `CLAUDE.md` belum dilakukan untuk fitur ini.

## Riwayat commit (terbaru di atas)
`77a05cb2` picker scope mengikuti master data dua arah + blok Taken seragam; `f6826a2b` endpoint `scope-catalog`; `a4e60a7e` baris group hitungan dan blok dua kolom; `71860eeb`, `fad5675d` aturan scope master data; `54353949` own_count dan remaining; `9440797a` baris group bisa dibuka; `c8d7c38e` role-options dan unit sentinel; `0ef1c6ed`, `28012f75`, `8ea61b02` polish tab Roles dan kartu group; `653b045a` gate role kembar; sebelumnya `4dffc1e4`, `aa206548`, `e50d4716`, `fb7000ae`, `6a47b4c3`.
