import { Link } from "react-router";
import { TextAction } from "../../../../../components/ui/TextAction.jsx";
import { cn } from "../../../../../lib/cn.js";
import { GithubEnvironmentCard, ServerEnvCard } from "../GithubEnvironmentCard.jsx";
import { Code, DoneWhen, Paragraph, Steps, SubHeading } from "../GuidePieces.jsx";
import { copyText } from "../../../utils/copyText.js";
import { useGuideLang, useT } from "../../../utils/guideLang.js";
import {
  GITHUB_MODES,
  NO_PIPELINE_MODES,
  STANDARD_ENVIRONMENTS,
  checkCommand,
  connectionKeys,
  guideRows,
  ownerMessage,
  putPermissionsCommand,
  rotationSteps,
  syncScript,
  valueModeOf,
  workflowJob,
} from "../../../utils/setupGuide.js";

const NOTE = "rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-4 text-sm leading-6 text-[#745716]";

export function LocalPart({ setup, keys, base, token, short, environment }) {
  const t = useT();
  const checkCall = `curl -i "$${base}${short ? "/application-permissions/me" : "/api/internal/application-permissions/me"}" \\
  -H "Authorization: Bearer $${token}"`;
  const names = keys.map((item) => item.key).join(", ");
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "This is where you try everything first. Nothing here touches staging or production.",
          "Cobalah semuanya di lingkungan lokal terlebih dahulu. Staging dan production tidak terpengaruh.",
        )}
      </Paragraph>
      <div>
        <SubHeading>{t("1. Put the lines in the .env", "1. Isi .env")}</SubHeading>
        <Steps
          items={[
            t(
              `Copy the block from the connection into the .env the application loads when you run it on your machine: ${names}.`,
              `Salin blok dari koneksi ke .env yang dibaca aplikasi saat berjalan di lingkungan lokal: ${names}.`,
            ),
            environment === "development"
              ? t(
                  `The Central address in it is the one you are using now${setup.central_url ? `, ${setup.central_url}` : ""}. Keep it for local work.`,
                  `Alamat Central di dalamnya sama dengan yang sedang Anda gunakan${setup.central_url ? `, ${setup.central_url}` : ""}. Biarkan untuk kerja lokal.`,
                )
              : t(
                  "If you run the application against a Central on your machine, make the connection in that Central and copy its block instead.",
                  "Jika aplikasinya dijalankan dengan Central lokal, buat koneksi di Central itu dan salin bloknya.",
                ),
            setup.hub_address
              ? t(
                  `The Hub address in the block is ${setup.hub_address}. For local work it should be the page you open the Hub at, usually http://localhost:5175. Its backend on 4001 sits behind it.`,
                  `Alamat Hub di blok adalah ${setup.hub_address}. Untuk kerja lokal, gunakan alamat Hub yang Anda buka di browser, biasanya http://localhost:5175. Backend-nya di port 4001 ada di belakangnya.`,
                )
              : t(
                  "If the block has no Hub lines, the Hub has no address yet. Set it in the Hub setup first.",
                  "Jika blok tidak memiliki baris Hub, berarti Hub belum memiliki alamat. Isi alamatnya terlebih dahulu di Hub setup.",
                ),
            t(
              "Take out any older variables for the same thing with other names. An application can read an older name first and never use the new token.",
              "Hapus variabel lama dengan nama lain untuk hal yang sama. Aplikasi bisa saja membaca nama lama terlebih dahulu dan tidak pernah memakai token baru.",
            ),
            t("Restart the application so it reads the file.", "Restart aplikasi supaya file-nya terbaca."),
          ]}
        />
      </div>
      <div>
        <SubHeading>{t("2. Check the connection", "2. Uji koneksi")}</SubHeading>
        <Paragraph>
          {t(
            "One call that proves the address and the token are right. In a terminal where the .env values are loaded:",
            "Satu panggilan untuk memastikan alamat dan token benar. Jalankan di terminal yang sudah memuat nilai .env:",
          )}
        </Paragraph>
        <Code>{checkCall}</Code>
        <Paragraph>
          {t(
            "A 200 means Central knows the token. A 401 means the token or the address is not the one from the connection. Your local Central is usually http://localhost:3000.",
            "200 berarti Central mengenali tokennya. 401 berarti token atau alamatnya bukan yang dari koneksi. Central lokal biasanya di http://localhost:3000.",
          )}
        </Paragraph>
      </div>
      <DoneWhen>
        {t(
          "the call answers 200 and the Connect step on the setup page turns to Connected by itself within a few seconds. If it does not, open Troubleshooting.",
          "panggilan itu menjawab 200 dan langkah Connect di halaman setup berubah menjadi Connected sendiri dalam beberapa detik. Jika tidak, lihat Troubleshooting.",
        )}
      </DoneWhen>
    </div>
  );
}

export function PermissionsPart({ isHub, keys, base, path }) {
  const t = useT();
  const script = syncScript(keys);
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "Roles can only use permissions the application has sent, so this is what lets you make roles.",
          "Role hanya dapat memakai permission yang sudah dikirim aplikasi, sehingga langkah ini harus selesai sebelum Anda dapat membuat role.",
        )}
      </Paragraph>
      {isHub ? (
        <Steps
          items={[
            t("The Hub keeps its permissions in its code and already has the script.", "Permission Hub ada di kodenya, dan skripnya sudah tersedia."),
            t(
              "Run bun run permissions:sync in its backend folder, and bun run permissions:check to compare without changing anything.",
              "Jalankan bun run permissions:sync di folder backend. Gunakan bun run permissions:check jika hanya ingin membandingkan tanpa mengubah apa pun.",
            ),
            t(
              "The deploy workflow runs the same command, see Staging and production.",
              "Workflow deploy menjalankan perintah yang sama, lihat bagian Staging and production.",
            ),
          ]}
        />
      ) : (
        <>
          <Steps
            items={[
              t(
                'List the permissions of your code in a permissions.json file in the repository: { "permissions": [{ "key": "app.use", "description": "Open the app" }] }',
                'Tulis daftar permission di kode Anda dalam file permissions.json di repository: { "permissions": [{ "key": "app.use", "description": "Open the app" }] }',
              ),
              t(
                "Keep the script below as scripts/sync-permissions.mjs. It sends the file and tries again while Central is starting.",
                "Simpan skrip di bawah sebagai scripts/sync-permissions.mjs. Skrip ini mengirim file itu dan mengulang jika Central belum selesai menyala.",
              ),
              t(
                "Run it with node scripts/sync-permissions.mjs. Add it to predev too, so every dev start sends the permissions the way a deploy does.",
                "Jalankan dengan node scripts/sync-permissions.mjs. Tambahkan juga ke predev supaya setiap menjalankan dev, permission ikut terkirim seperti saat deploy.",
              ),
            ]}
          />
          <Code>{script}</Code>
          <TextAction onClick={() => copyText(script)}>{t("Copy Script", "Salin Skrip")}</TextAction>
          <Paragraph>
            {t(
              `The call it makes is PUT {${base}}${path} with the token as a Bearer header. "me" means the application the token was made for. If you take a permission out, Central asks you to confirm once: add "confirm_removals": true to the file for that run.`,
              `Skrip memanggil PUT {${base}}${path} dengan token di header Bearer. "me" artinya aplikasi pemilik token itu. Jika ada permission yang Anda hapus, Central meminta konfirmasi satu kali: tambahkan "confirm_removals": true ke file untuk satu kali eksekusi tersebut.`,
            )}
          </Paragraph>
        </>
      )}
      <DoneWhen>
        {t(
          "the script prints that the permissions were sent, the Permissions step on the setup page is done, and you can add the first role.",
          "skrip mencetak bahwa permission terkirim, langkah Permissions di halaman setup selesai, dan role pertama sudah dapat dibuat.",
        )}
      </DoneWhen>
    </div>
  );
}

export function DeployPart({ setup, isHub, keys, environment, github, mode, applicationId, hrefFor }) {
  const t = useT();
  const lang = useGuideLang();
  const rowsOf = (selected) =>
    guideRows({
      keys,
      applicationId,
      selected,
      environment,
      centralUrl: setup.central_url,
      hubAddress: setup.hub_address,
      organizationId: setup.organization_id,
      mode: valueModeOf(mode),
      lang,
    });
  const job = workflowJob({ keys, isHub, mode });
  const checkBase = rowsOf(github ?? "staging").find((row) => row.target === "github" && row.key === connectionKeys(keys).base)?.value;
  const checkText = checkCommand({ keys, baseValue: checkBase });
  const putText = putPermissionsCommand({ keys, baseValue: checkBase });
  const message = ownerMessage({
    applicationName: setup.application.name,
    keys,
    isHub,
    environment,
    centralUrl: setup.central_url,
    hubAddress: setup.hub_address,
    organizationId: setup.organization_id,
    applicationId,
    lang,
  });
  const noPipeline = NO_PIPELINE_MODES.includes(mode);
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "Staging and production each have their own Central, so each has its own connection: its own token, Organization ID and Hub secret. Make the connection in each Central first. Then keep the two apart. How depends on how you deploy and what you are allowed to change:",
          "Staging dan production memiliki Central masing-masing, sehingga koneksinya juga terpisah: token, Organization ID, dan Hub secret yang berbeda. Buat koneksi di setiap Central terlebih dahulu, lalu pisahkan nilainya. Caranya bergantung pada cara deploy dan hak akses Anda:",
        )}
      </Paragraph>
      <div role="radiogroup" aria-label="How you deploy" className="grid gap-2 md:grid-cols-3">
        {GITHUB_MODES.map((item) => (
          <Link
            key={item.id}
            to={hrefFor("deploy", { github: item.id })}
            role="radio"
            aria-checked={mode === item.id}
            className={cn(
              "flex flex-col gap-0.5 rounded-xl border p-3 text-left transition-colors",
              mode === item.id ? "border-(--mws-burgundy) bg-[#7E15180D]" : "border-(--mws-line) bg-white hover:border-(--mws-burgundy)",
            )}
          >
            <span className="text-sm font-semibold text-(--mws-charcoal)">{t(item.label, item.label_id)}</span>
            <span className="text-xs leading-5 text-(--mws-muted)">{t(item.text, item.text_id)}</span>
          </Link>
        ))}
      </div>

      {mode === "environments" ? (
        <div role="note" className={NOTE}>
          <p className="font-semibold">{t("Not on the Repository secrets page.", "Jangan gunakan halaman Repository secrets.")}</p>
          <p className="mt-1">
            {t(
              "Repository secrets are shared by every branch, so a token put there would be used by both staging and production. Use them only for values that are really the same in both. The token, the Central address and the Hub secret go inside an environment.",
              "Repository secrets digunakan semua branch, sehingga token yang diletakkan di sana digunakan oleh staging dan production sekaligus. Gunakan hanya untuk nilai yang memang sama di keduanya. Token, alamat Central, dan Hub secret harus masuk ke environment.",
            )}
          </p>
        </div>
      ) : null}
      {mode === "prefixed" ? (
        <div role="note" className={NOTE}>
          <p className="font-semibold">{t("Without Environments, the name keeps them apart.", "Tanpa Environments, awalan nama yang memisahkan.")}</p>
          <p className="mt-1">
            {t(
              "Every name gets STAGING_ or PRODUCTION_ in front, and the job picks by branch. Anyone who can write to the repository can use these secrets in a workflow, which is the same for any repository secret. The server and the application keep reading the plain names.",
              "Setiap nama diberi awalan STAGING_ atau PRODUCTION_, dan job memilih sesuai branch. Siapa pun yang dapat menulis ke repository dapat memakai secret ini di workflow, sama seperti repository secret lainnya. Server dan aplikasi tetap membaca nama tanpa awalan.",
            )}
          </p>
        </div>
      ) : null}

      {noPipeline ? (
        <NoPipelineWays mode={mode} rows={rowsOf(github ?? "staging")} environment={github ?? "staging"} keys={keys} isHub={isHub} checkText={checkText} putText={putText} />
      ) : mode === "owner" ? (
        <div className="space-y-3">
          <SubHeading>{t("Send this to the repository owner", "Kirim ini ke owner repository")}</SubHeading>
          <Paragraph>
            {t(
              "Copy the message and send it. It says what to add and where, and the job to put in the workflow. The tokens are not in it: send them to the owner privately once you have them. Meanwhile you can finish On your machine and Send the permissions.",
              "Salin pesan ini lalu kirim. Pesan berisi hal yang perlu ditambahkan beserta lokasinya, serta job untuk workflow. Token tidak disertakan, kirim terpisah kepada owner secara pribadi setelah token tersedia. Sementara menunggu, kerjakan bagian Di lingkungan lokal dan Kirim permission.",
            )}
          </Paragraph>
          <Code>{message}</Code>
          <TextAction onClick={() => copyText(message)}>{t("Copy Message", "Salin Pesan")}</TextAction>
        </div>
      ) : (
        <>
          <Paragraph>
            {t(
              "Only three names are set in GitHub: the address of Central, the token and the Organization ID. The deploy job reads these and nothing else. Every other line of the block is for the server and is not set in GitHub.",
              "Yang diisi di GitHub hanya tiga: alamat Central, token, dan Organization ID. Job deploy hanya membaca ketiganya. Baris lain di blok itu untuk server dan tidak perlu masuk GitHub.",
            )}
          </Paragraph>
          <div className="grid gap-5 2xl:grid-cols-2">
            {STANDARD_ENVIRONMENTS.map((name) => (
              <GithubEnvironmentCard key={name} name={name} here={name === github} rows={rowsOf(name)} mode={mode} />
            ))}
          </div>
          <ServerEnvCard rows={rowsOf(github ?? "staging")} environment={github ?? "staging"} />
          <div>
            <SubHeading>{t("Send the permissions on every deploy", "Kirim permission di setiap deploy")}</SubHeading>
            <div role="note" className={cn("mb-3", NOTE)}>
              <p className="font-semibold">
                {t("Does the repository already have a job that sends the permissions?", "Repository sudah memiliki job yang mengirim permission?")}
              </p>
              <p className="mt-1">
                {t(
                  "Replace it with the job below, or make it read exactly the names in the table above. A job that reads other names finds them empty and fails with \"not set\".",
                  "Ganti dengan job di bawah, atau pastikan job itu membaca persis nama di tabel di atas. Job yang membaca nama lain akan menemukannya kosong dan gagal dengan \"not set\".",
                )}
                {mode === "environments"
                  ? t(
                      " With Environments the job has an environment: line and reads the plain names.",
                      " Dengan Environments, job memiliki baris environment: dan membaca nama tanpa awalan.",
                    )
                  : t(
                      " Without Environments the job has no environment: line and reads the names with STAGING_ or PRODUCTION_ in front.",
                      " Tanpa Environments, job tidak memiliki baris environment: dan membaca nama berawalan STAGING_ atau PRODUCTION_.",
                    )}
              </p>
            </div>
            <Paragraph>
              {t(
                "Add this job to the deploy workflow. It runs after the deploy job and after Central itself is deployed in that environment.",
                "Tambahkan job ini ke workflow deploy. Job berjalan setelah job deploy, dan setelah Central di environment itu selesai di-deploy.",
              )}
              {mode === "environments"
                ? t(
                    " The staging branch uses the staging environment and main uses production, so each takes the values of its own Central.",
                    " Branch staging memakai environment staging dan main memakai production, sehingga masing-masing mengambil nilai dari Central-nya.",
                  )
                : t(
                    " The main branch reads the PRODUCTION_ names and every other branch reads the STAGING_ names. A missing production value is an error, it never falls back to staging.",
                    " Branch main membaca nama PRODUCTION_, branch lain membaca nama STAGING_. Nilai production yang kosong dianggap error, tidak pernah otomatis memakai nilai staging.",
                  )}{" "}
              {t(
                "Change deploy if your deploy job has another name. If the job stops, the message names the value that is missing.",
                "Ganti deploy jika nama job deploy Anda berbeda. Jika job berhenti, pesannya menyebut nilai yang belum ada.",
              )}
            </Paragraph>
            <Paragraph>
              {t(
                "To stop a deploy when Central refuses the list, run this job before the deploy job instead: remove needs: deploy here and add this job to the needs of the deploy job.",
                "Agar deploy berhenti jika Central menolak daftarnya, jalankan job ini sebelum job deploy: hapus needs: deploy di sini, lalu tambahkan job ini ke needs milik job deploy.",
              )}
            </Paragraph>
            <Code>{job}</Code>
            <TextAction className="mt-2" onClick={() => copyText(job)}>
              {t("Copy Job", "Salin Job")}
            </TextAction>
            <Paragraph>{t("It fails the deploy if Central says no.", "Deploy akan gagal jika Central menolak.")}</Paragraph>
          </div>
          <div>
            <SubHeading>{t("Check The Values", "Periksa Nilainya")}</SubHeading>
            <Paragraph>
              {t(
                "Before the first deploy, run this on your machine with the token of that Central. It only reads. A list in the answer means the address and the token are right.",
                "Sebelum deploy pertama, jalankan ini di lingkungan lokal dengan token Central itu. Perintahnya hanya membaca. Jika jawabannya berisi daftar, alamat dan token sudah benar.",
              )}
            </Paragraph>
            <Code>{checkText}</Code>
            <TextAction className="mt-2" onClick={() => copyText(checkText)}>
              {t("Copy Command", "Salin Perintah")}
            </TextAction>
          </div>
        </>
      )}
      <DoneWhen>
        {noPipeline
          ? t(
              "the permissions were sent from where you ran the command, and the setup page in the staging Central shows Connected. Then do the same for production.",
              "permission terkirim dari tempat Anda menjalankan perintah, dan halaman setup di Central staging menampilkan Connected. Setelah itu ulangi untuk production.",
            )
          : t(
              "a deploy of the staging branch ends with the send-permissions job green, and the setup page in the staging Central shows Connected. Then do the same for production.",
              "deploy branch staging selesai dengan job send-permissions hijau, dan halaman setup di Central staging menampilkan Connected. Setelah itu ulangi untuk production.",
            )}
      </DoneWhen>
    </div>
  );
}

export function RotatePart({ keys, environment, isHub, applicationId }) {
  const t = useT();
  const lang = useGuideLang();
  const steps = rotationSteps({ keys, environment, lang });
  return (
    <div className="space-y-5">
      <Paragraph>
        {t(
          "A rotation gives a new value that the application does not have yet. Until it is put in every place the old one lives, something stops working. These are the places, in order.",
          "Rotasi menghasilkan nilai baru yang belum dimiliki aplikasi. Selama nilai itu belum dipasang di semua tempat yang tadinya memakai nilai lama, ada bagian yang berhenti berfungsi. Berikut tempat-tempat yang perlu diperbarui, secara berurutan.",
        )}
      </Paragraph>
      {applicationId && !applicationId.startsWith("<") ? (
        <Paragraph>
          {t("The buttons are on the Connection tab of the application: ", "Tombolnya ada di tab Connection pada halaman aplikasi: ")}
          <Link className="font-semibold underline" to={`/application-access/apps/${applicationId}?tab=connection`}>
            {t("Open The Connection Tab", "Buka Tab Connection")}
          </Link>
          .
        </Paragraph>
      ) : null}
      <div>
        <SubHeading>{t("Rotate the token of this application", "Rotasi token aplikasi ini")}</SubHeading>
        <Steps items={steps.token} />
      </div>
      {isHub ? null : (
        <div>
          <SubHeading>{t("Rotate the Hub secret of this application", "Rotasi Hub secret aplikasi ini")}</SubHeading>
          <Steps items={steps.appSecret} />
        </div>
      )}
      <div>
        <SubHeading>{t("Rotate the Hub's master secret", "Rotasi master secret Hub")}</SubHeading>
        <Steps items={steps.master} />
      </div>
      {isHub ? (
        <div>
          <SubHeading>{t("Rotate the Hub's signing key", "Rotasi signing key Hub")}</SubHeading>
          <Steps items={steps.signingKey} />
        </div>
      ) : null}
      <div>
        <SubHeading>Rotate Everything</SubHeading>
        <Paragraph>
          {isHub
            ? t(
                "On the Hub's setup page, Rotate Key And Secret makes both at once and shows one block for the .env of the Hub. The applications still need their own rotation afterwards.",
                "Di halaman setup Hub, Rotate Key And Secret merotasi keduanya sekaligus dan menampilkan satu blok untuk .env Hub. Setelah itu setiap aplikasi tetap perlu dirotasi sendiri.",
              )
            : t(
                "When this application has its own Hub secret, Rotate Everything on its setup page rotates the token and the Hub secret together and shows one block for the .env.",
                "Jika aplikasi ini memiliki Hub secret sendiri, Rotate Everything di halaman setup-nya merotasi token dan Hub secret sekaligus, lalu menampilkan satu blok untuk .env.",
              )}
        </Paragraph>
      </div>
      <div>
        <SubHeading>{t("No pipeline or GitHub secrets", "Tanpa pipeline atau GitHub secrets")}</SubHeading>
        <Steps items={steps.byHand} />
      </div>
      <div>
        <SubHeading>{t("After you put the values in", "Setelah nilai baru dipasang")}</SubHeading>
        <Steps items={steps.after} />
        <Code>{checkCommand({ keys, baseValue: "" })}</Code>
      </div>
      <DoneWhen>
        {t(
          "the application runs with the new value in every place, and the setup page shows Connected again.",
          "aplikasi berjalan dengan nilai baru di semua tempat, dan halaman setup menampilkan Connected kembali.",
        )}
      </DoneWhen>
    </div>
  );
}

export function TroubleshootingPart({ keys, applicationId }) {
  const t = useT();
  const names = keys.map((item) => item.key).join(", ");
  return (
    <dl className="space-y-4 text-sm leading-6">
      {[
        [
          t("Still nothing after 10 minutes", "Belum ada aktivitas setelah 10 menit"),
          t(
            `The token of the connection has not been used. Check that the .env has ${names}, that no older variable with another name is read first, that the application was restarted, and that the block was made for this application (its ID is ${applicationId}).`,
            `Token koneksi belum pernah digunakan. Periksa bahwa .env berisi ${names}, tidak ada variabel lama bernama lain yang terbaca duluan, aplikasi sudah di-restart, dan blok itu dibuat untuk aplikasi ini (ID-nya ${applicationId}).`,
          ),
        ],
        [
          t("The check answers 401", "Uji koneksi menjawab 401"),
          t(
            "The token or the address is not the one from the connection. Make a new token with Rotate Token and copy the block again.",
            "Token atau alamatnya bukan yang dari koneksi. Buat token baru dengan Rotate Token, lalu salin bloknya kembali.",
          ),
        ],
        [
          t("Permissions do not show up", "Permission tidak muncul"),
          t(
            "The script has to run with the same .env, and Central has to be reachable from where it runs. Run it by hand and read the answer: a 4xx says what to fix.",
            "Skrip harus berjalan dengan .env yang sama, dan Central harus terjangkau dari tempat skrip berjalan. Jalankan manual dan baca jawabannya, kode 4xx menyebut apa yang perlu diperbaiki.",
          ),
        ],
        [
          t("The deploy job cannot see a secret", "Job deploy tidak menemukan secret"),
          t(
            "With Environments the job needs the environment: line. Without them the names need the STAGING_ or PRODUCTION_ in front. A secret added after the run started is not seen by that run.",
            "Dengan Environments, job perlu baris environment:. Tanpa Environments, nama harus berawalan STAGING_ atau PRODUCTION_. Secret yang ditambahkan setelah run dimulai tidak terbaca oleh run itu.",
          ),
        ],
        [
          t("The Hub or the application refuses the other", "Hub dan aplikasi saling menolak"),
          t(
            "After a Hub secret rotation both sides need the new HUB_INTERNAL_SECRET. An old version is refused about a minute after the rotation.",
            "Setelah rotasi Hub secret, kedua sisi perlu HUB_INTERNAL_SECRET yang baru. Versi lama ditolak sekitar semenit setelah rotasi.",
          ),
        ],
      ].map(([question, answer]) => (
        <div key={question}>
          <dt className="font-semibold text-(--mws-charcoal)">{question}</dt>
          <dd className="mt-0.5 text-(--mws-muted)">{answer}</dd>
        </div>
      ))}
    </dl>
  );
}

// Ways to deploy that need no GitHub secrets and no workflow, for a repository nobody can change.
function NoPipelineWays({ mode, rows, environment, keys, isHub, checkText, putText }) {
  const t = useT();
  const script = syncScript(keys);
  return (
    <div className="space-y-5">
      {mode === "komodo" ? (
        <>
          <Paragraph>
            {t(
              "Nothing is set in GitHub. The values go straight into the stack, and the permissions are sent once from the terminal of the container. Do this again whenever the permissions change.",
              "Tidak ada yang diisi di GitHub. Nilainya langsung masuk ke stack, lalu permission dikirim dari terminal container. Ulangi setiap kali permission berubah.",
            )}
          </Paragraph>
          <ServerEnvCard rows={rows} environment={environment} />
          <Steps
            items={[
              t(
                "In Komodo open the stack of the application and put the lines above in its Environment field. Save it.",
                "Di Komodo, buka stack aplikasi dan tempelkan baris di atas ke kolom Environment. Simpan.",
              ),
              t("Redeploy the stack so the container reads them.", "Redeploy stack supaya container membaca nilai barunya."),
              isHub
                ? t(
                    "Open the terminal of the Hub container in Komodo and run bun run permissions:sync.",
                    "Buka terminal container Hub di Komodo, lalu jalankan bun run permissions:sync.",
                  )
                : t(
                    "Open the terminal of the application container in Komodo, in the folder of the application, and run node scripts/sync-permissions.mjs. It reads the values from the environment of the container.",
                    "Buka terminal container aplikasi di Komodo, masuk ke folder aplikasi, lalu jalankan node scripts/sync-permissions.mjs. Skrip membaca nilai dari environment container.",
                  ),
              t(
                "If the container has no scripts/sync-permissions.mjs or permissions.json, use the curl way from a machine that has the file.",
                "Jika container tidak memiliki scripts/sync-permissions.mjs atau permissions.json, gunakan cara curl dari mesin yang memiliki file itu.",
              ),
            ]}
          />
          {isHub ? null : (
            <div>
              <SubHeading>{t("The script, if the repository does not have it yet", "Skripnya, jika repository belum memiliki")}</SubHeading>
              <Code>{script}</Code>
              <TextAction className="mt-2" onClick={() => copyText(script)}>
                {t("Copy Script", "Salin Skrip")}
              </TextAction>
            </div>
          )}
        </>
      ) : (
        <>
          <Paragraph>
            {t(
              "One call, from any machine that can reach Central. Nothing is added to the repository and nothing is set in GitHub. Put the real token where it says the token, and run it in the folder that has permissions.json.",
              "Satu panggilan dari mesin mana pun yang dapat menjangkau Central. Tidak ada yang ditambahkan ke repository dan tidak ada yang diisi di GitHub. Ganti tulisan token dengan token asli, lalu jalankan di folder yang berisi permissions.json.",
            )}
          </Paragraph>
          <Code>{putText}</Code>
          <TextAction onClick={() => copyText(putText)}>{t("Copy Command", "Salin Perintah")}</TextAction>
          <Paragraph>
            {t(
              'A 200 means the permissions were sent. A 4xx says what to fix. If a permission was taken out, Central asks once: add "confirm_removals": true to the file for that run. The values for the server still go in its .env, as in the table of the Hub and application values.',
              'Jawaban 200 berarti permission terkirim, 4xx menyebut apa yang perlu diperbaiki. Jika ada permission yang dihapus, Central bertanya sekali: tambahkan "confirm_removals": true ke file untuk satu kali eksekusi tersebut. Nilai untuk server tetap masuk ke .env-nya, seperti di tabel nilai Hub dan aplikasi.',
            )}
          </Paragraph>
          <ServerEnvCard rows={rows} environment={environment} />
        </>
      )}
      <div>
        <SubHeading>{t("Check The Values", "Periksa Nilainya")}</SubHeading>
        <Paragraph>
          {t(
            "Before the first send, check the address and the token. It only reads. A list in the answer means both are right.",
            "Sebelum mengirim pertama kali, periksa alamat dan token. Perintahnya hanya membaca. Jika jawabannya berisi daftar, keduanya sudah benar.",
          )}
        </Paragraph>
        <Code>{checkText}</Code>
        <TextAction className="mt-2" onClick={() => copyText(checkText)}>
          {t("Copy Command", "Salin Perintah")}
        </TextAction>
      </div>
    </div>
  );
}
