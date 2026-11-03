# INAP Task Hub (Supabase + GitHub Pages edition)

A shared task manager for a small team: dashboard, Kanban board, filterable task table, Excel import and export,
change history. The web page is static (hosted free on **GitHub Pages**); the data lives in **Supabase** (Postgres)
behind a login.

No build step, no npm, no third-party JavaScript: every file in this folder is readable source.

```
index.html, config.js, app.css     the web page and its settings
js/                                app code (ui, supa = Supabase client, xlsx = Excel reader/writer, excel, app)
supabase/schema.sql                database tables, permissions and audit triggers (run once)
```

## What is public and what is private

| Public (anyone with the website address can see it) | Private (needs a login) |
|---|---|
| The code in this repository, including `config.js` (Project URL + publishable key) | All tasks, names, emails, audit log |

The publishable key is *meant* to be public. What protects your data is the database itself: Row Level Security
rules in `schema.sql` mean the key alone can read nothing. Do **not** put real task data in the GitHub repository.

---

## Part A. Set up Supabase (about 10 minutes)

Menu names in Supabase change from time to time; use the closest match if a label differs slightly.

1. Go to <https://supabase.com>, sign up, and click **New project**.
   * Region: pick the closest one (e.g. *Southeast Asia (Singapore)*).
   * Set a strong **database password** and store it in your password manager (the app never needs it).
2. Wait until the project is ready, then open **SQL Editor > New query**.
   Open `supabase/schema.sql`, copy everything, paste it, and click **Run**. You should see *Success*.
   It is safe to run again later.
3. **Turn off public sign-ups** (important): **Authentication > Sign In / Providers** (or *Settings*) and switch off
   **Allow new users to sign up**. Only you will create accounts.
   Also in the Email provider settings set **Minimum password length** to 10 or more.
4. **Create the accounts**: **Authentication > Users > Add user > Create new user**.
   * Enter the person's work email and a strong temporary password, and tick **Auto Confirm User**.
   * Create **your own account first**: the first account becomes the admin automatically.
   * Create the other 7 the same way (the free plan's built-in email sending is very limited, so the dashboard
     method is more reliable than invitation emails).
5. Copy your connection details: **Project Settings > API** (or **API Keys**).
   * **Project URL**, for example `https://abcdxyz.supabase.co`
   * **Publishable key** (or the legacy **anon** key)
   * Never use the **secret** / **service_role** key anywhere in this app.

## Part B. Configure the app

Open `config.js` in a text editor and replace the two placeholders with the values from step 5:

```js
SUPABASE_URL: 'https://abcdxyz.supabase.co',
SUPABASE_KEY: 'sb_publishable_xxxxxxxxxxxx',
```

Optional settings in the same file: `IDLE_MINUTES` (automatic sign-out when idle, default 30) and
`KEEP_SIGNED_IN` (set to `false` to sign out whenever the browser tab is closed).

*Optional hardening:* in `index.html`, change `connect-src https://*.supabase.co` to your exact project URL
(for example `connect-src https://abcdxyz.supabase.co`).

## Part C. Publish on GitHub Pages (no Git installation needed)

1. On <https://github.com> click **New repository**. Name it (e.g. `inap-task-hub`). Choose **Public**
   (GitHub Pages for private repositories needs a paid plan). Create it.
2. In the new repository click **Add file > Upload files**. Drag in **the contents of this folder**
   (`index.html`, `config.js`, `app.css`, `js/`, `supabase/`, `README.md`) so that `index.html` sits at the top level
   of the repository. Click **Commit changes**.
3. Go to **Settings > Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**,
   folder **/ (root)**, and **Save**.
4. After a minute or two the site is live at `https://<your-github-username>.github.io/<repository-name>/`.
   Share that address with the team.

To change anything later (for example `config.js`), open the file in GitHub, click the pencil icon, edit, and
**Commit changes**. The site updates by itself within a minute or two.

## Part D. First use

1. Open the site and sign in with your own account (you are the admin).
2. **Users** tab: edit display names, and **tick "Active"** for each teammate. New accounts cannot see any data
   until an admin activates them (a safety net in case sign-ups were ever left open).
3. **Tasks** tab > **Import from Excel**: choose your current Excel file.
   * It reads the sheet named `Tasks` (columns: Task Type, Domain, Title Detailed, Assignee, Customer PIC, Status,
     Progress, Priority, Deadline, Created, Finished, Summary, Notes). The Attachments column is ignored.
   * Check the **Match people** table: each Excel name is matched to a team member automatically when possible
     (by employee ID in the email, or by name). Fix any that show "Unassigned".
   * Click **Import**. Original created/finished dates are preserved. Spelling variants such as `iWFM` / `IWFM`
     are unified automatically.
   * Importing the same file twice does not create duplicates (the "skip rows already present" option).
4. Ask everyone to sign in and use **Password** to replace the temporary password you gave them.

## Daily use

* **Dashboard**: Total / Open / On Work / Pending / Finished / Overdue / % Complete, a sortable team workload table
  (click any column heading), and a list of tasks needing attention. Click a person to see their open tasks.
* **Board**: drag cards between Pending, On Work and Finished.
* **Tasks**: search, filter, sort; **Export Excel** or **Export CSV** exports exactly what is currently filtered.
* Roles: **members** see everything, create tasks, and edit tasks assigned to or created by them.
  **Admins** can edit and delete any task, import, manage users, and read the audit log.
* The page refreshes itself about every 45 seconds, so teammates' changes appear without reloading.

## Security checklist

- [ ] Public sign-ups are **off** in Supabase.
- [ ] Minimum password length is 10+; everyone changed their temporary password.
- [ ] Only the publishable/anon key is in `config.js` (never `secret` / `service_role`).
- [ ] No exported Excel/CSV files or other task data are uploaded to GitHub.
- [ ] Admin accounts use unique, strong passwords. When someone leaves: untick **Active** in the Users tab (and
      delete their login in Supabase if you wish).
- [ ] You checked that storing task data on Supabase (a cloud service) is acceptable under your company policy.

What the app does by design: all access control is enforced in the database; every task change is recorded in the
audit log by a database trigger (it cannot be skipped or forged from the browser); sessions refresh automatically and
end after 30 idle minutes; the page only talks to your Supabase project (enforced by a Content Security Policy);
all text is rendered as plain text, so task content cannot inject scripts; CSV export neutralises spreadsheet
formulas.

## Backups and limits

* The Supabase **free plan has no automatic backups** and pauses a project after about a week with no activity.
  Daily use by the team avoids pausing. As a backup routine, have an admin click **Export Excel** weekly and keep the
  file somewhere safe (it is a complete copy and can be re-imported with **Import from Excel**).
* Paid Supabase plans add daily backups if you need them.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Setup needed" screen | `config.js` still has the placeholder values (Part B). |
| "Invalid email or password" | Check the email; reset the password in Supabase > Authentication > Users. |
| "Waiting for activation" | An admin must tick **Active** for that user in the Users tab. |
| Signed in but "This account has no profile" | Run `schema.sql` (Part A step 2), then sign in again. |
| Blank page or 404 on GitHub Pages | `index.html` must be at the top level of the repository, and Pages must be enabled (Part C step 3). |
| "Cannot reach the server" | Wrong Project URL in `config.js`, or the project is paused (resume it in Supabase). |
| Import says a file is not valid | Use `.xlsx` or `.csv`. Open old `.xls` files in Excel and **Save As .xlsx**. Password-protected files are not supported. |

## Notes on the Excel import/export

* Export columns: No, Task Type, Domain, Title Detailed, Assignee, Customer PIC, Status, Progress, Priority, Deadline,
  Days Left, Overdue, Created, Finished, Summary, Notes. Dates are real Excel dates; Progress is a real percentage.
  Days Left and Overdue are values calculated at export time.
* Files exported from the app can be imported back unchanged (a round trip reproduces every field).
