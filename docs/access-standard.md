# Access Standard v1.0

Aturan satu-satunya untuk role, permission, dan akses di semua aplikasi MWS. Dokumen ini normatif: aplikasi mana pun yang memakai sesi Hub atau data Central harus mengikutinya. Dokumen lain (README aplikasi, catatan rollout) hanya menunjuk nomor aturan di sini dan tidak mengulang isinya.

- Berlaku untuk: Hub, Learnspace, Daily Check-in, Exima, MTSS, Woko, dan aplikasi baru.
- Tidak berlaku untuk panel admin Central sendiri (`AdminRole`). Panel itu bukan aplikasi penerima; lihat `access-conformance.md`.
- Cara menyambungkan aplikasi: [sso-integration-guide.md](sso-integration-guide.md). Detail API: [application-access-integration.md](application-access-integration.md). Status tiap aplikasi: [access-conformance.md](access-conformance.md).
- Kata MUST berarti wajib, SHOULD berarti dianjurkan kuat.

## Istilah

| Istilah | Arti |
| --- | --- |
| Permission | Satu hak melakukan satu hal, ditulis sebagai key, misalnya `work-order.approve`. |
| Manifest | Daftar semua permission milik satu aplikasi (key, deskripsi, `requires`), ditulis di kode aplikasi. |
| Role | Nama untuk sekumpulan permission, dibuat di Central. Hanya label bagi manusia. |
| Entitlement | Catatan di Central bahwa satu orang memegang satu role di satu aplikasi. Membawa `role`, `permissions`, `version`, `is_active`. |
| Group | Aturan di Central yang memberi role ke banyak orang sekaligus (karyawan, unit, posisi, level). |
| Scope data | Baris mana yang terjangkau (unit, grade, murid yang ditugaskan). Beda dari hak melakukan aksi. |

## Aturan

### AS-1 Kepemilikan
- Aplikasi MUST memiliki manifest permission-nya. Central MUST memiliki role, group, dan entitlement.
- Aplikasi MUST NOT menyimpan role sebagai sumber kebenaran dan MUST NOT punya layar sendiri untuk memberi atau mencabut akses.
- Aplikasi boleh menyimpan salinan (cache) permission dari entitlement terakhir, sesuai AS-10.

### AS-2 Hanya permission yang diperiksa
- Kode, SQL, dan UI MUST memeriksa permission, tidak pernah nama role.
- Nama role (misalnya `ADMINISTRATOR`) MUST NOT muncul di kondisi, enum, atau konstanta logika. Boleh muncul hanya sebagai teks tampilan atau di catatan audit.
- Alasan: "ADMIN" di satu aplikasi tidak sama dengan "ADMIN" di aplikasi lain, dan role baru bisa ditambah di Central tanpa deploy.

### AS-3 Format key
- Pola: `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,2}$`, paling panjang 64 karakter. Huruf kecil, kata dipisah `-`, tingkat dipisah titik: `domain.aksi` atau `domain.sub.aksi`.
- Aksi baku: `read`, `create`, `update`, `delete`, `manage`, `approve`, `export`, `use`, `admin`. Aksi lain boleh bila jelas (`reopen`, `cancel`).
- `<aplikasi>.use` MUST ada untuk hak masuk ke aplikasi, `<aplikasi>.admin` untuk hak administrasi aplikasi (contoh Hub: `hub.use`, `hub.admin`).
- Awalan khusus:
  - `scope.` untuk jangkauan data (`scope.organization`, `scope.grade`, `scope.assigned`).
  - `be-` di awal aksi untuk "boleh ditunjuk sebagai" (`work-order.be-pic`). Ini hanya memengaruhi daftar pilihan dan validasi penugasan.
- `manage` MUST menyebut `read` di `requires`.

Contoh benar: `work-order.create`, `work-order.read-all`, `iep.submit`, `facilities.manage`. Contoh salah: `WorkOrder:Create`, `work_order_create`, `canApprove`.

### AS-4 Manifest dan sinkron
- Manifest MUST ditulis sebagai satu konstanta di kode dan dipakai ulang untuk menjaga route, menu, dan API.
- Aplikasi MUST menyediakan `permissions:sync` dan `permissions:check`, dijalankan di deploy (gagal keras) dan di CI.
- Sinkron MUST NOT dijalankan di dalam proses boot aplikasi.
- Kirim daftar lengkap. Permission yang hilang ditandai dropped, tidak dihapus. Daftar yang membuang lebih dari separuh ditolak kecuali `confirm_removals`.
- Detail panggilan: bagian "Mendaftarkan permission" di `application-access-integration.md`.

### AS-5 Role hidup di Central
- Role dibuat di Central untuk aplikasinya, membawa hanya permission yang ada di manifest, dan punya `rank`, serta audience (karyawan, murid, intern).
- Dua role aktif dalam satu aplikasi MUST NOT punya kumpulan permission yang persis sama.
- Aplikasi MUST menerima role apa pun yang valid dari Central. Aplikasi tidak boleh menolak entitlement karena nama role tidak dikenalnya.

### AS-6 Gerbang di setiap route
- Setiap route server MUST mendeklarasikan permission yang dibutuhkan, di tempat route didaftarkan (`preHandler`, middleware route, atau guard). Tanpa deklarasi berarti ditolak (deny by default).
- Boleh tanpa permission hanya: kesehatan (`/health/*`), login dan logout, `/me`, serta data milik sendiri (notifikasi, preferensi).
- Route yang dipakai beberapa jenis pelaku MUST memakai "salah satu dari" daftar permission, bukan nama role.
- Contoh: Hub `backend/src/lib/hub-access-gate.ts`, Woko `apps/api/src/auth.ts` (`requirePermission`, `requireAnyPermission`).

### AS-7 UI hanya kemudahan
- Menu dan tombol MUST memakai konstanta permission yang sama dengan server. Menyembunyikan elemen bukan pengganti gerbang server.

### AS-8 Scope data
- Scope adalah permission berawalan `scope.`. Apa yang dijangkau tetap data di database aplikasi (unit, grade, penugasan).
- Dua pertanyaan dijawab terpisah: "boleh melakukan aksi ini?" (permission aksi) dan "pada data siapa?" (permission scope dan data).
- Bila tidak ada permission scope, jangkauan default MUST sempit (hanya milik sendiri atau yang ditugaskan), bukan luas.

### AS-9 Keanggotaan kontekstual
- Hak seperti "PIC yang ditugaskan pada work order ini" adalah syarat tambahan di dalam handler. Ia MUST NOT menggantikan permission di gerbang route.
- Bentuk: gerbang `be-*` atau aksi di route, lalu cek keanggotaan di handler.

### AS-10 Menerima entitlement
- Sumber: `GET /api/internal/application-entitlements/lookup` atau token SSO dari Hub.
- Aplikasi MUST menolak permission yang tidak ada di manifestnya (dan MUST NOT menganggapnya sebagai hak).
- Aplikasi MUST memeriksa `is_active` dan `organization_id` (harus sama dengan Organization ID aplikasi di Central).
- 404 berarti tidak punya akses. Jangan cache 404 lebih lama dari beberapa menit.
- `version` hanya dibandingkan bila `id` sama.

### AS-11 Kesegaran dan pencabutan
- Cache permission MUST paling lama 60 detik tanpa penyegaran, untuk sesi yang sedang berjalan.
- Entitlement yang dinonaktifkan atau 404 MUST memutus akses pada penyegaran berikutnya, tanpa menunggu sesi habis.

### AS-12 Admin pertama dan mode uji lokal
- Admin pertama ditentukan di Central (group atau exception), bukan oleh aplikasi dan bukan dari "pengguna pertama yang login".
- Mode uji lokal (login tanpa Central) MUST dikunci hanya untuk non-produksi dan membawa permission lengkap dari fixture, bukan role.

### AS-13 Role bawaan
- Role awal sebuah aplikasi ditulis sebagai berkas preset di repo aplikasi (`role-presets.json`: key, label, rank, audience, permissions) dan dibuat di Central dengan `bun run seed:application-roles` (di repo Central).
- Preset MUST hanya memakai key yang ada di manifest. Tes aplikasi MUST menjaga keduanya tetap sinkron.

### AS-14 Mengganti nama atau menghapus permission
- Ganti nama: tambah key baru di kode dan deploy, pindahkan role ke key baru di Central, hapus key lama dari kode di rilis berikutnya.
- Hapus: pindahkan role dulu, baru hapus dari kode. Dua rilis.

### AS-15 Kesesuaian
- Setiap aplikasi MUST punya tes otomatis yang memastikan: (a) semua route terdaftar punya gerbang, (b) manifest di kode sama dengan yang dikirim `permissions:sync`, (c) `role-presets.json` hanya memakai key manifest, (d) tidak ada konstanta nama role dalam logika (`grep`).
- Status tiap aplikasi dicatat di [access-conformance.md](access-conformance.md) dengan versi standar yang dipatuhi.

## Perubahan standar
Nomor aturan tidak dipakai ulang. Perubahan menaikkan versi (v1.1 untuk penambahan, v2.0 untuk perubahan yang merusak) dan dicatat di bawah.

| Versi | Tanggal | Catatan |
| --- | --- | --- |
| 1.0 | 2026-10-27 | Penyatuan aturan dari `application-access-integration.md`, ADR 0002 Learnspace, dan keputusan "tanpa role lokal". Format key diseragamkan ke titik. |
