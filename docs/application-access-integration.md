# Application Access: panduan integrasi aplikasi

Untuk tim yang menghubungkan aplikasi (Hub, Daily Check-in, Exima, atau aplikasi baru) ke registry role di Central. Fitur ini ada di branch `feat/role-registry`.

## Cara menambah aplikasi baru

Semua dari UI Central (Super Admin), tanpa deploy:

1. Application Access, Add application. Isi Application ID: huruf kecil, angka, `-` dan `_` (spasi otomatis jadi `_`). Contoh `exima`.
2. Buka aplikasinya, tab Roles. Tambah role dengan key `UPPER_SNAKE` (contoh `STORE_ADMIN`), label, dan permission. Dua role aktif dalam satu aplikasi tidak boleh punya permission yang persis sama. Urutan role berarti tertinggi dulu.
3. Tab Access. Buat group: siapa saja (audience, unit, level, posisi) yang mendapat role apa. Exception memberi satu orang role lain di dalam scope sebuah group.
4. Catat Organization ID aplikasi (klik untuk menyalin). Aplikasi menyimpannya sebagai penanda bahwa data berasal dari Central yang benar.
5. Beri aplikasi token API client dengan scope `application_entitlements:read`.

## Contoh scope untuk murid

- Hanya murid Junior High: group dengan audience Students, unit Junior High, lalu pilih role. Murid dicocokkan lewat unit gradenya, jadi murid Elementary dan semua karyawan tidak tercakup.
- Hanya murid Elementary: sama, unit Elementary.
- Semua murid aktif: audience Students, unit dibiarkan All.
- Karyawan dan murid bersama: buat dua group dengan role yang sama, satu untuk Employees dan satu untuk Students. Group tunggal untuk keduanya tidak bisa dibuat lagi karena murid tidak punya posisi dan level, sehingga scope-nya tidak bisa dibuat jujur. Group gabungan lama tetap berjalan dan sebaiknya dipecah.

Group murid hanya menerima unit yang punya grade (Kindergarten, Elementary, Junior High). Unit seperti MAD Lab tidak punya murid, jadi tidak ditawarkan dan ditolak server dengan pesan `Unit "MAD Lab" has no students`.

## Lookup

`GET /api/internal/application-entitlements/lookup?person_id=<id>&application_id=<id>` dengan `Authorization: Bearer <token>`.

Respons 200:

```
{
  "data": {
    "id": "<uuid>" atau "group:<ruleId>",
    "person_id": "...",
    "application_id": "exima",
    "organization_id": "org_exima_ab12cd",
    "role": "STORE_ADMIN",
    "permissions": ["store.use", "app.admin"],
    "version": 3,
    "is_active": true,
    "granted_at": "...",
    "updated_at": "...",
    "is_default": true
  }
}
```

`is_default` hanya ada bila aksesnya berasal dari group. 404 berarti orang itu tidak punya akses aktif (tidak tercakup group, atau diblokir).

## Arti `version`

- Akses dari exception (id berupa uuid): penghitung kecil yang naik tiap perubahan role, permission, atau status.
- Akses dari group (id berawalan `group:`): detik-epoch saat role atau group terakhir berubah. Naik bila role, permission, atau group berubah, dan tidak berubah selama tidak ada perubahan. Mengubah urutan role atau label juga menaikkannya.
- Jangan membandingkan `version` antar `id` yang berbeda. Orang yang berpindah dari exception ke group, atau sebaliknya, mendapat `id` baru dengan nilai `version` dari skala lain. Bandingkan hanya bila `id` sama.

## Aturan untuk aplikasi penerima

- Otorisasi memakai `permissions`, bukan nama role. Nama role case-sensitive dan hanya untuk tampilan.
- Setiap permission yang dipakai di Central harus dikenal aplikasi lebih dulu. Aplikasi yang memvalidasi ketat (seperti Daily Check-in) menolak login bila ada permission yang tidak dikenal. Urutannya: tambahkan permission di aplikasi, deploy, baru pakai di role Central.
- `organization_id` harus cocok dengan Organization ID aplikasi itu di Central. Untuk aplikasi lama, Central mempertahankan ID yang sudah dipakai.
- Orang tanpa akses (404) tidak boleh masuk. Jangan meng-cache 404 lebih lama dari beberapa menit.

## Role atau permission

Yang berwenang adalah `permissions`. Field `role` hanya key stabil (`UPPER_SNAKE`, huruf besar kecil dibedakan) untuk tampilan atau pencatatan. Label role tidak dikirim.

Aplikasi penerima mengotorisasi dari permission, misalnya Hub memakai `hub.admin`, bukan `role === "ADMIN"`. "ADMIN" di satu aplikasi tidak sama artinya dengan "ADMIN" di aplikasi lain, dan role baru bisa ditambah di Central tanpa mengubah kode aplikasi selama permission yang dipakai sudah dikenal.

Saat membuat role baru, pastikan setiap permission-nya sudah dikenal aplikasi penerima. Role juga punya audience (Employees, Students, atau keduanya). Group murid hanya bisa memakai role yang mengizinkan murid.

Kode: Hub di `backend/src/lib/hub-access-gate.ts` (`userHasHubPermission`) dan `lib/admin-access.ts` (`isHubAdmin`). Daily Check-in memakai `PERMISSION_SET`.

## Memblokir satu orang

Orang yang aksesnya datang dari group bisa diblokir tanpa mengganti role mereka: di kartu Exceptions pilih Add Exception, ubah "Add As" menjadi Blocked, centang orangnya, lalu Block Access. Central menyimpan satu baris entitlement tidak aktif dengan role yang diberikan group, dan baris tidak aktif selalu menang atas group, jadi lookup mengembalikan tidak ada akses. Orang itu tampil di daftar exception dengan status Blocked dan lencana merah "Blocked" di ringkasan. Unblock mengembalikannya ke akses group (atau ke role exception-nya), dan Remove menghapus barisnya. Hanya orang yang tercakup group yang bisa diblokir.

## Menghapus role

Role bisa dihapus dari tab Roles (Delete, Super Admin saja) hanya bila tidak pernah dirujuk: tidak ada orang yang pernah memegangnya (termasuk yang aksesnya sudah dicabut) dan tidak ada group yang memberikannya (termasuk yang dimatikan). Selain itu Central menolak dengan hitungannya, dan jalannya adalah memindahkan orang lewat Change Role atau group lewat Edit Group, atau cukup menonaktifkan role itu. Urutan role dirapatkan kembali setelah hapus dan penghapusan tercatat di audit log.

## Mendaftarkan permission

Role di Central hanya boleh membawa permission yang sudah didaftarkan untuk aplikasinya. Permission yang tidak dikenal ditolak saat role dibuat atau diubah (`Permission "x" is not registered for <app>`), jadi salah ketik tidak lolos diam-diam.

Daftar permission dimiliki aplikasi. Tulis sebagai satu konstanta di kode (contoh Exima: `APP_PERMISSIONS`), pakai konstanta yang sama untuk menjaga rute, tab dan API, lalu kirim ke Central setiap deploy:

```
PUT /api/internal/application-permissions/<application_id>
Authorization: Bearer <token API client aplikasi>
{ "permissions": [{ "key": "pos.checkout", "description": "Opens the cashier tab" }] }
```

- Token harus dari API client yang profilnya sama dengan `<application_id>` dan punya scope `application_permissions:write`.
- Kirim daftar lengkap. Yang baru didaftarkan, yang hilang dari daftar ditandai dropped (tidak dihapus), yang muncul lagi dihidupkan kembali. Mengirim ulang daftar yang sama aman.
- Role lama tetap boleh membawa permission yang sudah dropped dan tetap bisa disimpan. Role baru tidak bisa memilihnya. Tab Permissions di halaman aplikasi menunjukkan permission mana yang dropped dan berapa role yang masih membawanya.
- Sebelum aplikasi pernah mengirim daftar, permission bisa ditambah dari form role di Central. Setelah itu penambahan manual ditolak, permission baru datang dari kode aplikasi.
- Jadikan langkah ini bagian dari deploy dan buat deploy gagal bila panggilannya gagal. Tambahkan test di aplikasi yang memastikan daftar di kode sama dengan yang dikirim.
- Untuk membandingkan sebaliknya, `GET /api/internal/application-permissions/<application_id>/usage` (scope `application_entitlements:read`) mengembalikan permission yang dibawa role aktif. Aplikasi bisa memeriksa tidak ada yang tidak dikenal kodenya.

### Permission yang butuh permission lain

Permission bisa menyebut permission lain yang harus menyertainya lewat `requires`, misalnya mengelola barang butuh bisa membuka tab barangnya:

```
{ "permissions": [
  { "key": "inventory.read", "description": "Opens the inventory tab" },
  { "key": "inventory.manage", "description": "Adds, edits and deletes items", "requires": ["inventory.read"] }
] }
```

- Central menolak role yang membawa `inventory.manage` tanpa `inventory.read`, dan form role mencentang yang dibutuhkan secara otomatis. Berlaku juga lewat rantai (`a` butuh `b`, `b` butuh `c`).
- Isi `requires` harus ada di daftar yang sama, tidak boleh menunjuk dirinya sendiri atau membentuk lingkaran. Daftar yang melanggar ditolak seluruhnya.
- Role lama yang sudah ada tidak diputus. Bila daftar baru menambah `requires`, role yang kurang ditandai "Missing ..." di tab Roles, label dan audience-nya masih bisa diubah, tetapi mengubah daftar permission-nya harus lengkap.
- `requires` hanya menutup kombinasi yang tidak masuk akal di Central. Aplikasi tetap menjaga di server: tiap endpoint memeriksa permission aksinya sendiri (CRUD memeriksa `manage`), dan menyembunyikan tab di UI bukan penjagaan.

### Menjalankan sinkron

Jalankan sebagai langkah deploy yang gagal-keras, bukan di dalam boot aplikasi (Central yang mati tidak boleh menahan aplikasi start, dan beberapa instance tidak perlu mengirim bersamaan). Hub sudah punya contohnya: `bun run permissions:sync` dan `bun run permissions:check` (`backend/scripts/sync-permissions.ts`). Aplikasi lain memakai `CentralDataClient` dari `mws-central-auth/data-client`: `publishPermissions`, `listRegisteredPermissions`, `permissionUsage`, dan `comparePermissions` untuk mode check.

- `check` tidak menulis apa pun dan gagal bila role aktif membawa permission yang tidak dikenal kode, `requires` berbeda, atau kode kehilangan permission yang masih terdaftar. Jalankan di CI.
- Respons sinkron menyebut `affected_roles`, yaitu role aktif yang masih membawa permission yang baru dihapus dari daftar. Cetak sebagai peringatan keras.
- Daftar yang menghapus lebih dari separuh permission yang pernah dikirim ditolak (409) kecuali `confirm_removals: true`, supaya daftar yang terpotong tidak lolos diam-diam.
- Sinkron untuk satu aplikasi bergantian (dikunci), jadi dua deploy sekaligus tidak bertabrakan.
- Token hanya boleh dari API client berprofil sama dengan aplikasinya. Membaca daftar terdaftar dan pemakaian role juga dibatasi begitu.

Menghapus permission dilakukan dua rilis: pindahkan role ke permission yang baru di Central, baru hapus dari kode. Permission yang dihapus dari daftar ditandai dropped, tidak memutus role yang membawanya, tetapi aplikasi mengabaikannya. Rollback aplikasi ke versi lama menandai permission barunya dropped saat deploy sinkron berikutnya, role tidak putus, dan deploy ulang menghidupkannya kembali.

Aplikasi yang menolak permission asing (Daily Check-in memeriksa `PERMISSION_SET`): sampai skrip sinkronnya ada, permission yang ditambah manual di Central harus persis sama dengan daftar di kodenya.

Mengganti nama permission: tambah yang baru di kode dan deploy, pindahkan role ke yang baru di Central, lalu hapus yang lama dari kode. Contoh Exima: Cashier membawa `pos.checkout` dan Resource membawa `inventory.export`, dan middleware Exima memetakan rute ke permission itu.

## Lewat Hub

Di layar admin Hub, isi kolom Central entitlement app id pada entri aplikasi dengan Application ID di Central. Setelah terisi, Launch ditolak bila orang itu tidak punya akses aktif di Central, dan `role`, `permissions`, `version`, `organization_id` ikut di token SSO. Kolom kosong berarti Hub tidak memeriksa akses Central untuk aplikasi itu.

Checklist sebelum mengisi kolom itu untuk aplikasi yang sudah berjalan:

1. Role, permission, dan group aplikasi itu sudah benar di Central.
2. Env Organization ID di aplikasi sama dengan Organization ID di Central.
3. Semua permission pada role sudah dikenal aplikasi.
4. Aplikasi tidak menolak `version` yang lebih kecil bila `id` berubah.
5. Coba Launch dengan akun group, akun exception, dan akun tanpa akses di staging.
