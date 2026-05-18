# Где смотреть логи

Логи API пишет **Fastify** в **stdout/stderr** процесса Node.js. Секреты (токены GitHub, webhook secret, `X-Admin-Key`) в лог **не попадают** — только флаги вида «заголовок есть / нет», owner/name репозитория, коды ответов, время запроса.

## Запуск через Docker Compose (основной сценарий)

В корне проекта, пока крутится `docker compose up`:

```powershell
docker compose logs -f api
```

Только последние строки без «приклеивания» к потоку:

```powershell
docker compose logs --tail=200 api
```

Воркер очереди (отдельный контейнер) — выполняет LLM-ревью из Redis:

```powershell
docker compose logs -f worker
```

**Опрос GitHub по таймеру** (`PR_POLL_INTERVAL_MS`) крутится в контейнере **`api`**, не в `worker`:

```powershell
docker compose logs -f api | Select-String "pr-poll"
```

База и Redis обычно не нужны для отладки UI; при необходимости:

```powershell
docker compose logs -f postgres
docker compose logs -f redis
```

## API на хосте (`npm run dev` в папке `backend`)

Логи идут в тот же терминал, где запущена команда. Уровень и формат JSON задаются в коде при создании Fastify (`backend/src/index.ts`, сейчас `logger: true` — разумный вывод по умолчанию).

## Что искать при проблемах

| Симптом | Что смотреть в логах `api` |
|--------|---------------------------|
| Вечный «Saving…» во фронте | См. таблицу ниже по шагам лога `POST /repos`. |
| Только `request received`, нет `admin key ok` | Завис `preHandler` — пересоберите бэкенд (`npm run build` в `backend/`) и перезапустите API/Docker: в `dist` должен быть **async** `requireAdmin`. |
| Есть `POST /repos: attempt`, нет `POST /repos ok` | Зависание на запросе к Postgres (БД не запущена, неверный `DATABASE_URL`, долгий таймаут сети). При старте API теперь пишет `database connected` или падает с ошибкой подключения. |
| Есть `POST /repos ok`, нет `response sent` | Редко — сбой отправки ответа; перезапуск API. |
| 401 | Событие `admin_auth` с `authOk: false` — не совпал **Admin key** с `ADMIN_API_KEY` в `.env`. |
| 503 про `ADMIN_API_KEY` | На сервере не задана переменная `ADMIN_API_KEY`. |
| Ошибка уникальности репозитория | Лог Prisma / `repo_create` с `outcome: duplicate` — репозиторий с тем же `provider/owner/name` уже есть. |

## Опрос PR по таймеру (`component: pr-poll`, контейнер `api`)

Включение: в `.env` или `docker-compose` задайте `PR_POLL_INTERVAL_MS` (миллисекунды), например `300000` = 5 минут. Перезапустите `api`.

| Событие | Значение |
|--------|----------|
| `poll_timer_disabled` | Интервал не задан — опрос выключен. |
| `poll_timer_enabled` | Опрос включён, указаны `intervalMs` и `initialDelayMs`. |
| `poll_tick_start` / `poll_tick_done` | Начало/конец цикла; в `done` — `reposTotal`, `prsSeen`, `scheduled`, `skipped`, `reposFailed`, `ms`. |
| `poll_repo_start` / `poll_repo_done` | Один репозиторий; в `done` — сколько PR просмотрено и поставлено в очередь. |
| `poll_github_page` | Ответ GitHub `pulls.list` (страница, число PR). |
| `poll_pr_scheduled` | PR отправлен на ревью (`reviewLogId`). |
| `poll_pr_skipped` | Пропуск с полем `reason` (уже ревьюили коммит, нет SHA и т.д.). |
| `poll_repo_error` | Ошибка GitHub/сети для репозитория (токен, доступ, rate limit). |

Детали постановки в очередь: `component: pr-schedule` (`schedule_check`, `schedule_enqueued`).

## Воркер ревью (`component: pr-worker`, контейнер `worker`)

| Событие | Значение |
|--------|----------|
| `worker_started` / `worker_ready` | Процесс и BullMQ подключены к Redis. |
| `job_active` | Взята задача из очереди (`reviewLogId`, `jobId`, `attempt`). |
| `review_step` | Этап: `load_review_log`, `fetch_diff`, `llm_review`, `submit_github_review`, `mark_done`. |
| `review_diff_ready` | Дифф получен (`diffChars`, `headSha` — укороченный). |
| `review_llm_done` | Ответ модели (`outputChars`, время). |
| `review_submitted` | Комментарий отправлен в GitHub. |
| `job_completed` / `job_failed` | Успех или ошибка с текстом в `err`. |

Токены и полный SHA в лог **не** пишутся.

## Логи фронтенда

При `npm run dev` для фронта в **консоли разработчика браузера** (F12 → Console) сообщения с префиксом **`[PRR API]`**: метод, путь, статус, длительность. Для прод-сборки включите явно `VITE_DEBUG_API=true` в `frontend/.env` и пересоберите, если нужны те же сообщения.
