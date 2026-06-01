# Запуск приложения локально на Windows

Инструкция для **Pull Request Reviewer**: API на порту **3000**, админка (опционально) на **3001**, база и Redis в Docker.

## Что установить заранее

1. **[Docker Desktop для Windows](https://docs.docker.com/desktop/install/windows-install/)**  
   Включите **WSL 2** по рекомендациям Docker, перезагрузите ПК при необходимости.  
   Без Docker можно обойтись только если вы сами поднимете PostgreSQL и Redis — в этом репозитории основной путь именно через **Docker Compose**.

2. **Node.js 20+** ([nodejs.org](https://nodejs.org/)) — только если будете крутить **фронтенд** локально (`npm run dev`). Для самого API в Docker Node на хосте не нужен.

## Шаг 1. Клонировать репозиторий и перейти в папку

В **PowerShell** или **cmd**:

```powershell
cd H:\WORK\WEB\PullRequestReviewer
```

(путь замените на свой, где лежит проект.)

## Шаг 2. Файл с секретами `.env`

В корне проекта:

```powershell
copy .env.example .env
notepad .env
```

Заполните как минимум:

| Переменная | Зачем |
|------------|--------|
| `OPENAI_API_KEY` | Ключ OpenAI — **обязателен**, иначе воркер не сможет вызвать модель. |
| `ADMIN_API_KEY` | Длинная случайная строка — тем же значением потом введёте **Admin key** в браузере. |

Строки `DATABASE_URL` и `REDIS_URL` в `.env` используются, если вы гоняете бэкенд **на хосте**; в **Docker Compose** для контейнеров `api` и `worker` уже подставлены свои URL к сервисам `postgres` и `redis` (см. `docker-compose.yml`). Для типичного сценария «всё в Docker» достаточно ключей выше.

## Шаг 3. Запуск стека (Postgres + Redis + API + Worker)

Убедитесь, что **Docker Desktop запущен**. Затем в корне репозитория:

```powershell
docker compose up --build
```

- Первый раз скачаются образы и соберётся образ `backend` — может занять несколько минут.
- Миграции Prisma выполняются при старте контейнеров `api` и `worker` (`prisma migrate deploy`).

Проверка API в браузере или PowerShell:

```powershell
curl http://localhost:3000/api/health
```

Ожидается JSON вроде `{"ok":true,"service":"prr-api"}`.

## Шаг 4. Админка в браузере (опционально, но удобно)

Откройте **второй** терминал:

```powershell
cd H:\WORK\WEB\PullRequestReviewer\frontend
copy .env.example .env
npm install
npm run dev
```

Откройте в браузере: **http://localhost:3001**

1. В шапке в поле **Admin key** вставьте **то же значение**, что в `ADMIN_API_KEY` в `.env`, нажмите **Save**.
2. На странице репозиториев добавьте GitHub-репозиторий (owner, name, токен, секрет вебхука).

Прокси в `vite.config.ts` пересылает запросы с `/api` на **http://localhost:3000**, поэтому админка общается с уже запущенным Docker API.

## Порты и конфликты

Порты задаются в корневом `.env` (см. `.env.example`):

| Переменная | По умолчанию | Сервис |
|------------|--------------|--------|
| `PORT` | 3000 | API (backend, Docker `api`) |
| `FRONTEND_DEV_PORT` | 3001 | Vite (`npm run dev`) |
| `POSTGRES_HOST_PORT` | 15432 | PostgreSQL на хосте → 5432 в контейнере |
| `REDIS_HOST_PORT` | 16379 | Redis на хосте → 6379 в контейнере |

Стандартные **5432** и **6379** на Windows часто заняты диапазоном Hyper-V (~5147–5846). Если `docker compose` падает с `bind: ... forbidden`, оставьте порты из `.env.example` или задайте свои вне этого диапазона.

Если гоняете бэкенд **на хосте**, в `.env` должны совпадать `DATABASE_URL` / `REDIS_URL` с `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT`.

Если меняете `PORT`, обновите `PUBLIC_API_URL` и `VITE_PUBLIC_API_URL` (в `frontend/.env`) на тот же хост:порт.

Если что-то уже слушает порты, `docker compose` может упасть с ошибкой «port is already allocated» — закройте конфликтующую программу или смените `PORT` / `FRONTEND_DEV_PORT` в `.env`.

## Вебхуки GitHub с вашего ПК

GitHub не достучится до `localhost` на вашем компьютере. Нужен туннель, например **ngrok**:

```powershell
ngrok http 3000
```

В настройках вебхука укажите `https://…/webhooks/github` и тот же секрет, что в админке. Подробнее: [WEBHOOK.md](WEBHOOK.md).

## Остановка

В терминале, где запущен `docker compose up`, нажмите **Ctrl+C**.  
Данные Postgres сохраняются в Docker volume `pgdata` до тех пор, пока вы не удалите volume командой `docker compose down -v`.

## Если Docker не используете (кратко)

Нужны локальные **PostgreSQL** и **Redis**, переменные `DATABASE_URL` и `REDIS_URL` в `.env`, затем в двух терминалах из папки `backend`:

```powershell
npm install
npx prisma migrate deploy
npm run dev
```

и отдельно:

```powershell
npm run worker
```

Фронт — как в шаге 4. Этот путь дольше настраивать на Windows; для MVP проще **Docker Desktop**.
