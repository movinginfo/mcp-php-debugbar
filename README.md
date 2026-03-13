# mcp-php-debugbar

> **AI-powered PHP debugging via Model Context Protocol.**
>
> Підключає **PHP DebugBar** та **Laravel Debugbar** до AI-асистентів.
> AI бачить винятки, SQL-запити, timeline, логи вашого додатку — читає вихідні PHP-файли і пропонує конкретні виправлення з точними рядками коду.

[![MCP](https://img.shields.io/badge/protocol-MCP-blue)](https://modelcontextprotocol.io)
[![PHP DebugBar](https://img.shields.io/badge/PHP%20DebugBar-3.5.x-orange)](https://github.com/php-debugbar/php-debugbar)
[![Laravel Debugbar](https://img.shields.io/badge/Laravel%20Debugbar-4.1.x-red)](https://github.com/fruitcake/laravel-debugbar)

**Підтримувані клієнти:** Cursor &nbsp;·&nbsp; VS Code &nbsp;·&nbsp; Claude Desktop &nbsp;·&nbsp; OpenAI Codex  
**Незабаром:** Antigravity

---

## Як це працює

```
Ваш PHP/Laravel додаток (localhost:8000)
        │  phpdebugbar-id header
        ▼
  mcp-php-debugbar  (Node.js MCP Server, stdio)
        │  37 інструментів
        ▼
  AI асистент (Cursor / VS Code / Claude / Codex)
        │  читає PHP файли, аналізує, фіксить
        ▼
  Розробник отримує: файл:рядок + код + готовий фікс
```

Одна команда:
```
Debug /users page
```
AI викликає `debugbar_auto_debug` → health score, кожна проблема з точним PHP файлом + рядком + кодом навколо + готовим виправленням.

---

## Вимоги

- **Node.js** 18+
- **PHP** 7.4+ із запущеним dev-сервером
- **PHP DebugBar** v3.5+ або **Laravel Debugbar** v4.1+

---

## Крок 1 — Встановити PHP DebugBar у проект

### Laravel проект

```bash
composer require fruitcake/laravel-debugbar --dev
```

У `.env` Laravel:
```env
APP_DEBUG=true
DEBUGBAR_ENABLED=true
```

У `config/debugbar.php`:
```php
'storage' => [
    'enabled' => true,
    'open'    => true,   // вмикає /_debugbar/open endpoint
    'driver'  => 'file',
    'path'    => storage_path('debugbar'),
],
```

### Vanilla PHP проект

```bash
composer require php-debugbar/php-debugbar
```

```php
use DebugBar\DebugBar;
use DebugBar\Storage\FileStorage;

$debugbar = new DebugBar();
$debugbar->setStorage(new FileStorage(__DIR__ . '/storage/debugbar'));
$debugbar->sendDataInHeaders(); // відправляє phpdebugbar-id заголовок
```

Додати `/debugbar/open.php`:
```php
<?php
require __DIR__ . '/../vendor/autoload.php';
// ... ініціалізація debugbar ...
$handler = new DebugBar\OpenHandler($debugbar);
$handler->handle();
```

> **Авто-визначення:** якщо `PROJECT_ROOT` вказує на Laravel проект (є файл `artisan`) — сервер автоматично використовує `/_debugbar/open` і тип `laravel`. Для vanilla PHP — `/debugbar/open`.

---

## Крок 2 — Встановити mcp-php-debugbar

```bash
git clone https://github.com/YOUR_USERNAME/mcp-php-debugbar.git
cd mcp-php-debugbar
npm install
npm run build
```

---

## Крок 3 — Підключити до AI клієнта

---

### Cursor

**Варіант A — для поточного проекту** (рекомендовано)

Створи або відредагуй файл `.cursor/mcp.json` у корені свого PHP проекту:

```json
{
  "mcpServers": {
    "php-debugbar": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-php-debugbar/dist/index.js"],
      "env": {
        "DEBUGBAR_BASE_URL": "http://localhost:8000",
        "DEBUGBAR_TYPE": "auto",
        "PROJECT_ROOT": "/absolute/path/to/your/php-project"
      }
    }
  }
}
```

**Варіант B — глобально** (для всіх проектів)

Файл: `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "php-debugbar": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-php-debugbar/dist/index.js"],
      "env": {
        "DEBUGBAR_BASE_URL": "http://localhost:8000",
        "DEBUGBAR_TYPE": "auto",
        "PROJECT_ROOT": ""
      }
    }
  }
}
```

> У глобальному варіанті `PROJECT_ROOT` можна передавати через `debugbar_connect`:
> ```
> Connect to http://localhost:8000, project root is /var/www/myapp
> ```

**Перевірити:**

Перезапусти Cursor → `Settings → MCP` → має з'явитись `php-debugbar` зі статусом `connected`.

**Windows приклад:**
```json
{
  "mcpServers": {
    "php-debugbar": {
      "command": "node",
      "args": ["C:/projects/mcp-php-debugbar/dist/index.js"],
      "env": {
        "DEBUGBAR_BASE_URL": "http://localhost:8000",
        "DEBUGBAR_TYPE": "auto",
        "PROJECT_ROOT": "C:/projects/my-laravel-app"
      }
    }
  }
}
```

---

### VS Code

Потрібний VS Code 1.99+ з розширенням **GitHub Copilot Chat**.

**Крок 1.** Увімкни MCP підтримку у VS Code settings:

```json
// .vscode/settings.json
{
  "chat.mcp.enabled": true
}
```

**Крок 2.** Створи `.vscode/mcp.json` у корені свого PHP проекту:

```json
{
  "servers": {
    "php-debugbar": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-php-debugbar/dist/index.js"],
      "env": {
        "DEBUGBAR_BASE_URL": "http://localhost:8000",
        "DEBUGBAR_TYPE": "auto",
        "PROJECT_ROOT": "/absolute/path/to/your/php-project"
      }
    }
  }
}
```

**Windows приклад:**
```json
{
  "servers": {
    "php-debugbar": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/projects/mcp-php-debugbar/dist/index.js"],
      "env": {
        "DEBUGBAR_BASE_URL": "http://localhost:8000",
        "DEBUGBAR_TYPE": "auto",
        "PROJECT_ROOT": "C:/projects/my-laravel-app"
      }
    }
  }
}
```

**Крок 3.** Перезапусти VS Code → відкрий GitHub Copilot Chat → в меню вибери **Agent mode** → `php-debugbar` буде доступний.

> **Примітка:** формат `.vscode/mcp.json` використовує ключ `"servers"` (не `"mcpServers"` як у Cursor).

---

### Claude Desktop

**macOS**

Відкрий або створи:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**

Відкрий або створи:
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux**

Відкрий або створи:
```
~/.config/Claude/claude_desktop_config.json
```

**Вміст файлу:**

```json
{
  "mcpServers": {
    "php-debugbar": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-php-debugbar/dist/index.js"],
      "env": {
        "DEBUGBAR_BASE_URL": "http://localhost:8000",
        "DEBUGBAR_TYPE": "auto",
        "PROJECT_ROOT": "/absolute/path/to/your/php-project"
      }
    }
  }
}
```

Якщо `mcpServers` вже існує — просто додай блок `"php-debugbar"` всередину.

**Перезапусти Claude Desktop.** У лівому нижньому куті з'явиться іконка 🔌 з кількістю підключених MCP серверів.

**Windows приклад:**
```json
{
  "mcpServers": {
    "php-debugbar": {
      "command": "node",
      "args": ["C:/projects/mcp-php-debugbar/dist/index.js"],
      "env": {
        "DEBUGBAR_BASE_URL": "http://localhost:8000",
        "DEBUGBAR_TYPE": "auto",
        "PROJECT_ROOT": "C:/projects/my-laravel-app"
      }
    }
  }
}
```

---

### Antigravity

> 🚧 Повна інтеграція в розробці. Буде додано у наступному релізі.

Наразі можна використовувати через стандартний stdio транспорт:

```bash
# Запустити сервер вручну і підключити через stdio
DEBUGBAR_BASE_URL=http://localhost:8000 \
PROJECT_ROOT=/path/to/your/php-project \
node /path/to/mcp-php-debugbar/dist/index.js
```

---

## Крок 4 — Запустити та підключити

### Laravel

```bash
# 1. Запустити Laravel
php artisan serve

# 2. В AI чаті:
# "Connect debugbar to http://localhost:8000"
# Сервер автоматично визначить тип laravel (через artisan файл)
# і використає /_debugbar/open
```

### Vanilla PHP

```bash
# 1. Запустити PHP сервер
php -S localhost:8000 -t public

# 2. В AI чаті:
# "Connect debugbar to http://localhost:8000"
```

---

## Використання

### Основний workflow

```
1. Запусти PHP/Laravel сервер
2. В AI чаті напиши: "Connect debugbar to http://localhost:8000"
3. Відкрий браузер, перейди на сторінку що потрібно дебагнути
4. Напиши: "Debug the last request" або "Debug /users endpoint"
```

### Приклад розмови з AI

```
Ти:   Debug /users page

AI:   [викликає debugbar_auto_debug(url="/users")]

      🐛 DEBUG REPORT: GET /users
      Health score: 35/100 [████░░░░░░]
      Duration: 245ms | SQL: 12 queries | Exceptions: 0

      ISSUE 1/2: 🔴 [N+1] "posts" queried 10×
      📍 app/Http/Controllers/UserController.php:34

         30 | $users = User::all();
         31 | foreach ($users as $user) {
      >>>  34 |     $posts = Post::where('user_id', $user->id)->get();
         35 | }

      💡 FIX:
         $users = User::with('posts')->get();

Ти:   Apply this fix

AI:   [відкриває UserController.php, редагує рядок 34]
      ✅ Fixed: replaced N+1 loop with eager loading
```

---

## Всі 37 MCP інструментів

### Підключення

| Інструмент | Що робить |
|---|---|
| `debugbar_connect` | Підключитись до PHP/Laravel сервера |
| `debugbar_disconnect` | Відключитись |
| `debugbar_status` | Статус підключення і кількість запитів |
| `debugbar_chrome_tabs` | Список вкладок Chrome (CDP) |
| `debugbar_start_chrome_monitor` | Авто-захоплення через Chrome DevTools |

### Запити

| Інструмент | Що робить |
|---|---|
| `debugbar_list_requests` | Список всіх захоплених запитів |
| `debugbar_get_request` | Деталі конкретного запиту |
| `debugbar_fetch_url` | Зробити HTTP запит і захопити дані |
| `debugbar_refresh_requests` | Оновити список з сервера |
| `debugbar_clear` | Очистити кеш запитів |

### База даних

| Інструмент | Що робить |
|---|---|
| `debugbar_get_queries` | SQL запити з часом і біндингами |
| `debugbar_get_duplicate_queries` | **N+1 детекція** — повторні запити |
| `debugbar_compare_queries` | Порівняти кількість запитів між двома запитами |

### Логи та винятки

| Інструмент | Що робить |
|---|---|
| `debugbar_get_logs` | Логи з фільтрацією по рівню |
| `debugbar_get_exceptions` | Винятки з повним стеком |

### Продуктивність

| Інструмент | Що робить |
|---|---|
| `debugbar_get_timeline` | Timeline вимірювань |
| `debugbar_performance_summary` | Таблиця запитів за тривалістю/SQL |

### Laravel

| Інструмент | Що робить |
|---|---|
| `debugbar_get_route` | Route, action, middleware |
| `debugbar_get_views` | Blade шаблони |
| `debugbar_get_events` | Events і listeners |
| `debugbar_get_auth` | Auth guards і користувач |
| `debugbar_get_models` | Eloquent моделі |
| `debugbar_get_cache` | Cache hit/miss/write |
| `debugbar_get_session` | Дані сесії |
| `debugbar_laravel_report` | Повний Laravel звіт |

### AI аналіз — головні інструменти

| Інструмент | Що робить |
|---|---|
| `debugbar_analyze` | Аналіз: N+1, повільні запити, винятки, пам'ять |
| `debugbar_analyze_all` | Health report по всіх запитах |
| `debugbar_suggest_fixes` | Список дій для виправлення |
| **`debugbar_auto_debug`** | **One-shot:** URL → дані → читає файли → звіт з кодом і фіксами |
| **`debugbar_fix_issue`** | Конкретна проблема: код + рядок + фікс |
| **`debugbar_read_source`** | Читає будь-який PHP файл із `PROJECT_ROOT` |

### Cursor / IDE

| Інструмент | Що робить |
|---|---|
| `debugbar_open_preview` | Відкрити Cursor preview |
| `debugbar_start_polling` | Polling нових запитів |
| `debugbar_stop_polling` | Зупинити polling |
| `debugbar_watch_and_debug` | Авто-аналіз нових запитів |
| `debugbar_auto_analyze` | Аналізувати останні N запитів |
| `debugbar_webhook_start` | Слухач webhook |
| `debugbar_preview_modes` | Режими preview |

---

## Налаштування через .env

```env
# URL PHP/Laravel dev сервера (обов'язково)
DEBUGBAR_BASE_URL=http://localhost:8000

# Шлях до open handler
# Laravel:      /_debugbar/open
# Vanilla PHP:  /debugbar/open
DEBUGBAR_OPEN_HANDLER=/_debugbar/open

# Тип проекту: laravel | php | auto (auto = перевіряє artisan файл)
DEBUGBAR_TYPE=auto

# Абсолютний шлях до PHP проекту (для читання файлів і авто-фіксів)
# Laravel: /var/www/myapp  або  C:/projects/myapp
PROJECT_ROOT=

# Chrome remote debugging (опціонально)
CHROME_HOST=localhost
CHROME_PORT=9222
CHROME_AUTO_CONNECT=false

# Інше
MAX_REQUESTS=100
REQUEST_TIMEOUT=10000
LOG_LEVEL=info
```

---

## Тестовий проект

У папці `Example/` є готовий PHP DebugBar demo:
- Головна сторінка з **N+1 проблемою** і перехопленим винятком
- `/users.php` — стандартні SQL запити
- `/error.php` — 4 різних типи винятків
- `/slow.php` — симульована повільна сторінка (~850ms timeline)
- `/api.php` — JSON API endpoint

```bash
# Запустити example
php -S localhost:8000 -t Example/public Example/public/router.php

# Прямий тест (без MCP)
node test/direct-debugbar.mjs

# Повний MCP smoke test
node test/smoke-test.mjs
```

---

## Розробка

```bash
npm run dev      # запуск без збірки (tsx)
npm run build    # TypeScript → dist/
npm run watch    # watch mode
npm run inspect  # MCP Inspector UI у браузері
```

---

## Вивантаження на GitHub

```bash
cd mcp-php-debugbar
git init
git add .
git commit -m "feat: initial release"

# GitHub CLI:
gh repo create mcp-php-debugbar --public --push

# або вручну:
git remote add origin https://github.com/YOUR_USERNAME/mcp-php-debugbar.git
git branch -M main
git push -u origin main
```

> `.env` захищений в `.gitignore` — локальні шляхи не потраплять в репозиторій.

---

## Roadmap

- [x] PHP DebugBar v3.5
- [x] Laravel Debugbar v4.1
- [x] Авто-визначення Laravel через `artisan`
- [x] `PROJECT_ROOT` — читання вихідних файлів
- [x] `debugbar_auto_debug` — one-shot дебаг з кодом
- [x] `debugbar_fix_issue` — код + фікс на конкретну проблему
- [x] N+1 детекція, повільні запити, аналіз винятків
- [x] **Cursor** підтримка
- [x] **Claude Desktop** підтримка
- [x] **OpenAI Codex** підтримка
- [ ] **VS Code** — стабільна підтримка (GitHub Copilot MCP)
- [ ] **Antigravity** — нативна інтеграція
- [ ] `npm publish` — `npx mcp-php-debugbar`
- [ ] Авто-застосування фіксів (запис у файл)
- [ ] EXPLAIN аналіз (відсутні індекси)
- [ ] Xdebug інтеграція

---

## License

MIT
