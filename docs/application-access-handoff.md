# Application Access: catatan serah terima

Branch kerja: `feat/role-registry` (belum di-push, belum di-merge). Semua kode sudah di-commit. Balas user dalam bahasa Indonesia. Ikuti aturan di `CLAUDE.md` repo (commit satu baris `feat:`/`update:`/`fix:`/`docs:`, tanpa trailer Claude, jangan nested include pada write Prisma, komentar singkat, alur feature, staging, main).

## Gambaran fitur
Super Admin mengatur siapa yang boleh membuka tiap aplikasi (exima, daily-checkin, hub, dst.) dan dengan role apa. Satu sumber kebenaran RBAC di Central. Aplikasi lain membaca lewat `GET /api/internal/application-entitlements/lookup` (kontrak tidak berubah: role, permissions, version, organization_id; akses dari group mengembalikan `id: group:<ruleId>`, `version: 0`).

Konsep:
- **Aplikasi**: dibuat dengan satu isian Application ID (huruf kecil, angka, `-`, `_`; spasi otomatis jadi `_` di form). Organization ID dibuat otomatis sekali, tidak pernah diketik.
- **Role**: kunci `UPPER_SNAKE` per aplikasi, urutan manual (`rank`, 0 = tertinggi, ditampilkan paling atas di semua pilihan role). Role baru masuk paling bawah. Dilarang ada dua role aktif dengan himpunan permission sama persis dalam satu aplikasi (create dan ubah permission; mengaktifkan kembali ke bentrokan juga ditolak).
- **Group** (`ApplicationAccessRule`): audience (EMPLOYEES, STUDENTS, EMPLOYEES_AND_STUDENTS) ditambah scope unit, job position, job level (daftar kosong = semua). Dasar akses sebuah aplikasi.
- **Exception** (`ApplicationEntitlement`): akses per orang, hanya boleh di dalam scope sebuah group dan dengan role berbeda dari group itu. Boleh diblokir (revoke). Orang yang dipegang group yang lebih sempit tidak muncul sebagai kandidat group yang lebih luas (exception mereka ditambahkan di group sempit).
- **Aturan hierarki** (server, `application-access-gate.ts`): paling spesifik menang; group dalam group tidak boleh memberi role yang sama dengan induk terdekatnya; group tidak bisa dihapus/dimatikan/dipersempit selama masih ada exception atau group anak yang bergantung padanya (pesan menyebut nama); melebarkan group tidak boleh membuat group/orang di dalamnya jadi redundan; orang yang diblokir tetap diblokir.
- **Aturan master data untuk scope** (`application-scope-rules.ts`): kombinasi (unit, posisi, level) hanya sah bila posisi diizinkan di unit (`MasterJobPositionUnit`, daftar kosong = semua unit), level diizinkan di unit (`MasterJobLevelUnit`), dan pasangan posisi-level cocok (`jobPositionAndJobLevelAreCompatible` di `utils/employee-role-rules.ts`: teaching dengan teaching, Special Education Teacher hanya dengan SE Teacher). Server menolak simpan scope yang berisi nilai yang tidak mungkin ada orangnya (`assertScopeCanHoldPeople`, hanya untuk audience karyawan, dan hanya bila scope diubah). Unit sentinel "Unknown / Legacy" (konstanta di `server/src/utils/legacy-unit.ts`, `client/.../utils/legacyUnit.js`) ditolak server dan disembunyikan di UI.

## Peta kode
Server (`server/src`):
- `service/application-entitlement-service.ts`: `ApplicationEntitlementService`, `ApplicationRoleService` (list, create, reorder, update), `ApplicationOrganizationService`, `ApplicationAccessRuleService` (create/update/delete, `assertRuleReferences`), `ApplicationAccessService` (applications, createApplication, `application()` detail grup dengan `covered_count`, `own_count`, `remaining`, `exceptions()`, `candidates()`, `roleOptions()`, `scopeCatalog()`).
- `service/application-access-gate.ts`: `ruleSpecificity`, `covers`, `parentRule`, `inheritedRole`, `loadGateState`, `checkRuleGate` (opsi `roleOnly`), `assertRuleGate`, `assertPersonException`.
- `service/application-scope-rules.ts`: katalog master, `buildFeasibility().combos`, `projection`, `scopePairFits`.
- `controller/admin/application-entitlement-controller.ts`, `routes/admin/application-role-router.ts` (rute `/api/admin/application-access/...`: `applications`, `apps/:id`, `apps/:id/exceptions`, `apps/:id/role-options`, `scope-catalog`, `candidates`), `validation/application-entitlement-validation.ts`, `model/application-entitlement-model.ts`.
- Migrasi: `20261006090000_application_role_rank` (kolom `rank`, enum audit `APPLICATION_CREATE`).
- Test: `src/test/application-role.test.ts`, `application-entitlement.test.ts`, `application-access-rule.test.ts`, `application-access-gate.test.ts`, `application-access-apps.test.ts`.

Klien (`client/src/features/application-access`):
- Halaman: `ApplicationAccessPage` (daftar aplikasi, paging server), `AppCreatePage`, `AppAccessPage` (tab Access dan Roles, `?tab=`), `GroupFormPage`, `GroupAccessEditPage`, `ExceptionAddPage`, `RoleFormPage` (rute di bawah `/application-access/apps/:applicationId/...`).
- Komponen utama: `GroupCard` (baris ringkas yang bisa dibuka, akordion satu per satu), `ExceptionsCard` (card exception di bawah tiap group), `ExceptionsPanel` (tabel, paging server per group atau `other`), `GroupSummary` (ScopeGrid, GroupFacts, RemainingScope, RolePill), `ListPopover` dan `PermissionPopover` (daftar ter-portal; scroll di dalam daftar tidak menutupnya), `GroupFilters` + `MultiCheckList` (chip), `AppRolesTab`, `CopyableId`, `RoleName`, `Tip`.
- Util dan hook: `utils/scopeRules.js` (aturan scope murni dari katalog server: `combos`, `allowedValues`, `settle`), `utils/groupFilterState.js` (`useGroupFilterState(initial, rules)`), `hooks/useScopeCatalog.js`, `hooks/useRoleAvailability.js`, `hooks/useApplicationRoles.js`, `utils/roleOptions.js`, `utils/groupSummary.js`.
- Test: `client/test/features/application-access/*` (bun, jsdom). Catatan: ada sesuatu di luar sesi ini yang memformat ulang file (tanda kutip ganda, titik koma) setelah diedit; baca ulang file sebelum edit string.

## Cara menjalankan test
Server (butuh DB yang namanya mengandung "test"): ada kontainer `mws-claude-testdb` (port 5499, DB `mws-center-test`, user `root`, sandi `t`, migrasi sudah dideploy, master data di-seed).
```
cd server
export DATABASE_URL="postgresql://root:t@localhost:5499/mws-center-test?schema=public"
bun run typecheck
bun test src/test/application-access-apps.test.ts   # jalankan per file
```
Kontainer itu sementara; hapus dengan `docker rm -f mws-claude-testdb` bila sudah tidak perlu. Klien: `cd client && bun test test/features/application-access && bunx eslint src test && bun run build`.
Jangan reset sequence `admin_no` dan jangan memulihkan DB dev tanpa tanya (lihat memori proyek).

## Keputusan desain dari user (jangan dibalik tanpa tanya)
- Gaya UI: tombol aksi kecil berupa ikon (Add role, Add exception, Add permission, Manage). Tidak ada tombol Copy; klik teks id langsung menyalin (tanpa background, pointer, hover burgundy). Nama role selalu burgundy tebal (`RoleName`). Angka di kolom Roles/Groups/Exceptions rata tengah. Hitungan ditulis `3 Employees`, `0 Exceptions`. Jangan pakai teks berformat "Label - penjelasan" atau em dash di UI (terdengar AI).
- Scope di baris group ditulis hitungan (`All Units · 12 Positions · All Levels`), nama lengkap ada di badan yang dibuka lewat `N units` yang bisa diklik.
- Group luas dengan group anak menampilkan blok "After Narrower Groups": kiri "Still held by this group" (nilai `All`, `All except N`, `N positions`, nama tunggal, atau `None left`), kanan "Taken by narrower groups" dengan grid yang sama.
- Pilihan role di Add group hanya memuat role yang tidak bentrok (server menjawab lewat `role-options`, aturan identik dengan saat simpan).
- Kandidat exception tampil sebagai tabel berkolom dengan paging dan filter (unit, posisi, level, employment type), tanpa filter Current role (dihitung di memori, akan merusak paging).

## Bug terbuka (kerjakan ini dulu)
Di Add group (dan Edit group), pada daftar Units/Positions/Levels: user melepas posisi yang "ada di unit MAD Lab" tetapi **chip unit MAD Lab tidak ikut terhapus**. Harapan user: bila tidak ada lagi posisi (atau level) terpilih yang bisa ada di MAD Lab, unit itu ikut hilang, dan sebaliknya (cascade dua arah, dengan catatan "Also removed because they no longer fit the other choices").

Logika ada di `client/src/features/application-access/utils/scopeRules.js` (`settle(selection, changed, { wipe })`) dan `utils/groupFilterState.js`. Diagnosis sejauh ini:
1. `settle` sudah bekerja untuk kasus bersih. Simulasi dengan data uji: unit `[MAD]`, posisi `[Tutor]` (hanya di Elementary) setelah mengubah posisi menghapus MAD; unit `[MAD]`, posisi `[Tutor, Aide]` **tidak** menghapus MAD, karena `Aide` tidak dibatasi unit (`unit_ids: []`) sehingga menurut master data sah ada di MAD Lab. Kemungkinan besar inilah yang terlihat user: posisi yang tersisa adalah posisi "semua unit", jadi unit dianggap masih punya pendukung. Aturan master data memang begitu ("Empty allows this position in any unit").
2. Kemungkinan lain yang perlu diperiksa langsung di browser: (a) saat "All Positions" aktif lalu satu per satu dilepas, `toggle` di `MultiCheckList.jsx` membentuk daftar dari `items` yang sudah disaring `allowed`, jadi daftar eksplisit hanya berisi posisi yang sah untuk unit terpilih; (b) bila Units masih `All`, pilihan All tidak pernah dipangkas (hanya chip yang disaring), jadi "unit tidak terhapus" bisa berarti `All Units` tetap menyala; (c) `rules` (katalog) belum termuat saat klik, sehingga tidak ada cascade (lihat helper `rulesLoaded` di `GroupFormPage.test.jsx`).
3. Keputusan yang perlu dikonfirmasi ke user sebelum mengubah perilaku: apakah posisi/level yang tidak dibatasi unit (sah di semua unit) boleh dianggap mendukung sebuah unit? Pilihan: (i) tetap (sesuai master data) tetapi tampilkan petunjuk mengapa unit bertahan, mis. "MAD Lab stays because Aide and Coach exist in every unit"; (ii) hanya hitung posisi yang secara eksplisit mencantumkan unit itu untuk mendukung pilihan unit eksplisit (lebih sesuai harapan user, tetapi bertentangan dengan server yang menerima kombinasi itu, jadi server dan `settle` harus disamakan atau ada aturan khusus UI). Rekomendasi: reproduksi dulu di browser dengan data master asli, pastikan skenario mana (1 atau 2a/2b/2c), baru pilih.
4. Mengosongkan satu daftar (melepas nilai terakhir lewat chip, bukan lewat tombol All) mengosongkan pilihan eksplisit di dua daftar lain (`wipe`), karena tidak ada lagi yang mendukungnya. User sudah diberi tahu dan bisa meminta versi yang lebih lunak (hanya menandai).

Uji regresi yang harus ada setelah perbaikan: `client/test/features/application-access/scopeRules.test.js` (murni) dan `GroupFormPage.test.jsx` ("drops what only existed because of an unchecked unit and says so").

## Hal lain yang belum dikerjakan
- Panduan integrasi aplikasi: `docs/application-access-integration.md`. Hub sudah generik (kolom Central entitlement app id per aplikasi), tapi Daily Check-in perlu penyesuaian aturan `version` sebelum gerbang Central dinyalakan untuknya.
- Hub, Exima, Daily Check-in belum membaca role dari Central dengan kunci `UPPER_SNAKE` baru (perlu branch tindak lanjut di repo masing-masing dan koordinasi deploy; sesi UserSession dipotong saat deploy migrasi SSO, lihat memori proyek).
- Merge: feature branch ke `staging` dulu, baru `staging` ke `main`. Jangan push tanpa diminta.
- Review pasca-fitur (RBAC, soft-delete, audit, race condition) sesuai `CLAUDE.md` belum dilakukan untuk fitur ini.

## Riwayat commit (terbaru di atas)
`77a05cb2` picker scope mengikuti master data dua arah + blok Taken seragam; `f6826a2b` endpoint `scope-catalog`; `a4e60a7e` baris group hitungan dan blok dua kolom; `71860eeb`, `fad5675d` aturan scope master data; `54353949` own_count dan remaining; `9440797a` baris group bisa dibuka; `c8d7c38e` role-options dan unit sentinel; `0ef1c6ed`, `28012f75`, `8ea61b02` polish tab Roles dan kartu group; `653b045a` gate role kembar; sebelumnya `4dffc1e4`, `aa206548`, `e50d4716`, `fb7000ae`, `6a47b4c3`.

## Moving the Hub catalog into Central

The Hub shows every app that is published in Central, so its own Application Catalog table can be emptied once the apps live here.

1. Deploy Central first. It has a new migration (`launch_mode`).
2. In the Hub backend: `bun run export:catalog catalog.json`.
3. In Central server: `bun run import:hub-catalog catalog.json --dry-run`, then again without `--dry-run`. Add `--publish` to publish apps that have a launch address. Apps with no single sign-on address become plain links. Existing apps are never touched.
4. For each imported app, add its roles and groups, then publish it.
5. In the Hub backend: `bun run prune:catalog` shows what would go, `bun run prune:catalog --confirm` deletes the rows Central now covers.

## Adding the Hub in production

The Hub is the application whose id equals `HUB_APPLICATION_ID` in Central's `.env` (default `hub`). There is no separate flag. Check that value matches before adding it.

Add it once from Add Application with "This is the Hub itself" ticked. After that it cannot be retired, deleted or renamed, and the tick box disappears. Central asks for a confirmation before it is created. Put your own email under "Emails That Always Get In" and keep Warn mode until everyone who should get in has access.

## Emergency sign-in and exceptions

"Emergency Sign-in" on the Hub's setup page lists up to 3 people who skip the Hub's Central access check. It only shows in Enforce mode, since Warn and Off turn nobody away. They still sign in through Central, so someone who is not in Central cannot get in this way. It gives no Hub admin rights and no access to other apps. Use it for one or two admins so a wrong group setup or a Central outage cannot lock them out. Every such sign-in is written to the Hub's audit log as `hub.login_bypass`. Everyone else gets access through a group or an exception. Only millennia21.id emails are accepted, typed as the name alone.

After changing the sign-in settings use Copy Sign-in Lines on the same page. It shows the three lines before copying them. Restart the Hub after pasting. The token does not change.

## Syncing permissions

Every application tells Central which permissions its code knows. In production that belongs in the deploy pipeline, after Central is deployed (the Hub runs `bun run permissions:sync` there). On a local machine there is no pipeline, so run the sync by hand or let the application send it on start. The Setup Guide on an application's setup page (the Setup Guide link on its Connect step, or More actions) shows the exact names and commands for it, including a table of what to add in GitHub (Settings, Secrets and variables, Actions: the token and secrets as Secrets, the rest as Variables) and a workflow step that sends the permissions on every deploy.

## Scopes and categories

Two lists live in Central under Master Data > Scopes & Categories. A **category** is the kind of tool (Reporting, Students, Workplace, Operations, Utilities). A **scope** is the product space (Safespace, Learnspace, Carespace, Shieldspace). An application has one category and may have one scope, both picked in its details. More can be added there at any time. A row's key is made from its name when it is created and never changes, so renaming is safe. A row that applications still use cannot be deleted.

The Hub does not keep these lists. It reads them from Central (`GET /api/internal/application-taxonomy`, same token and cache as the published applications) and falls back to the original five categories if Central cannot be reached. The Hub shows a second row of scope filters once at least one application has a scope.

Deploy order: the Central migration first (it creates the two tables and fills them), then Central, then the Hub.

## Seeing which endpoints a connection can call

Under each scope in Data Access, "N endpoints" lists the endpoints that scope opens, and the setup page shows how many endpoints the connection can call as a whole. The same list is the API Reference page. It is written in `server/src/constants/internal-api-endpoints.ts`, and a test compares it with the real internal routes, so a new endpoint cannot be left out.

## Hub values in every .env

The .env block of an application also carries what it needs from the Hub: `HUB_BASE_URL`, `HUB_SSO_JWKS_URL` (the base URL plus `/.well-known/jwks.json`) and `HUB_INTERNAL_SECRET`. The Hub's own block carries the same secret. They come from the Hub's setup page in Central, so the order is:

1. Add the Hub (or open its setup page if it exists) and fill in the Hub Address.
2. Generate the Hub Secret. If the Hub and its applications already run with a secret, use "Use The Hub's Current One" and paste it, so nothing has to change.
3. Create the connection of each application. Its block now includes the Hub lines. An application made before the Hub had an address shows a note and gets the lines after its token is rotated.

The secret is kept encrypted with `APP_SECRETS_KEY` in Central's `.env`. Make one with `openssl rand -base64 32` and set it on every Central deploy before adding the Hub. Without it the secret cannot be made or read, and the page says so. Do not change the key afterwards, or the stored secret cannot be read any more (paste it again to fix that). "Rotate Secret" makes a new one; the Hub and every application need the new value. Changing the secret is written to the audit log, never the value.

## The Hub wizard, and who takes the Hub lines

The Hub's address, its shared secret and its sign-in settings depend on each other, so they are one wizard: Address, Secret, Sign-in, Review. It runs when the Hub is added and can be opened again from the Hub's setup page ("Open Setup Wizard"), where each step saves as you go. Making, replacing or pasting the secret always asks first and lists the applications it reaches.

The address and the secret are one value for everything. Whether an application takes them is its own choice: "Signs in through the Hub" in its details. Turn it off for an application that does not use the Hub's sign-in and its .env will not carry the three Hub lines.

If the page says Central cannot keep a secret, `APP_SECRETS_KEY` is missing from Central's `.env`. Run `bun run secrets:key` in the server folder, put the line in `.env` and restart Central. In Docker, `docker-compose.yml` passes it through from the host environment.

The Hub can be retired and deleted once it is the only application left in Central. While others exist, it waits for them.

The Hub secret is shown once, like a token. When Central makes it (Generate or Rotate) a dialog shows it masked with one button that copies the line, and it cannot be read again. After that it only reaches an .env through the block shown when a token is made or rotated, again masked and copied. A secret that was pasted is not shown, since whoever pasted it already has it. If it is lost, rotate it.

## A Hub secret for each application

The Hub secret is a master that only the Hub and Central hold. Each application gets its own secret made from it (the master, the application id and a version), so a secret that leaks only opens that application. Central puts it in the application's `.env` as `HUB_INTERNAL_SECRET`, and the Hub makes it again to check it.

New applications get their own secret. Older ones keep using the master until you open their setup page and choose "Give Its Own Hub Secret", put the new value in their `.env` and deploy. "Rotate Hub Secret" on the same page replaces it, and the old one stops working after the Hub refreshes its catalog (about a minute). Rotating the master in the Hub setup changes every secret.

Deploy the Hub first (it accepts both kinds), then Central. When every application has its own secret, set `HUB_ALLOW_SHARED_SECRET=false` in the Hub's `.env` so the master is no longer accepted from applications.

## Staging and production

Staging and production each run their own Central (`DEPLOYMENT_ENVIRONMENT` tells it which), and a connection belongs to the Central that made it. So an application needs a connection in each: a different token, a different Organization ID and a different Hub secret. In GitHub, make two Environments, `staging` and `production`, and add the same names in each with the values of that Central. The deploy workflow picks the environment from the branch (`staging` or `main`), and the Setup Guide has the job to copy. The same values also go into the environment the application runs in on the server.

Set `HUB_PUBLIC_URL` on each Central so Add Hub suggests the address of that environment instead of a production-shaped example. Staging uses `https://app-stg.mws.web.id`; production uses `https://app.mws.web.id`. The value is only a starting point in the form and is still checked against the Hub JWKS endpoint before it can be saved.

## The Setup Guide, in order

The guide on an application's setup page now goes in the order things are done: put the lines in the `.env`, check the connection with one call, send the permissions, then staging and production.

For the permissions, the permanent way is a script kept in the application's repository (`scripts/sync-permissions.mjs`, copied from the guide) that sends `permissions.json` and tries again while Central starts. The same command runs on a machine, from `predev`, and in the deploy workflow, so local runs behave like a deploy. curl is only for the one-off check in step 2. The Hub uses its own `bun run permissions:sync`.

Step 4 has a Staging | Production switch. It opens on the environment of the Central you are looking at and fills in what is known there (the application ID, that Central's address, its Organization ID, the Hub address). For the other environment it says where to get the values instead of guessing. Tokens and secrets are never filled in.

## The Setup Guide is a page

The guide lives at `/application-access/apps/:id/guide` (links from the Connect step, More actions, the application page, and the dialogs that show a new token or secret). It has four parts: First setup, Staging and production with GitHub, When you rotate, and Troubleshooting.

Staging and production are kept apart with two GitHub **Environments** (Settings, Environments), each holding its own secrets and variables under the same names. The Repository secrets page is shared by every branch, so a token or Central address put there would be used by both. The guide shows one card per environment with what to add in it, and fills in values only for the Central you are looking at.

After a rotation the dialog that shows the new value lists what to do now (replace it in the `.env`, in the GitHub environment of that Central, then deploy or restart), with a link to the full steps for a token, a per-application Hub secret and the Hub master secret.

## The guide goes one part at a time

The Setup Guide shows six numbered parts, one per screen, with Back and Next and a list of the parts that stays in view: Before you start, On your machine, Send the permissions, Staging and production, When you rotate, Troubleshooting. The part is kept in the address (`?part=`), which is how the links from other pages land in the right place. Each part ends with what you should see before going on.

On your machine comes first, since that is where everything is tried. Staging and production adapts to what you may change in GitHub: Environments (owner or admin), repository secrets named with a STAGING_ or PRODUCTION_ in front (no Environments menu), or a ready message for the repository owner when the settings are read only. The application keeps reading the plain names. Only GitHub sees the prefix.

## The Hub address is checked

Typing a Hub address no longer lets you go on by itself. Central asks `GET /api/admin/application-access/hub-address-check?url=` (Super Admin), which fetches `{url}/.well-known/jwks.json` and answers `ok`, `unreachable`, `not_hub` or `refused`. Code is `server/src/service/hub-address-check.ts`. No redirects, 4s timeout, 64KB cap, and `169.254.*` and `metadata.google.internal` are refused.

`HubAddressField` waits 600ms after typing, shows the result under the field, and tells the wizard (or the Hub card) the address is not ready until it is `ok`. `unreachable` has a Use It Anyway link with a confirm, for a Hub that only runs on a laptop while Central runs on a server. `not_hub` has no way around. An address that is the one already saved is not checked again. Production also rejects local, private, `.local`, `.test` and dotless hosts before asking.

Locally the Hub address is the Vite page, `http://localhost:5175`, not the backend on 4001. Vite forwards `/auth`, `/apps`, `/sso`, `/admin/api` and `/.well-known` to 4001. This matches `mws-hub/README.md`.

## Testing a pasted Hub secret

"Use The Hub's Current Secret" has a Test This Secret button. Central sends the pasted value in the `x-hub-internal-secret` header to the Hub's `POST /sso/secret-check` (Hub commit `94c170d`) and gets back only a verdict: `ok`, `wrong`, `unreachable`, `no_check` (a Hub without the route) or `refused`. Continue and Use This Secret stay off until `ok`. `unreachable` and `no_check` allow Use It Anyway, `wrong` does not. The endpoint is `POST /api/admin/application-access/hub-secret-check` (Super Admin); without an address in the body it asks the Hub address that is kept. The secret is never stored or logged by the check. Make A New Secret is not tested, since the Hub only has the value after it is put in its .env.

A pasted `.env` line is reduced to its value (`cleanPastedSecret`, server and client). Another variable's line (`CENTRAL_API_TOKEN="..."`) or an API token (`mws_`) is refused. Deploy the Hub before Central.

## The application address is checked

In Add and Edit Application the address of the application (host and port, not `/auth/sso` or `/auth/logout`) is asked through `GET /api/admin/application-access/application-address-check?url=` (Super Admin). Central does `GET {origin}/` without following redirects and answers `ok` for any status under 500, `unreachable` for no answer, a timeout or a 502 to 504, `refused` for what it must not ask (same rules as the Hub address check). Add Application and Save wait for `ok`, or for Use It Anyway after a confirm when nothing answers (an application that only runs on a laptop). An address kept as saved is not asked again. An address with a mistake in it is not asked, the form shows the mistake on submit instead.

`useAddressCheck` (hook) and `AddressCheckStatus` (the line under the field) are shared with the Hub address field.

## App Display in the Hub

The Hub's admin catalog no longer creates or edits applications. Central owns name, icon, address, category, scope and access. The Hub keeps how a card is shown (status, found in search, keywords) in its own table `application_display` (Hub commit `a0366b5`, migration `20261012090000_add_application_display`), edited at `/admin/display`. A Hub row that still covers the same application wins over it, so a legacy row keeps its own status until it is pruned. Deploy the Hub (with its migration) before anything else; Central has no change for this.

## One set of .env names for every application

Every application except the Hub gets the same block from Central, only its id, token and organization differ:

| Line | Meaning |
| --- | --- |
| `HUB_SSO_APP_ID` | the application id |
| `CENTRAL_API_BASE_URL` | Central's address, already ending in `/api/internal` |
| `CENTRAL_API_TOKEN` | the token of this application |
| `CENTRAL_ORGANIZATION_ID` | the Central organization of this application |
| `HUB_BASE_URL`, `HUB_SSO_JWKS_URL`, `HUB_INTERNAL_SECRET` | the Hub lines |

Before this, Exima read `CENTRAL_DATA_API_BASE_URL` (no `/api/internal`) and `CENTRAL_DATA_API_TOKEN`, and Daily Check-in read `CENTRAL_ENTITLEMENT_ORGANIZATION_ID`. Both still read their old names as a fallback, so deploy the application first, then copy the new block and move the GitHub secrets. A new application only needs the block. The Hub keeps `CENTRAL_API_*` plus its own `HUB_CENTRAL_ACCESS_*` lines.

## Roles in bulk, Settings, and the Hub card in Central

- **Add Roles** (`/application-access/apps/:id/roles/bulk`, also `roles/new`) is a matrix: one column per new role, one row per permission, saved together. Role labels are plain words (letters, numbers, single spaces) and the key is made from the label.
- **Settings** (`/application-access/apps/:id/settings`) is what a finished application opens instead of the setup steps: details, connection (token, Hub secret, data access), the Hub card, access shortcuts and removal, with the Setup Guide one click away. `Application.setup_completed_at` is set the first time the application is shown in the Hub and is not taken back by hiding it again. `/setup` redirects to Settings once it is set or every step is done.
- **Hub card**: `hub_status` (active, maintenance, coming_soon, new) and `hub_keywords` are set in Central on the form and in Settings and reach the Hub in `/api/internal/applications` as `status` and `keywords`. The Hub's own App Display page and table are gone.
- Migrations to run on every Central: `20261017090000_application_setup_completed` and `20261018090000_application_hub_card`. Until they are applied, `/api/internal/applications` fails with a 500 because the new columns are missing, and the Hub shows no cards from Central. Run them before the Hub is pointed at this Central.
