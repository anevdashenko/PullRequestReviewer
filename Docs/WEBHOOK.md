# Webhooks and local testing (GitHub & GitLab)

For a **Russian code walkthrough** (files, methods, stack) aimed at developers new to web/Node, see [РАЗБОР_ПРОЕКТА_ПО_ФАЙЛАМ.md](РАЗБОР_ПРОЕКТА_ПО_ФАЙЛАМ.md).

For **running locally on Windows** (Docker, ports, admin UI), see [ЗАПУСК_WINDOWS.md](ЗАПУСК_WINDOWS.md).

GitHub and GitLab must reach your **backend** URL (the service that listens on port `3000` by default), not the Vite dev server.

| Provider | Webhook path |
|----------|----------------|
| GitHub | `POST /webhooks/github` |
| GitLab (gitlab.com) | `POST /webhooks/gitlab` |

Choose the provider when adding a repository in the admin UI. Existing database rows without an explicit provider are treated as **GitHub**.

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

Open `http://localhost:5173`, set **Admin key** to the same value as `ADMIN_API_KEY`, then add a repository: pick **GitHub** or **GitLab**, enter owner/namespace, repo/project name, access token, and webhook secret.

## 3. Expose the API with ngrok

Install [ngrok](https://ngrok.com/) and run (replace port if needed):

```powershell
ngrok http 3000
```

Copy the HTTPS forwarding URL, e.g. `https://abcd-12-34-56-78.ngrok-free.app`.

## 4. Configure the webhook on GitHub

Skip to [section 5](#5-configure-the-webhook-on-gitlab-gitlabcom) for GitLab.

In the repository: **Settings → Webhooks → Add webhook**.

| Field | Value |
|--------|--------|
| Payload URL | `https://<your-ngrok-host>/webhooks/github` |
| Content type | `application/json` |
| Secret | Same string you saved as **Webhook secret** for this repo in the admin UI |
| Events | Let me select individual events → enable **Pull requests** only |

Save the webhook. GitHub will send `pull_request` events for opened, synchronize, and reopened actions.

## 5. Configure the webhook on GitLab (gitlab.com)

In the project: **Settings → Webhooks**.

| Field | Value |
|--------|--------|
| URL | `https://<your-ngrok-host>/webhooks/gitlab` |
| Secret token | Same string you saved as **Webhook secret** for this repo in the admin UI |
| Trigger | Enable **Merge request events** |

GitLab sends merge request events for `open`, `update`, and `reopen` actions.

**Personal Access Token scopes:** `api`, `read_api`, `read_repository`, `write_repository` (to post MR notes).

**Field mapping in the admin UI:**

| UI field | GitLab meaning |
|----------|----------------|
| Namespace (owner) | Group or username |
| Project path (name) | Project slug (e.g. `my-app` in `group/my-app`) |

## 6. Manual E2E check

### GitHub

1. Ensure the repo exists in the admin UI with provider **github** and the PAT can read the repo and post reviews (`pull_requests: write` on fine-grained tokens, or classic `repo`).
2. Create a branch, commit a small `.cs` change, open a **Pull Request** toward the default branch.
3. Within about a minute, check **Review logs** in the admin UI and the PR on GitHub for an automated review comment.

### GitLab

1. Ensure the repo exists with provider **gitlab**, namespace/project path match GitLab exactly, and the PAT can read the project and create MR notes.
2. Create a branch, commit a small `.cs` change, open a **Merge Request** toward the default branch.
3. Check **Review logs** and the MR on gitlab.com for an automated comment.

### Commit batch reviews (both providers)

1. Enable **Commit review** on the repository in the admin UI.
2. Set `COMMIT_POLL_INTERVAL_MS` to a positive value in `.env`.
3. After new commits on the default branch, check **Commit reviews** in the UI.

### Enable / disable review modes

On the **Repositories** page each connected repo has two toggles:

| Toggle | Effect |
|--------|--------|
| **PR / MR review** | Webhooks and `PR_POLL_INTERVAL_MS` poll schedule AI reviews on pull/merge requests. Default **on** for new and existing repos. |
| **Commit review** | `COMMIT_POLL_INTERVAL_MS` poll batches commits by author. Default **off**. |

### Troubleshooting

- If jobs stay `queued`, confirm the **worker** container is running and `REDIS_URL` / `OPENAI_API_KEY` are set.
- If the webhook returns `404 Repository not registered`, `owner`/`name` in the database must match the provider’s namespace/project (GitHub `owner/name`, GitLab `namespace/path`).
- `PR_POLL_INTERVAL_MS` polls open PRs/MRs for **all** configured repositories (GitHub and GitLab).
