# Admin Guide

Panduan ini ditujukan untuk admin MWS yang menggunakan MWS Data Center sebagai pusat data siswa, karyawan, academic structure, access management, audit log, dan integrasi aplikasi internal.

## 1. Login

Admin login menggunakan Google Sign-In dengan email Google Workspace yang sudah terdaftar sebagai admin.

Alur login:

1. Buka frontend MWS Data Center.
2. Klik tombol Google Sign-In.
3. Pilih akun Google Workspace MWS.
4. Sistem akan mengecek apakah email tersebut terdaftar sebagai admin aktif.
5. Jika akun admin aktif, pengguna masuk ke dashboard.

Jika login berhasil tetapi muncul pesan tidak punya akses panel, akun Google tersebut belum dipromosikan menjadi admin aktif atau sudah dinonaktifkan.

## 2. Role dan Permission

MWS Data Center memiliki tiga role admin: `SUPER_ADMIN`, `DATABASE_ADMIN`, dan `VIEWER`. Role menentukan menu yang terlihat, data yang dapat diakses, dan aksi yang boleh dilakukan.

Selain role, ada beberapa permission tambahan:

- `can_write_data`: menentukan apakah admin operasional boleh membuat atau mengubah data.
- `can_view_sensitive_data`: menentukan apakah admin boleh melihat data sensitif seperti health, special needs, consent attachment, dan detail personal tertentu.
- After-hours grant: memberi izin tulis sementara di luar jam kerja.
- Working Saturdays: membuka akses tulis pada hari Sabtu tertentu yang ditandai sebagai hari kerja.

### SUPER_ADMIN

`SUPER_ADMIN` adalah role tertinggi. Role ini digunakan untuk admin utama yang bertanggung jawab terhadap seluruh database dan pengaturan sistem.

Gunakan role ini untuk:

- Kepala admin sistem.
- PIC data pusat.
- Admin yang boleh mengelola akses admin lain.
- Admin yang boleh membuat API client untuk aplikasi internal.
- Admin yang boleh melakukan import besar dan rollback.

Akses yang dimiliki:

- Melihat seluruh data siswa dan karyawan tanpa batas unit.
- Membuat dan mengubah data siswa.
- Membuat dan mengubah data karyawan.
- Menghapus dan restore data siswa, karyawan, enrollment, dan data sensitif yang mendukung restore.
- Melihat data sensitif.
- Import dan export data.
- Mengelola academic year, grade, class, dan enrollment.
- Mengelola master data seperti unit, job position, job level, dan building.
- Promote employee menjadi admin.
- Demote admin.
- Mengatur `can_write_data` dan `can_view_sensitive_data`.
- Memberikan after-hours grant.
- Mengelola working Saturdays.
- Membuat, rotate, dan revoke API client.
- Melihat audit log.

Batasan penting:

- `SUPER_ADMIN` tidak boleh demote akun admin miliknya sendiri.
- API token yang dibuat hanya muncul sekali saat create atau rotate, jadi harus langsung disimpan dengan aman.
- Aksi penting akan masuk audit log.

Contoh penggunaan:

- Membuat master data awal.
- Membuat admin DATABASE_ADMIN untuk unit tertentu.
- Import data siswa dan karyawan dari Excel.
- Restore data yang tidak sengaja dihapus.
- Rotate token API client untuk aplikasi internal.

### DATABASE_ADMIN

`DATABASE_ADMIN` adalah role admin operasional. Role ini digunakan untuk user yang membantu mengelola data harian, biasanya dibatasi pada unit tertentu.

Gunakan role ini untuk:

- Admin unit.
- Staff database sekolah.
- User yang perlu update data siswa atau karyawan sesuai area kerja.

Akses yang dimiliki:

- Melihat data sesuai unit atau scope yang diberikan backend.
- Membuat atau mengubah data jika `can_write_data` aktif.
- Mengakses menu operasional seperti Students, Employees, Academic, dan Profile sesuai permission.
- Melihat data sensitif hanya jika `can_view_sensitive_data` aktif.
- Export data jika permission dan role mengizinkan.

Batasan penting:

- Tidak bisa menghapus data.
- Tidak bisa restore data.
- Tidak bisa mengelola admin user.
- Tidak bisa membuat, rotate, atau revoke API client.
- Tidak bisa mengelola master data yang dibatasi SUPER_ADMIN.
- Hak tulis dapat dibatasi oleh jam kerja.
- Jika di luar jam kerja, butuh after-hours grant dari SUPER_ADMIN.
- Jika hari Sabtu belum ditandai sebagai working Saturday, aksi tulis dapat ditolak.

Contoh penggunaan:

- Memperbaiki data alamat atau status siswa.
- Memperbarui data karyawan di unitnya.
- Membantu validasi hasil import.
- Mengelola perubahan data harian tanpa akses ke pengaturan sistem.

### VIEWER

`VIEWER` adalah role baca. Role ini digunakan untuk user yang perlu melihat data, tetapi tidak boleh mengubah apa pun.

Gunakan role ini untuk:

- User yang hanya perlu monitoring.
- Pihak internal yang perlu validasi data tanpa hak edit.
- Admin sementara yang belum diberi wewenang update.

Akses yang dimiliki:

- Melihat data sesuai permission.
- Melihat list dan detail yang diizinkan.
- Melihat data sensitif hanya jika `can_view_sensitive_data` aktif.

Batasan penting:

- Tidak bisa create data.
- Tidak bisa edit data.
- Tidak bisa delete atau restore data.
- Tidak bisa import.
- Tidak bisa mengelola access.
- Tidak bisa mengelola API client.
- Tidak bisa mengelola master data.
- Tidak bisa melakukan action tulis meskipun sedang dalam working hours.

Contoh penggunaan:

- Melihat daftar siswa.
- Mengecek data karyawan.
- Membantu audit manual tanpa risiko perubahan data.
- Memberi akses baca ke pihak yang hanya perlu referensi.

### Ringkasan Permission

| Aksi | SUPER_ADMIN | DATABASE_ADMIN | VIEWER |
| --- | --- | --- | --- |
| Lihat data umum | Ya | Ya, sesuai scope | Ya, sesuai scope |
| Lihat data sensitif | Ya | Jika diberi permission | Jika diberi permission |
| Create data | Ya | Jika `can_write_data` aktif | Tidak |
| Edit data | Ya | Jika `can_write_data` aktif dan sesuai scope | Tidak |
| Delete data | Ya | Tidak | Tidak |
| Restore data | Ya | Tidak | Tidak |
| Import data | Ya | Tidak | Tidak |
| Export data | Ya | Sesuai permission | Sesuai permission baca |
| Kelola master data | Ya | Tidak | Tidak |
| Kelola admin users | Ya | Tidak | Tidak |
| Kelola API clients | Ya | Tidak | Tidak |
| Lihat audit log | Ya | Tidak | Tidak |

## 3. Dashboard

Dashboard menampilkan ringkasan data utama.

Data yang tersedia saat ini:

- Total students.
- Total employees.

Grafik dan insight lanjutan dapat ditambahkan di fase berikutnya.

## 4. Student Database

Menu Students digunakan untuk mengelola data siswa.

Fitur utama:

- List siswa dengan search, filter, sort, dan pagination.
- Pilih jumlah data per halaman: 10, 30, 50, atau 100.
- Create student.
- Edit student.
- Detail student.
- Soft delete dan restore sesuai permission.
- Import dan export.

### Create Student

Saat membuat siswa baru:

- NIS dibuat otomatis oleh backend.
- Admin wajib memilih entry type: `PRE_K`, `PSB`, atau `TRANSFER`.
- NISN opsional.
- Status awal siswa dibuat sebagai `REGISTERED`.
- Siswa menjadi `ACTIVE` melalui enrollment ke class aktif.

### Student Detail

Student Detail berisi data utama dan panel tambahan:

- Enrollment history.
- Parents atau guardians.
- Consent status.
- Consent attachments.
- Health record dan health notes.
- Vaccine records.
- PC activities.

### Bulk Actions (Delete & Restore)

Untuk efisiensi manajemen data dalam jumlah besar:
- **Bulk Delete**: Admin (khususnya `SUPER_ADMIN`) dapat memilih beberapa siswa sekaligus dari daftar tabel siswa, lalu melakukan soft delete secara bersamaan.
- **Bulk Restore**: Di halaman Trash Bin (data terhapus), admin dapat memilih beberapa siswa sekaligus untuk mengembalikan (restore) status mereka ke keadaan sebelum dihapus.
- Setelah aksi bulk dijalankan, sistem akan menampilkan laporan hasil pemrosesan per siswa, termasuk status `SUCCESS` atau `FAILED` beserta detail error-nya jika ada.

### Sensitive Data

Data sensitif seperti health, special needs, consent attachment, dan beberapa detail personal hanya bisa dilihat oleh role atau admin yang punya permission sensitif.

## 5. Employee Database

Menu Employees digunakan untuk mengelola data karyawan.

Fitur utama:

- List karyawan dengan search, filter, sort, dan pagination.
- Pilih jumlah data per halaman: 10, 30, 50, atau 100.
- Create employee.
- Edit employee.
- Detail employee.
- Soft delete dan restore sesuai permission.
- Import dan export.

Employee data memakai master data berikut:

- Unit.
- Job position.
- Job level.
- Building.

Job level dapat ditandai sebagai teaching role. Flag ini dipakai untuk membatasi pilihan homeroom teacher dan mentor PC Activity.

## 6. Academic

Menu Academic memiliki beberapa sub menu.

### Academic Years

Digunakan untuk membuat dan mengelola tahun ajaran.

Catatan:

- Hanya satu academic year yang boleh aktif jika aturan backend membatasi status aktif.
- Academic year dipakai untuk class, enrollment, dan NIS generation.

### Grades

Digunakan untuk mengelola grade level.

Catatan:

- Level grade mempengaruhi NIS generation.
- Kindergarten memakai unit code Kindergarten.
- Elementary memakai level 1 sampai 6.
- Junior High memakai level 7 sampai 9.

### Classes

Digunakan untuk mengelola class per academic year.

Fitur utama:

- Membuat class.
- Mengatur grade.
- Mengatur academic year.
- Mengatur homeroom teacher.
- Melihat kapasitas dan jumlah enrollment aktif.
- Melihat Teacher History untuk riwayat wali kelas.

Homeroom teacher hanya dapat dipilih dari employee aktif dengan job level teaching role.

### Enrollments

Digunakan untuk mengelola class history siswa.

Fitur utama:

- **Create Enrollment**: Mendaftarkan siswa ke kelas aktif untuk tahun ajaran tertentu.
- **Promote Student**: Kenaikan kelas siswa ke jenjang/grade berikutnya.
- **Transfer Student**: Memindahkan kelas siswa dalam tahun ajaran yang sama.
- **Close Enrollment**: Menutup status enrollment (misal karena lulus, pindah sekolah/transfer, atau mengundurkan diri/withdrawn).
- **Soft Delete & Restore**: Menghapus atau memulihkan riwayat enrollment.
- **Bulk Enrollment**: Mendaftarkan banyak siswa sekaligus ke satu kelas yang sama.
- **Bulk Promotion**: Menaikkan kelas banyak siswa sekaligus ke jenjang/kelas baru dalam tahun ajaran baru secara massal.

Student akan menjadi `ACTIVE` setelah memiliki enrollment class yang valid.

## 7. Master Data

Menu Master Data dipakai untuk data referensi yang bukan enum dan dapat dikelola oleh admin.

Sub menu:

- Units.
- Job Positions.
- Job Levels.
- Buildings.

Job Levels memiliki toggle `Teaching role`. Gunakan toggle ini untuk role seperti teacher atau SE teacher agar muncul sebagai pilihan homeroom teacher dan PC Activity mentor.

## 8. Access Management

Menu Access hanya tersedia untuk SUPER_ADMIN.

### Admin Users

Fitur:

- Promote employee menjadi admin.
- Demote admin.
- Reactivate admin dengan promote ulang.
- Mengatur role.
- Mengatur can write data.
- Mengatur can view sensitive data.
- Grant after-hours write access.

### Working Saturdays

Digunakan untuk membuka akses tulis pada hari Sabtu tertentu jika sekolah tetap bekerja.

### After-hours Grant

Grant after-hours memberi waktu tambahan untuk admin tertentu agar bisa menulis data di luar jam kerja.

## 9. API Clients

Menu API Clients digunakan untuk integrasi aplikasi internal seperti Daily Check-in, MTSS, Reading Buddy, dan Exima.

Fitur:

- Create API client.
- Pilih scope.
- Copy token saat token pertama kali dibuat.
- Rotate token.
- Revoke token.
- Lihat token prefix dan last used.
- Lihat internal API reference.
- Test internal API request dengan Bearer token.

Token hanya ditampilkan saat create atau rotate. Simpan token di secret manager aplikasi internal, bukan di dokumen publik.

## 10. Audit Logs

Menu Audit Logs menampilkan riwayat aktivitas penting.

Tabel utama menampilkan:

- Time.
- Action.
- Source.
- Actor.
- Entity.

Klik row atau View Details untuk melihat detail perubahan, termasuk before/after values.

Audit log dipakai untuk:

- Melacak perubahan data.
- Melacak role/access change.
- Melacak import/export.
- Melacak API client activity.
- Melacak blocked unauthorized access.

## 11. Import dan Export

Import dan export tidak memakai halaman terpisah. Tombol tersedia langsung di page Students dan Employees.

### Import

Alur import:

1. Klik Import.
2. Upload CSV atau Excel.
3. **Pilihan Sheet (Tab)**: Jika file Excel Anda memiliki beberapa sheet/tab, Anda dapat memilih sheet spesifik berdasarkan **Nama Sheet** atau **Index Sheet** (dimulai dari 0). Jika dikosongkan, sheet pertama akan terpilih secara default.
4. Sistem membaca file dan menampilkan preview.
5. Jika ada field error, edit cell langsung di preview.
6. Revalidate.
7. Commit jika semua row valid.
8. Rollback jika perlu membatalkan import yang sudah committed.

Student import:

- NIS boleh kosong.
- Jika NIS kosong, backend generate otomatis.
- Jika NIS diisi, sistem menganggap itu data migrasi dan memvalidasi pola NIS.
- Entry Type wajib untuk create student.

Employee import:

- Employee ID wajib.
- Unit, job position, job level, building, join date, employment type, dan marital status perlu sesuai master data atau enum.

### Export

Export tersedia dari page Students dan Employees.

Format:

- CSV.
- Excel.

Export mengikuti filter yang sedang dipakai di halaman.

## 12. Error Umum

### Login gagal karena unauthorized

Kemungkinan:

- Email belum dipromosikan menjadi admin.
- Admin sudah demoted.
- Email tidak berada di allowed domain.
- Google OAuth client ID atau redirect URI tidak cocok.

### Tidak bisa upload consent attachment

Kemungkinan:

- MinIO belum berjalan.
- `MINIO_ACCESS_KEY` atau `MINIO_SECRET_KEY` kosong.
- Bucket belum tersedia.
- Backend belum direstart setelah env diubah.

### Mentor PC Activity invalid

Mentor harus:

- Employee aktif.
- Job level memiliki `is_teaching_role = true`.

### NIS import error

Jika data baru, kosongkan NIS dan isi Entry Type. Jika membawa NIS lama, pastikan academic year, grade, dan entry type cocok dengan pola NIS.

## 13. Checklist Operasional

Sebelum dipakai admin:

- Google OAuth FE dan BE sudah konsisten.
- Database aktif.
- MinIO aktif jika menggunakan attachment.
- SUPER_ADMIN tersedia.
- Master data dasar sudah dibuat.
- Academic year dan grade sudah siap.
- Job level teaching role sudah ditandai.
- API client token sudah diberikan ke aplikasi internal yang membutuhkan.
