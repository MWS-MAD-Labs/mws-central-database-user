# Application Access: panduan integrasi aplikasi

Untuk tim yang menghubungkan aplikasi (Hub, Daily Check-in, Exima, atau aplikasi baru) ke registry role di Central. Fitur ini ada di branch `feat/role-registry`.

## Cara menambah aplikasi baru

Semua dari UI Central (Super Admin), tanpa deploy:

1. Application Access, Add application. Isi Application ID: huruf kecil, angka, `-` dan `_` (spasi otomatis jadi `_`). Contoh `exima`.
2. Buka aplikasinya, tab Roles. Tambah role dengan key `UPPER_SNAKE` (contoh `STORE_ADMIN`), label, dan permission. Dua role aktif dalam satu aplikasi tidak boleh punya permission yang persis sama. Urutan role berarti tertinggi dulu.
3. Tab Access. Buat group: siapa saja (audience, unit, level, posisi) yang mendapat role apa. Exception memberi satu orang role lain di dalam scope sebuah group.
4. Catat Organization ID aplikasi (klik untuk menyalin). Aplikasi menyimpannya sebagai penanda bahwa data berasal dari Central yang benar.
5. Beri aplikasi token API client dengan scope `application_entitlements:read`.

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

## Lewat Hub

Di layar admin Hub, isi kolom Central entitlement app id pada entri aplikasi dengan Application ID di Central. Setelah terisi, Launch ditolak bila orang itu tidak punya akses aktif di Central, dan `role`, `permissions`, `version`, `organization_id` ikut di token SSO. Kolom kosong berarti Hub tidak memeriksa akses Central untuk aplikasi itu.

Checklist sebelum mengisi kolom itu untuk aplikasi yang sudah berjalan:

1. Role, permission, dan group aplikasi itu sudah benar di Central.
2. Env Organization ID di aplikasi sama dengan Organization ID di Central.
3. Semua permission pada role sudah dikenal aplikasi.
4. Aplikasi tidak menolak `version` yang lebih kecil bila `id` berubah.
5. Coba Launch dengan akun group, akun exception, dan akun tanpa akses di staging.
