# Notes

- [x] 2026-11-06: Student Detail diubah menjadi lima tab read-only: Overview, Academic, Family & Consent, Health, dan Special Education.
- [x] 2026-11-06: Contacts, Consent, dan Health dipindahkan ke halaman Manage khusus; assignment SE Teacher tetap melalui flow Class/Special Education.
- [x] 2026-11-06: Edit Student memakai kontrak atomic `special_needs_profile`: omitted tidak mengubah profil, object menyimpan atau restore, dan `null` menghapus profil serta eligibility.
- [x] 2026-11-06: Penghapusan Special Needs Profile ditolak jika assignment SE Teacher aktif, dengan advisory lock yang sama pada assignment dan perubahan eligibility.
- [x] 2026-11-06: Read endpoint parents, consent, health, notes, vaccine, dan Special Needs Profile memeriksa student permission dan unit scope.
- [x] 2026-11-06: Health Information dipisahkan dari Special Needs Profile; Health hanya menampilkan `HEALTH_INFO`, sedangkan Special Needs operasional hanya berada di tab Special Education.
- [x] 2026-11-06: Manage Health disederhanakan menjadi Create/Edit untuk health information, health notes, dan vaccine records; delete/restore tetap tersedia pada API lama tetapi tidak ditampilkan di UI.
- [x] 2026-11-06: Special Needs Profile menyimpan deskripsi per Need Type; Learning Support Summary dan Classroom Accommodations tetap ringkasan gabungan per siswa.
- [x] 2026-11-06: Label tanggal diperjelas menjadi Needs Identified Date dan Professional Report Date; tanggal laporan hanya tampil ketika laporan tersedia.
