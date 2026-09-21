# Deploying Astronote to nuc

Astronote runs at https://notes.snapcrunch.io. The repository checkout on `nuc` is `/home/tim/services/astronote`. Its `docker-compose.nuc.yml` starts the app and PostgreSQL, and joins the existing `services_default` network. The existing Caddy container routes `notes.snapcrunch.io` to `astronote-app:3001`. Do not start the generic `docker-compose.yml` on `nuc`; it would try to bind ports 80 and 443, which Caddy already owns.

## Release

1. Finish and test the intended changes locally. If they include a database migration, back up the `astronote_postgres_data` and `astronote_attachment_data` volumes before deploying.
2. Commit only the intended files and push `main` to `origin`.
3. Pull and build on `nuc`:

   ```sh
   ssh nuc
   cd /home/tim/services/astronote
   git pull --ff-only origin main
   docker compose -f docker-compose.nuc.yml up --build -d
   docker compose -f docker-compose.nuc.yml ps
   ```

4. Check `https://notes.snapcrunch.io/api/health` and load the app in a browser. The image's startup command runs database migrations before the API begins serving requests.

The checkout uses a repository-specific, read-only SSH deploy key. Its `.env` contains the database password, is mode 600, and stays on `nuc`. PostgreSQL data is in `astronote_postgres_data`; attached files are in `astronote_attachment_data`. Back them up as one logical snapshot. The Caddyfile is `/home/tim/services/Caddyfile`; its backup from the initial deployment is `/home/tim/services/Caddyfile.pre-astronote-20260920.bak`.
