export const STANDARD_ENVIRONMENTS = ['staging', 'production']

// The key that holds the address of Central and the one that holds the token, from the names an application reads.
export function connectionKeys(keys) {
  const base = keys.find((item) => item.key.endsWith('_BASE_URL') && item.key.startsWith('CENTRAL'))?.key ?? 'CENTRAL_DATA_API_BASE_URL'
  const token = keys.find((item) => item.secret && item.key.endsWith('_TOKEN'))?.key ?? 'CENTRAL_DATA_API_TOKEN'
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
export function guideRows({ keys, applicationId, selected, environment, centralUrl, hubAddress, organizationId }) {
  const { base, token, short } = connectionKeys(keys)
  const here = selected === environment
  const hub = hubAddress ? hubAddress.replace(/\/+$/, '') : null
  return keys.map((item) => {
    const kind = item.secret ? 'Secret' : 'Variable'
    const usedBy = item.key === base || item.key === token ? 'Sync job and app' : 'App'
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
    return { key: item.key, kind, usedBy, value, source }
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
      ? `In GitHub open Settings, then Environments, then ${github}, and replace the secret ${name} with the new value.`
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
