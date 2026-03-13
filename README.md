# mcp-php-debugbar 

> **AI-powered PHP debugging via Model Context Protocol.**
>
> Connects **PHP DebugBar** and **Laravel Debugbar** to AI assistants.
> The AI can see exceptions, SQL queries, timeline data, and your application's logs — read your PHP source files and suggest specific fixes with exact line references.

[![MCP](https://img.shields.io/badge/protocol-MCP-blue)](https://modelcontextprotocol.io)
[![PHP DebugBar](https://img.shields.io/badge/PHP%20DebugBar-3.5.x-orange)](https://github.com/php-debugbar/php-debugbar)
[![Laravel Debugbar](https://img.shields.io/badge/Laravel%20Debugbar-4.1.x-red)](https://github.com/fruitcake/laravel-debugbar)

**Supported clients:** Cursor &nbsp;·&nbsp;  
**Coming soon:** Antigravity  VS Code &nbsp;·&nbsp; Claude Desktop &nbsp;·&nbsp; OpenAI Codex

---

## How it works

```text
Your PHP/Laravel app (localhost:8000)
        │  phpdebugbar-id header
        ▼
  mcp-php-debugbar  (Node.js MCP Server, stdio)
        │  37 tools
        ▼
  AI assistant (Cursor / VS Code / Claude / Codex)
        │  reads PHP files, analyzes, fixes
        ▼
  Developer gets: file:line + code + ready-to-apply fix
````

One command:

```text
Debug /users page
```

The AI calls `debugbar_auto_debug` → returns a health score, and each issue includes the exact PHP file + line number + surrounding code + a proposed fix.

---

## Requirements

* **Node.js** 18+
* **PHP** 7.4+ with a running development server
* **PHP DebugBar** v3.5+ or **Laravel Debugbar** v4.1+

---

## Step 1 — Install PHP DebugBar in your project

### Laravel project

```bash
composer require fruitcake/laravel-debugbar --dev
```

In Laravel `.env`:

```env
APP_DEBUG=true
DEBUGBAR_ENABLED=true
```

In `config/debugbar.php`:

```php
'storage' => [
    'enabled' => true,
    'open'    => true,   // enables the /_debugbar/open endpoint
    'driver'  => 'file',
    'path'    => storage_path('debugbar'),
],
```

### Vanilla PHP project

```bash
composer require php-debugbar/php-debugbar
```

```php
use DebugBar\DebugBar;
use DebugBar\Storage\FileStorage;

$debugbar = new DebugBar();
$debugbar->setStorage(new FileStorage(__DIR__ . '/storage/debugbar'));
$debugbar->sendDataInHeaders(); // sends the phpdebugbar-id header
```

Add `/debugbar/open.php`:

```php
<?php
require __DIR__ . '/../vendor/autoload.php';
// ... initialize debugbar ...
$handler = new DebugBar\OpenHandler($debugbar);
$handler->handle();
```

> **Auto-detection:** if `PROJECT_ROOT` points to a Laravel project (an `artisan` file exists), the server automatically uses `/_debugbar/open` and the `laravel` type. For vanilla PHP, it uses `/debugbar/open`.

---

## Step 2 — Install mcp-php-debugbar

```bash
git clone https://github.com/YOUR_USERNAME/mcp-php-debugbar.git
cd mcp-php-debugbar
npm install
npm run build
```

---

## Step 3 — Connect it to your AI client

---

### Cursor

**Option A — for the current project** (recommended)

Create or edit `.cursor/mcp.json` in the root of your PHP project:

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

**Option B — globally** (for all projects)

File: `~/.cursor/mcp.json`

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

> In the global setup, you can pass `PROJECT_ROOT` through `debugbar_connect`:
>
> ```
> Connect to http://localhost:8000, project root is /var/www/myapp
> ```

**Verify it works:**

Restart Cursor → `Settings → MCP` → you should see `php-debugbar` with status `connected`.

**Windows example:**

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

Requires VS Code 1.99+ with the **GitHub Copilot Chat** extension.

**Step 1.** Enable MCP support in VS Code settings:

```json
// .vscode/settings.json
{
  "chat.mcp.enabled": true
}
```

**Step 2.** Create `.vscode/mcp.json` in the root of your PHP project:

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

**Windows example:**

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

**Step 3.** Restart VS Code → open GitHub Copilot Chat → select **Agent mode** from the menu → `php-debugbar` will be available.

> **Note:** `.vscode/mcp.json` uses the `"servers"` key, not `"mcpServers"` like Cursor.

---

### Claude Desktop

**macOS**

Open or create:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**

Open or create:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux**

Open or create:

```text
~/.config/Claude/claude_desktop_config.json
```

**File contents:**

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

If `mcpServers` already exists, just add the `"php-debugbar"` block inside it.

**Restart Claude Desktop.** In the bottom-left corner, you will see a 🔌 icon showing the number of connected MCP servers.

**Windows example:**

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

> 🚧 Full integration is in progress. It will be added in the next release.

For now, you can use the standard stdio transport:

```bash
# Start the server manually and connect over stdio
DEBUGBAR_BASE_URL=http://localhost:8000 \
PROJECT_ROOT=/path/to/your/php-project \
node /path/to/mcp-php-debugbar/dist/index.js
```

---

## Step 4 — Start and connect

### Laravel

```bash
# 1. Start Laravel
php artisan serve

# 2. In the AI chat:
# "Connect debugbar to http://localhost:8000"
# The server will automatically detect the Laravel type (via the artisan file)
# and use /_debugbar/open
```

### Vanilla PHP

```bash
# 1. Start the PHP server
php -S localhost:8000 -t public

# 2. In the AI chat:
# "Connect debugbar to http://localhost:8000"
```

---

## Usage

### Main workflow

```text
1. Start your PHP/Laravel server
2. In the AI chat, type: "Connect debugbar to http://localhost:8000"
3. Open your browser and visit the page you want to debug
4. Type: "Debug the last request" or "Debug /users endpoint"
```

### Example conversation with AI

```text
You:  Debug /users page

AI:   [calls debugbar_auto_debug(url="/users")]

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

You:  Apply this fix

AI:   [opens UserController.php, edits line 34]
      ✅ Fixed: replaced N+1 loop with eager loading
```

---

## All 37 MCP tools

### Connection

| Tool                            | What it does                        |
| ------------------------------- | ----------------------------------- |
| `debugbar_connect`              | Connect to a PHP/Laravel server     |
| `debugbar_disconnect`           | Disconnect                          |
| `debugbar_status`               | Connection status and request count |
| `debugbar_chrome_tabs`          | List Chrome tabs (CDP)              |
| `debugbar_start_chrome_monitor` | Auto-capture via Chrome DevTools    |

### Requests

| Tool                        | What it does                              |
| --------------------------- | ----------------------------------------- |
| `debugbar_list_requests`    | List all captured requests                |
| `debugbar_get_request`      | Details for a specific request            |
| `debugbar_fetch_url`        | Make an HTTP request and capture the data |
| `debugbar_refresh_requests` | Refresh the request list from the server  |
| `debugbar_clear`            | Clear the request cache                   |

### Database

| Tool                             | What it does                              |
| -------------------------------- | ----------------------------------------- |
| `debugbar_get_queries`           | SQL queries with timing and bindings      |
| `debugbar_get_duplicate_queries` | **N+1 detection** — repeated queries      |
| `debugbar_compare_queries`       | Compare query counts between two requests |

### Logs and exceptions

| Tool                      | What it does                      |
| ------------------------- | --------------------------------- |
| `debugbar_get_logs`       | Logs with level filtering         |
| `debugbar_get_exceptions` | Exceptions with full stack traces |

### Performance

| Tool                           | What it does                            |
| ------------------------------ | --------------------------------------- |
| `debugbar_get_timeline`        | Timeline measurements                   |
| `debugbar_performance_summary` | Request summary by duration / SQL usage |

### Laravel

| Tool                      | What it does                 |
| ------------------------- | ---------------------------- |
| `debugbar_get_route`      | Route, action, middleware    |
| `debugbar_get_views`      | Blade templates              |
| `debugbar_get_events`     | Events and listeners         |
| `debugbar_get_auth`       | Auth guards and current user |
| `debugbar_get_models`     | Eloquent models              |
| `debugbar_get_cache`      | Cache hit / miss / write     |
| `debugbar_get_session`    | Session data                 |
| `debugbar_laravel_report` | Full Laravel report          |

### AI analysis — core tools

| Tool                       | What it does                                                        |
| -------------------------- | ------------------------------------------------------------------- |
| `debugbar_analyze`         | Analyze N+1, slow queries, exceptions, memory                       |
| `debugbar_analyze_all`     | Health report across all requests                                   |
| `debugbar_suggest_fixes`   | List recommended fixes                                              |
| **`debugbar_auto_debug`**  | **One-shot:** URL → data → reads files → report with code and fixes |
| **`debugbar_fix_issue`**   | Specific issue: code + line + fix                                   |
| **`debugbar_read_source`** | Reads any PHP file inside `PROJECT_ROOT`                            |

### Cursor / IDE

| Tool                       | What it does                   |
| -------------------------- | ------------------------------ |
| `debugbar_open_preview`    | Open Cursor preview            |
| `debugbar_start_polling`   | Start polling for new requests |
| `debugbar_stop_polling`    | Stop polling                   |
| `debugbar_watch_and_debug` | Auto-analyze new requests      |
| `debugbar_auto_analyze`    | Analyze the last N requests    |
| `debugbar_webhook_start`   | Start webhook listener         |
| `debugbar_preview_modes`   | Preview modes                  |

---

## Configuration via `.env`

```env
# URL of the PHP/Laravel dev server (required)
DEBUGBAR_BASE_URL=http://localhost:8000

# Path to the open handler
# Laravel:      /_debugbar/open
# Vanilla PHP:  /debugbar/open
DEBUGBAR_OPEN_HANDLER=/_debugbar/open

# Project type: laravel | php | auto (auto = checks for artisan file)
DEBUGBAR_TYPE=auto

# Absolute path to the PHP project (for reading files and auto-fixes)
# Laravel: /var/www/myapp  or  C:/projects/myapp
PROJECT_ROOT=

# Chrome remote debugging (optional)
CHROME_HOST=localhost
CHROME_PORT=9222
CHROME_AUTO_CONNECT=false

# Other
MAX_REQUESTS=100
REQUEST_TIMEOUT=10000
LOG_LEVEL=info
```

---

## Test project

The `Example/` directory includes a ready-to-run PHP DebugBar demo:

* Main page with an **N+1 issue** and a captured exception
* `/users.php` — standard SQL queries
* `/error.php` — 4 different exception types
* `/slow.php` — simulated slow page (~850ms timeline)
* `/api.php` — JSON API endpoint

```bash
# Run the example
php -S localhost:8000 -t Example/public Example/public/router.php

# Direct test (without MCP)
node test/direct-debugbar.mjs

# Full MCP smoke test
node test/smoke-test.mjs
```

---

## Development

```bash
npm run dev      # run without build (tsx)
npm run build    # TypeScript → dist/
npm run watch    # watch mode
npm run inspect  # MCP Inspector UI in the browser
```

---

## Publish to GitHub

```bash
cd mcp-php-debugbar
git init
git add .
git commit -m "feat: initial release"

# GitHub CLI:
gh repo create mcp-php-debugbar --public --push

# or manually:
git remote add origin https://github.com/YOUR_USERNAME/mcp-php-debugbar.git
git branch -M main
git push -u origin main
```

> `.env` is protected by `.gitignore` — local paths will not be committed to the repository.

---

## Roadmap

* [x] PHP DebugBar v3.5
* [x] Laravel Debugbar v4.1
* [x] Auto-detect Laravel via `artisan`
* [x] `PROJECT_ROOT` — source file reading
* [x] `debugbar_auto_debug` — one-shot debugging with code
* [x] `debugbar_fix_issue` — code + fix for a specific issue
* [x] N+1 detection, slow query analysis, exception analysis
* [x] **Cursor** support
* [x] **Claude Desktop** support
* [x] **OpenAI Codex** support
* [ ] **VS Code** — stable support (GitHub Copilot MCP)
* [ ] **Antigravity** — native integration
* [ ] `npm publish` — `npx mcp-php-debugbar`
* [ ] Auto-apply fixes (write to file)
* [ ] EXPLAIN analysis (missing indexes)
* [ ] Xdebug integration

---

## License

MIT

```

I can also turn this into a more polished GitHub-native README style with tighter wording, better section names, and more marketing-friendly phrasing.
```
