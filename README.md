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
