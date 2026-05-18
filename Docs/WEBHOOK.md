# GitHub webhook and local testing

For a **Russian code walkthrough** (files, methods, stack) aimed at developers new to web/Node, see [РАЗБОР_ПРОЕКТА_ПО_ФАЙЛАМ.md](РАЗБОР_ПРОЕКТА_ПО_ФАЙЛАМ.md).

For **running locally on Windows** (Docker, ports, admin UI), see [ЗАПУСК_WINDOWS.md](ЗАПУСК_WINDOWS.md).

The GitHub servers must reach your **backend** URL (the service that listens on port `3000` by default), not the Vite dev server. Path: `POST /webhooks/github`.

## 1. Run stack

From the repository root:

```powershell
copy .env.example .env
# Set OPENAI_API_KEY, ADMIN_API_KEY in .env
docker compose up --build
```

Apply migrations are run automatically by the `api` and `worker` container commands.

## 2. Admin UI (optional, local)

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`, set **Admin key** to the same value as `ADMIN_API_KEY`, then add a repository (owner, name, GitHub token with `repo` scope, webhook secret).

## 3. Expose the API with ngrok

Install [ngrok](https://ngrok.com/) and run (replace port if needed):

```powershell
ngrok http 3000
```

Copy the HTTPS forwarding URL, e.g. `https://abcd-12-34-56-78.ngrok-free.app`.

## 4. Configure the webhook on GitHub

In the repository: **Settings → Webhooks → Add webhook**.

| Field | Value |
|--------|--------|
| Payload URL | `https://<your-ngrok-host>/webhooks/github` |
| Content type | `application/json` |
| Secret | Same string you saved as **Webhook secret** for this repo in the admin UI |
| Events | Let me select individual events → enable **Pull requests** only |

Save the webhook. GitHub will send `pull_request` events for opened, synchronize, and reopened actions.

## 5. Manual E2E check

1. Ensure the repo exists in the admin UI and the PAT can read the repo and post reviews (`pull_requests: write` on fine-grained tokens, or classic `repo`).
2. Create a branch, commit a small change, open a **Pull Request** toward the default branch.
3. Within about a minute, check **Review logs** in the admin UI and the PR on GitHub for an automated review comment.

If jobs stay `queued`, confirm the **worker** container is running and `REDIS_URL` / `OPENAI_API_KEY` are set. If the webhook returns `404 Repository not registered`, the `owner`/`name` in the database must match GitHub’s `owner/name` exactly.
