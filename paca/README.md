# Paca integration

[Paca](https://github.com/Paca-AI/paca) is the operational board: a self-hosted
platform where humans and AI agents pull the same cards. This repository holds
the public, read-only mirror of that board.

The split is not a preference, it is a constraint. Paca runs four Go services
and PostgreSQL. GitHub Pages serves static files and nothing else. Paca cannot
be deployed to Pages, so the two layers meet through `data/board.json`:

```
Paca (self-hosted, interactive)  ──sync.mjs──▶  data/board.json  ──build──▶  GitHub Pages
            ▲                                         │
            └──────────────── seed.mjs ───────────────┘
```

## Running Paca

Paca's development stack publishes everything behind Caddy on port 3000:

```bash
git clone https://github.com/Paca-AI/paca.git
cd paca
docker compose -f deploy/docker-compose.dev.yml up -d
```

The web app is then at `http://localhost:3000` and the API at
`http://localhost:3000/api/v1`. For a real institutional deployment use the Helm
chart under `deploy/helm/` instead. Consult Paca's own documentation; this
repository does not vendor its deployment.

## Credentials

Either an API key or a username and password:

```bash
export PACA_BASE_URL="http://localhost:3000/api/v1"
export PACA_API_KEY="paca_..."          # Settings -> API keys, shown once
# or
export PACA_USERNAME="..."
export PACA_PASSWORD="..."
```

`POST /auth/login` returns no token in its body; it sets HttpOnly cookies, so
the client keeps a cookie jar. An API key is the better choice for automation.

Never commit these values. `.env` is ignored.

## Seeding the board into Paca

```bash
node paca/seed.mjs --project "Vicerrectoría General — Dashboards"          # dry run
node paca/seed.mjs --project "Vicerrectoría General — Dashboards" --apply  # writes
```

Dry run is the default: a mis-targeted seed would scatter tasks across another
project and Paca has no bulk undo.

What it creates:

| Board concept | Paca object |
| --- | --- |
| Period (fortnight) | Sprint, with its real start and end dates |
| Phase (`epics[]`) | Task of the system `Epic` type |
| Work item (`items[]`) | Task parented to its epic through `parent_task_id` |
| Board key (`F1-a`) | Tag, which is also how re-runs find the task again |
| Owner | `assignee_ids`, matched to a project member by display name |

Re-running updates instead of duplicating: sprints match by name, tasks by
their board-key tag.

## Status mapping

Paca statuses are per-project rows whose `category` carries the meaning. The
categories are `backlog`, `refinement`, `ready`, `todo`, `inprogress` and
`done` — there is no review or blocked category.

| Board status | Paca category | Note |
| --- | --- | --- |
| `todo` | `todo` | |
| `in_progress` | `inprogress` | |
| `review` | `inprogress` | folded, and tagged `review` to survive the round trip |
| `blocked` | `inprogress` | folded, and tagged `blocked` |
| `done` | `done` | |

An exact status **name** wins over the category fallback. If the project
defines a status called "En revisión", review maps onto it directly and no tag
is needed.

Reading back, the category is authoritative and the tag only disambiguates
`inprogress`. A card dragged to Done still carries its old `review` tag, and
trusting that tag would silently undo real progress.

## Syncing Paca back into the board

```bash
node paca/sync.mjs --project "Vicerrectoría General — Dashboards"          # dry run
node paca/sync.mjs --project "Vicerrectoría General — Dashboards" --apply  # rewrites data/board.json
```

Then review the diff and commit it. Publishing goes through a commit on
purpose: every change to the public board stays reviewable in history.

Sync never deletes. A board item absent from the Paca response is reported and
left untouched, because the likeliest cause is a filtered or paginated read
rather than deleted work.

## Verification status

`paca/plan.mjs` is pure and covered by 20 tests (`npm test`): status mapping,
task-type resolution, sprint planning, payload construction and reconciliation.

`paca/client.mjs`, `paca/seed.mjs` and `paca/sync.mjs` are written against
Paca's documented HTTP surface — router registrations, request DTOs and the
status/sprint enums in its migrations — but **have not been executed against a
live Paca instance**. Run the dry run first and read what it reports before
passing `--apply`.
