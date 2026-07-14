# **Requirement List**

## **Centralized User Database**

---

# **1\. Latar Belakang**

Saat ini data siswa dan karyawan MWS dikelola menggunakan Google Sheet terpisah. Data siswa berada di satu Google Sheet, sedangkan data karyawan berada di Google Sheet lain.

Selain itu, MWS sudah memiliki beberapa aplikasi internal seperti:

* Daily Check-in  
* MTSS  
* Reading Buddy  
* Exima

Saat ini, masing-masing aplikasi masih memiliki database user sendiri-sendiri. Hal ini menimbulkan beberapa risiko:

* Data user tidak konsisten antar aplikasi  
* Perubahan data harus dilakukan di banyak tempat  
* Risiko data duplikat  
* Sulit mengetahui data mana yang paling benar  
* Sulit melakukan integrasi antar aplikasi  
* Sulit melakukan kontrol akses dan audit data secara terpusat

Karena itu, MWS membutuhkan satu aplikasi database pusat yang menjadi referensi utama untuk data siswa dan karyawan.

---

# **2\. Tujuan Aplikasi**

Aplikasi ini dikembangkan sebagai **centralized user database** untuk seluruh data siswa dan karyawan MWS.

Tujuan utama aplikasi:

1. Menjadi **single source of truth** untuk data siswa dan karyawan.  
2. Menggantikan proses update data utama yang sebelumnya dilakukan langsung di Google Sheet.  
3. Menyediakan admin panel agar user berwenang dapat mengelola data siswa dan karyawan dengan aman dan terstruktur.  
4. Menyediakan API agar aplikasi internal MWS dapat mengambil data user dari satu sumber yang sama.  
5. Mengurangi duplikasi database user di aplikasi-aplikasi internal.  
6. Menyediakan struktur data yang scalable untuk pengembangan aplikasi MWS di masa depan.  
7. Mendukung masa transisi dari Google Sheet ke aplikasi database pusat.  
8. Menyiapkan fondasi untuk kemungkinan integrasi Google Workspace di masa depan.

---

# **3\. Ruang Lingkup Pengembangan**

Pengembangan aplikasi dibagi menjadi dua kelompok besar:

## **3.1 MVP / Core Requirement**

MVP adalah fitur utama yang wajib dikembangkan terlebih dahulu.

MVP mencakup:

* Database siswa  
* Database karyawan  
* Admin login menggunakan Google Workspace / Google Sign-In  
* Role dan permission dasar  
* CRUD data siswa dan karyawan  
* Import data dari Google Sheet / CSV / Excel  
* Export data  
* Search, filter, sort, dan pagination  
* Status aktif / tidak aktif  
* Academic year dan class history  
* Consent status dan attachment surat yang sudah ditandatangani  
* Data kesehatan dan kebutuhan khusus  
* API untuk aplikasi internal  
* Integrasi fase pertama dengan Daily Check-in, MTSS, Reading Buddy, dan Exima  
* Sinkronisasi / transisi dengan Google Sheet selama masa migrasi  
* Audit log  
* Dokumentasi admin dan teknis  
* Internal hosting dan deployment sesuai standar internal MWS

## **3.2 Bonus Feature / Future Development**

Fitur berikut bukan bagian dari MVP utama dan dapat dikembangkan setelah aplikasi database pusat berjalan stabil:

* Sinkronisasi Google Workspace  
* Mapping data ke Google Workspace Organizational Unit  
* Mapping data ke Google Groups  
* Custom user fields di Google Workspace  
* Create akun Google Workspace dari aplikasi  
* Suspend akun Google Workspace  
* Offboarding workflow  
* Deletion queue  
* Penghapusan akun otomatis setelah grace period  
* Transfer ownership sebelum akun dihapus  
* Advanced account lifecycle management  
* Centralized authentication provider selain Google Sign-In  
* Student-facing portal  
* Parent-facing portal

---

# **4\. Prinsip Utama Sistem**

## **4.1 Single Source of Truth**

Aplikasi database pusat harus menjadi referensi utama untuk data siswa dan karyawan MWS.

Aplikasi lain seperti Daily Check-in, MTSS, Reading Buddy, Exima, dan aplikasi internal lain tidak boleh menyimpan data profil user utama secara terpisah.

Aplikasi lain hanya boleh menyimpan data yang spesifik terhadap fungsi aplikasi tersebut.

Contoh:

* Reading Buddy boleh menyimpan data reading level, reading log, assessment, dan progress membaca.  
* MTSS boleh menyimpan data intervention, observation, support plan, dan follow-up.  
* Daily Check-in boleh menyimpan data attendance, mood check-in, atau kehadiran harian.  
* Exima boleh menyimpan data yang spesifik terhadap fungsi aplikasinya.  
* Tetapi data nama siswa, email, status, kelas, grade, NIS, dan data identitas utama harus tetap mengambil dari database pusat.

## **4.2 ID Utama**

Setiap user harus memiliki identifier yang konsisten.

Untuk siswa:

* `NIS` digunakan sebagai identifier utama siswa.

Untuk karyawan:

* `Employee ID` digunakan sebagai identifier utama karyawan.

Sistem juga dapat membuat internal `user_id` untuk kebutuhan teknis, tetapi NIS dan Employee ID tetap harus disimpan dan dijaga keunikannya.

## **4.3 API-First Approach**

Karena aplikasi ini akan menjadi referensi untuk aplikasi lain, sistem harus dikembangkan dengan pendekatan API-first.

Artinya:

* Data tidak hanya bisa dilihat dari UI admin.  
* Data harus bisa diakses secara aman oleh aplikasi lain melalui API.  
* API harus terdokumentasi dengan baik.  
* API harus memiliki autentikasi, permission, access scope, dan rate limit.  
* Setiap existing app harus memiliki API client dan scope akses masing-masing.

## **4.4 Authentication Tetap Menggunakan Google Sign-In**

Aplikasi database pusat **tidak menjadi authentication provider** untuk aplikasi lain.

Authentication provider untuk aplikasi internal tetap menggunakan **Google Sign-In / Google Workspace account**.

Aplikasi database pusat berfungsi sebagai **user profile authority** setelah user berhasil login menggunakan Google.

Contoh flow:

1. User login ke Daily Check-in menggunakan Google Sign-In.  
2. Daily Check-in mendapatkan email user dari Google.  
3. Daily Check-in memanggil API database pusat dengan email tersebut.  
4. Database pusat mengembalikan data user, seperti user type, status, grade, class, unit, atau job position.  
5. Daily Check-in menggunakan data tersebut sesuai kebutuhan aplikasinya.

---

*    const updatedPerson \= await prismaClient.person.update({  
* it atau permission  
* Menambah data baru jika diberi izin  
* Mengubah data siswa atau karyawan sesuai scope  
* Menonaktifkan data siswa atau karyawan sesuai scope  
* Melakukan import data jika diberi izin  
* Melakukan export data jika diberi izin  
* Tidak dapat mengatur Super Admin  
* Tidak dapat menghapus permanen data

## **5.3 Viewer**

Hak akses Viewer:

* Melihat data sesuai permission  
* Menggunakan search dan filter  
* Tidak dapat menambah data  
* Tidak dapat mengubah data  
* Tidak dapat menghapus data  
* Tidak dapat melihat field sensitif jika tidak diberi akses

## **5.4 API Client / System Access**

API Client digunakan oleh aplikasi lain untuk mengakses data melalui API.

Karakteristik API Client:

* Tidak memiliki akses ke UI admin  
* Memiliki access token atau API credential  
* Access scope dibatasi sesuai kebutuhan aplikasi  
* Setiap aplikasi internal memiliki konfigurasi akses sendiri

Existing app yang harus didukung pada fase pertama:

* Daily Check-in  
* MTSS  
* Reading Buddy  
* Exima

---

# **6\. Authentication dan Login**

## **6.1 Login Admin**

Login admin ke aplikasi database pusat menggunakan Google Workspace / Google Sign-In.

Requirement:

* Admin panel harus mendukung login menggunakan akun Google Workspace MWS.  
* Hanya email/domain yang diizinkan yang boleh login.  
* Setelah login, sistem harus mengecek role user di database aplikasi.  
* User yang berhasil login Google tetapi tidak memiliki role admin tidak boleh mengakses admin panel.  
* Login event harus dicatat di audit log.  
* Failed login atau unauthorized access attempt harus dicatat.

## **6.2 Tidak Ada Login untuk Siswa**

Siswa tidak perlu login ke aplikasi database pusat.

Implikasi:

* Tidak perlu membuat student-facing portal untuk MVP.  
* Data siswa hanya dikelola oleh admin yang berwenang.  
* Akses siswa ke aplikasi lain tetap melalui aplikasi masing-masing.

## **6.3 Tidak Ada Login untuk Parent / Guardian**

Parent / guardian tidak memiliki akses login ke aplikasi database pusat.

Implikasi:

* Tidak perlu membuat parent portal dalam MVP.  
* Data parent/guardian hanya menjadi data referensi dan contact information.  
* Perubahan data parent/guardian dilakukan oleh admin yang berwenang.

## **6.4 Aplikasi Ini Bukan Authentication Provider**

Aplikasi database pusat tidak perlu membangun:

* OAuth provider  
* OpenID Connect provider  
* Central session provider  
* SSO provider untuk aplikasi lain

Aplikasi lain tetap menggunakan Google Sign-In.

Database pusat digunakan untuk:

* Validasi apakah email user terdaftar  
* Mengetahui apakah user masih aktif  
* Mengetahui user type  
* Mengambil profil user  
* Mengambil grade, class, unit, atau job position  
* Mengambil permission data sesuai kebutuhan aplikasi

---

# **7\. Modul Database Siswa**

Aplikasi harus menyediakan fitur untuk mengelola data siswa.

## **7.1 Field Data Siswa dari Google Sheet Saat Ini**

Data siswa yang tersedia saat ini:

* NIS  
* Photo ID  
* Full Name  
* Nick Name  
* Gender  
* Current status  
* Student MWS Email  
* Current grade, if Active  
* Class Name  
* Join Academic year  
* Leave year, if Graduated  
* SN  
* Join Grade  
* Graduation Grade  
* Previous School  
* NISN  
* Religion  
* Place, Date of birth  
* Father  
* Mother  
* Father’s Phone  
* Emails  
* Mother’s Phone  
* Address  
* Health Information  
* Blood Type  
* Special Needs, Psychological / Physical  
* Media consent sign  
* Media consent YES  
* Parent consent sign  
* PC Monday  
* PC Tuesday  
* PC Wednesday  
* PC Thursday

## **7.2 Struktur Field Siswa yang Disarankan**

Agar lebih rapi, field siswa sebaiknya dikelompokkan sebagai berikut.

### **A. Identitas Siswa**

* NIS  
* Photo ID  
* Full Name  
* Nick Name  
* Gender  
* Student MWS Email  
* NISN  
* Religion  
* Birth Place  
* Birth Date

Catatan:

Field `Place, Date of birth` dari spreadsheet lama harus dipisahkan menjadi:

* `birth_place`  
* `birth_date`

### **B. Status dan Akademik**

* Current Status  
* Current Grade  
* Current Class Name  
* Join Academic Year  
* Leave Year  
* SN  
* Join Grade  
* Graduation Grade  
* Previous School

Status siswa minimal:

* Active  
* Inactive  
* Graduated  
* Transferred  
* Withdrawn  
* Archived

### **C. Data Orang Tua / Wali**

* Father Name  
* Mother Name  
* Father’s Phone  
* Mother’s Phone  
* Parent Emails  
* Address

Catatan:

Field `Emails` pada spreadsheet lama perlu diperjelas apakah berisi email ayah, ibu, wali, atau beberapa email sekaligus.

Sistem sebaiknya mendukung lebih dari satu parent atau guardian contact.

### **D. Data Kesehatan dan Kebutuhan Khusus**

* Health Information  
* Blood Type  
* Special Needs, Psychological / Physical

Field ini dikategorikan sebagai data sensitif.

Akses data kesehatan melalui API diperbolehkan, tetapi harus dibatasi dengan scope khusus dan tercatat di audit log.

### **E. Consent**

Consent disimpan dalam dua bentuk:

* Status consent  
* Attachment surat yang sudah ditandatangani

Data consent minimal:

* Consent Type  
* Consent Status  
* Consent Date  
* Signed By  
* Attachment File  
* Uploaded By  
* Uploaded At  
* Notes  
* Validity Period jika diperlukan

Contoh consent type:

* Media Consent  
* Parent Consent  
* Other School Consent

Field dari spreadsheet lama:

* Media Consent Sign  
* Media Consent YES  
* Parent Consent Sign

Attachment harus disimpan di storage internal MWS.

### **F. Passion Connection Activity**

* PC Monday  
* PC Tuesday  
* PC Wednesday  
* PC Thursday

Sistem harus dapat mencatat aktivitas Passion Connection siswa per hari.

---

# **8\. Modul Database Karyawan**

Aplikasi harus menyediakan fitur untuk mengelola data karyawan.

## **8.1 Field Data Karyawan dari Google Sheet Saat Ini**

Data karyawan yang tersedia saat ini:

* Employee ID  
* Full Name  
* Nick  
* Job Level  
* Unit  
* Job Position  
* Class  
* Building  
* Join Date  
* Email  
* Birth Place  
* Birth Date  
* Religion  
* Gender

## **8.2 Struktur Field Karyawan yang Disarankan**

### **A. Identitas Karyawan**

1) Employee ID  
2) Full Name  
3) Nick  
4) Email  
5) Gender  
6) Religion  
7) Birth Place  
8) Birth Date

### **B. Data Kepegawaian**

* Job Level  
* Unit  
* Job Position  
* Class  
* Building  
* Join Date

### **C. Status Karyawan**

Sistem harus menambahkan field status karyawan.

Minimal status:

* Active  
* Inactive  
* Resigned  
* On Leave  
* Archived

Field ini penting agar aplikasi lain dapat mengetahui apakah karyawan masih aktif atau tidak.

### **D. Data Offboarding Dasar**

Walaupun fitur Google Workspace offboarding menjadi future development, sistem MVP sebaiknya tetap menyiapkan field dasar:

* Resignation Date  
* Last Working Date  
* Employment Status  
* Notes

Tujuannya agar jika nanti fitur account lifecycle dikembangkan, data dasarnya sudah tersedia.

---

# **9\. Academic Year dan Class History**

MWS menggunakan nama kelas yang dapat berubah setiap tahun, misalnya `Grade 1 Sombrero`, bukan format tetap seperti `1A`, `1B`, atau `1C`.

Karena itu, sistem harus menyimpan histori kelas siswa per academic year.

## **9.1 Academic Year**

Sistem harus memiliki entitas academic year.

Field minimal:

* Academic Year ID  
* Academic Year Name  
* Start Date  
* End Date  
* Status

Contoh:

* 2024/2025  
* 2025/2026  
* 2026/2027

## **9.2 Class**

Sistem harus memiliki entitas class yang terhubung ke academic year.

Field minimal:

* Class ID  
* Class Name  
* Grade Level  
* Academic Year ID  
* Homeroom Teacher ID jika relevan  
* Status

Contoh:

* Grade 1 Sombrero  
* Grade 2 Fedora  
* Grade 3 Bowler

## **9.3 Student Class Enrollment / Student Academic History**

Sistem harus menyimpan riwayat kelas siswa per tahun ajaran.

Field minimal:

* Student ID  
* Academic Year ID  
* Grade Level  
* Class ID  
* Class Name Snapshot  
* Enrollment Status  
* Start Date  
* End Date

Dengan struktur ini, sistem dapat menjawab:

* Siswa ini berada di kelas apa pada tahun ajaran tertentu?  
* Siapa saja siswa di kelas Grade 1 Sombrero pada tahun tertentu?  
* Apa histori kelas siswa dari tahun ke tahun?  
* Kelas apa yang aktif untuk tahun ajaran saat ini?  
* Bagaimana perubahan class name dari tahun ke tahun?

---

# **10\. Fitur Manajemen Data**

## **10.1 Create Data**

Admin harus dapat menambahkan data siswa dan karyawan baru melalui aplikasi.

Validasi minimal:

* NIS tidak boleh kosong  
* NIS tidak boleh duplikat  
* Employee ID tidak boleh kosong  
* Employee ID tidak boleh duplikat  
* Full Name tidak boleh kosong  
* Email harus valid  
* Email tidak boleh duplikat jika digunakan untuk login atau Google Sign-In  
* Status harus berasal dari pilihan yang sudah ditentukan

## **10.2 Read / View Data**

Admin dan viewer harus dapat melihat data dalam bentuk tabel.

Fitur tampilan minimal:

* Search  
* Filter  
* Sort  
* Pagination  
* Column visibility  
* Detail view per user

## **10.3 Update Data**

Admin harus dapat memperbarui data siswa dan karyawan sesuai permission.

Perubahan data langsung berlaku setelah disimpan oleh user berwenang.

Tidak diperlukan approval workflow untuk perubahan data biasa.

Perubahan penting harus masuk audit log.

Contoh perubahan yang perlu dilacak:

* Perubahan nama  
* Perubahan email  
* Perubahan kelas  
* Perubahan grade  
* Perubahan status siswa  
* Perubahan data orang tua  
* Perubahan data kesehatan  
* Perubahan consent  
* Perubahan status karyawan  
* Perubahan unit  
* Perubahan job position

## **10.4 Deactivate / Archive Data**

Data sebaiknya tidak langsung dihapus permanen.

Sistem harus mendukung:

* Active  
* Inactive  
* Graduated  
* Transferred  
* Resigned  
* Archived

Data yang sudah tidak aktif tetap dapat dicari untuk keperluan historis.

## **10.5 Delete Data**

Jika fitur delete disediakan, hanya Super Admin yang boleh mengaksesnya.

Sistem sebaiknya menggunakan **soft delete**, bukan hard delete.

Soft delete berarti data tidak benar-benar hilang dari database, tetapi ditandai sebagai deleted atau archived.

---

# **11\. Search, Filter, Sort, dan Pagination**

## **11.1 Search Siswa**

Sistem harus mendukung pencarian siswa berdasarkan:

* NIS  
* Nama lengkap  
* Nick name  
* Email  
* Grade  
* Class  
* Status  
* NISN  
* Parent name  
* Parent phone  
* Parent email

## **11.2 Filter Siswa**

Filter siswa minimal:

* Status  
* Grade  
* Class  
* Academic Year  
* Gender  
* Religion  
* PC activity  
* Consent status  
* Join year  
* Leave year

## **11.3 Search Karyawan**

Sistem harus mendukung pencarian karyawan berdasarkan:

* Employee ID  
* Nama lengkap  
* Nick  
* Email  
* Unit  
* Job Position  
* Job Level  
* Class  
* Building  
* Status

## **11.4 Filter Karyawan**

Filter karyawan minimal:

* Status  
* Unit  
* Job Level  
* Job Position  
* Building  
* Gender  
* Religion  
* Join Date

---

# **12\. Import, Migrasi, dan Google Sheet Transition Sync**

Karena data awal berasal dari Google Sheet, aplikasi harus memiliki fitur import dan mekanisme transisi.

## **12.1 Format Import**

Sistem harus mendukung import dari:

* CSV  
* Excel  
* Google Sheet export

## **12.2 Field Mapping**

Sistem sebaiknya menyediakan fitur mapping kolom agar struktur Google Sheet lama dapat disesuaikan dengan struktur database baru.

Contoh mapping:

* `Full Name` → `full_name`  
* `Nick Name` → `nickname`  
* `Current grade (If Active)` → `current_grade`  
* `Student MWS Email` → `email`  
* `Place, Date of birth` → `birth_place` dan `birth_date`

## **12.3 Validasi Import**

Sebelum data masuk ke database, sistem harus menampilkan hasil validasi:

* Jumlah data valid  
* Jumlah data error  
* Field wajib yang kosong  
* NIS duplikat  
* Employee ID duplikat  
* Email duplikat  
* Email tidak valid  
* Format tanggal tidak valid  
* Status tidak sesuai pilihan  
* Grade atau class tidak dikenali  
* Field yang berisi multiple values dalam satu cell

Admin harus dapat memperbaiki data sebelum import final dilakukan.

## **12.4 Import Preview**

Sistem harus menyediakan preview sebelum import final.

Preview minimal menampilkan:

* Data baru yang akan dibuat  
* Data lama yang akan diperbarui  
* Data yang tidak bisa diimport  
* Alasan error  
* Potensi duplikasi  
* Potensi data conflict

## **12.5 Migration Report**

Developer harus membuat migration report sebelum data masuk ke sistem production.

Migration report minimal mencakup:

* Jumlah total data siswa  
* Jumlah total data karyawan  
* Jumlah data valid  
* Jumlah data bermasalah  
* Daftar NIS duplikat  
* Daftar Employee ID duplikat  
* Daftar email duplikat  
* Daftar field wajib kosong  
* Daftar format tanggal bermasalah  
* Daftar status tidak konsisten  
* Daftar class name tidak konsisten  
* Rekomendasi perbaikan data

## **12.6 Google Sheet Transition Sync**

Selama masa transisi, sistem perlu tetap sinkron dengan Google Sheet.

Requirement:

* Import awal dari Google Sheet  
* Re-import dari Google Sheet  
* Data comparison antara database dan Google Sheet  
* Conflict detection  
* Sync preview  
* Sync log  
* Error report

Developer perlu menentukan apakah sync bersifat:

* One-way dari Google Sheet ke database  
* One-way dari database ke Google Sheet  
* Two-way sync

Rekomendasi:

Pada awal transisi:

* Google Sheet digunakan sebagai data awal dan pembanding.  
* Setelah aplikasi database pusat aktif, update utama sebaiknya dilakukan di aplikasi database.  
* Jika masih ada perubahan di Google Sheet, sistem harus mampu mendeteksi perubahan tersebut dan menampilkan conflict.

---

# **13\. Export Data**

Aplikasi harus dapat melakukan export data untuk kebutuhan administrasi.

Format export minimal:

* CSV  
* Excel

## **13.1 Export Siswa**

Export siswa harus dapat difilter berdasarkan:

* Semua siswa  
* Siswa aktif  
* Siswa inactive  
* Siswa graduated  
* Siswa per grade  
* Siswa per class  
* Siswa berdasarkan academic year  
* Siswa berdasarkan consent status  
* Siswa berdasarkan PC activity jika diperlukan

## **13.2 Export Karyawan**

Export karyawan harus dapat difilter berdasarkan:

* Semua karyawan  
* Karyawan aktif  
* Karyawan inactive  
* Karyawan resigned  
* Karyawan per unit  
* Karyawan per job position  
* Karyawan per building

## **13.3 Pembatasan Export Data Sensitif**

Data sensitif hanya boleh diekspor oleh role tertentu.

Data sensitif mencakup:

* Health Information  
* Special Needs  
* Blood Type  
* Address  
* Parent phone number  
* Parent email  
* Birth date  
* Consent attachment  
* Employee personal information

Export data sensitif harus tercatat di audit log.

---

# **14\. API dan Integrasi dengan Aplikasi Internal**

Aplikasi harus menyediakan API agar aplikasi lain dapat mengambil data user dari database pusat.

Aplikasi yang harus terintegrasi pada fase pertama:

* Daily Check-in  
* MTSS  
* Reading Buddy  
* Exima

## **14.1 Prinsip API**

API harus mendukung:

* Lookup user berdasarkan email Google Sign-In  
* Lookup student berdasarkan NIS  
* Lookup employee berdasarkan Employee ID  
* Data user aktif  
* Data siswa aktif  
* Data karyawan aktif  
* Data academic history siswa  
* Data class per academic year  
* Data health dengan permission khusus  
* Data consent status dan attachment metadata jika diperlukan  
* Field-level access control  
* API scope per aplikasi

## **14.2 API untuk Validasi User Setelah Google Sign-In**

Karena authentication tetap menggunakan Google Sign-In, API utama yang dibutuhkan adalah validasi user berdasarkan email.

Contoh kebutuhan:

* Apakah email ini terdaftar?  
* Apakah user ini siswa atau karyawan?  
* Apakah user ini masih aktif?  
* Apa ID utama user ini?  
* Apa nama lengkap user ini?  
* Apa role atau kategori user ini?  
* Apa class, grade, unit, atau job position user ini?  
* Apakah user ini boleh mengakses aplikasi tertentu?

## **14.3 API untuk Data Siswa**

Endpoint yang dibutuhkan:

* Get all students  
* Get student by NIS  
* Get student by email  
* Get active students  
* Get students by grade  
* Get students by class  
* Get students by academic year  
* Get student current profile  
* Get student academic history  
* Get student consent status  
* Get student health data dengan permission khusus

Contoh data yang dapat diberikan ke aplikasi lain:

* NIS  
* Full Name  
* Nick Name  
* Email  
* Status  
* Grade  
* Class Name  
* Academic Year  
* Gender jika diperlukan  
* Photo ID jika diperlukan

## **14.4 API untuk Data Karyawan**

Endpoint yang dibutuhkan:

* Get all employees  
* Get employee by Employee ID  
* Get employee by email  
* Get active employees  
* Get employees by unit  
* Get employees by job position  
* Get employee profile summary

Contoh data yang dapat diberikan ke aplikasi lain:

* Employee ID  
* Full Name  
* Nick  
* Email  
* Status  
* Unit  
* Job Position  
* Job Level  
* Class jika relevan  
* Building jika relevan

## **14.5 API Response Standard**

API harus memiliki format response yang konsisten.

Contoh:

{  
  "success": true,  
  "data": {  
    "id": "S12345",  
    "type": "student",  
    "full\_name": "Student Name",  
    "email": "student@mws.sch.id",  
    "status": "active",  
    "grade": "Grade 5",  
    "class\_name": "Grade 5 Sombrero",  
    "academic\_year": "2025/2026"  
  }  
}

## **14.6 API Authentication dan Security**

API tidak boleh terbuka publik tanpa autentikasi.

Minimal mekanisme keamanan:

* API key atau token-based authentication  
* Access scope per aplikasi  
* Rate limiting  
* API request logging  
* Field-level restriction  
* HTTPS wajib digunakan  
* Token dapat dibuat, dicabut, dan dirotasi

## **14.7 API Scope per Aplikasi**

Setiap aplikasi internal harus memiliki scope akses masing-masing.

### **Daily Check-in**

Kemungkinan akses:

* User ID  
* Name  
* Email  
* User type  
* Status  
* Grade  
* Class  
* Unit

Tidak boleh mengakses secara default:

* Health information  
* Parent phone  
* Address  
* Consent attachment

### **Reading Buddy**

Kemungkinan akses:

* NIS  
* Name  
* Email  
* Grade  
* Class  
* Status  
* Academic year

Tidak boleh mengakses secara default:

* Parent contact  
* Health information  
* Employee data

### **MTSS**

MTSS dapat mengakses data tambahan yang relevan, termasuk data kesehatan atau kebutuhan khusus jika memang dibutuhkan.

Akses MTSS perlu menggunakan scope khusus, misalnya:

* `student.profile.read`  
* `student.academic_history.read`  
* `student.health.read`  
* `student.special_needs.read`

### **Exima**

Akses Exima mengikuti kebutuhan aplikasi.

Developer harus melakukan mapping kebutuhan field Exima pada tahap technical design.

---

# **15\. Data Sensitif dan Privacy**

Beberapa data harus dikategorikan sebagai data sensitif.

Contoh data sensitif:

* Health Information  
* Special Needs, Psychological / Physical  
* Blood Type  
* Address  
* Parent phone number  
* Parent email  
* Birth date  
* Consent attachment  
* Employee personal information

Sistem harus memiliki pembatasan akses berdasarkan role dan API scope.

Tidak semua admin atau aplikasi internal boleh mengakses seluruh field.

Requirement khusus:

* Akses data kesehatan melalui API diperbolehkan.  
* Akses data kesehatan harus menggunakan scope khusus.  
* Setiap akses ke data kesehatan harus tercatat di audit log.  
* Export data sensitif hanya boleh dilakukan oleh role tertentu.  
* Attachment consent harus disimpan di internal storage.

---

# **16\. Audit Log**

Sistem harus menyimpan audit log untuk aktivitas penting.

Audit log minimal mencatat:

* Siapa yang melakukan perubahan  
* Kapan perubahan dilakukan  
* Data apa yang diubah  
* Nilai sebelum perubahan  
* Nilai sesudah perubahan  
* Dari mana perubahan dilakukan, misalnya UI admin atau API  
* IP address atau device information jika memungkinkan

Aktivitas yang perlu dicatat:

* Login admin  
* Failed login  
* Unauthorized access attempt  
* Create student  
* Update student  
* Deactivate student  
* Delete student  
* Create employee  
* Update employee  
* Deactivate employee  
* Delete employee  
* Import data  
* Export data  
* Upload consent attachment  
* Download consent attachment  
* Access health data  
* API access  
* API token creation  
* API token revocation  
* Permission change  
* Role change

---

# **17\. Riwayat Data**

Sistem harus menyimpan histori perubahan untuk data utama.

## **17.1 Histori Siswa**

Contoh histori siswa:

* Riwayat grade  
* Riwayat class  
* Riwayat academic year  
* Riwayat status  
* Riwayat parent contact  
* Riwayat consent  
* Riwayat Passion Connection  
* Riwayat health information jika diperlukan

## **17.2 Histori Karyawan**

Contoh histori karyawan:

* Riwayat unit  
* Riwayat job position  
* Riwayat job level  
* Riwayat status  
* Riwayat building  
* Riwayat join/resign date

Tujuannya agar sistem tidak hanya menyimpan kondisi terbaru, tetapi juga dapat melihat perubahan historis.

---

# **18\. Struktur Data yang Disarankan**

Developer sebaiknya tidak membuat satu tabel besar, tetapi memisahkan data secara lebih terstruktur.

## **18.1 Entitas Utama**

Minimal entitas yang dibutuhkan:

* Users  
* Students  
* Employees  
* Parents / Guardians  
* Classes  
* Grades  
* Academic Years  
* Student Class Enrollments  
* Consent Records  
* Consent Attachments  
* Health Records  
* Passion Connection Activities  
* API Clients  
* API Scopes  
* Audit Logs  
* Import Jobs  
* Sync Logs

## **18.2 Relasi Dasar**

Contoh relasi:

* Satu `User` dapat memiliki satu `Student Profile` atau satu `Employee Profile`.  
* Satu student dapat memiliki beberapa parent/guardian contact.  
* Satu student memiliki satu active class pada satu academic year.  
* Satu student memiliki banyak class history records.  
* Satu class berada dalam satu academic year.  
* Satu class berada pada satu grade level.  
* Satu student dapat memiliki beberapa consent records.  
* Satu consent record dapat memiliki attachment.  
* Satu student dapat memiliki beberapa health notes.  
* Satu API client dapat memiliki beberapa access scope.  
* Satu employee berada dalam satu unit.  
* Satu employee dapat memiliki satu atau beberapa class assignment jika relevan.

## **18.3 Master User Model**

Karena siswa dan karyawan sama-sama merupakan user, sistem sebaiknya memiliki model umum `User`, lalu detailnya dipisahkan ke `Student Profile` dan `Employee Profile`.

### **User**

* user\_id  
* full\_name  
* email  
* user\_type  
* status  
* created\_at  
* updated\_at

### **Student Profile**

* user\_id  
* nis  
* nisn  
* current\_grade  
* current\_class\_id  
* join\_academic\_year  
* join\_grade  
* graduation\_grade  
* previous\_school  
* parent data reference  
* consent data reference  
* health data reference

### **Employee Profile**

* user\_id  
* employee\_id  
* unit  
* job\_position  
* job\_level  
* class  
* building  
* join\_date  
* employment\_status  
* resignation\_date  
* last\_working\_date

---

# **19\. Dashboard dan UI Admin**

Aplikasi perlu memiliki dashboard sederhana untuk membantu admin melihat kondisi data.

Dashboard minimal menampilkan:

* Jumlah siswa aktif  
* Jumlah siswa inactive  
* Jumlah siswa graduated  
* Jumlah karyawan aktif  
* Jumlah karyawan inactive  
* Jumlah karyawan resigned  
* Jumlah data siswa yang belum lengkap  
* Jumlah data karyawan yang belum lengkap  
* Jumlah siswa per grade  
* Jumlah siswa per class  
* Jumlah siswa per academic year  
* Jumlah karyawan per unit  
* Jumlah karyawan per job position  
* Jumlah data dengan import error  
* Jumlah data yang konflik dengan Google Sheet selama masa transisi

---

# **20\. Data Validation Rules**

## **20.1 Validasi Umum**

* Email harus valid  
* Tanggal harus memiliki format konsisten  
* Field ID utama tidak boleh kosong  
* Field nama lengkap tidak boleh kosong  
* Status harus berasal dari daftar status yang sudah ditentukan  
* Gender harus berasal dari pilihan yang sudah ditentukan  
* Data tidak boleh duplikat berdasarkan ID utama  
* Attachment harus memiliki format dan ukuran sesuai aturan sistem

## **20.2 Validasi Siswa**

* NIS wajib unik  
* Student MWS Email sebaiknya unik  
* Current Grade wajib ada jika status siswa Active  
* Class Name wajib ada jika status siswa Active  
* Leave Year wajib ada jika status Graduated  
* Graduation Grade wajib ada jika status Graduated  
* Parent contact sebaiknya minimal satu tersedia  
* Date of Birth harus valid jika diisi  
* Academic year harus valid  
* Class harus terhubung ke academic year yang benar

## **20.3 Validasi Karyawan**

* Employee ID wajib unik  
* Email wajib unik jika digunakan untuk login  
* Join Date harus valid  
* Job Position wajib ada jika status Active  
* Unit wajib ada jika status Active  
* Resignation Date wajib ada jika status Resigned

---

# **21\. Notifikasi dan Reminder**

Sistem sebaiknya memiliki notifikasi untuk membantu admin menjaga kelengkapan data.

Contoh notifikasi:

* Data siswa belum lengkap  
* Data karyawan belum lengkap  
* Siswa aktif belum memiliki class  
* Siswa aktif belum memiliki academic year  
* Karyawan aktif belum memiliki unit  
* Consent belum diisi  
* Attachment consent belum diupload  
* Format email tidak valid  
* Data parent contact belum lengkap  
* Data karyawan active tetapi belum memiliki job position  
* Data siswa graduated tetapi leave year belum diisi  
* Data Google Sheet conflict selama masa transisi

---

# **22\. Backup dan Recovery**

Aplikasi harus memiliki mekanisme backup database secara berkala.

Kebutuhan minimal:

* Backup otomatis harian  
* Retensi backup minimal 30 hari  
* Kemampuan restore data  
* Export manual oleh Super Admin  
* Backup harus mencakup data utama dan audit log  
* Backup harus mencakup attachment consent  
* Dokumentasi proses recovery

Karena deployment wajib internal, backup juga harus mengikuti kebijakan internal MWS.

---

# **23\. Internal Hosting, Storage, dan Deployment**

Seluruh deployment wajib di-host secara internal.

Termasuk:

* Application server  
* Database  
* Storage  
* File attachment storage  
* Backup  
* CI/CD pipeline

Penggunaan storage atau database platform harus internal.

## **23.1 Requirement Deployment**

Developer harus menyediakan:

* Deployment script  
* Environment configuration  
* Database migration script  
* Internal storage configuration  
* Backup configuration  
* CI/CD pipeline sesuai internal standard  
* Dokumentasi deployment  
* Dokumentasi rollback  
* Dokumentasi environment development, staging, dan production

## **23.2 Requirement Storage**

Attachment seperti consent letter harus disimpan di internal storage.

Storage harus mendukung:

* Upload file  
* Download file sesuai permission  
* File access logging  
* File metadata  
* File size limit  
* Allowed file type  
* Backup attachment

## **23.3 CI/CD**

CI/CD harus mengikuti internal standard MWS.

Minimal mendukung:

* Source control  
* Build pipeline  
* Test pipeline jika tersedia  
* Deployment ke staging  
* Deployment ke production  
* Rollback procedure  
* Environment variable management  
* Migration execution

---

# **24\. Non-Functional Requirements**

## **24.1 Security**

* Semua akses harus menggunakan HTTPS.  
* Password internal tidak diperlukan jika login menggunakan Google Sign-In.  
* Jika password internal tetap digunakan untuk kebutuhan tertentu, password harus disimpan dengan hashing yang aman.  
* Role-based access control wajib diterapkan.  
* Sensitive fields harus dibatasi.  
* API token harus dapat dibuat, dicabut, dan dirotasi.  
* Audit log tidak boleh mudah dihapus.  
* Export data sensitif harus dibatasi.  
* Session timeout perlu diterapkan untuk admin panel.  
* Attachment access harus melalui permission check.  
* API access harus menggunakan token yang aman.

## **24.2 Performance**

* Search dan filter harus tetap cepat.  
* API response untuk data dasar user harus ringan.  
* Sistem harus dapat menangani pertumbuhan data beberapa tahun ke depan.  
* Tabel besar harus menggunakan pagination.  
* API untuk lookup user by email harus cepat karena akan dipakai oleh aplikasi lain setelah Google Sign-In.

## **24.3 Reliability**

* Sistem harus stabil digunakan oleh admin.  
* API harus tersedia untuk aplikasi lain.  
* Error harus ditampilkan dengan jelas.  
* Sistem harus tetap aman jika import gagal.  
* Perubahan data tidak boleh menyebabkan aplikasi lain gagal tanpa error handling.  
* Google Sheet transition sync harus memiliki conflict handling.

## **24.4 Maintainability**

* Struktur database harus terdokumentasi.  
* API documentation harus tersedia.  
* Developer harus menyediakan dokumentasi deployment.  
* Developer harus menyediakan dokumentasi penggunaan admin.  
* Codebase harus modular agar mudah dikembangkan.  
* Mapping field dan scope API sebaiknya configurable.

## **24.5 Scalability**

Sistem harus dapat dikembangkan untuk kebutuhan berikutnya, seperti:

* Penambahan aplikasi internal baru  
* Penambahan role baru  
* Penambahan field data baru  
* Penambahan jenis user baru  
* Integrasi Google Workspace  
* Account lifecycle automation  
* Advanced field-level access control

---

# **25\. Dokumentasi yang Harus Disediakan Developer**

Developer harus menyediakan dokumentasi berikut:

1. Dokumentasi struktur database  
2. Dokumentasi API  
3. Dokumentasi role dan permission  
4. Dokumentasi API client dan scope  
5. Dokumentasi cara import data  
6. Dokumentasi cara export data  
7. Dokumentasi Google Sheet transition sync  
8. Dokumentasi deployment internal  
9. Dokumentasi backup dan restore  
10. Dokumentasi penggunaan admin  
11. Dokumentasi security dan API access  
12. Dokumentasi error handling  
13. Dokumentasi audit log  
14. Dokumentasi data validation rules  
15. Migration report dari Google Sheet  
16. Dokumentasi CI/CD sesuai internal standard

---

# **26\. Kriteria Keberhasilan MVP**

Aplikasi MVP dianggap berhasil jika:

* Data siswa dapat dimigrasikan dari Google Sheet ke aplikasi.  
* Data karyawan dapat dimigrasikan dari Google Sheet ke aplikasi.  
* Developer sudah melakukan pengecekan manual terhadap data Google Sheet.  
* NIS sudah divalidasi unik.  
* Employee ID sudah divalidasi unik.  
* Admin dapat login menggunakan Google Workspace.  
* Siswa tidak perlu login ke aplikasi database.  
* Parent/guardian tidak perlu login ke aplikasi database.  
* Admin dapat mengelola data tanpa mengedit spreadsheet manual.  
* Setiap siswa memiliki NIS unik sebagai reference ID.  
* Setiap karyawan memiliki Employee ID unik sebagai reference ID.  
* Admin dapat search, filter, sort, dan update data.  
* Data aktif dan tidak aktif dapat dibedakan dengan jelas.  
* Histori kelas siswa per academic year tersedia.  
* Consent dapat disimpan sebagai status dan attachment.  
* Data kesehatan dapat disimpan dan diakses melalui API dengan permission khusus.  
* Daily Check-in dapat mengambil data user dari database pusat.  
* MTSS dapat mengambil data user dari database pusat.  
* Reading Buddy dapat mengambil data user dari database pusat.  
* Exima dapat mengambil data user dari database pusat.  
* Role dan permission dasar berjalan.  
* Data sensitif terlindungi.  
* Audit log tersedia.  
* Export dan import berjalan.  
* Google Sheet transition sync tersedia selama masa transisi.  
* Deployment berjalan di internal environment.  
* Storage dan database menggunakan platform internal.  
* Dokumentasi teknis dan admin tersedia.

---

# **27\. Development Roadmap MVP**

## **Phase 1 — Core Database**

Fokus:

* Modul siswa  
* Modul karyawan  
* Master user model  
* Academic year  
* Class per academic year  
* Student class history  
* Parent/guardian data  
* Consent status dan attachment  
* Health data  
* Employee status  
* Admin login menggunakan Google Workspace  
* Role Super Admin dan Database Admin  
* CRUD data  
* Search, filter, sort, pagination

## **Phase 2 — Import, Migration, dan Google Sheet Transition**

Fokus:

* Import Google Sheet  
* Import CSV / Excel  
* Field mapping  
* Import preview  
* Data validation  
* Migration report  
* Re-import  
* Google Sheet comparison  
* Conflict detection  
* Sync log

## **Phase 3 — API Integration untuk Existing Apps**

Fokus:

* API lookup user by email  
* API student data  
* API employee data  
* API academic history  
* API health data dengan permission khusus  
* API consent status  
* API client management  
* Scope per aplikasi  
* Integrasi Daily Check-in  
* Integrasi MTSS  
* Integrasi Reading Buddy  
* Integrasi Exima

## **Phase 4 — Governance, Audit, dan Stabilization**

Fokus:

* Audit log lengkap  
* Field-level access control  
* Export restriction  
* Dashboard data completeness  
* Notification/reminder  
* Backup dan recovery  
* Internal deployment hardening  
* Dokumentasi lengkap

---

# **28\. Bonus Feature / Future Development: Google Workspace Integration**

Fitur Google Workspace Integration bukan bagian dari MVP utama.

Fitur ini dapat dikembangkan setelah aplikasi database pusat stabil dan sudah menjadi source of truth untuk data siswa dan karyawan.

## **28.1 Tujuan Integrasi Google Workspace**

Integrasi Google Workspace bertujuan untuk:

* Menyinkronkan data siswa ke Google Workspace  
* Menyinkronkan data karyawan ke Google Workspace  
* Memindahkan user ke Organizational Unit yang sesuai  
* Mengisi custom user fields di Google Workspace  
* Menambahkan atau menghapus user dari Google Groups  
* Membuat akun Google Workspace dari aplikasi database  
* Men-suspend akun Google Workspace  
* Mengelola offboarding account  
* Menghapus akun setelah masa tunggu tertentu sesuai policy MWS

## **28.2 Prinsip Integrasi**

Database pusat MWS tetap menjadi source of truth.

Google Workspace menjadi sistem eksternal yang mengikuti data dari database pusat.

Prinsip:

* Data utama diedit di aplikasi database MWS.  
* Google Workspace menerima hasil sinkronisasi.  
* Jika terjadi perbedaan data antara database pusat dan Google Workspace, database pusat dianggap benar.  
* Sinkronisasi harus memiliki log dan error handling.  
* Perubahan massal harus memiliki preview dan approval.

## **28.3 Komponen Google Workspace yang Perlu Didukung**

Integrasi dapat mencakup:

1. Google Workspace Users  
2. Google Workspace Organizational Units  
3. Google Workspace Groups  
4. Google Workspace Custom User Fields  
5. Account status, seperti active, suspended, pending deletion, atau deleted

## **28.4 Sinkronisasi Organizational Unit**

Sistem dapat memindahkan user ke Organizational Unit yang sesuai berdasarkan data di database pusat.

Contoh struktur OU:

* `/Students`  
* `/Students/Active`  
* `/Students/Grade 1`  
* `/Students/Grade 2`  
* `/Students/Grade 3`  
* `/Students/Grade 4`  
* `/Students/Grade 5`  
* `/Students/Grade 6`  
* `/Students/Graduated`  
* `/Employees`  
* `/Employees/Teachers`  
* `/Employees/Admin`  
* `/Employees/Leadership`  
* `/Employees/Inactive`  
* `/Former Students`  
* `/Former Employees`

Catatan:

Organizational Unit sebaiknya digunakan untuk segmentasi besar dan policy Google Workspace, bukan untuk semua detail data user.

Informasi seperti class, grade detail, unit, atau job position bisa lebih fleksibel jika disimpan juga di custom user fields dan Google Groups.

## **28.5 Sinkronisasi Custom User Fields**

Sistem dapat mengisi custom user fields di Google Workspace agar informasi penting dari database pusat terlihat pada profil user Workspace.

Contoh custom fields untuk siswa:

* `user_type`  
* `nis`  
* `student_status`  
* `grade`  
* `class_name`  
* `join_academic_year`  
* `graduation_year`

Contoh custom fields untuk karyawan:

* `user_type`  
* `employee_id`  
* `employment_status`  
* `unit`  
* `job_level`  
* `job_position`  
* `assigned_class`  
* `building`  
* `join_date`

## **28.6 Sinkronisasi Google Groups**

Sistem dapat menambahkan atau menghapus user dari Google Groups berdasarkan data di database pusat.

Contoh group siswa:

* `students@mws.sch.id`  
* `active-students@mws.sch.id`  
* `grade-1@mws.sch.id`  
* `grade-2@mws.sch.id`  
* `class-5a@mws.sch.id`

Contoh group karyawan:

* `employees@mws.sch.id`  
* `teachers@mws.sch.id`  
* `admin-staff@mws.sch.id`  
* `elementary-team@mws.sch.id`  
* `leadership@mws.sch.id`  
* `finance@mws.sch.id`

Google Groups dapat digunakan untuk:

* Mailing list  
* Permission group  
* Classroom-related group  
* Unit kerja  
* Grade-level group  
* Role-based access group

## **28.7 Create Google Workspace Account**

Pada fase lanjutan, aplikasi dapat memiliki kemampuan membuat akun Google Workspace baru.

Contoh trigger:

* Siswa baru ditambahkan dengan status Active  
* Karyawan baru ditambahkan dengan status Active  
* Admin menekan tombol Create Workspace Account

Data yang digunakan:

* Full Name  
* Email  
* User Type  
* NIS atau Employee ID  
* Grade / Class untuk siswa  
* Unit / Job Position untuk karyawan  
* Initial password atau mekanisme invite/reset password

Validasi sebelum create account:

* Email belum digunakan di Google Workspace  
* Email sesuai domain MWS  
* Nama lengkap tersedia  
* Status user valid  
* Mapping OU tersedia

## **28.8 Update Google Workspace Account**

Ketika data user berubah di database pusat, sistem dapat memperbarui akun Google Workspace.

Contoh perubahan yang disinkronkan:

* Perubahan nama  
* Perubahan status  
* Perubahan grade  
* Perubahan class  
* Perubahan unit  
* Perubahan job position  
* Perubahan building  
* Perubahan OU  
* Perubahan Google Groups  
* Perubahan custom user fields

Update dapat dilakukan secara:

* Manual per user  
* Bulk update  
* Otomatis ketika data berubah  
* Scheduled sync harian

## **28.9 Suspend Account**

Sistem dapat mendukung tindakan suspend akun Google Workspace.

Suspend digunakan ketika user tidak boleh lagi login, tetapi data akunnya belum dihapus.

Contoh kondisi suspend:

* Karyawan resign  
* Siswa lulus  
* Siswa keluar / transferred  
* Akun sedang dalam investigasi  
* Akun perlu dibekukan sementara

## **28.10 Grace Period dan Account Deletion Policy**

MWS menginginkan policy berikut untuk future development:

* Karyawan yang sudah resign: akun dihapus 30 hari setelah dinyatakan keluar.  
* Siswa yang sudah lulus: akun dihapus 30 hari setelah tanggal kelulusan.

Untuk mendukung ini, sistem perlu menyimpan field berikut:

* `exit_date`  
* `graduation_date`  
* `resignation_date`  
* `account_suspend_date`  
* `account_deletion_eligible_date`  
* `account_deleted_date`  
* `workspace_account_status`  
* `offboarding_status`

Contoh aturan:

* Jika employee status berubah menjadi `Resigned`, sistem mengisi `resignation_date`.  
* Sistem menghitung `account_deletion_eligible_date = resignation_date + 30 hari`.  
* Selama 30 hari, akun masuk status `Pending Deletion`.  
* Pada hari ke-30, sistem dapat menjalankan deletion workflow sesuai approval dan safety rule.

## **28.11 Automated Deletion Workflow**

Penghapusan akun otomatis harus diperlakukan sebagai fitur berisiko tinggi dan tidak boleh dijalankan tanpa safety mechanism.

Workflow yang direkomendasikan:

1. User berubah status menjadi `Graduated`, `Transferred`, `Resigned`, atau `Inactive`.  
2. Sistem menghitung tanggal eligible deletion.  
3. Sistem memindahkan user ke OU khusus, misalnya:  
   * `/Former Students/Pending Deletion`  
   * `/Former Employees/Pending Deletion`  
4. Sistem menghapus user dari Google Groups aktif.  
5. Sistem menandai akun sebagai `Pending Offboarding`.  
6. Sistem mengirim notifikasi kepada admin sebelum tanggal penghapusan.  
7. Sistem mengecek checklist offboarding.  
8. Setelah checklist selesai dan grace period terpenuhi, sistem menghapus akun.  
9. Sistem menyimpan audit log deletion.

## **28.12 Deletion Queue**

Sistem dapat memiliki halaman `Deletion Queue`.

Halaman ini menampilkan akun yang akan atau sudah memenuhi syarat penghapusan.

Data yang ditampilkan:

* Full Name  
* Email  
* User Type  
* NIS / Employee ID  
* Status  
* Graduation Date / Resignation Date / Exit Date  
* Eligible Deletion Date  
* Workspace Account Status  
* Offboarding Checklist Status  
* Approval Status  
* Last Sync Status  
* Error Message jika ada

Admin dapat melakukan:

* Approve deletion  
* Cancel deletion  
* Extend grace period  
* Suspend account  
* Transfer ownership  
* Mark as exception  
* View audit log

## **28.13 Offboarding Checklist**

Sebelum akun dihapus, sistem harus menyediakan checklist offboarding.

Checklist minimal untuk karyawan:

* Akun sudah di-suspend  
* User sudah dikeluarkan dari Google Groups aktif  
* User sudah dipindahkan ke OU former employee  
* Ownership Google Drive sudah ditransfer  
* Email forwarding atau delegation sudah ditentukan jika diperlukan  
* Calendar/resource ownership sudah diperiksa jika diperlukan  
* Data penting sudah diamankan  
* Approval HR/Admin sudah diberikan  
* Approval IT/Admin Workspace sudah diberikan

Checklist minimal untuk siswa:

* Akun sudah di-suspend jika policy mengharuskan  
* User sudah dikeluarkan dari Google Groups kelas aktif  
* User sudah dipindahkan ke OU graduated/former student  
* Data akademik penting sudah dipastikan tersimpan di sistem sekolah  
* File penting sudah ditransfer atau diarsipkan jika diperlukan  
* Approval admin sudah diberikan

## **28.14 Deletion Approval Mode**

Sistem harus mendukung beberapa mode approval:

### **1\. Manual Approval Mode**

Sistem hanya menampilkan daftar akun yang eligible untuk dihapus. Admin harus menekan tombol approve/delete.

### **2\. Semi-Automatic Mode**

Sistem mengirim reminder dan menyiapkan deletion queue. Admin dapat approve secara bulk.

### **3\. Fully Automatic Mode**

Sistem otomatis menghapus akun setelah semua rule terpenuhi.

Rekomendasi untuk MWS:

Gunakan Manual Approval Mode atau Semi-Automatic Mode terlebih dahulu sebelum mengaktifkan Fully Automatic Mode.

## **28.15 Exception Handling**

Sistem harus mendukung pengecualian agar akun tertentu tidak dihapus otomatis.

Contoh exception:

* Alumni masih membutuhkan akses sementara  
* Mantan karyawan masih membantu masa transisi  
* Akun digunakan untuk kepemilikan file penting  
* Akun sedang dalam proses investigasi  
* Akun perlu diarsipkan, bukan dihapus

Field yang dibutuhkan:

* `deletion_exception`  
* `exception_reason`  
* `exception_until`  
* `approved_by`  
* `approval_date`

## **28.16 Transfer Ownership Sebelum Delete**

Sebelum akun karyawan dihapus, sistem harus mendukung atau minimal mengingatkan proses transfer ownership data.

Data yang perlu dipertimbangkan:

* Google Drive files  
* Shared files owned by user  
* Calendar events  
* Google Groups ownership  
* Shared drives membership  
* Email data, jika perlu dimigrasikan atau dipertahankan

Untuk karyawan, deletion tidak boleh dilakukan jika transfer ownership belum selesai atau belum diberi approval oleh admin.

Untuk siswa, policy transfer data dapat dibuat lebih sederhana, tetapi tetap harus ditentukan oleh MWS.

## **28.17 Google Workspace Sync Log**

Setiap sinkronisasi Google Workspace harus dicatat dalam sync log.

Sync log minimal mencatat:

* User yang disinkronkan  
* Waktu sinkronisasi  
* Admin atau sistem yang menjalankan sinkronisasi  
* Field yang berubah  
* OU sebelum dan sesudah  
* Group yang ditambahkan  
* Group yang dihapus  
* Custom fields yang diperbarui  
* Status berhasil atau gagal  
* Error message jika gagal

## **28.18 Safety Rules untuk Google Workspace Account Management**

Minimal safety rules:

* Akun tidak boleh dihapus jika belum melewati grace period.  
* Akun tidak boleh dihapus jika masih memiliki deletion exception aktif.  
* Akun tidak boleh dihapus jika offboarding checklist belum selesai.  
* Akun tidak boleh dihapus jika approval belum diberikan, kecuali fully automatic mode sudah diaktifkan secara eksplisit.  
* Akun Super Admin atau admin penting tidak boleh dihapus otomatis.  
* Bulk delete harus memiliki preview.  
* Bulk delete harus memiliki approval.  
* Sistem harus menyimpan snapshot data sebelum delete.  
* Sistem harus menampilkan warning bahwa deletion dapat menyebabkan kehilangan data.  
* Sistem harus memiliki log lengkap atas semua tindakan delete.

## **28.19 Development Roadmap untuk Google Workspace Feature**

Fitur Google Workspace sebaiknya dikembangkan bertahap.

### **Future Phase A — Read-only Sync**

* Membaca data user dari Google Workspace  
* Membandingkan dengan database pusat  
* Menampilkan mismatch  
* Belum melakukan perubahan otomatis

### **Future Phase B — Controlled Update**

* Update OU  
* Update custom fields  
* Update Google Groups  
* Semua perubahan dengan preview dan approval

### **Future Phase C — Account Creation**

* Membuat akun baru dari database pusat  
* Generate email sesuai format MWS  
* Set initial password atau invite/reset password  
* Assign OU dan Groups otomatis

### **Future Phase D — Suspend and Offboarding**

* Suspend akun resigned/graduated/inactive  
* Move ke OU former user  
* Remove dari active groups  
* Offboarding checklist  
* Grace period tracking

### **Future Phase E — Deletion Automation**

* Deletion queue  
* Approval workflow  
* Automated delete setelah 30 hari  
* Exception handling  
* Full audit log

---

# **29\. Final Development Recommendation**

Untuk menjaga scope development tetap realistis, pengembangan sebaiknya dilakukan dengan prioritas berikut.

## **29.1 MVP Utama**

Fokus utama:

* Database pusat siswa dan karyawan  
* Admin panel  
* Google Workspace login untuk admin  
* API untuk aplikasi internal  
* Import/export  
* Google Sheet transition sync  
* Role dan permission  
* Audit log  
* Data validation  
* Academic year dan class history  
* Consent attachment  
* Health data access control  
* Internal deployment

## **29.2 Setelah MVP Stabil**

Lanjutkan ke:

* Advanced API permission  
* Field-level access control yang lebih detail  
* Data history yang lebih lengkap  
* Dashboard data completeness  
* Integrasi aplikasi internal tambahan  
* Monitoring API usage  
* Data governance improvement

## **29.3 Bonus / Future Development**

Baru kemudian lanjut ke:

* Google Workspace sync  
* Google Workspace account creation  
* Google Workspace group dan OU mapping  
* Suspend account  
* Offboarding automation  
* Deletion queue  
* Automated deletion setelah 30 hari

Dengan pendekatan ini, aplikasi database pusat dapat selesai dan digunakan lebih cepat, sementara fitur Google Workspace tetap masuk roadmap tanpa membebani MVP utama.

