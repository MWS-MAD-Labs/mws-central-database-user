# Intern Workforce Assignment Roadmap

Dokumen ini mencatat gap dan rencana implementasi agar intern dapat diperlakukan sebagai workforce member pada assignment akademik, tanpa mengubah intern menjadi employee secara data model.

Branch utama pekerjaan:

```text
feat/intern-workforce-assignments
```

Baseline commit yang sudah masuk:

```text
2d8f6bfb merge:prior central workflow into workforce
71f873bb feat:class assignments support interns
e77cc368 fix:render intern class teachers
```

## Tujuan Bisnis

Intern harus dapat menjalankan fungsi operasional yang sama dengan employee ketika memang ditugaskan oleh sekolah:

- Mengajar di class.
- Menjadi supporting homeroom teacher.
- Menjadi subject teacher.
- Menjadi Special Education teacher untuk student.
- Menjadi PC Activity mentor.
- Memiliki riwayat assignment dan perubahan yang dapat diaudit.

Intern tetap merupakan entity terpisah dari employee karena field identitas dan lifecycle-nya berbeda.

## Keputusan Role Class

Satu class hanya memiliki satu `HOMEROOM` utama dari employee.

Intern tidak boleh menjadi `HOMEROOM` utama. Intern dapat menjadi:

- `SUPPORTING_HOMEROOM`
- `SUBJECT_TEACHER`

Contoh tampilan yang diharapkan:

```text
Teacher             Type       Role
Dummy Staff         Employee   Homeroom
Intern Teacher      Intern     Supporting Homeroom
```

Aturan ini mencegah dua homeroom utama dalam satu class, tetapi tetap mendukung intern yang ikut menangani class.

## Yang Sudah Selesai

### Class Assignment Schema

Migration class assignment sudah menambahkan target intern:

- `class_teacher_assignments.employee_id` menjadi nullable.
- `class_teacher_assignments.intern_id` ditambahkan.
- Foreign key `intern_id -> interns.id` ditambahkan.
- Check constraint memastikan tepat satu target workforce terisi.
- Index `intern_id` ditambahkan.

### Class Assignment Backend

Class assignment request dapat membawa salah satu:

```json
{
  "employee_id": "...",
  "role": "HOMEROOM"
}
```

atau:

```json
{
  "intern_id": "...",
  "role": "SUPPORTING_HOMEROOM"
}
```

Backend sudah memvalidasi intern sebagai berikut:

- Intern harus ada.
- Intern tidak soft-deleted.
- Status intern harus `ACTIVE`.
- `end_date` belum lewat.
- Job position harus teaching-eligible.
- Unit intern harus sama dengan unit class.
- Intern tidak boleh memakai role `HOMEROOM`.

### Class Assignment UI

Class detail sekarang memuat active interns bersama teaching employees.

Selector assignment mendukung:

- Staff/employee.
- Intern.

Nama intern diarahkan ke:

```text
/interns/:internId
```

Nama employee tetap diarahkan ke:

```text
/employees/:employeeId
```

Class summary menggunakan `workforce_member` agar tidak crash ketika assignment tidak memiliki `employee`.

## Gap Yang Belum Selesai

## 1. Student Support / SE Assignment

Saat ini `StudentSupportAssignment` hanya memiliki:

```prisma
employee_id String
```

Yang perlu dilakukan:

- Tambah `intern_id` nullable.
- Tambah check constraint exactly-one-target.
- Tambah relation `Intern.student_assignments`.
- Ubah request menjadi employee/intern target.
- Ubah response menjadi `workforce_member`.
- Update eligibility agar intern memakai job position.
- Validasi status `ACTIVE` dan end date intern.
- Validasi unit student dan intern.
- Update student detail support selector.
- Update employee/intern assignment panels.
- Update caseload response agar tidak hanya `employee_id`.
- Update active support lookup yang dipakai enrollment/class UI.

Eligibility intern untuk SE:

- Job position harus `Special Education Teacher` atau capability khusus yang setara.
- Unit harus sama dengan unit student.
- Internship belum selesai.

## 2. PC Activity Mentor

Saat ini model berikut hanya menunjuk employee:

- `PCActivityDefaultMentor.mentor_id`
- `PCActivityMentorMutationHistory.mentor_id`

Yang perlu dilakukan:

- Tambah `intern_id` nullable pada kedua model.
- Tambah exactly-one-target constraint.
- Update set, clear, list, dan rollback mentor.
- Update mentor response menjadi workforce response.
- Update `resolveMentorForActivity` agar dapat membaca employee atau intern.
- Update mentor selector pada Master Data.
- Update mentor history panel.
- Update employee/intern detail mentorship panel.

Eligibility intern untuk PC Activity:

- Status `ACTIVE`.
- End date belum lewat.
- Job position memiliki capability mentor.
- Unit sesuai dengan unit activity.

## 3. Intern Mutation History

Intern belum memiliki mutation history. Employee memiliki history untuk:

- Unit.
- Job position.
- Job level.
- Building.
- Status.
- Employment type.

Intern tidak memiliki job level dan employment type, sehingga history intern sebaiknya hanya mencakup:

- Unit.
- Job position.
- Building.
- Status.

Model yang dibutuhkan:

```prisma
enum InternMutationField {
  UNIT
  JOB_POSITION
  BUILDING
  STATUS
}

model InternMutationHistory {
  id                  String @id @default(cuid())
  intern_id           String
  field               InternMutationField
  unit_id             String?
  job_position_id     String?
  building_id         String?
  status              InternStatus?
  start_date          DateTime
  end_date            DateTime?
  previous_history_id String?
  deleted_at          DateTime?
}
```

Endpoint yang diperlukan:

- `GET /api/admin/interns/:id/mutation-history`
- `PATCH /api/admin/interns/:id/mutation-history/:historyId/rollback`

## 4. Intern Detail Page

Intern detail belum memiliki panel relasi seperti employee.

Panel yang perlu ditambahkan:

- Teaching Assignments.
- Student Support Assignments.
- PC Activity Mentorships.
- Mutation History.

Panel harus menggunakan response workforce yang sama agar nama dan link konsisten.

## 5. Lifecycle Guard

Intern yang masih memiliki assignment aktif tidak boleh diselesaikan atau di-archive.

Saat `end_date` lewat, status otomatis menjadi `COMPLETED` hanya jika tidak ada assignment aktif.

Jika masih ada assignment aktif, response harus menjelaskan:

```text
Cannot complete this intern: 2 active assignments remain. End or reassign them first.
```

Archive juga harus ditolak:

```text
Cannot archive this intern: 1 active class assignment remains. End or remove it first.
```

Guard harus berlaku untuk:

- Single archive.
- Bulk archive.
- Update end date.
- Update status.
- Update unit.
- Update job position.

## 6. Workforce Response Adapter

Response class yang baru sudah memiliki metadata `workforce_member`, tetapi beberapa consumer lama masih mengandalkan `assignment.employee`.

Semua consumer berikut harus diaudit:

- Class list.
- Class detail.
- Teacher assignment section.
- Employee teaching assignment panel.
- Student API support contacts.
- Internal class teacher assignment API.
- Bulk move teacher assignments.
- Audit log snapshots.

Untuk compatibility sementara, response dapat membawa dua bentuk:

```json
{
  "workforce_member": {
    "id": "...",
    "type": "INTERN",
    "full_name": "Intern Teacher"
  },
  "employee": null
}
```

Setelah semua consumer migrated, field legacy dapat dipertimbangkan untuk dihapus pada major API change.

## 7. API Internal

Endpoint internal yang perlu diperbarui:

- Class teacher assignment read.
- Student support assignment read.
- Student support contacts.
- Workforce lookup jika dibutuhkan aplikasi internal.

Response harus menyertakan:

- `member_type` atau `workforce_member.type`.
- `member_id`.
- `full_name`.
- Email.
- Unit.
- Job position.

Jangan mengembalikan `employee_id` kosong sebagai satu-satunya cara membedakan intern. Gunakan type discriminator yang eksplisit.

## 8. Archive dan Restore

Sudah ada guard archive employee. Guard yang sama harus diterapkan untuk intern setelah SE dan PC relation tersedia.

Restore tidak boleh langsung mengaktifkan assignment lama secara otomatis. Assignment yang sudah ended atau removed tetap mengikuti history-nya.

Jika intern di-restore:

- Intern kembali ke status sebelumnya atau `ACTIVE` sesuai policy yang dipakai saat ini.
- Assignment historis tetap historis.
- Assignment baru harus dibuat melalui flow normal.

## 9. Import dan Export

Import intern belum mendukung assignment.

Jika assignment intern akan diimport, perlu format eksplisit:

```text
member_type
member_id
class_id
role
subject
```

Jangan menggunakan `employee_id` untuk menyimpan intern karena akan membingungkan sistem dan audit.

Export class roster/teacher assignment juga perlu menampilkan:

- Member Name.
- Member Type.
- Employee ID jika employee.
- Role.
- Subject.
- Start Date.
- End Date.

## 10. Permission dan Audit

Assignment class sekarang menggunakan permission employee untuk teacher assignment. Untuk intern target, permission tetap sebaiknya memakai domain employee/workforce assignment, bukan membuat permission baru.

Audit assignment harus mencatat:

```json
{
  "member_type": "INTERN",
  "member_id": "...",
  "member_name": "Intern Teacher",
  "class_id": "...",
  "role": "SUPPORTING_HOMEROOM"
}
```

Audit harus berlaku untuk:

- Assign.
- End.
- Remove.
- Reopen.
- Bulk move.
- Lifecycle block.

## Urutan Implementasi

### Phase 1: Class Assignment

Status: sedang dikerjakan.

- Schema `intern_id`.
- Migration.
- Employee/intern target request.
- Eligibility.
- Supporting homeroom dan subject teacher.
- UI selector.
- Workforce response.
- Class summary renderer.
- Regression tests.

### Phase 2: Class Assignment Hardening

- Update semua response lama.
- Update internal API.
- Update bulk move.
- Update employee/intern detail panels.
- Tambahkan audit metadata.
- Test clean database migration.

### Phase 3: SE Assignment

- Schema intern target.
- Service eligibility.
- Student selector.
- Caseload.
- Detail panels.
- Lifecycle guards.

### Phase 4: PC Activity Mentor

- Schema intern target.
- Default mentor service.
- Mutation history.
- Master Data selector.
- Detail panels.
- Lifecycle guards.

### Phase 5: Intern Mutation History

- Schema history.
- Service.
- Controllers/routes.
- Detail page panel.
- Rollback.
- Audit.

### Phase 6: Lifecycle and Data Operations

- Archive guard.
- Completion guard.
- Restore behavior.
- Import/export.
- Internal API.
- Full regression test.

## Test Matrix

### Class

- Employee `HOMEROOM` tetap berhasil.
- Intern `HOMEROOM` ditolak.
- Intern `SUPPORTING_HOMEROOM` berhasil.
- Intern `SUBJECT_TEACHER` berhasil.
- Intern yang sudah expired ditolak.
- Intern unit berbeda ditolak.
- Job position non-teaching ditolak.
- Duplicate assignment ditolak.
- End assignment intern berhasil.
- Reopen assignment intern berhasil.
- Remove assignment intern berhasil.
- Bulk move employee tetap berhasil.
- Bulk move intern berhasil.

### SE

- Employee SE existing tidak berubah.
- Intern SE satu unit berhasil.
- Intern SE beda unit ditolak.
- Intern expired ditolak.
- End/remove/reopen berhasil.
- Caseload menampilkan type member.

### PC Mentor

- Employee mentor existing tidak berubah.
- Intern mentor eligible berhasil.
- Intern beda unit ditolak.
- Intern expired ditolak.
- Set, clear, replace, dan rollback berhasil.

### Lifecycle

- Intern dengan class assignment aktif tidak dapat selesai.
- Intern dengan SE assignment aktif tidak dapat selesai.
- Intern dengan PC mentor aktif tidak dapat selesai.
- Archive single dan bulk memblokir assignment aktif.
- Restore tidak mengaktifkan kembali assignment historis secara otomatis.

## Risiko dan Mitigasi

### Risiko: Employee response lama rusak

Mitigasi:

- Tambahkan `workforce_member` tanpa langsung menghapus field lama.
- Migrate consumer satu per satu.
- Pertahankan test internal API employee.

### Risiko: Data assignment menjadi orphan

Mitigasi:

- Check constraint exactly-one-target.
- Foreign key ke employee/intern.
- Migration harus dijalankan pada database copy/test terlebih dahulu.

### Risiko: Intern yang sudah selesai tetap mengajar

Mitigasi:

- Semua assignment write mengecek status dan `end_date`.
- Completion/ archive mengecek assignment aktif.

### Risiko: Homeroom ganda

Mitigasi:

- Intern selalu ditolak untuk `HOMEROOM`.
- Employee tetap mengikuti cap existing.
- Supporting homeroom memakai role terpisah.

## Definition Of Done

Fitur workforce intern dianggap selesai jika:

- Intern dapat menjadi supporting homeroom dan subject teacher.
- Intern dapat menjadi SE teacher.
- Intern dapat menjadi PC mentor.
- Semua assignment memiliki end/remove/reopen flow.
- Semua response membedakan employee dan intern.
- Detail page intern menampilkan assignment panels.
- Archive/completion guard aktif.
- Internal API sudah diperbarui.
- Audit menyimpan member type dan member id.
- Migration berjalan dari database clean.
- Semua regression test employee tetap lulus.
- Semua test intern baru lulus.
- Client lint/build dan server typecheck lulus.
