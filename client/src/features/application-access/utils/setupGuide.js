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
export function guideRows({ keys, applicationId, selected, environment, centralUrl, hubAddress, organizationId, mode = 'environments' }) {
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
    const usedBy = inPipeline ? 'Pipeline and server' : 'Server only'
    let value = null
    let source = `From the block of the ${selected} Central.`
    if (item.key === 'HUB_SSO_APP_ID') {
      value = applicationId
      source = 'The ID of this application.'
    } else if (item.key === base) {
      value = here && centralUrl ? `${centralUrl}${short ? '/api/internal' : ''}` : null
      source = `The address of the ${selected} Central${short ? ', ending in /api/internal' : ''}.`
    } else if (item.key.endsWith('ORGANIZATION_ID')) {
      value = here ? organizationId : null
      source = 'Made by that Central for this application. It differs between Centrals.'
    } else if (item.key === 'HUB_BASE_URL') {
      value = here ? hub : null
      source = `The address of the Hub in ${selected}.`
    } else if (item.key === 'HUB_SSO_JWKS_URL') {
      value = here && hub ? `${hub}/.well-known/jwks.json` : null
      source = 'The Hub address followed by /.well-known/jwks.json.'
    } else if (item.secret) {
      source = 'Shown once, in the block you copy when the connection is made or rotated.'
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
export function rotationSteps({ keys, environment }) {
  const { token } = connectionKeys(keys)
  const github = githubEnvironmentOf(environment)
  const inGithub = (name) =>
    github
      ? `In GitHub replace the secret ${name} with the new value. It is in the environment ${github}, or among the repository secrets as ${prefixedName(name, github)} if you do not use Environments.`
      : `This is a development Central. If the application also runs in staging or production, those have their own values, rotate them in their own Central.`
  return {
    token: [
      'Copy the new block now. The token is shown once, and closing the dialog without copying loses it.',
      `Replace ${token} in the .env of the application.`,
      inGithub(token),
      'Deploy or restart the application so it reads the new value. If you chose a grace time, the old token keeps working until it ends, so do this before then.',
      'This page shows Connected again once the application calls Central with the new token.',
    ],
    appSecret: [
      'Copy the new line now. The secret is shown once.',
      'Replace HUB_INTERNAL_SECRET in the .env of the application.',
      inGithub('HUB_INTERNAL_SECRET'),
      'Deploy or restart the application. Until then it and the Hub do not trust each other. Other applications are not affected.',
    ],
    master: [
      'Rotate it in the Hub setup. The dialog lists every application that is reached.',
      'Put the new HUB_INTERNAL_SECRET in the .env of the Hub, and in the GitHub environment and the server of the Hub.',
      'Then do the same for each application in that list: open it here, rotate its token or ask for its secret, and replace the value in its .env and GitHub environment.',
      'Applications that have a secret of their own get a new one made from the new master, so their .env changes too.',
    ],
    // The short version shown in the dialog that follows a rotation.
    short: [
      `Replace ${token} in the .env of the application.`,
      github ? `Replace the secret ${token} in the GitHub environment ${github}.` : 'Replace it in the GitHub environment of staging or production if it runs there.',
      'Deploy or restart the application.',
    ],
  }
}

export const GITHUB_MODES = [
  { id: 'environments', label: 'I can use Environments', text: 'Owner or admin of the repository. Two environments, the same names in each.' },
  { id: 'prefixed', label: 'I can only add repository secrets', text: 'No Environments menu. Names get a STAGING_ or PRODUCTION_ in front.' },
  { id: 'owner', label: 'I cannot change GitHub settings', text: 'Read only. Send the owner a message that says exactly what to add.' },
]

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
export function ownerMessage({ applicationName, keys, isHub, environment, centralUrl, hubAddress, organizationId, applicationId }) {
  const known = (selected) =>
    guideRows({ keys, applicationId, selected, environment, centralUrl, hubAddress, organizationId, mode: 'prefixed' })
  const lines = (selected) =>
    known(selected)
      .filter((row) => row.target === 'github')
      .map((row) => `  - ${row.name}: ${row.value ?? `(from the ${selected} Central, I will send it)`}`)
      .join('\n')
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
