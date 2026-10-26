import { useT } from "../../../utils/guideLang.js";
import { ENVIRONMENT_NAMES } from "../../../utils/startGuide.js";
import { Code, DoneWhen, Paragraph, Steps, SubHeading } from "../GuidePieces.jsx";

const KEY_COMMANDS = `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out hub-sso-private.pem
openssl rsa -pubout -in hub-sso-private.pem -out hub-sso-public.pem`;

export function HowPart({ environment }) {
  const t = useT();
  const name = environment ? (ENVIRONMENT_NAMES[environment] ?? environment) : "";
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "Three things work together. Central knows who may use which application and with what role. The Hub is the page where people sign in and open applications. Each application asks the Hub who the person is and asks Central what they may do.",
          "Ada tiga bagian yang saling bergantung. Central menyimpan siapa boleh memakai aplikasi apa, dengan role apa. Hub adalah halaman tempat orang sign in dan membuka aplikasi. Setiap aplikasi menanyakan identitas pengguna ke Hub, lalu menanyakan hak aksesnya ke Central.",
        )}
      </Paragraph>
      <div>
        <SubHeading>{t("The order", "Urutan kerjanya")}</SubHeading>
        <Steps
          items={[
            t(
              "Run the Hub, then add it here. Its key, token and secret come in one block to copy. Nothing else can start before the Hub can sign people in.",
              "Jalankan Hub, lalu tambahkan di sini. Key, token, dan secret-nya muncul dalam satu blok untuk disalin. Aplikasi lain belum dapat berjalan sebelum Hub siap menerima sign in.",
            ),
            t(
              "Every application gets the Hub address and its connection to Central from that, so Central adds no other application before it.",
              "Alamat Hub dan koneksi ke Central dibagikan ke setiap aplikasi dari sini, karena itu Central menolak aplikasi lain sebelum Hub ada.",
            ),
            t(
              "Deploy each application with the lines Central gives it, then add it here.",
              "Deploy setiap aplikasi dengan baris yang diberikan Central, lalu daftarkan di sini.",
            ),
            t("Make roles, then groups of people, so people have access.", "Buat role, lalu grup orang, supaya mereka dapat akses."),
            t("Choose how people sign in to each application.", "Pilih cara sign in untuk setiap aplikasi."),
          ]}
        />
      </div>
      <div>
        <SubHeading>{t("One of everything per environment", "Setiap environment memiliki set sendiri")}</SubHeading>
        <Paragraph>
          {t(
            "Development, staging and production each have their own Central, their own Hub and their own tokens. A token made in one does not work in another, and the addresses must never be mixed.",
            "Development, staging, dan production masing-masing memiliki Central, Hub, dan token sendiri. Token dari satu environment tidak berjalan di environment lain, dan alamatnya jangan sampai tertukar.",
          )}
          {environment
            ? t(` This page is about the ${name} Central you are in.`, ` Panduan ini untuk Central ${name} yang sedang Anda buka.`)
            : ""}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("What you need", "Yang perlu disiapkan")}</SubHeading>
        <Steps
          items={[
            t("A protected Super Admin account in this Central.", "Akun protected Super Admin di Central ini."),
            t(
              "APP_SECRETS_KEY in this Central's own .env. Without it Central cannot keep the Hub secret and the Secret step shows a warning. Make the line with bun run secrets:key in the server folder, then restart Central.",
              "APP_SECRETS_KEY di .env Central ini. Tanpa itu Central tidak dapat menyimpan secret Hub, dan langkah Secret menampilkan peringatan. Buat barisnya dengan bun run secrets:key di folder server, lalu restart Central.",
            ),
            t(
              "Access to the server where the Hub and the applications run, to set their environment lines.",
              "Akses ke server tempat Hub dan aplikasi berjalan, untuk mengisi environment-nya.",
            ),
            t(
              "Access to the GitHub repository of each one, when it deploys by itself.",
              "Akses ke repository GitHub setiap aplikasi jika deploy-nya otomatis.",
            ),
          ]}
        />
      </div>
      <DoneWhen>
        {t("you know what comes first. Open the next part and start with the Hub.", "Anda sudah tahu urutannya. Lanjutkan ke bagian berikutnya dan mulai dari Hub.")}
      </DoneWhen>
    </div>
  );
}

export function HubPart({ hubUrl }) {
  const t = useT();
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "The Hub comes first because every application is given its address. Central will not add any other application until the Hub is added, and Add Application opens as the Hub until then. The Hub only has to be running when you add it. Its key, token and secret all come in one block at the end, so the .env is filled once.",
          "Hub harus didaftarkan pertama karena alamatnya dibagikan ke semua aplikasi. Sebelum Hub terdaftar, Central menolak aplikasi lain dan Add Application otomatis membuka form Hub. Hub hanya perlu sudah berjalan saat didaftarkan. Key, token, dan secret-nya muncul dalam satu blok di akhir, sehingga .env cukup diisi sekali.",
        )}
      </Paragraph>
      <div>
        <SubHeading>{t("1. Run the Hub", "1. Jalankan Hub")}</SubHeading>
        <Paragraph>
          {t(
            "Deploy the Hub, or start it on your machine. It can run without its .env lines for now, Central only needs to find it at its address. Set what the Hub has always needed: FRONTEND_ORIGIN (the address people open the Hub at, with https), JWT_SECRET, and the Google sign-in lines (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_DOMAIN), as in the Hub's own setup notes. Also set CENTRAL_API_BASE_URL to the address of this Central, ending in /api/internal.",
            "Deploy Hub, atau jalankan di lingkungan lokal. Baris .env dari Central belum perlu ada saat ini, yang penting Central dapat menjangkau alamat Hub. Isi variabel yang selalu dibutuhkan Hub: FRONTEND_ORIGIN (alamat Hub yang dibuka orang, dengan https), JWT_SECRET, dan login Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_DOMAIN), sesuai catatan setup Hub. Isi juga CENTRAL_API_BASE_URL dengan alamat Central ini, diakhiri /api/internal.",
          )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("2. Add the Hub here", "2. Daftarkan Hub di sini")}</SubHeading>
        <Steps
          items={[
            t("Applications, Add Application. The page is the Hub already when none exists.", "Applications, Add Application. Jika Hub belum ada, form-nya otomatis untuk Hub."),
            t(
              "Key: choose Make Signing Key. Central makes the key and keeps only its name and fingerprint. The key itself waits in this page until the last step, so do not close the page before you finish.",
              "Key: pilih Make Signing Key. Central hanya menyimpan nama dan fingerprint-nya, key-nya sendiri disimpan sementara di halaman ini sampai langkah terakhir. Jangan tutup halaman sebelum selesai.",
            ),
            t(
              "Address: type the address of the Hub. Central says Found The Hub. A Hub that does not have the key yet is fine here.",
              "Address: isi alamat Hub. Jika Hub ditemukan, Central menjawab Found The Hub. Hub yang belum memiliki key tidak menjadi masalah pada tahap ini.",
            ),
            t(
              "Secret: Central makes one secret shared by the Hub and the applications that sign in through it, or you paste the one the Hub already has. Applications get their own secret made from it.",
              "Secret: biarkan Central membuat satu secret untuk Hub dan aplikasi yang sign in melalui Hub, atau tempelkan secret yang sudah digunakan Hub. Setiap aplikasi nanti mendapat secret turunannya sendiri.",
            ),
            t("Sign-in: how strictly the Hub checks who may sign in.", "Sign-in: seberapa ketat Hub memeriksa siapa yang boleh masuk."),
            t("Review, then Add Hub.", "Review, lalu Add Hub."),
          ]}
        />
      </div>
      <div>
        <SubHeading>{t("3. Copy the block once", "3. Salin bloknya, hanya muncul sekali")}</SubHeading>
        <Paragraph>
          {t(
            "After Add Hub one block of lines appears, once: the signing key (HUB_SSO_PRIVATE_KEY and HUB_SSO_KEY_ID), the token, the sign-in lines, CENTRAL_ORGANIZATION_ID and the secret. Copy all of it into the Hub's environment and deploy or restart the Hub. HUB_COOKIE_DOMAIN, the parent domain the Hub and the applications on the shared sign-in share, like mws.web.id, can wait until an application uses it.",
            "Setelah Add Hub, satu blok baris muncul dan tidak akan ditampilkan lagi: signing key (HUB_SSO_PRIVATE_KEY dan HUB_SSO_KEY_ID), token, baris sign-in, CENTRAL_ORGANIZATION_ID, dan secret. Salin semuanya ke environment Hub, lalu deploy atau restart Hub. HUB_COOKIE_DOMAIN (domain induk bersama untuk sign in bersama, misalnya mws.web.id) boleh diisi nanti, saat ada aplikasi yang memakainya.",
          )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("4. Check that the Hub publishes its key", "4. Periksa Hub sudah menerbitkan key-nya")}</SubHeading>
        <Paragraph>
          {t("Open ", "Buka ")}
          {hubUrl ? hubUrl : t("the address of the Hub", "alamat Hub")}
          {t(
            "/.well-known/jwks.json in a browser. You should see a block of text that starts with ",
            "/.well-known/jwks.json di browser. Hasilnya harus berupa teks yang diawali ",
          )}
          {`{"keys":[`}
          {t(". An error page there means the key line is missing or broken.", ". Jika yang muncul halaman error, berarti baris key hilang atau rusak.")}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("If the Hub already has a key", "Jika Hub sudah memiliki key")}</SubHeading>
        <Paragraph>
          {t(
            "Choose I Already Have A Key in the Key step and keep its lines in the Hub. To make one by hand, on your machine, once for each environment:",
            "Pilih I Already Have A Key di langkah Key dan biarkan barisnya di Hub. Jika ingin membuatnya sendiri, jalankan ini di lingkungan lokal, sekali per environment:",
          )}
        </Paragraph>
        <Code>{KEY_COMMANDS}</Code>
        <Paragraph>
          {t(
            "HUB_SSO_PRIVATE_KEY is the whole private file as one line with each line break written as \\n, starting with BEGIN PRIVATE KEY (PKCS#8), not BEGIN RSA PRIVATE KEY. The public file is not needed anywhere, the Hub publishes it by itself.",
            "HUB_SSO_PRIVATE_KEY berisi seluruh file private dalam satu baris, dengan setiap baris baru ditulis \\n. Awalannya harus BEGIN PRIVATE KEY (PKCS#8), bukan BEGIN RSA PRIVATE KEY. File public tidak perlu diletakkan di mana pun, Hub menerbitkannya sendiri.",
          )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("5. Send the Hub's permissions", "5. Kirim permission Hub")}</SubHeading>
        <Paragraph>
          {t(
            "The Hub's own deploy does this, from the Hub's GitHub repository. It needs these repository secrets for each environment: CENTRAL_API_BASE_URL_STAGING and CENTRAL_API_TOKEN_STAGING (or the _PRODUCTION pair), and the Komodo webhook URL and secret. Set them before the first push, otherwise that step stops the deploy.",
            "Ini dikirim oleh deploy Hub sendiri, dari repository GitHub Hub. Repository secret yang perlu ada untuk setiap environment: CENTRAL_API_BASE_URL_STAGING dan CENTRAL_API_TOKEN_STAGING (atau pasangan _PRODUCTION), serta URL dan secret webhook Komodo. Isi sebelum push pertama, jika tidak, langkah ini akan menghentikan deploy.",
          )}
        </Paragraph>
      </div>
      <DoneWhen>
        {t("the Hub is in the list of applications and its status says it is connected.", "Hub sudah ada di daftar aplikasi dan statusnya connected.")}
      </DoneWhen>
    </div>
  );
}

export function AppPart() {
  const t = useT();
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "The same way for every application. The Hub has to be added already, Central refuses any other application before that.",
          "Caranya sama untuk semua aplikasi. Hub harus sudah terdaftar, jika belum, Central menolak aplikasi lain.",
        )}
      </Paragraph>
      <div>
        <SubHeading>{t("1. Add it here", "1. Daftarkan di sini")}</SubHeading>
        <Steps
          items={[
            t(
              "Applications, Add Application: name it. The ID is made from the name and cannot change later.",
              "Applications, Add Application: isi nama. ID dibuat dari nama itu dan tidak dapat diubah lagi.",
            ),
            t(
              "Say how the Hub shows it (icon, group, description) and what it may read from Central. Employees is the default.",
              "Atur tampilan di Hub (ikon, grup, deskripsi) dan data Central apa saja yang boleh dibaca. Defaultnya Employees.",
            ),
            t(
              "Set the sign-in address to the page the application really serves for the Hub. Daily and Exima use /auth/sso, Learnspace uses /api/v1/auth/sso. A path the application does not have ends in a Not Found page.",
              "Isi alamat sign-in dengan halaman yang benar-benar disediakan aplikasi untuk Hub. Daily dan Exima memakai /auth/sso, Learnspace memakai /api/v1/auth/sso. Jalur yang tidak dimiliki aplikasi berakhir di halaman Not Found.",
            ),
            t(
              "Add it. A block of environment lines appears once, with the token and CENTRAL_ORGANIZATION_ID. Copy it before you close the box. If you lose it, rotate the token.",
              "Simpan. Satu blok baris environment muncul sekali, berisi token dan CENTRAL_ORGANIZATION_ID. Salin sebelum kotaknya ditutup. Jika terlanjur hilang, rotasi tokennya.",
            ),
          ]}
        />
      </div>
      <div>
        <SubHeading>{t("2. Give the token what the application reads", "2. Samakan akses token dengan kebutuhan aplikasi")}</SubHeading>
        <Paragraph>
          {t(
            "The token only opens the data you picked under Data Access. An application that reads students needs students:read, one that reads who teaches a class needs class_teacher_assignments:read. When a scope is missing, Central answers 403 with the name of the scope, and the application skips that list without saying so on screen. Change it on the application's page, then deploy again if the token changed.",
            "Token hanya membuka data yang dipilih di Data Access. Aplikasi yang membaca data murid memerlukan students:read, yang membaca pengajar kelas memerlukan class_teacher_assignments:read. Jika scope kurang, Central menjawab 403 beserta nama scope-nya, dan aplikasi melewati daftar itu tanpa pesan apa pun di layar. Ubah di halaman aplikasi, lalu deploy ulang jika tokennya ikut berubah.",
          )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("3. Set the environment on the application's server", "3. Isi environment di server aplikasi")}</SubHeading>
        <Steps
          items={[
            t(
              "Put the lines from step 1 in the application's environment on the server, and in its .env on your machine.",
              "Pasang baris dari langkah 1 di environment aplikasi di server, dan di .env lokal.",
            ),
            t(
              "Deploy the application. Central shows it as connected as soon as it calls Central with the token.",
              "Deploy aplikasinya. Statusnya menjadi connected begitu aplikasi memanggil Central dengan token itu.",
            ),
            t(
              "The application sends CENTRAL_ORGANIZATION_ID with every call. Settings shows Matches when it is the one Central made, and Does Not Match when it was copied wrong or taken from another environment.",
              "Aplikasi mengirim CENTRAL_ORGANIZATION_ID di setiap panggilan. Di Settings, Matches berarti sama dengan yang dibuat Central, Does Not Match berarti salah disalin atau diambil dari environment lain.",
            ),
            t(
              "The address of the application is checked every few minutes. If its page says it is down, open that address yourself first.",
              "Alamat aplikasi diperiksa setiap beberapa menit. Jika halamannya menyatakan aplikasi mati, buka alamat aplikasi tersebut secara langsung terlebih dahulu.",
            ),
          ]}
        />
      </div>
      <div>
        <SubHeading>{t("4. Send its permissions", "4. Kirim permission aplikasi")}</SubHeading>
        <Paragraph>
          {t(
            "The application sends its permissions to Central, usually from its own deploy or a command in its repository, with the CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN secrets set for that environment. Roles can only use permissions it has sent, and a deploy that cannot send them stops.",
            "Aplikasi mengirim daftar permission-nya ke Central, biasanya melalui deploy atau perintah di repository, memakai secret CENTRAL_API_BASE_URL dan CENTRAL_API_TOKEN milik environment itu. Role hanya dapat memakai permission yang sudah terkirim, dan deploy yang gagal mengirimnya akan berhenti.",
          )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("5. Roles and groups", "5. Role dan grup")}</SubHeading>
        <Paragraph>
          {t(
            "Make the roles, then the groups of people that get a role. Without a group nobody has access.",
            "Buat role, lalu grup orang yang mendapat role itu. Tanpa grup, tidak ada yang memiliki akses.",
          )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("Notes for the applications we run", "Catatan untuk aplikasi kita")}</SubHeading>
        <Steps
          items={[
            t(
              "Daily Check-in: run the permission sync with the removals confirmed, give its token students:read and class_teacher_assignments:read, fill the role permissions here, and back up the database before the people migration.",
              "Daily Check-in: jalankan sync permission dengan konfirmasi penghapusan, beri tokennya students:read dan class_teacher_assignments:read, isi permission role di sini, dan backup database sebelum migrasi orang.",
            ),
            t(
              "Exima: create the GitHub environments staging and production, each with the Central address and token and the Komodo webhook. The first push to staging creates the branch on GitHub.",
              "Exima: buat environment GitHub staging dan production, masing-masing berisi alamat dan token Central serta webhook Komodo. Push pertama ke staging sekaligus membuat branch-nya di GitHub.",
            ),
            t(
              "MTSS (older): it keeps the Hub code and token way until it reads the shared session.",
              "MTSS (lama): tetap gunakan cara kode dan token Hub sampai dapat membaca sesi bersama.",
            ),
          ]}
        />
      </div>
      <Paragraph>
        {t(
          "Once the application is added, pick it at the top of this page to see its own commands, the GitHub settings per environment and what to do when you rotate the token.",
          "Setelah aplikasinya terdaftar, pilih di bagian atas halaman ini untuk melihat perintah khusus aplikasi itu, pengaturan GitHub per environment, dan langkah saat rotasi token.",
        )}
      </Paragraph>
      <DoneWhen>
        {t(
          "the application is connected, its permissions are sent and a person in a group can open it from the Hub.",
          "aplikasi sudah connected, permission-nya terkirim, dan orang di dalam grup dapat membukanya dari Hub.",
        )}
      </DoneWhen>
    </div>
  );
}

export function SignInPart() {
  const t = useT();
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "Each application has one of two ways to sign people in. You choose it in the application's settings.",
          "Setiap aplikasi memiliki dua pilihan cara sign in, diatur di pengaturan aplikasinya.",
        )}
      </Paragraph>
      <div>
        <SubHeading>Hub Code And Token (Legacy)</SubHeading>
        <Paragraph>
          {t(
            "The Hub hands the application a short code and the application trades it for a token. Each application keeps its own session, so it works for any address. Applications that have not been changed yet use this.",
            "Hub memberi aplikasi kode pendek, lalu aplikasi menukarnya dengan token. Setiap aplikasi menyimpan sesinya sendiri, sehingga cara ini berjalan di alamat apa pun. Aplikasi yang belum diubah masih memakai cara ini.",
          )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>Shared Hub Session</SubHeading>
        <Paragraph>
          {t(
            "Signing in once covers every application. They read the Hub's session from a cookie on the parent domain, so the Hub and the application must be subdomains of the same domain, and the Hub needs HUB_COOKIE_DOMAIN set to it.",
            "Sign in satu kali berlaku di semua aplikasi. Aplikasi membaca sesi Hub dari cookie di domain induk, sehingga Hub dan aplikasi harus berupa subdomain dari domain yang sama, dan HUB_COOKIE_DOMAIN di Hub harus diisi domain itu.",
          )}
        </Paragraph>
        <Paragraph>
          {t(
            "Every application on the shared session has to be under the same parent as the Hub. With the Hub at app.mws.web.id the parent is mws.web.id, so daily.mws.web.id works. web.id alone does not count, and another domain like millenniaws.sch.id never gets the cookie. Central checks the addresses and marks an application on another domain as Different Domain. You can still switch it, but nobody can sign in to it with the shared session and signing out of the Hub does not end a session it still holds. Keep it on Hub Code & Token (Legacy) until it moves.",
            "Semua aplikasi di sesi bersama harus berada di bawah induk yang sama dengan Hub. Jika Hub di app.mws.web.id, induknya mws.web.id, sehingga daily.mws.web.id dapat digunakan. web.id saja tidak dihitung, dan domain lain seperti millenniaws.sch.id tidak akan pernah menerima cookie-nya. Central memeriksa alamat dan menandai aplikasi di domain lain dengan Different Domain. Aplikasinya tetap boleh dialihkan, namun tidak ada yang dapat sign in dengan sesi bersama, dan keluar dari Hub tidak mengakhiri sesi yang masih dipegang aplikasi itu. Biarkan di Hub Code & Token (Legacy) sampai pindah domain.",
          )}
        </Paragraph>
        <Paragraph>
          {t(
            "On your machine a cookie is kept per host name and the port does not count. Open the Hub and the application through the same one, for example localhost for both. An application opened by IP address does not get the cookie of a Hub opened as localhost.",
            "Di lingkungan lokal, cookie disimpan per nama host dan port tidak dihitung. Buka Hub dan aplikasi melalui host yang sama, misalnya localhost untuk keduanya. Aplikasi yang dibuka melalui alamat IP tidak menerima cookie Hub yang dibuka sebagai localhost.",
          )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("Switching", "Berpindah cara")}</SubHeading>
        <Steps
          items={[
            t("Deploy the application with the code that reads the shared session first.", "Deploy aplikasi terlebih dahulu dengan kode yang membaca sesi bersama."),
            t("Set HUB_COOKIE_DOMAIN on the Hub and deploy the Hub again.", "Isi HUB_COOKIE_DOMAIN di Hub, lalu deploy ulang Hub."),
            t(
              "Change the way here. Central keeps the old way open until it has seen the application use the new one.",
              "Ganti caranya di sini. Cara lama tetap dibuka sampai Central melihat aplikasi benar-benar memakai yang baru.",
            ),
          ]}
        />
      </div>
      <DoneWhen>
        {t(
          "the application shows the sign-in way you chose and the warning about waiting for proof is gone.",
          "aplikasi menampilkan cara sign-in yang dipilih dan peringatan menunggu bukti sudah hilang.",
        )}
      </DoneWhen>
    </div>
  );
}

export function CheckPart({ hubUrl }) {
  const t = useT();
  return (
    <div className="space-y-5">
      <Steps
        items={[
          t(
            `Open ${hubUrl || "the Hub"} in a private window and sign in with an account that belongs to a group.`,
            `Buka ${hubUrl || "Hub"} di jendela private, lalu sign in dengan akun yang tergabung di sebuah grup.`,
          ),
          t(
            "The application's card should be there. Open it: you land inside without another sign-in.",
            "Kartu aplikasinya harus ada. Buka kartunya, maka Anda langsung masuk tanpa sign in lagi.",
          ),
          t(
            "Back in Central, the application's page shows Connected and when it last called.",
            "Kembali ke Central, halaman aplikasi harus menampilkan Connected dan kapan terakhir memanggil.",
          ),
          t(
            "Sign out of the Hub. Opening the application again must ask you to sign in.",
            "Sign out dari Hub. Jika aplikasinya dibuka kembali, Anda akan diminta sign in.",
          ),
        ]}
      />
      <DoneWhen>
        {t(
          "a person in a group opens the application from the Hub and signing out of the Hub signs them out of it.",
          "orang di dalam grup dapat membuka aplikasi dari Hub, dan sign out dari Hub ikut mengeluarkan mereka dari aplikasi.",
        )}
      </DoneWhen>
    </div>
  );
}

// The message is what the screen says, so it stays in English. The cause and the fix are written for the reader.
const PROBLEMS = [
  {
    message: "A Hub answers here, but it has no sign-in key yet",
    cause: [
      "The Hub is running but HUB_SSO_PRIVATE_KEY is missing or not a PKCS#8 PEM.",
      "Hub jalan, namun HUB_SSO_PRIVATE_KEY tidak ada atau bukan PEM PKCS#8.",
    ],
    fix: [
      "Add the Hub in Central and copy the block at the end into the Hub's environment, or write your own as one line with \\n for the line breaks. Deploy the Hub again, then open /.well-known/jwks.json to see the keys.",
      "Daftarkan Hub di Central lalu salin blok di akhir ke environment Hub, atau tulis sendiri dalam satu baris dengan \\n sebagai pemisah baris. Deploy ulang Hub, lalu buka /.well-known/jwks.json untuk melihat key-nya.",
    ],
  },
  {
    message: "The Hub runs with another key than the one made here",
    cause: [
      "The Hub still has an older key, or the new lines were not deployed yet.",
      "Hub masih memakai key lama, atau baris barunya belum di-deploy.",
    ],
    fix: [
      "Deploy the Hub with the lines Central showed. If you made the key yourself, carry on, Central cannot tell it apart.",
      "Deploy Hub dengan baris yang ditampilkan Central. Jika key-nya buat sendiri, lanjut saja, Central tidak dapat membedakannya.",
    ],
  },
  {
    message: "Wrong Path or Unreachable on an application",
    cause: [
      "Wrong Path: something answers at the host and port, but not at the sign-in address saved here. Cannot Tell: the server answers every path with a page, as a single-page app does. Unreachable: nothing answers at all, or another application on that port is not running.",
      "Wrong Path: ada yang menjawab di host dan port tersebut, namun tidak di alamat sign-in yang tersimpan di sini. Cannot Tell: server menjawab semua path dengan halaman, seperti aplikasi single-page. Unreachable: tidak ada yang menjawab sama sekali, atau aplikasi lain di port tersebut sedang tidak berjalan.",
    ],
    fix: [
      "Use Check Now on the application, open Edit Details and set the Sign-In Address to the page the application serves for sign-in. Learnspace, for example, signs in at /api/v1/auth/sso, which needs custom paths in the form. Two applications can share a domain only with different paths, and each port on your machine belongs to one application.",
      "Gunakan Check Now pada aplikasi, buka Edit Details lalu isi Sign-In Address dengan halaman sign-in yang disajikan aplikasi. Learnspace, misalnya, masuk melalui /api/v1/auth/sso, sehingga memerlukan path kustom di form. Dua aplikasi hanya dapat berbagi domain dengan path yang berbeda, dan setiap port di mesin Anda hanya milik satu aplikasi.",
    ],
  },
  {
    message: "Add the Hub first",
    cause: ["An application was added before the Hub.", "Aplikasi didaftarkan sebelum Hub."],
    fix: ["Add the Hub, then add the application again.", "Daftarkan Hub terlebih dahulu, lalu daftarkan aplikasinya kembali."],
  },
  {
    message: "Something answers, but it does not look like the Hub",
    cause: ["The address is another website, or the port is wrong.", "Alamatnya ternyata website lain, atau port-nya salah."],
    fix: ["Use the address people open the Hub at, without a path.", "Gunakan alamat yang dibuka orang untuk Hub, tanpa path."],
  },
  {
    message: "Nothing answers at this address",
    cause: [
      "The Hub is down, or Central cannot reach it from where it runs.",
      "Hub mati, atau Central tidak dapat menjangkaunya dari tempatnya berjalan.",
    ],
    fix: [
      "Start the Hub. For a Hub that only runs on your machine, use the anyway option only if you are sure.",
      "Jalankan Hub. Jika Hub hanya berjalan di lingkungan lokal, gunakan opsi anyway hanya jika Anda yakin.",
    ],
  },
  {
    message: "Missing required scope",
    cause: [
      "The token of that application was not given the scope it needs.",
      "Token aplikasi itu belum diberi scope yang dibutuhkan.",
    ],
    fix: [
      "Add the scope to its API client in this Central, or change its data access on the application's page.",
      "Tambahkan scope ke API client-nya di Central ini, atau ubah data access di halaman aplikasi.",
    ],
  },
  {
    message: "One or more scopes do not exist or are inactive",
    cause: ["This Central has not created its scope rows yet.", "Central ini belum membuat data scope-nya."],
    fix: ["Restart Central once, it creates them when it starts.", "Restart Central sekali, scope dibuat saat Central menyala."],
  },
  {
    message: "The deploy stops at sending the permissions",
    cause: [
      "The Central address or token secret is missing in the GitHub repository, or the token is not allowed to send permissions.",
      "Alamat Central atau secret token tidak ada di repository GitHub, atau token tidak memiliki izin mengirim permission.",
    ],
    fix: [
      "Set the secrets for that environment and give the token the permissions scope, then run the job again.",
      "Isi secret untuk environment itu dan beri token scope permissions, lalu jalankan job tersebut kembali.",
    ],
  },
];

export function ProblemsPart() {
  const t = useT();
  return (
    <div className="space-y-4">
      <Paragraph>
        {t(
          "Find the message you saw. The cause and what to do are next to it.",
          "Cari pesan yang Anda lihat. Penyebab dan cara memperbaikinya ada di bawahnya.",
        )}
      </Paragraph>
      <dl className="space-y-3">
        {PROBLEMS.map((item) => (
          <div key={item.message} className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-4">
            <dt className="text-sm font-semibold text-(--mws-charcoal)">{item.message}</dt>
            <dd className="mt-1 text-sm leading-6 text-(--mws-muted)">{t(...item.cause)}</dd>
            <dd className="mt-1 text-sm leading-6 text-(--mws-muted)">{t(...item.fix)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
