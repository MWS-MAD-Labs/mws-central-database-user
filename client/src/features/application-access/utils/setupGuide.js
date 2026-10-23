export const STANDARD_ENVIRONMENTS = ['staging', 'production']

// The key that holds the address of Central and the one that holds the token, from the names an application reads.
export function connectionKeys(keys) {
  const base = keys.find((item) => item.key.endsWith('_BASE_URL') && item.key.startsWith('CENTRAL'))?.key ?? 'CENTRAL_API_BASE_URL'
  const token = keys.find((item) => item.secret && item.key.endsWith('_TOKEN'))?.key ?? 'CENTRAL_API_TOKEN'
  // An address that already ends in /api/internal takes the short path.
  const short = base === 'CENTRAL_API_BASE_URL'
  return { base, token, short, path: short ? '/application-permissions/me' : '/api/internal/application-permissions/me' }
}

// Which environment the guide opens on: the one of the Central being looked at, when it is one of the two.
export function startingEnvironment(environment) {
  return STANDARD_ENVIRONMENTS.includes(environment) ? environment : 'staging'
}

// The rows of the table of GitHub settings for one environment. A value is only filled in when it is known for
// that environment, which is the Central being looked at. For the other one it is null and the row says where to
// get it. Tokens and secrets are never filled in: they are shown once, when they are made.
export function guideRows({ keys, applicationId, selected, environment, centralUrl, hubAddress, organizationId, mode = 'environments', lang = 'en' }) {
  const L = (en, id) => (lang === 'id' ? id : en)
  const { base, token, short } = connectionKeys(keys)
  const here = selected === environment
  const hub = hubAddress ? hubAddress.replace(/\/+$/, '') : null
  return keys.map((item) => {
    // Only three names are read by the deploy pipeline. Every other line of the block is read by the server.
    const inPipeline = item.key === base || item.key === token || item.key.endsWith('ORGANIZATION_ID')
    const target = inPipeline ? 'github' : 'server'
    // Without Environments every value in GitHub is a repository secret, named for its environment. The server
    // always reads the plain names.
    const prefixed = mode === 'prefixed' && inPipeline
    const kind = target === 'server' ? 'Server' : prefixed || item.secret ? 'Secret' : 'Variable'
    const name = prefixed ? prefixedName(item.key, selected) : item.key
    const usedBy = inPipeline ? L('Pipeline and server', 'Pipeline dan server') : L('Server only', 'Hanya server')
    let value = null
    let source = L(`From the block of the ${selected} Central.`, `Dari blok Central ${selected}.`)
    if (item.key === 'HUB_SSO_APP_ID') {
      value = applicationId
      source = L('The ID of this application.', 'ID aplikasi ini.')
    } else if (item.key === base) {
      value = here && centralUrl ? `${centralUrl}${short ? '/api/internal' : ''}` : null
      source = L(`The address of the ${selected} Central${short ? ', ending in /api/internal' : ''}.`, `Alamat Central ${selected}${short ? ', diakhiri /api/internal' : ''}.`)
    } else if (item.key.endsWith('ORGANIZATION_ID')) {
      value = here ? organizationId : null
      source = L('Made by that Central for this application. It differs between Centrals.', 'Dibuat oleh Central itu untuk aplikasi ini. Setiap Central berbeda.')
    } else if (item.key === 'HUB_BASE_URL') {
      value = here ? hub : null
      source = L(`The address of the Hub in ${selected}.`, `Alamat Hub di ${selected}.`)
    } else if (item.key === 'HUB_SSO_JWKS_URL') {
      value = here && hub ? `${hub}/.well-known/jwks.json` : null
      source = L('The Hub address followed by /.well-known/jwks.json.', 'Alamat Hub diikuti /.well-known/jwks.json.')
    } else if (item.secret) {
      source = L('Shown once, in the block you copy when the connection is made or rotated.', 'Tampil sekali, di blok yang disalin saat koneksi dibuat atau dirotasi.')
    }
    return { key: item.key, name, kind, usedBy, target, value, source }
  })
}

// A script an application keeps in its repository to send the permissions of its code. The same one runs on a
// machine, from predev, and in the deploy workflow.
export function syncScript(keys) {
  const { base, token, path } = connectionKeys(keys)
  return `// scripts/sync-permissions.mjs
// Sends permissions.json to Central. Run it by hand, from "predev", and in the deploy workflow.
import { readFile } from "node:fs/promises";

const base = process.env.${base};
const token = process.env.${token};
if (!base || !token) {
  console.error("${base} and ${token} must be set");
  process.exit(1);
}

const body = await readFile(new URL("../permissions.json", import.meta.url), "utf8");
const attempts = Number(process.env.SYNC_ATTEMPTS ?? 6);

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const res = await fetch(\`\${base.replace(/\\/+$/, "")}${path}\`, {
      method: "PUT",
      headers: { Authorization: \`Bearer \${token}\`, "Content-Type": "application/json" },
      body,
    });
    if (res.ok) {
      console.log("permissions sent to Central");
      process.exit(0);
    }
    // Central answered and said no: trying again would not change that.
    if (res.status < 500 && res.status !== 429) {
      console.error(\`Central said \${res.status}: \${await res.text()}\`);
      process.exit(1);
    }
    console.warn(\`Central answered \${res.status}, trying again\`);
  } catch (error) {
    console.warn(\`Central is not reachable (\${error.message}), trying again\`);
  }
  if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 20_000));
}
console.error("Central did not answer");
process.exit(1);
`
}

// The GitHub environment that holds the values of the Central being looked at, or null for a development Central.
export function githubEnvironmentOf(environment) {
  return STANDARD_ENVIRONMENTS.includes(environment) ? environment : null
}

// What to do after a rotation, in the order it is done, with the names this application reads and the GitHub
// environment of the Central being looked at.
export function rotationSteps({ keys, environment, lang = 'en' }) {
  const L = (en, id) => (lang === 'id' ? id : en)
  const { token } = connectionKeys(keys)
  const github = githubEnvironmentOf(environment)
  const inGithub = (name) =>
    github
      ? L(
          `In GitHub replace the secret ${name} with the new value. It is in the environment ${github}, or among the repository secrets as ${prefixedName(name, github)} if you do not use Environments.`,
          `Di GitHub, ganti secret ${name} dengan nilai baru. Secret ini ada di environment ${github}, atau di repository secrets dengan nama ${prefixedName(name, github)} jika Anda tidak menggunakan Environments.`,
        )
      : L(
          `This is a development Central. If the application also runs in staging or production, those have their own values, rotate them in their own Central.`,
          `Ini Central development. Jika aplikasinya juga berjalan di staging atau production, keduanya memiliki nilai sendiri. Rotasi di Central masing-masing.`,
        )
  return {
    token: [
      L('Copy the new block now. The token is shown once, and closing the dialog without copying loses it.', 'Salin blok barunya sekarang. Token hanya tampil satu kali. Jika dialog ditutup sebelum disalin, token tersebut hilang.'),
      L(`Replace ${token} in the .env of the application.`, `Ganti ${token} di .env aplikasi.`),
      inGithub(token),
      L(
        'Deploy or restart the application so it reads the new value. If you chose a grace time, the old token keeps working until it ends, so do this before then.',
        'Deploy atau restart aplikasi supaya membaca nilai baru. Jika Anda memilih grace time, token lama masih berlaku sampai waktunya habis, karena itu selesaikan sebelum waktu tersebut habis.',
      ),
      L('This page shows Connected again once the application calls Central with the new token.', 'Halaman ini kembali menampilkan Connected begitu aplikasi memanggil Central dengan token baru.'),
    ],
    appSecret: [
      L('Copy the new line now. The secret is shown once.', 'Salin baris barunya sekarang. Secret hanya tampil satu kali.'),
      L('Replace HUB_INTERNAL_SECRET in the .env of the application.', 'Ganti HUB_INTERNAL_SECRET di .env aplikasi.'),
      inGithub('HUB_INTERNAL_SECRET'),
      L(
        'Deploy or restart the application. Until then it and the Hub do not trust each other. Other applications are not affected.',
        'Deploy atau restart aplikasi. Sebelum itu, aplikasi dan Hub belum saling percaya. Aplikasi lain tidak terpengaruh.',
      ),
    ],
    signingKey: [
      L('Rotate it in the Hub setup. The private key is shown once.', 'Rotasi di Hub setup. Private key hanya tampil satu kali.'),
      L(
        'Replace HUB_SSO_PRIVATE_KEY and HUB_SSO_KEY_ID in the .env of the Hub, and in its GitHub environment and server.',
        'Ganti HUB_SSO_PRIVATE_KEY dan HUB_SSO_KEY_ID di .env Hub, di environment GitHub, dan di servernya.',
      ),
      L(
        'Restart the Hub. Everybody is signed out and signs in again. Applications need nothing, they read the new key from the Hub.',
        'Restart Hub. Semua orang akan keluar dan harus sign in kembali. Aplikasi tidak perlu diubah, mereka membaca key baru dari Hub.',
      ),
    ],
    // For an application that has no pipeline: the values go in by hand.
    byHand: [
      L(
        'Komodo: open the stack of the application, replace the value in its Environment field, save and redeploy.',
        'Komodo: buka stack aplikasi, ganti nilai di kolom Environment, simpan, lalu redeploy.',
      ),
      L(
        'A server you run by hand: edit the .env next to the compose file and restart the container.',
        'Server yang dikelola manual: ubah .env di samping file compose, lalu restart container.',
      ),
      L(
        'A repository without secrets for this: send the owner the name of each value and ask them to add it, or open a pull request that changes the deploy settings.',
        'Repository yang tidak dapat Anda ubah: kirim nama setiap nilai ke owner dan minta ditambahkan, atau buka pull request yang mengubah pengaturan deploy.',
      ),
    ],
    // What to check once the new values are in.
    after: [
      L('The setup page shows Connected again once the application calls Central with the new token.', 'Halaman setup kembali menampilkan Connected begitu aplikasi memanggil Central dengan token baru.'),
      L('Try the token by hand. A 200 means Central accepts it, a 401 means the old value is still in use.', 'Uji tokennya secara manual. 200 berarti Central menerimanya, 401 berarti nilai lama masih digunakan.'),
      L('Run the permissions job again if the application sends permissions at deploy.', 'Jalankan ulang job permission jika aplikasi mengirim permission saat deploy.'),
      L('When the grace time ends, the old token stops working. Anything that still has it fails then.', 'Begitu grace time habis, token lama mati. Apa pun yang masih memakainya akan gagal saat itu.'),
    ],
    master: [
      L('Rotate it in the Hub setup. The dialog lists every application that is reached.', 'Rotasi di Hub setup. Dialognya menampilkan daftar aplikasi yang terdampak.'),
      L(
        'Put the new HUB_INTERNAL_SECRET in the .env of the Hub, and in the GitHub environment and the server of the Hub.',
        'Pasang HUB_INTERNAL_SECRET baru di .env Hub, di environment GitHub, dan di server Hub.',
      ),
      L(
        'Then do the same for each application in that list: open it here, rotate its token or ask for its secret, and replace the value in its .env and GitHub environment.',
        'Lalu ulangi untuk setiap aplikasi di daftar itu: buka di sini, rotasi tokennya atau minta secret-nya, dan ganti nilainya di .env serta environment GitHub aplikasi itu.',
      ),
      L(
        'Applications that have a secret of their own get a new one made from the new master, so their .env changes too.',
        'Aplikasi yang memiliki secret sendiri ikut mendapat secret baru turunan master baru, sehingga .env-nya juga berubah.',
      ),
    ],
    // The short version shown in the dialog that follows a rotation.
    short: [
      L(`Replace ${token} in the .env of the application.`, `Ganti ${token} di .env aplikasi.`),
      github
        ? L(`Replace the secret ${token} in the GitHub environment ${github}.`, `Ganti secret ${token} di environment GitHub ${github}.`)
        : L('Replace it in the GitHub environment of staging or production if it runs there.', 'Ganti juga di environment GitHub staging atau production jika aplikasinya berjalan di sana.'),
      L('Deploy or restart the application.', 'Deploy atau restart aplikasi.'),
    ],
  }
}

export const GITHUB_MODES = [
  { id: 'environments', label: 'I can use Environments', text: 'Owner or admin of the repository. Two environments, the same names in each.', label_id: 'Saya dapat gunakan Environments', text_id: 'Owner atau admin repository. Dua environment dengan nama yang sama.' },
  { id: 'prefixed', label: 'I can only add repository secrets', text: 'No Environments menu. Names get a STAGING_ or PRODUCTION_ in front.', label_id: 'Saya hanya dapat menambah repository secrets', text_id: 'Tidak ada menu Environments. Nama diberi awalan STAGING_ atau PRODUCTION_.' },
  { id: 'owner', label: 'I cannot change GitHub settings', text: 'Read only. Send the owner a message that says exactly what to add.', label_id: 'Saya tidak dapat mengubah pengaturan GitHub', text_id: 'Hanya dapat baca. Kirim pesan ke owner berisi apa saja yang harus ditambahkan.' },
  { id: 'komodo', label: 'No pipeline, I use Komodo', text: 'Set the values in the stack and send the permissions from the terminal of the container.', label_id: 'Tanpa pipeline, saya gunakan Komodo', text_id: 'Isi nilai di stack, lalu kirim permission dari terminal container.' },
  { id: 'curl', label: 'No pipeline, I use curl', text: 'Send the permissions with one curl call from any machine that can reach Central.', label_id: 'Tanpa pipeline, saya gunakan curl', text_id: 'Kirim permission dengan satu curl dari mesin mana pun yang dapat menjangkau Central.' },
]

// The ways that need no GitHub secrets and no workflow.
export const NO_PIPELINE_MODES = ['komodo', 'curl']

// The mode the table of values is written for: only Environments keeps plain names, the rest use the prefixed ones.
export const valueModeOf = (mode) => (mode === 'environments' ? 'environments' : 'prefixed')

// Sends permissions.json with curl, without a script in the repository.
export function putPermissionsCommand({ keys, baseValue }) {
  const { path } = connectionKeys(keys)
  return `curl -i -X PUT "${baseValue || '<the address of Central>'}${path}" \\
  -H "Authorization: Bearer <the token>" \\
  -H "Content-Type: application/json" \\
  --data @permissions.json`
}

export function prefixedName(key, environment) {
  return `${environment.toUpperCase()}_${key}`
}

// A read-only call to check the address and the token by hand before the first deploy.
export function checkCommand({ keys, baseValue }) {
  const { path } = connectionKeys(keys)
  return `curl -i -H "Authorization: Bearer <the token>" "${baseValue || '<the address of Central>'}${path}"`
}

// The shell of the job: it picks the values of the branch, says which one is missing, checks the shape of the address and
// then runs the command that sends the permissions. One text for the guide, the owner message and the tests.
export function sendScript({ keys, mode, command }) {
  const { base, token, short } = connectionKeys(keys)
  const organization = keys.find((item) => item.key.endsWith('ORGANIZATION_ID'))?.key
  const prefixed = mode === 'prefixed' || mode === 'owner-prefixed'
  const names = [base, token]
  const lines = []
  let missing
  if (prefixed) {
    // main reads PRODUCTION_ and everything else reads STAGING_, so a missing production value is an error and
    // never a quiet fall back to the staging one.
    lines.push(
      'if [ "$GITHUB_REF" = "refs/heads/main" ]; then P=PRODUCTION; else P=STAGING; fi',
      'pick() { local name="${P}_$1"; printf \'%s\' "${!name}"; }',
      `export ${base}="$(pick ${base})"`,
      `export ${token}="$(pick ${token})"`,
    )
    if (organization) lines.push(`export ${organization}="$(pick ${organization})"`)
    missing = (name) => `\${P}_${name} is not set. Add it under Settings, Secrets and variables, Actions, as a repository secret.`
  } else {
    missing = (name) => `${name} is not set in the GitHub Environment $ENVIRONMENT_NAME. Add it there.`
  }
  for (const name of names) {
    lines.push(`if [ -z "$${name}" ]; then echo "::error::${missing(name)}"; exit 1; fi`)
  }
  const shape = short ? 'https://*/api/internal' : 'https://*'
  const rule = short ? 'start with https:// and end with /api/internal' : 'start with https://'
  lines.push(
    `case "\${${base}%/}" in`,
    `  ${shape}) ;;`,
    `  *) echo "::error::The address in ${base} must ${rule}."; exit 1 ;;`,
    'esac',
    command,
  )
  return lines.join('\n')
}

// The job that sends the permissions on a deploy. With Environments it takes the values of the environment named for
// the branch. Without them it reads the repository secrets with STAGING_ or PRODUCTION_ in front.
export function workflowJob({ keys, isHub, mode }) {
  const { base, token } = connectionKeys(keys)
  const organization = keys.find((item) => item.key.endsWith('ORGANIZATION_ID'))?.key
  const prefixed = mode === 'prefixed' || mode === 'owner-prefixed'
  const command = isHub ? 'bun install --frozen-lockfile\nbun run permissions:sync --retries 5 --wait 20' : 'node scripts/sync-permissions.mjs'
  const env = []
  if (prefixed) {
    for (const environment of STANDARD_ENVIRONMENTS) {
      for (const key of [base, token, organization].filter(Boolean)) {
        env.push(`${prefixedName(key, environment)}: \${{ secrets.${prefixedName(key, environment)} }}`)
      }
    }
  } else {
    env.push(`${base}: \${{ vars.${base} || secrets.${base} }}`, `${token}: \${{ secrets.${token} }}`)
    if (organization) env.push(`${organization}: \${{ vars.${organization} || secrets.${organization} }}`)
    env.push("ENVIRONMENT_NAME: ${{ github.ref_name == 'main' && 'production' || 'staging' }}")
  }
  const indent = (text, spaces) =>
    text
      .split('\n')
      .map((line) => `${' '.repeat(spaces)}${line}`)
      .join('\n')
  const header = prefixed
    ? `  send-permissions:
    needs: deploy
    runs-on: ubuntu-latest
    steps:`
    : `  send-permissions:
    needs: deploy
    runs-on: ubuntu-latest
    # the staging branch uses the staging environment, main uses production
    environment: \${{ github.ref_name == 'main' && 'production' || 'staging' }}
    steps:`
  return `${header}
      - uses: actions/checkout@v4
${isHub ? '      - uses: oven-sh/setup-bun@v2\n' : ''}      - name: Send the permissions to Central${isHub ? '\n        working-directory: backend' : ''}
        env:
${indent(env.join('\n'), 10)}
        run: |
${indent(sendScript({ keys, mode, command }), 10)}`
}

// What to send the owner of a repository when you cannot change its settings yourself.
export function ownerMessage({ applicationName, keys, isHub, environment, centralUrl, hubAddress, organizationId, applicationId, lang = 'en' }) {
  const known = (selected) =>
    guideRows({ keys, applicationId, selected, environment, centralUrl, hubAddress, organizationId, mode: 'prefixed', lang })
  const lines = (selected) =>
    known(selected)
      .filter((row) => row.target === 'github')
      .map((row) => `  - ${row.name}: ${row.value ?? (lang === 'id' ? `(dari Central ${selected}, akan saya kirim)` : `(from the ${selected} Central, I will send it)`)}`)
      .join('\n')
  if (lang === 'id') {
    return `Halo, saya sedang menghubungkan ${applicationName} ke Central. Saya tidak dapat mengubah pengaturan repository ini, jadi mohon tambahkan repository secrets berikut (Settings, Secrets and variables, Actions, New repository secret):

Staging:
${lines('staging')}

Production:
${lines('production')}

Di GitHub cukup tiga nama ini. Baris lain di blok dibaca server dan tidak perlu diletakkan di sana.

Lalu tambahkan job ini ke workflow deploy, setelah job deploy:

${workflowJob({ keys, isHub, mode: 'prefixed' })}

Job ini mengirim permission aplikasi ke Central di setiap deploy. Nilai yang bertanda "akan saya kirim" adalah token, yang akan saya kirim secara terpisah dan pribadi secara pribadi.`
  }
  return `Hi, I am setting up ${applicationName} to connect to Central. I cannot change this repository's settings, so could you add these repository secrets (Settings, Secrets and variables, Actions, New repository secret)?

Staging:
${lines('staging')}

Production:
${lines('production')}

Only these three names are needed in GitHub. The other lines of the block are read by the server and do not go there.

Then please add this job to the deploy workflow, after the deploy job:

${workflowJob({ keys, isHub, mode: 'prefixed' })}

It sends the permissions of the application to Central on every deploy. The values marked "I will send it" are tokens, so I will send them to you privately.`
}
