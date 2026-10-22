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
3. Admin Console > Security > Account recovery: allow users to recover their own account. New accounts get a temporary password that the person must change at the first sign in, and a recovery email for "Forgot password" later. Try it on one test account first.
4. Set these in the Komodo stack of the production Central (they reach the container through `docker-compose.yml`):

| Variable | Value |
|---|---|
| `DEPLOYMENT_ENVIRONMENT` | `production` |
| `GOOGLE_WORKSPACE_ENABLED` | `true` |
| `GOOGLE_WORKSPACE_ADMIN_SUBJECT` | the admin above |
| `GOOGLE_WORKSPACE_CREDENTIALS_B64` | the service account JSON, base64 on one line (`base64 -w0 key.json`) |
| `GOOGLE_WORKSPACE_TEST_PREFIX` | leave empty in production. Only for trying it from elsewhere, see above |
| `GOOGLE_OU_EMPLOYEE`, `GOOGLE_OU_INTERN`, `GOOGLE_OU_STUDENT` | optional, the org unit path for each kind, for example `/Employees` |

The sign-in email needs an SMTP server too, see Sending the first sign-in details.

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

## An email Google already has, for a new employee

The form refuses it, since a typo could be someone else's mailbox. A Super Admin can tick "Wait for this person to sign in" instead (`claim_existing_google`). The person is saved with the status `PENDING_CLAIM`, nothing is made or changed in Google, and no recovery email is asked for. The account is linked when that mailbox's owner signs in to Central with Google, because the sign-in is what proves it is theirs. Until then provision, the bulk link and every other action on the account are refused. Someone who never signs in stays waiting.

A claimed account keeps the name it has in Google: Central no longer writes its name over it (`google_keeps_name`), only the email follows. While it waits, a protected Super Admin can reset its password (`POST .../google/reset-waiting`). It goes ahead only when the name in Google is the name in Central, the password is mailed to the recovery email Google holds for the account, and it is never shown or sent to the mailbox itself. It needs SMTP, and an account with no recovery email cannot use it.

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

The Google Accounts tab counts **Linked** as the working accounts only. Suspended, Deleted In Google and Failed have their own tiles, and **Not Checked** counts the people whose address Central may not look up from here. Links with an id like `simulated-1` come from the simulated Google; they are removed as soon as the real Google is used, so those people read as having no account.

On a development machine with the test prefix set, a real person such as `dummystaff@` shows **Not Checked**. To try Link there, use a person whose email starts with the prefix and already exists in Google. In production (no prefix) the same person shows **In Google**.

A person made before the Google accounts has no link, even when their email is already a Google account. The row then says **In Google** with a **Link** button that needs no recovery email. Master Data > Employment > Google Accounts shows how everyone stands and links all the matches at once, after a preview. Workspace admins and addresses outside the allowed prefix are left out.

## Hints in the lists

In Employees, Interns and Students a name that has hints is coloured by the most serious one (red: wrong, amber: worth a look, blue: information, plain with a dotted underline: only a note) and opens the hints when clicked. They are listed grouped as Discipline, Google Account and Data To Review, each with a sentence. The Google hints are only for things that need someone to look: a failed account, a deleted or missing one (with the last day it can be restored), a suspended one that nobody expected, a password not set after a week, and an account still active for someone who left. Having no account is not a hint, and neither is an account Central suspended because the person left. The server sends them as `google_account.hints` on every employee and intern.

## Rules the code keeps

- Only people held in Central, on `ALLOWED_DOMAIN`. Workspace admins and `PROTECTED_SUPER_ADMIN_EMAILS` are never changed from here.
- A protected admin who makes their own employee record gets their Google account linked (read only, `linkOwn`): they are signed in with it, so it is theirs. Nothing is made or changed there, and every other action stays refused. When someone else makes the record, it is saved with no link.
- A temporary password is shown once, to the admin who made the account or the protected Super Admin who reset it, and is never stored, logged or put in the audit log. The mail that carries it is written by the server; the audit entry only says to which hidden address and in which language.
- The recovery email goes to Google and is not kept in Central. It can be any clean address, another mailbox of the organization included (`@millennia21.id`), but not the account's own address. If that mailbox belongs to someone who left or is suspended, the code never arrives. Google does not ask the owner of that address to confirm, so the forms remind you to read it again, and the review before creating shows it in full. It is hidden (`b***@gmail.com`) only where the full address is not on the screen: the current one in Change Recovery Email, and the sign-in instructions that get passed on. Central cannot tell whether the same address is the recovery email of other accounts.
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

## Sending the first sign-in details

A new account is made with a temporary password (16 characters). The dialog that opens right after, **Share Sign-in Details**, shows it once (hidden until Show) with a message ready to paste into WhatsApp: "Halo {name}, ..." in Bahasa Indonesia or English, editable before Copy Message. While the password is hidden it is hidden in the message too (dots, read-only); Show reveals both and lets the admin edit the message. Copy Message always copies the real text. **Send Email** mails the same details, by default to the account's recovery email: the server reads it from Google and sends there, the browser only sees it hidden (`b***@gmail.com`). The admin can choose another address instead. An account with no recovery email says so and offers Add Recovery Email. Make Temporary Password opens the same dialog. Closing it without copying or sending asks first, because the password cannot be shown again.

The server only mails for an account that still waits for its first password and was issued in the last 48 hours, to an address that is not the account's own, and at most 20 mails an hour per admin. Making a new password and mailing the details go together, because a new password ends the one just given out, so both wait the same **2 minutes** for the same person: a new temporary password is refused for 2 minutes after the last one was made (by creating the account or by Make Temporary Password), and a second mail for 2 minutes after the last.

The other actions on a Google account wait too, per person, in `GOOGLE_COOLDOWN_SECONDS` (`google-workspace-service.ts`):

| Action | Waits | Read from |
|---|---|---|
| Check Google | 10 seconds | the last press of Check, kept in the server's memory. The page looking at Google by itself when it opens does not count |
| Suspend, Unsuspend | 30 seconds | the last suspend or unsuspend in the audit log |
| Add or Change Recovery Email | 1 minute | the last recovery email entry in the audit log |
| Make Temporary Password | 2 minutes | `google_password_issued_at` |
| Send Email | 2 minutes | the last `GOOGLE_SIGNIN_EMAILED` in the audit log |

An action inside its wait is refused with 429 and the time left. Those read from the audit log survive a restart of the server. The status carries `check_available_at`, `suspend_available_at`, `recovery_available_at`, `password_available_at`, `email_available_at` and `cooldowns` (the seconds above), and the page keeps the button off with a burgundy ring around it that shortens as the wait runs out (`CooldownRing`).

### What Check says

Check Google answers with `check: { outcome, changes, checked_at }`. `outcome` is `checked`, `simulated` (this environment does not talk to the real Google, so nothing was asked), `unreachable` (Google did not answer; the last answer is kept) or `skipped`. `changes` lists what differs from before: the status of the account, the password state and a new sign-in. The page shows a message, and under the account "Checked 14:32. Nothing changed." or the changes, and "Last checked 14:32" before anything is pressed.

Email needs an SMTP server, which is a mailbox's login for sending, not something Central makes. Use the same block as MTSS or Exima: copy their `SMTP_*` lines from Komodo (MTSS already sends from `no-reply@millennia21.id`). Without these variables Send Email is off and says so.

| Variable | Where it comes from |
|---|---|
| `SMTP_HOST` | the mail server: `smtp.gmail.com` for Google Workspace (`smtp-relay.gmail.com` for a relay that allows the server's IP and needs no login) |
| `SMTP_PORT` | `465` (SSL, what Exima uses) or `587` (the default here). Port 465 turns `SMTP_SECURE` on by itself |
| `SMTP_SECURE` | `true` for 465, empty for 587 |
| `SMTP_USER` | the sender mailbox, for example `no-reply@millennia21.id` |
| `SMTP_PASSWORD` | an **app password** of that mailbox, not its normal password: Google Account of the mailbox > Security > 2-Step Verification (must be on) > App passwords. MTSS calls the same value `SMTP_PASS`, and that name works here too |
| `SMTP_FROM` | what the person sees as sender, for example `Millennia Central <no-reply@millennia21.id>` |

Use a mailbox made for this, not an admin's own. In development run Mailpit (`docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`) with `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `SMTP_FROM=central@localhost`, and read the mail at `http://localhost:8025`. Tests never send mail.

## Profile

`/profile` shows the signed-in person's own employee record, read only, in tabs: Overview (the account), Personal (contact, address, education, and the sensitive details), Employment, Family and, for admins, Access. An admin is made from an employee, so the record is theirs when `AdminUser.person_id` points to one (`GET /api/auth/me` returns `employee_id`); an admin with no link sees only Overview and Access. An employee who signs in reads it from `GET /api/auth/employee/me/detail`. Identifiers (NIK, NPWP, bank, BPJS, birth details, children) stay hidden until Show; the reveal is recorded as `ACCESS_EMPLOYEE_PII` with `self: true`. Nothing is edited there: a change goes through Request a Change (`/change-requests/mine`), and the photo can still be changed by the person.

## Students

A student has a Google account too, made from the student's detail page (`/api/admin/students/:id/google`, the same set of actions as for employees). What is different is who gets the first password: a parent or guardian.

- **The student form checks the email like the employee form.** Pressing Check asks Google, and the server repeats the check on create (only for the form, not the import) and when a student who already has an account is renamed.
- **A new student comes with a parent or guardian who has an email.** `POST /api/admin/students` requires `parent: { type, full_name, email, phone? }` and saves it with the student as the primary contact. This goes further than `Centralized User Database.md` (20.2), which only says a parent contact *should* be there. The import of older data does not ask for it (it calls the service without `requireParentContact`), and older students without one keep working; they just cannot get a Google account until one parent or guardian with an email is added.
- **Create Google Account** asks which parent or guardian the account is for (the primary one is chosen). Their email becomes the account's **recovery email**, so "Forgot password" also reaches them. Without a parent or guardian with an email the button is off and says why, and the server answers 400.
- **Share Sign-in Details** lists the parents and guardians that have an email (email hidden, phone shown only to an admin who may see sensitive student data). Copy Message is written to the chosen one ("Yth. Bapak/Ibu {name}, akun Google Millennia untuk {student} sudah dibuat..."). **Send Email** sends `{ parent_id, language, password }`: the server reads the address from the parent record, checks the parent belongs to the student, and writes the mail itself. No address is typed or taken from the browser.
- **Who may do what**: making the account is for a Super Admin or a Database Admin who may write students in the student's unit (the unit of the current grade); seeing the status needs the student's unit in the admin's view scope. Reset password, suspend, restore and Check stay as for employees (protected Super Admin, Super Admin).
- **Locked** (no new password, no unsuspend): a student who withdrew, transferred or was archived, or is deleted. A graduate keeps the account for now.
- The waits (2 minutes for a new password and for a mail, and the others) apply to students too.
- Not done yet: making accounts for a whole class at once, hints in the student list, suspending on leave.

## Recovery email

The recovery email lives only in Google, so "Forgot password" sends its code there. A Super Admin can see it hidden (`b***@gmail.com`) and the admin who may make the account sees the same hint. Whoever may make the account can **add** one when the account has none (older accounts); replacing one that is there stays with the protected Super Admins. The new address goes to Google and is not kept in Central or the audit log. If the person cannot use any recovery email, Reset Google password gives a temporary password without it. Self-service recovery must be on in the Admin Console (Security, Account recovery), otherwise Reset in Central is the only way.

## Not done yet

Students (their parents' emails exist only after the student is created, so the account is a separate step), suspending the Google account when someone leaves, a one-off report that compares every email in Central with Google, and a self-service photo for interns (they have no sign-in to Central).
