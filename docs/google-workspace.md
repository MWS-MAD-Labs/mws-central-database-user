# Google Workspace accounts

Central makes and keeps the Google Workspace account of every employee and intern. Create an employee or intern and the account is made (or linked, if Google already has it). Change a name or an email and Google follows. A Super Admin can reset a password. An employee changes their own photo from Profile and Google gets it too.

## What runs where

Only a production Central with `GOOGLE_WORKSPACE_ENABLED=true` talks to the real Workspace. Staging and development share that Workspace, so they use a simulated client that only writes to the log ("would create ..."). The Employee and Intern detail pages show **Simulated** next to the Google account there.

## Setting it up (once)

1. In Google Cloud, a service account with domain-wide delegation. In the Admin Console (Security > API controls > Domain-wide delegation) allow its client ID with the scope `https://www.googleapis.com/auth/admin.directory.user`.
2. A Workspace admin that Central acts as, with the **User Management** role only (not the main super admin), for example `central-sync@millennia21.id`.
3. Admin Console > Security > Account recovery: allow users to recover their own account. New accounts get a random password nobody knows and a recovery email, so the person sets their own password with "Forgot password". Try it on one test account first.
4. Set these in the Komodo stack of the production Central (they reach the container through `docker-compose.yml`):

| Variable | Value |
|---|---|
| `DEPLOYMENT_ENVIRONMENT` | `production` |
| `GOOGLE_WORKSPACE_ENABLED` | `true` |
| `GOOGLE_WORKSPACE_ADMIN_SUBJECT` | the admin above |
| `GOOGLE_WORKSPACE_CREDENTIALS_B64` | the service account JSON, base64 on one line (`base64 -w0 key.json`) |
| `GOOGLE_OU_EMPLOYEE`, `GOOGLE_OU_INTERN`, `GOOGLE_OU_STUDENT` | optional, the org unit path for each kind, for example `/Employees` |

The key is a secret. Keep it out of Git and out of chat, and make a new one if it was ever shared.

## Rules the code keeps

- Only people held in Central, on `ALLOWED_DOMAIN`. Workspace admins and `PROTECTED_SUPER_ADMIN_EMAILS` are never changed from here.
- A temporary password is shown once to the Super Admin who asked and is never stored, logged or put in the audit log.
- The recovery email goes to Google and is not kept in Central. It must not be an organization address.
- A failure from Google never undoes the person in Central. The Google account row shows **Failed** with the reason, and a Super Admin can try again.
- Employee photos: the signed-in employee only, through `PUT /api/auth/employee/me/photo`. Admins still have their existing upload; closing that path is a separate decision.

## Not done yet

Students (their parents' emails exist only after the student is created, so the account is a separate step), suspending the Google account when someone leaves, a one-off report that compares every email in Central with Google, and a self-service photo for interns (they have no sign-in to Central).
