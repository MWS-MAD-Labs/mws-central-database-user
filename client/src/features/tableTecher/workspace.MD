# Implementasi Academic Workspace — Spreadsheet-style MVP

Saya sedang mengembangkan fitur **Academic Workspace** di project MWS Central Database User.


Jangan membuat project baru. Jangan mengubah arsitektur existing secara besar-besaran. **Lanjutkan struktur yang sudah ada.**

---

## 1. Struktur folder saat ini

Di:

```text
client/src/features/tableTecher/
```

saya sudah membuat struktur:

```text
tableTecher/
├── api/
└── components/
    ├── academic/
    │   ├── api/
    │   ├── components/
    │   ├── pages/
    │   └── utils/
    │
    ├── enrollments/
    │   ├── api/
    │   ├── components/
    │   ├── pages/
    │   └── utils/
    │
    ├── grades/
    │   ├── api/
    │   ├── components/
    │   ├── pages/
    │   └── utils/
    │
    ├── students/
    │   ├── api/
    │   ├── components/
    │   ├── pages/
    │   └── utils/
    │
    ├── pages/
    │   └── WorkspaceTable.jsx
    │
    └── utils/
```

Saat ini `WorkspaceTable.jsx` sudah dipanggil dari `AcademicPage.jsx` ketika:

```text
/academic?tab=workspace
```

---

# 2. Konsep utama

Saya ingin membuat **Academic Workspace** yang pengalaman penggunaannya mirip dengan spreadsheet seperti Excel/Google Sheets.

Tujuan utamanya adalah membuat guru/admin bisa bekerja dengan data akademik secara cepat tanpa harus membuka banyak halaman CRUD/form.

Workspace ini **bukan database baru** dan bukan penggabungan tabel database.

Database/domain tetap terpisah:

```text
Students
Enrollments
Academic
Grades
```

Yang digabung adalah **pengalaman kerja di frontend**.

Konsepnya:

```text
Academic Workspace
│
├── Students
├── Enrollments
├── Academic
└── Grades
```

User bisa berpindah tab dari satu domain ke domain lainnya tanpa meninggalkan workspace.

---

# 3. Struktur Workspace yang diinginkan

`WorkspaceTable.jsx` akan menjadi **container utama / hero workspace**.

Kurang lebih layout-nya:

```text
┌───────────────────────────────────────────────────────────────┐
│                                                 [Fullscreen]  │
|                                                               |
│                                                               │ 
│ [Academic Year] [Grade] [Class]              [Search]         │
├───────────────────────────────────────────────────────────────┤
│ Students │ Enrollments │ Academic │ Grades                    │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                     ACTIVE WORKSPACE TABLE                    │
│                                                               │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Tab:

```text
Students
Enrollments
Academic
Grades
```

Untuk implementasi awal, **hanya Students yang perlu benar-benar dikerjakan**.

Tab lainnya boleh tetap berupa placeholder/component existing.

---

# 4. WorkspaceTable.jsx

`WorkspaceTable.jsx` bertanggung jawab sebagai orchestrator.

Tanggung jawabnya:

* Workspace header
* Fullscreen mode
* Workspace context/filter
* Tab navigation
* Menentukan tabel yang aktif
* Menampilkan active table

Contoh konsep:

```text
WorkspaceTable
│
├── Workspace Header
├── Context / Filter
├── Workspace Tabs
│
└── Active Table
      ├── TableStudents
      ├── TableEnroll
      ├── TableAcademic
      └── TableGrades
```

Jangan membuat semua API fetching di `WorkspaceTable`.

Fetching data tetap dilakukan oleh masing-masing domain/table.

---

# 5. Existing Table Components

Saya sudah memiliki component:

```text
students/pages/TableStudents.jsx
enrollments/pages/TableEnroll.jsx
academic/pages/TableAcademic.jsx
grades/pages/TableGrades.jsx
```

Saat ini `TableStudents.jsx` masih placeholder:

```jsx
export function TableStudents() {
    return (
        <div>INI UNTUK TAB STUDENT</div>
    )
}
```

Untuk tahap pertama, fokus implementasi hanya pada:

```text
TableStudents
```

Jangan menghapus component/domain lainnya.

---

# 6. Existing Student API

Saya sudah memiliki API:

```text
client/src/features/students/api/studentsApi.js
```

API tersebut memiliki:

```js
studentsApi.list(params)
studentsApi.get(id)
studentsApi.countTotal()
studentsApi.create(payload)
studentsApi.update(id, payload)
studentsApi.remove(id)
studentsApi.bulkRemove(ids)
studentsApi.restore(id)
studentsApi.bulkRestore(ids)
studentsApi.reissueNis(id, entryType)
```

Untuk Workspace Students, **gunakan:**

```js
studentsApi.list(params)
```

Jangan menggunakan:

```js
studentsApi.get(id)
```

untuk mengambil setiap student satu per satu.

Jangan membuat N+1 request.

---

# 7. Student Detail Page bukan Workspace

Project sudah memiliki `StudentDetailPage`.

StudentDetailPage digunakan untuk melihat **detail lengkap satu student**, seperti:

```text
Identity
Academic
Contact
Profile
Services
Enrollment History
Parents
Consent
Health
Vaccine
PC Activities
Support Assignment
```

Jangan memindahkan seluruh detail tersebut ke Workspace.

Workspace berbeda.

Workspace digunakan untuk melihat dan mengelola **banyak student dalam bentuk spreadsheet/grid**.

Jadi:

```text
StudentDetailPage
= detail satu student

TableStudents
= banyak student dalam workspace
```

---

# 8. Tahap pertama: API Debugging

Sebelum membuat spreadsheet grid yang kompleks, saya ingin mengetahui **response asli dari `studentsApi.list()`**.

Gunakan TanStack React Query.

Buat query kira-kira:

```js
const studentsQuery = useQuery({
    queryKey: ["workspace", "students"],
    queryFn: async () => {
        const response = await studentsApi.list({});

        console.log(
            "[Workspace Students] API response:",
            response
        );

        return response;
    },
});
```

Tambahkan debugging yang cukup jelas.

Saya ingin melihat di browser console:

```text
[Workspace Students] API response:
[Workspace Students] query:
[Workspace Students] error:
[Workspace Students] final response:
```

Gunakan `console.log` untuk response dan `console.error` untuk error.

Untuk tahap debugging ini, boleh juga tampilkan JSON response sementara di UI agar mudah melihat bentuk datanya.

Contoh:

```jsx
<pre>
    {JSON.stringify(response, null, 2)}
</pre>
```

Tujuannya **bukan final UI**, tetapi untuk mengetahui struktur response sebenarnya.

Jangan menebak struktur response hanya berdasarkan `StudentDetailPage`.

---

# 9. Setelah response diketahui

Setelah response API sudah diketahui, ubah `TableStudents` dari JSON debug menjadi spreadsheet-style table.

Jangan langsung membuat fitur kompleks seperti:

* IndexedDB
* autosave
* batch save
* undo/redo
* offline sync

pada tahap pertama.

Fokus dulu pada **read-only spreadsheet/grid**.

---

# 10. Bentuk awal TableStudents

Target awal:

```text

├────┬───────────────┬─────────┬────────┬─────────┬────────────┤
│ #  │ Student       │ NIS     │ Grade  │ Class   │ Status     │
├────┼───────────────┼─────────┼────────┼─────────┼────────────┤
│ 1  │ Ahmad         │ 123     │ Grade7 │ 7A      │ ACTIVE     │
│ 2  │ Budi          │ 124     │ Grade7 │ 7A      │ ACTIVE     │
│ 3  │ Citra         │ 125     │ Grade7 │ 7B      │ ACTIVE     │
└────┴───────────────┴─────────┴────────┴─────────┴────────────┘
```

Namun kolom **harus disesuaikan dengan response API sebenarnya**.

Jangan mengarang field yang tidak tersedia.

---

# 11. Spreadsheet behavior

Setelah read-only grid berhasil, tahap berikutnya adalah membuatnya terasa seperti spreadsheet.

Secara bertahap:

### Phase 1 — Read-only

* Render rows
* Render columns
* Horizontal scrolling
* Sticky header
* Proper column width
* Loading state
* Error state
* Empty state

### Phase 2 — Spreadsheet interaction

Tambahkan:

* Click cell
* Active cell
* Inline editing
* Keyboard navigation
* Enter
* Tab
* Arrow keys
* Copy
* Paste
* Multi-cell selection

### Phase 3 — Working state

Pisahkan:

```text
Original Data
Working Data
```

User mengedit:

```text
Original:
Ahmad → 7A

Working:
Ahmad → 7B
```

Perubahan **belum langsung dikirim ke server**.

### Phase 4 — Pending Changes

Track perubahan sebagai delta:

```js
{
    entity: "student",
    id: "student-id",
    field: "classId",
    oldValue: "7A",
    newValue: "7B"
}
```

Jangan menyimpan seluruh tabel sebagai pending changes.

### Phase 5 — Undo / Redo

Ctrl+Z dan Ctrl+Y dilakukan di frontend.

### Phase 6 — Batch Save

Nanti perubahan dikirim dalam satu batch:

```text
Frontend
    ↓
Pending Changes
    ↓
Batch API
    ↓
Server
    ↓
Database
```

Bukan satu HTTP request untuk setiap cell.

### Phase 7 — Offline support

Tahap paling akhir baru pertimbangkan:

```text
Working State
      ↓
IndexedDB
      ↓
Pending Sync Queue
      ↓
Internet kembali
      ↓
Batch API
```

---

# 12. Jangan implement backend dulu

Untuk pekerjaan sekarang, fokus hanya pada frontend.

Jangan membuat endpoint backend baru.

Jangan mengubah schema database.

Jangan mengubah API existing kecuali memang ditemukan masalah yang diperlukan untuk frontend.

Gunakan API existing:

```js
studentsApi.list()
```

---

# 13. State management

Untuk MVP awal, jangan langsung menambahkan global state yang kompleks.

Mulai dari:

```text
useQuery
    ↓
server data
    ↓
local component state
    ↓
working grid
```

Kalau nanti workspace sudah membutuhkan state lintas tab, undo/redo, pending changes, dan sync queue, baru pertimbangkan store khusus Workspace.

---

# 14. Jangan merusak existing Academic page

Saat ini `AcademicPage` memiliki tab:

```text
years
grades
classes
workspace
```

dan ketika:

```text
?tab=workspace
```

akan menampilkan:

```jsx
<WorkspaceTable />
```

Pertahankan behavior existing tersebut.

Workspace boleh memiliki UI/header sendiri karena Workspace adalah environment kerja yang berbeda dari halaman CRUD Academic biasa.

---

# 15. Tujuan akhir

Target akhirnya adalah:

```text
Academic Workspace
│
├── Context
│   ├── Academic Year
│   ├── Grade
│   └── Class
│
├── Toolbar
│   ├── Search
│   ├── Filter
│   ├── Sort
│   ├── Columns
│   ├── Bulk Actions
│   └── Import
│
├── Tabs
│   ├── Students
│   ├── Enrollments
│   ├── Academic
│   └── Grades
│
└── Spreadsheet Grid
    │
    ├── Inline Editing
    ├── Multi-cell Selection
    ├── Copy / Paste
    ├── Keyboard Navigation
    ├── Undo / Redo
    ├── Pending Changes
    ├── Batch Save
    └── Offline Sync
```

Namun **jangan implementasikan semuanya sekaligus**.

## Prioritas implementasi sekarang

Kerjakan dalam urutan:

```text
1. WorkspaceTable shell
        ↓
2. Workspace tabs
        ↓
3. TableStudents
        ↓
4. studentsApi.list()
        ↓
5. console.log response
        ↓
6. Tampilkan response sementara
        ↓
7. Identifikasi struktur data
        ↓
8. Buat read-only spreadsheet grid
        ↓
9. Baru lanjut inline editing
```

### Hal yang saya harapkan dari implementasi pertama

Setelah coding selesai:

1. `Academic Workspace` tampil sebagai workspace utama.
2. Tab `Students / Enrollments / Academic / Grades` bisa diganti.
3. Tab Students melakukan request menggunakan `studentsApi.list()`.
4. Console menampilkan response API dengan prefix `[Workspace Students]`.
5. Loading/error state tersedia.
6. Response sementara bisa dilihat di UI.
7. Belum ada autosave, IndexedDB, undo/redo, atau backend baru.
8. Existing Student Detail Page tetap tidak berubah.
9. Jangan melakukan request detail per student.
10. Setelah response API diketahui, gunakan field asli dari response tersebut untuk menentukan kolom grid.

**Mulai dari implementasi frontend tahap pertama ini. Jangan langsung membuat fitur spreadsheet kompleks sebelum struktur response `studentsApi.list()` berhasil diverifikasi.**
