// How an application is taken out of use, in the order it is done. Shown in the dialog and in the Guides page.
export const REMOVAL_STEPS = [
  {
    title: "1. Retire",
    text: "Stops the application without deleting anything. Its token is revoked, it disappears from the Hub and nobody has access to it. Roles, groups and permissions stay.",
    title_id: "1. Retire",
    text_id: "Aplikasi dihentikan tanpa menghapus apa pun. Tokennya dicabut, aplikasinya hilang dari Hub dan tidak ada yang memiliki akses. Role, grup, dan permission tetap ada.",
  },
  {
    title: "2. Restore, if you change your mind",
    text: "Turns it back on. The old token stays revoked, so you create a new connection and copy the new .env values. You also show it in the Hub again by hand.",
    title_id: "2. Restore, jika berubah pikiran",
    text_id: "Aplikasi diaktifkan kembali. Token lama tetap tercabut, sehingga Anda perlu membuat koneksi baru dan salin nilai .env yang baru. Menampilkannya kembali di Hub juga dilakukan secara manual.",
  },
  {
    title: "3. Delete",
    text: "Removes it for good, with its roles, groups, permissions and any access people still had. A retired application can be deleted right away. An application nobody uses can be deleted without retiring it first.",
    title_id: "3. Delete",
    text_id: "Aplikasi dihapus permanen, beserta role, grup, permission, dan akses yang masih dimiliki orang. Aplikasi yang sudah di-retire dapat langsung dihapus. Aplikasi yang tidak digunakan siapa pun boleh dihapus tanpa di-retire terlebih dahulu.",
  },
];

export const HUB_REMOVAL_NOTE =
  'It can only be retired or deleted after every other application is removed, because removing it locks everyone out of the Hub.'

export const HUB_REMOVAL_NOTE_ID =
  'Hub baru dapat di-retire atau dihapus setelah semua aplikasi lain dihapus, karena jika Hub hilang semua orang terkunci dari Hub.'
