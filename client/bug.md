# Bug Fix

## 1. Academic

### A. Enrollment Form

#### Student Dropdown

Pada form **Enrollment**, dropdown **Student** saat ini sudah menampilkan informasi berikut:

- Full Name
- NIS
- Grade
- Status

Apabila jumlah data student mencapai **10 data atau lebih**, dropdown harus menjadi **searchable** sehingga admin dapat mencari student dengan cepat berdasarkan **nama** maupun **NIS**.

---

### B. Class Form

#### Academic Year Dropdown

Pada dropdown **Academic Year**, tampilkan status dari setiap Academic Year agar lebih mudah dibedakan oleh admin.

Contoh:

- 2024/2025 *(Completed)*
- 2025/2026 *(Active)*
- 2026/2027 *(Upcoming)*

Status tersebut sebaiknya menggunakan badge atau warna yang berbeda sehingga admin dapat dengan mudah mengetahui status Academic Year yang dipilih.

---

### C. Enrollment Form - Class Dropdown

Pada dropdown **Class**, apabila jumlah data class mencapai **10 data atau lebih**, dropdown harus menjadi **searchable**.

Selain itu, tampilkan juga informasi kapasitas class sehingga admin dapat mengetahui sisa kuota sebelum memilih class.

Contoh:

```
Grade 7A
20/24 Students
```

atau

```
Grade 7A
Remaining: 4 Seats
```

Apabila kuota sudah penuh:

```
Grade 8B
24/24 Students (Full)
```

---

## 2. Employee Import & Student Import

### A. Import Preview

Sebelum proses import dilakukan, alur proses harus menjadi:

```
Upload Excel
      ↓
Preview
      ↓
Validation
      ↓
Import/Commit
```

Pada halaman **Preview**:

- Tampilkan seluruh data yang terdapat pada file Excel.
- Semua kolom harus ditampilkan sesuai isi file Excel, mulai dari kolom pertama hingga kolom terakhir.
- Semua row harus terlihat sehingga admin dapat melakukan pengecekan sebelum proses import dilakukan.

Untuk field yang berupa **Enum** pada database (misalnya **Job Status**, **Employment Status**, **Gender**, **Religion**, dan enum lainnya), gunakan dropdown seperti implementasi sebelumnya.

Nilai default dropdown harus mengikuti data yang terdapat pada file Excel sehingga admin tetap dapat melakukan perubahan apabila diperlukan.

---

### B. Validation Highlight

Saat proses validasi dijalankan:

- Row yang memiliki error harus diberikan highlight berwarna merah.
- Tampilkan pesan validasi pada row yang bermasalah.
- Row yang valid tetap menggunakan tampilan normal.

Apabila seluruh data valid, maka tidak ada row yang diberi highlight merah.

---

### C. Revalidate

Fitur **Revalidate** digunakan untuk memvalidasi kembali data setelah admin melakukan perbaikan.

Ketika tombol **Revalidate** ditekan:

- Seluruh data preview harus tetap ditampilkan.
- Jangan hanya menampilkan row yang memiliki error.
- Revalidate hanya memperbarui hasil validasi pada setiap row tanpa menghilangkan data lainnya.

Dengan demikian, admin tetap dapat melihat seluruh data selama proses pengecekan sehingga proses perbaikan menjadi lebih nyaman.

---

## 3. Global Improvement

Semua dropdown yang memiliki **10 data atau lebih** wajib menggunakan **searchable dropdown**.

Contohnya:

- Student
- Employee
- Class
- Academic Year
- Department
- Position
- Serta dropdown lain yang memiliki jumlah data cukup banyak.

Tujuannya agar admin tidak perlu melakukan scroll panjang ketika mencari data.

---

# Next Feature

Setelah seluruh bug dan improvement di atas selesai serta telah dipastikan berjalan dengan baik, barulah lanjut ke pengembangan fitur **Super Admin**.

---

# Notes

- Semua dropdown yang memiliki **10 data atau lebih** wajib mendukung fitur **search**.
- Terapkan aturan ini secara konsisten pada seluruh aplikasi, bukan hanya pada halaman yang disebutkan di atas.
- Prioritaskan penyelesaian seluruh bug terlebih dahulu sebelum mulai mengembangkan fitur baru.