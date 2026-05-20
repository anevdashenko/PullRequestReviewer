# Commit batch reviews

Periodic AI review of commits grouped by author (separate from pull request reviews).

## Enable for a repository

1. Register the repository in the admin UI (Repositories).
2. Check **Commit review** on the repository row. This sets `commitReviewEnabled` in the database.

## Environment variables (API process)

| Variable | Default | Description |
|----------|---------|-------------|
| `COMMIT_POLL_INTERVAL_MS` | `0` (off) | How often to poll GitHub for new commits, in milliseconds |
| `COMMIT_REVIEW_LOOKBACK_SEC` | `86400` | Window from each poll tick backward, in seconds (e.g. `86400` = 24 hours) |

Example in `.env`:

```
COMMIT_POLL_INTERVAL_MS=3600000
COMMIT_REVIEW_LOOKBACK_SEC=86400
```

PR polling (`PR_POLL_INTERVAL_MS`) is independent and unchanged.

## LLM diff size and full files (worker)

| Variable | Default | Description |
|----------|---------|-------------|
| `DIFF_MAX_CHARS` | `120000` | Max characters of diff text in one review (patch + optional full files) |
| `INCLUDE_FULL_FILE_CONTENT` | off | When `true`, attach full `.cs` at HEAD if patch is empty or shorter than `PATCH_MIN_CHARS` |
| `PATCH_MIN_CHARS` | `500` | Threshold for “short patch” |
| `FILE_MAX_CHARS` | `20000` | Skip full file if larger than this |

Full files are only fetched for `added` / `modified` (not `removed`). Applies to PR/MR and commit batch reviews.

## Behaviour

- Poll runs only for repositories with `commitReviewEnabled: true`.
- On each tick, **all branches** of the repository are listed (GitHub/GitLab API, paginated).
- For each branch, commits are fetched since `now - COMMIT_REVIEW_LOOKBACK_SEC`.
- Branches with no unreviewed commits in that window are skipped (no empty batch records).
- Commits already stored in `ReviewedCommit` for the same `(repo, branch, sha)` are skipped.
- Remaining commits on a branch are grouped by author login.
- Each `(branch, author)` batch is reviewed in two LLM phases (overview + code review), same rules/model as PR reviews.
- Result is saved as Markdown in `CommitBatchReview.mdContent` with `branchName` stored in the database and shown in the admin UI.
- Reviewed commit SHAs are recorded per branch so the same SHA on another branch can be reviewed separately.

On repositories with many branches, each poll tick performs more API calls and may take longer.

## View results

Admin UI → **Commit reviews**:

1. List repositories that have at least one batch review. The **New** column shows how many completed (`status=done`) batch reviews are not marked seen yet (`seenByUser=false`).
2. Open a repository → list of reviews by branch, author, and period. Rows are highlighted **green** (seen) or **red** (new) based on `seenByUser`.
3. Open a review → rendered Markdown. Use **Mark seen** to set `seenByUser` on that batch.

### Mark review as seen

Each `CommitBatchReview` has `seenByUser` (default `false`). New batches appear as **new** until you mark them:

```http
PATCH /api/commit-reviews/:id
Content-Type: application/json
X-Admin-Key: ...

{ "seenByUser": true }
```

Response: `{ "id": "...", "seenByUser": true }`.

### Clear all commit reviews for a repository

Removes every `CommitBatchReview` and `ReviewedCommit` row for the repository so polling can treat commits as unreviewed again. Does not delete the repository, review rules, or PR review logs (`ReviewLog`).

Admin UI → open a repository under **Commit reviews** → **Clear reviews** (confirmation required).

```http
DELETE /api/repos/:repoId/commit-reviews
X-Admin-Key: ...
```

Response:

```json
{
  "reviewedCommitsDeleted": 42,
  "batchReviewsDeleted": 5
}
```

Pending `commit-review` queue jobs for removed batches are purged before the database delete.

## Worker

Commit review jobs use the BullMQ queue `commit-review`. The same worker process handles both `pr-review` and `commit-review` queues.
