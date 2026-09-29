# PC Activity Staging Migration Audit

Runbook ini dipakai untuk memeriksa data PC Activity lama sebelum room-based PC Activity migrations dikirim ke staging atau production.

## Status Saat Ini

Hasil pemeriksaan awal staging:

```text
Database: mws-center
Environment: staging

Total PC Activity assignments: 1600
Live assignments: 1600
Removed assignments: 0

PC Activity Room migration: belum applied
Class PC Activity migration: belum applied
Room class scope migration: belum applied
Room integrity rollover migration: belum applied
```

Schema staging saat ini belum memiliki:

```text
class_passion_connection_activities
pc_activity_rooms
pc_activity_room_classes
passion_connection_activities.class_activity_id
passion_connection_activities.room_id
```

Jangan push atau deploy room-based PC Activity migrations sebelum audit dan perbaikan migration selesai.

## Aturan Keselamatan

- Jalankan query pada staging terlebih dahulu.
- Jangan menjalankan `prisma migrate deploy` selama audit.
- Jangan menjalankan `UPDATE`, `DELETE`, `INSERT`, `ALTER`, `DROP`, atau `TRUNCATE`.
- Jangan mengirim database URL, password, student ID, atau nama student ke chat.
- Kirim hasil berupa jumlah agregat saja.
- Jangan memakai `COMMIT`. Tutup audit dengan `ROLLBACK`.

## 1. Masuk ke Database Staging

Di Komodo, buka terminal service `db`, lalu jalankan:

```bash
psql -U root -d mws-center
```

Prompt yang berhasil biasanya terlihat seperti:

```text
mws-center=#
```

## 2. Mulai Transaksi Read-only

```sql
BEGIN TRANSACTION READ ONLY;
```

Pastikan mode read-only aktif:

```sql
SHOW transaction_read_only;
```

Hasilnya harus:

```text
on
```

Jika prompt berubah menjadi `mws-center=!#` setelah query error, jalankan:

```sql
ROLLBACK;
BEGIN TRANSACTION READ ONLY;
```

Gunakan `COUNT(*)`, bukan `COUNT()`.

## 3. Assignment per Student dan Academic Year

Query ini menghitung student yang memiliki beberapa assignment dalam academic year yang sama, assignment pada beberapa hari, dan duplicate pada hari yang sama.

```sql
SELECT
  (
    SELECT COUNT(*)
    FROM (
      SELECT student_id, academic_year_id
      FROM passion_connection_activities
      WHERE deleted_at IS NULL
      GROUP BY student_id, academic_year_id
      HAVING COUNT(*) > 1
    ) affected
  ) AS affected_student_years,
  (
    SELECT COUNT(*)
    FROM (
      SELECT student_id, academic_year_id
      FROM passion_connection_activities
      WHERE deleted_at IS NULL
      GROUP BY student_id, academic_year_id
      HAVING COUNT(DISTINCT day) > 1
    ) affected
  ) AS student_years_with_multiple_days,
  (
    SELECT COUNT(*)
    FROM (
      SELECT student_id, academic_year_id, day
      FROM passion_connection_activities
      WHERE deleted_at IS NULL
      GROUP BY student_id, academic_year_id, day
      HAVING COUNT(*) > 1
    ) conflicts
  ) AS conflicting_same_day_slots;
```

Catat:

```text
affected_student_years:
student_years_with_multiple_days:
conflicting_same_day_slots:
```

Interpretasi:

- `affected_student_years > 0`: ada student dengan beberapa assignment dalam satu academic year.
- `student_years_with_multiple_days > 0`: migration one-per-year akan menghapus assignment berbeda hari yang sebenarnya valid pada model final.
- `conflicting_same_day_slots > 0`: ada duplicate yang benar-benar melanggar aturan final.

## 4. Prediksi Assignment yang Akan Dihapus

Migration `20260923000004_fix_pc_activity_one_per_year` mempertahankan satu assignment paling awal dan soft-delete sisanya. Query ini hanya menghitung dampaknya.

```sql
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY student_id, academic_year_id
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM passion_connection_activities
  WHERE deleted_at IS NULL
)
SELECT COUNT(*) AS assignments_that_would_be_removed
FROM ranked
WHERE row_number > 1;
```

Catat:

```text
assignments_that_would_be_removed:
```

Jika hasilnya lebih dari nol, migration tersebut tidak boleh dijalankan tanpa perbaikan.

## 5. Mapping Assignment ke Semua Enrollment

Query ini memeriksa apakah assignment lama dapat dipetakan ke class melalui enrollment student pada academic year yang sama. Semua status enrollment dipakai karena historical enrollment mungkin sudah `COMPLETED` atau `TRANSFERRED`.

```sql
WITH enrollment_counts AS (
  SELECT
    pca.id AS assignment_id,
    COUNT(sce.id) AS enrollment_count
  FROM passion_connection_activities pca
  LEFT JOIN student_class_enrollments sce
    ON sce.student_id = pca.student_id
   AND sce.academic_year_id = pca.academic_year_id
   AND sce.deleted_at IS NULL
  WHERE pca.deleted_at IS NULL
  GROUP BY pca.id
)
SELECT
  COUNT(*) FILTER (
    WHERE enrollment_count = 0
  ) AS assignments_without_enrollment,
  COUNT(*) FILTER (
    WHERE enrollment_count = 1
  ) AS assignments_with_one_enrollment,
  COUNT(*) FILTER (
    WHERE enrollment_count > 1
  ) AS assignments_with_multiple_enrollments
FROM enrollment_counts;
```

Catat:

```text
assignments_without_enrollment:
assignments_with_one_enrollment:
assignments_with_multiple_enrollments:
```

Interpretasi:

- `assignments_with_one_enrollment`: dapat dipetakan otomatis ke class.
- `assignments_without_enrollment`: perlu fallback atau review manual.
- `assignments_with_multiple_enrollments`: mapping ambigu dan perlu direview.

## 6. Mapping Assignment ke Active Enrollment

```sql
WITH enrollment_counts AS (
  SELECT
    pca.id AS assignment_id,
    COUNT(sce.id) AS enrollment_count
  FROM passion_connection_activities pca
  LEFT JOIN student_class_enrollments sce
    ON sce.student_id = pca.student_id
   AND sce.academic_year_id = pca.academic_year_id
   AND sce.enrollment_status = 'ACTIVE'
   AND sce.deleted_at IS NULL
  WHERE pca.deleted_at IS NULL
  GROUP BY pca.id
)
SELECT
  COUNT(*) FILTER (
    WHERE enrollment_count = 0
  ) AS assignments_without_active_enrollment,
  COUNT(*) FILTER (
    WHERE enrollment_count = 1
  ) AS assignments_with_one_active_enrollment,
  COUNT(*) FILTER (
    WHERE enrollment_count > 1
  ) AS assignments_with_multiple_active_enrollments
FROM enrollment_counts;
```

Catat:

```text
assignments_without_active_enrollment:
assignments_with_one_active_enrollment:
assignments_with_multiple_active_enrollments:
```

## 7. Assignment yang Tidak Bisa Dipetakan

```sql
SELECT COUNT(*) AS unmappable_live_assignments
FROM passion_connection_activities pca
WHERE pca.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM student_class_enrollments sce
    WHERE sce.student_id = pca.student_id
      AND sce.academic_year_id = pca.academic_year_id
      AND sce.deleted_at IS NULL
  );
```

Catat:

```text
unmappable_live_assignments:
```

Assignment ini tidak boleh dibiarkan menjadi `room_id = NULL` tanpa migration workflow.

## 8. Estimasi Room yang Perlu Dibuat

Room legacy dapat dibentuk berdasarkan kombinasi activity, academic year, day, dan class.

```sql
SELECT COUNT(*) AS potential_room_count
FROM (
  SELECT DISTINCT
    pca.activity_id,
    pca.academic_year_id,
    pca.day,
    sce.class_id
  FROM passion_connection_activities pca
  JOIN student_class_enrollments sce
    ON sce.student_id = pca.student_id
   AND sce.academic_year_id = pca.academic_year_id
   AND sce.deleted_at IS NULL
  WHERE pca.deleted_at IS NULL
) potential_rooms;
```

Catat:

```text
potential_room_count:
```

## 9. Distribusi Assignment per Academic Year

```sql
SELECT
  ay.name AS academic_year,
  COUNT(*) AS assignment_count
FROM passion_connection_activities pca
JOIN academic_years ay
  ON ay.id = pca.academic_year_id
WHERE pca.deleted_at IS NULL
GROUP BY ay.id, ay.name, ay.start_date
ORDER BY ay.start_date;
```

## 10. Distribusi Assignment per Hari

```sql
SELECT
  day,
  COUNT(*) AS assignment_count
FROM passion_connection_activities
WHERE deleted_at IS NULL
GROUP BY day
ORDER BY day;
```

## 11. Distribusi Assignment per Activity

```sql
SELECT
  mpa.name AS activity_name,
  COUNT(*) AS assignment_count
FROM passion_connection_activities pca
JOIN master_pc_activities mpa
  ON mpa.id = pca.activity_id
WHERE pca.deleted_at IS NULL
GROUP BY mpa.id, mpa.name
ORDER BY assignment_count DESC;
```

## 12. Status Student yang Memiliki Assignment

```sql
SELECT
  s.status,
  COUNT(*) AS assignment_count
FROM passion_connection_activities pca
JOIN students s
  ON s.id = pca.student_id
WHERE pca.deleted_at IS NULL
GROUP BY s.status
ORDER BY s.status;
```

## 13. Default Mentor

Schema staging masih menggunakan employee-only default mentor.

```sql
SELECT
  COUNT(*) AS default_mentor_count,
  COUNT(*) FILTER (
    WHERE mentor_id IS NULL
  ) AS invalid_default_mentors
FROM pc_activity_default_mentors;
```

Catat:

```text
default_mentor_count:
invalid_default_mentors:
```

## 14. Mentor Mutation History

```sql
SELECT
  COUNT(*) AS mentor_history_count,
  COUNT(*) FILTER (
    WHERE deleted_at IS NULL
  ) AS live_history_rows,
  COUNT(*) FILTER (
    WHERE deleted_at IS NULL
      AND end_date IS NULL
  ) AS open_mentor_history,
  COUNT(*) FILTER (
    WHERE deleted_at IS NULL
      AND end_date IS NOT NULL
  ) AS closed_mentor_history,
  COUNT(*) FILTER (
    WHERE deleted_at IS NOT NULL
  ) AS removed_mentor_history
FROM pc_activity_mentor_mutation_histories;
```

Catat:

```text
mentor_history_count:
live_history_rows:
open_mentor_history:
closed_mentor_history:
removed_mentor_history:
```

## 15. Master Activity dan Unit Scope

```sql
SELECT
  (
    SELECT COUNT(*)
    FROM master_pc_activities
  ) AS master_activity_count,
  (
    SELECT COUNT(*)
    FROM master_pc_activity_units
  ) AS activity_unit_scope_count,
  (
    SELECT COUNT(*)
    FROM master_pc_activities mpa
    WHERE NOT EXISTS (
      SELECT 1
      FROM master_pc_activity_units scope
      WHERE scope.activity_id = mpa.id
    )
  ) AS activities_without_unit_scope;
```

Catat:

```text
master_activity_count:
activity_unit_scope_count:
activities_without_unit_scope:
```

## 16. Active Academic Year

```sql
SELECT COUNT(*) AS active_academic_years
FROM academic_years
WHERE status = 'ACTIVE';
```

Hasil ideal:

```text
active_academic_years = 1
```

## 17. Akhiri Audit

```sql
ROLLBACK;
```

Keluar dari PostgreSQL:

```text
\q
```

## Template Hasil

```text
Environment: staging

total_assignments: 1600
live_assignments: 1600
removed_assignments: 0

affected_student_years:
student_years_with_multiple_days:
conflicting_same_day_slots:
assignments_that_would_be_removed:

assignments_without_enrollment:
assignments_with_one_enrollment:
assignments_with_multiple_enrollments:

assignments_without_active_enrollment:
assignments_with_one_active_enrollment:
assignments_with_multiple_active_enrollments:

unmappable_live_assignments:
potential_room_count:

default_mentor_count:
invalid_default_mentors:

mentor_history_count:
live_history_rows:
open_mentor_history:
closed_mentor_history:
removed_mentor_history:

master_activity_count:
activity_unit_scope_count:
activities_without_unit_scope:

active_academic_years:
```

## Keputusan Setelah Audit

### Jangan Deploy Jika

- `assignments_that_would_be_removed > 0`.
- `student_years_with_multiple_days > 0`.
- `conflicting_same_day_slots > 0` belum diselesaikan.
- `assignments_without_enrollment > 0` belum memiliki fallback.
- `assignments_with_multiple_enrollments > 0` belum direview.
- Mentor history belum ditentukan cara migrasinya.

### Migration yang Harus Diperbaiki

1. Jangan mengandalkan `class_passion_connection_activities` untuk staging karena tabel tersebut belum ada dan migration hanya akan membuatnya kosong.
2. Jangan jalankan cleanup one-per-year yang soft-delete assignment berbeda hari.
3. Bentuk room dari existing assignment dan enrollment student.
4. Isi unit, grade, dan class scope dari enrollment.
5. Hubungkan setiap assignment ke room hasil mapping.
6. Buat exception report untuk assignment tanpa enrollment atau mapping ambigu.
7. Jangan drop source mapping sampai reconciliation selesai.
8. Gunakan mentor mutation history untuk mentor room jika mapping dapat ditentukan dengan aman.
9. Hentikan `IMPORT_LEGACY` agar tidak membuat assignment tanpa room baru.
10. Rehearse migration pada clone database staging sebelum menjalankannya pada staging asli.

## Deployment Gate

Room migration hanya boleh diteruskan setelah:

- Backup staging dibuat dan restore-nya diuji.
- Migration berhasil dijalankan pada clone database staging.
- Total history assignment sebelum dan sesudah sama.
- Tidak ada live assignment tanpa room, kecuali exception yang disetujui.
- Tidak ada assignment valid yang berubah menjadi removed.
- Unit, grade, dan class scope room terisi sesuai enrollment lama.
- Mentor history sudah dipertahankan atau exception-nya didokumentasikan.
- Startup expiration sweep tidak akan mengubah data lama secara tidak terkontrol.
