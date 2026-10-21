# Google Workspace accounts

Central makes and keeps the Google Workspace account of every employee and intern. Create an employee or intern and the account is made (or linked, if Google already has it). Change a name or an email and Google follows. A Super Admin can reset a password. An employee changes their own photo from Profile and Google gets it too.

## What runs where

Only a production Central with `GOOGLE_WORKSPACE_ENABLED=true` talks to the real Workspace, or any other one that also has `GOOGLE_WORKSPACE_TEST_PREFIX` set (then only addresses with that prefix go to Google). Staging and development share that Workspace, so otherwise they use a simulated client that only writes to the log ("would create ..."). The Employee and Intern detail pages show **Simulated** next to the Google account there.

## Trying it for real from your own machine (or staging)

Only addresses that start with a test prefix are sent to Google, so nothing else in the Workspace can be touched:

1. Put the same four variables as production in the `.env` of the server you run (`GOOGLE_WORKSPACE_ENABLED=true`, `GOOGLE_WORKSPACE_ADMIN_SUBJECT`, `GOOGLE_WORKSPACE_CREDENTIALS_B64`) and add `GOOGLE_WORKSPACE_TEST_PREFIX=test.central.` (any prefix you choose, lowercase). `DEPLOYMENT_ENVIRONMENT` can stay `development`.
2. Create an employee or intern whose email starts with that prefix, for example `test.central.budi@millennia21.id`, and a recovery email of your own. The Google account row should say **Linked** and no longer **Simulated**.
3. Any other address stays untouched and the row stays **Not created** (asking for it by hand answers with the prefix rule).
4. Afterwards delete the test accounts in the Admin Console: Directory > Users > the user > More options > Delete user. A deleted user can be restored for about 20 days, and you can suspend instead. Central never deletes Google accounts. Archive the test employee in Central as well.
5. Remove `GOOGLE_WORKSPACE_TEST_PREFIX` when done: without it a non-production server goes back to the simulated client.

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
| `GOOGLE_WORKSPACE_TEST_PREFIX` | leave empty in production. Only for trying it from elsewhere, see above |
| `GOOGLE_OU_EMPLOYEE`, `GOOGLE_OU_INTERN`, `GOOGLE_OU_STUDENT` | optional, the org unit path for each kind, for example `/Employees` |

The key is a secret. Keep it out of Git and out of chat, and make a new one if it was ever shared.

## Who can do what

| Level | Who | Actions |
|---|---|---|
| Create | Super Admin, or a Database Admin who may write employees in the person's unit | Create or Link the account, see the sign-in instructions |
| Manage | Super Admin | Suspend, Unsuspend, Restore, Check Google again, see the recovery email hidden, link existing accounts |
| Takeover | Protected Super Admin (`PROTECTED_SUPER_ADMIN_EMAILS`) | Make temporary password, Change recovery email |

The page asks the server what the admin may do and shows only those buttons.

## Deleted in Google

Until the account is restored, Make temporary password, Change recovery email, Suspend and Unsuspend are off, in the page and on the server. The email of the person can still be changed in Central (it has to pass the check); the Google account is not touched, and Restore renames it to the email and name Central holds at that moment. A person who forgot their password and has no usable recovery email gets a temporary password from **Make temporary password**, shown once.

## Checking an email

A new or changed email has to pass the **Check** button before Create or Save is enabled. Typing never asks Google. The answer belongs to the address that was checked, so changing the text asks for a new check. The server checks again by itself on create, and on an edit of someone who has a Google account, because that account is renamed with the email.

## Accounts that were in Google before Central

For a person with no link, the row says what Central could find out about the email, and "not asking" is never shown as "not there":

| State | Badge | Meaning |
|---|---|---|
| found | In Google | The account exists. **Link** it, no recovery email needed |
| absent | Not created | Google was asked and has none. **Create** it (the recovery email is only needed to make one) |
| simulated | Not Checked | This environment only simulates Google, so it cannot say |
| blocked | Not Checked | Central may not reach this address from here. Outside production only addresses starting with `GOOGLE_WORKSPACE_TEST_PREFIX` do, and protected admins never do. Create is off |
| admin | Workspace Admin | A Workspace admin account, not managed from Central |
| failed | Not Checked | Google did not answer. Press **Check Google** |

On a development machine with the test prefix set, a real person such as `dummystaff@` shows **Not Checked**. To try Link there, use a person whose email starts with the prefix and already exists in Google. In production (no prefix) the same person shows **In Google**.

A person made before the Google accounts has no link, even when their email is already a Google account. The row then says **In Google** with a **Link** button that needs no recovery email. Master Data > Employment > Google Accounts shows how everyone stands and links all the matches at once, after a preview. Workspace admins and addresses outside the allowed prefix are left out.

## Rules the code keeps

- Only people held in Central, on `ALLOWED_DOMAIN`. Workspace admins and `PROTECTED_SUPER_ADMIN_EMAILS` are never changed from here.
- A temporary password is shown once to the Super Admin who asked and is never stored, logged or put in the audit log.
- The recovery email goes to Google and is not kept in Central. It must not be an organization address. Google does not ask the owner of that address to confirm, so the forms show it hidden (`b***@gmail.com`) before it is saved. Central cannot tell whether the same address is the recovery email of other accounts.
- A failure from Google never undoes the person in Central. The Google account row shows **Failed** with the reason, and a Super Admin can try again.
- Employee photos: the signed-in employee only, through `PUT /api/auth/employee/me/photo`. Admins still have their existing upload; closing that path is a separate decision.

## What Central reads back from Google

Central only reads here, it never blocks anyone because of it.

- **Status**: the detail page asks Google when the last look is more than 5 minutes old, and a Super Admin can force it with the refresh icon. A daily sweep checks every linked person with two list calls. States: Linked, Suspended, Deleted in Google, Not in Google.
- **Password**: Google keeps `changePasswordAtNextLogin` true until the person sets their own password. The row shows "Waiting for the first sign-in", then **Password not set** after 7 days, then "Signed in" with the last login. Reset Google password starts the wait again.
- **Deleted accounts**: a deleted user keeps its address reserved for about 20 days. The email check refuses such an address (`DELETED_IN_GOOGLE`), and a create that Google still refuses says the same. Central never restores an account by itself. A Super Admin can press **Restore** on the person's own deleted account (matched by Google id, so an old mailbox never goes to someone else). The row counts down the 20 days from the deletion time Google reports.
- **Suspend / Unsuspend** (Super Admin) is how access is cut from Central. There is no Delete: deleting loses mail and files for good after 20 days, so that stays in the Admin Console.
- Deleted accounts are found by reading Google's list of deleted users and matching the Google id or the email, because Google's `query` filter does not match deleted users. A Google that cannot answer leaves the last status as it was.
- Simulated Google (every environment but production, or without the test prefix) is never checked, because it forgets its users on restart.

## When someone leaves

With `GOOGLE_SUSPEND_ON_OFFBOARD=true` (off by default), Central suspends the Google account of anyone who resigns (also when the last working date passes), is archived, or is an intern who completed or was terminated. It opens the account again only when Central was the one that suspended it, for instance after a restore. On Leave and Inactive keep their account. Nothing is ever deleted by Central: move the Drive and Calendar data in the Admin Console, then delete there.

- While a person is locked, Central refuses Unsuspend, Make temporary password, Change recovery email and Create account for them.
- An account turned on again directly in Google is locked again by the hourly status check, or when the detail page is opened. There is up to an hour of delay: Google sends no event to Central. Near real time would need the Reports API (another scope).
- Suspending is recorded in the audit log with the reason, and `reactivated_in_google` when it was undone in Google.

## Recovery email

The recovery email lives only in Google, so "Forgot password" sends its code there. A Super Admin can see it hidden (`b***@gmail.com`) and change it from the Google account row. The new address goes to Google and is not kept in Central or the audit log. If the person cannot use any recovery email, Reset Google password gives a temporary password without it. Self-service recovery must be on in the Admin Console (Security, Account recovery), otherwise Reset in Central is the only way.

## Not done yet

Students (their parents' emails exist only after the student is created, so the account is a separate step), suspending the Google account when someone leaves, a one-off report that compares every email in Central with Google, and a self-service photo for interns (they have no sign-in to Central).
