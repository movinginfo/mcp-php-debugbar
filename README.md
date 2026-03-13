# mcp-php-debugbar

> **AI-powered PHP debugging via Model Context Protocol.**
>
> Connects **PHP DebugBar** and **Laravel Debugbar** to AI assistants.
> The AI sees exceptions, SQL queries, timelines and logs from your running app — reads the actual PHP source files and suggests concrete fixes with exact line numbers.

[![MCP](https://img.shields.io/badge/protocol-MCP-blue)](https://modelcontextprotocol.io)
[![PHP DebugBar](https://img.shields.io/badge/PHP%20DebugBar-3.5.x-orange)](https://github.com/php-debugbar/php-debugbar)
[![Laravel Debugbar](https://img.shields.io/badge/Laravel%20Debugbar-4.1.x-red)](https://github.com/fruitcake/laravel-debugbar)

**Supported clients:** Cursor &nbsp;·&nbsp; VS Code &nbsp;·&nbsp; Claude Desktop &nbsp;·&nbsp; OpenAI Codex  
**Coming soon:** Antigravity

---

## How it works

```
Your PHP/Laravel app (localhost:8000)
        │  phpdebugbar-id header
        ▼
  mcp-php-debugbar  (Node.js MCP Server, stdio)
        │  37 tools
        ▼
  AI assistant (Cursor / VS Code / Claude / Codex)
        │  reads PHP files, analyzes issues, applies fixes
        ▼
  Developer gets: file:line + code context + ready-to-apply fix
```

One command:
```
Debug /users page
```
The AI calls `debugbar_auto_debug` → health score, every issue with the exact PHP file + line number + surrounding code + a concrete fix.

---

## Requirements

- **Node.js** 18+
- **PHP** 7.4+ with a running dev server
- **PHP DebugBar** v3.5+ or **Laravel Debugbar** v4.1+

---

## Step 1 — Install PHP DebugBar in your project

### Laravel project

```bash
composer require fruitcake/laravel-debugbar --dev
```

In your Laravel `.env`:
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

> **Auto-detection:** if `PROJECT_ROOT` points to a Laravel project (an `artisan` file is present), the server automatically uses `/_debugbar/open` and sets type to `laravel`. For vanilla PHP it uses `/debugbar/open`.

---

## Step 2 — Install mcp-php-debugbar

```bash
git clone https://github.com/movinginfo/mcp-php-debugbar.git
cd mcp-php-debugbar
npm install
npm run build
```

---

## Step 3 — Connect to your AI client

---

### Cursor

**Option A — per project** (recommended)

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

**Option B — global** (all projects)

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

> In the global setup you can pass `PROJECT_ROOT` at connect time:
> ```
> Connect to http://localhost:8000, project root is /var/www/myapp
> ```

**Verify:**

Restart Cursor → `Settings → MCP` → `php-debugbar` should appear with status `connected`.

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

Requires VS Code **1.99+** with the **GitHub Copilot Chat** extension.

**Step 1.** Enable MCP support in VS Code settings:

```json
// .vscode/settings.json
{
  "chat.mcp.enabled": true,
  "chat.agent.enabled": true
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

If you cloned this repo and open it in VS Code, both `.vscode/mcp.json` and `.vscode/settings.json` are already included — `${workspaceFolder}` resolves automatically.

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

**Step 3.** Restart VS Code → open GitHub Copilot Chat → switch to **Agent mode** → `php-debugbar` will appear in the tools list.

> **Note:** VS Code uses the key `"servers"` in `.vscode/mcp.json`, while Cursor and Claude use `"mcpServers"`.

**Run the Example project from VS Code:**

`Ctrl+Shift+P` → **Tasks: Run Task** → select:

| Task | What it does |
|---|---|
| **Start PHP Example Server** | Runs `php -S localhost:8000` from the Example folder |
| **Run MCP Smoke Test** | Runs the full test of all 37 tools |
| **Run Direct DebugBar Test** | Direct test without MCP — outputs data with code and fixes |
| **Build MCP Server** | Recompile TypeScript |

Or press `F5` → select a debug configuration:
- **Debug MCP Server** — launches the MCP server with the Node.js debugger
- **Run Smoke Test**
- **Run Direct DebugBar Test**

---

### Claude Desktop

**macOS** — open or create:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows** — open or create:
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux** — open or create:
```
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

If `mcpServers` already exists in your config, just add the `"php-debugbar"` block inside it.

**Restart Claude Desktop.** A 🔌 icon will appear in the bottom-left corner showing the number of connected MCP servers.

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

> 🚧 Full native integration is in development. Will be added in the next release.

In the meantime you can use it via the standard stdio transport:

```bash
DEBUGBAR_BASE_URL=http://localhost:8000 \
PROJECT_ROOT=/path/to/your/php-project \
node /path/to/mcp-php-debugbar/dist/index.js
```

---

## Step 4 — Start your server and connect

### Laravel

```bash
# 1. Start Laravel
php artisan serve

# 2. In the AI chat:
# "Connect debugbar to http://localhost:8000"
# The server auto-detects Laravel via the artisan file
# and uses /_debugbar/open
```

### Vanilla PHP

```bash
# 1. Start PHP dev server
php -S localhost:8000 -t public

# 2. In the AI chat:
# "Connect debugbar to http://localhost:8000"
```

---

## Usage

### Basic workflow

```
1. Start your PHP/Laravel server
2. In the AI chat: "Connect debugbar to http://localhost:8000"
3. Open your browser and visit the page you want to debug
4. Ask: "Debug the last request" or "Debug /users endpoint"
```

### Example AI conversation

```
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

### Quick command reference

```
# Connect (run once at the start)
Connect debugbar to http://localhost:8000

# One-shot debug — the main tool
Debug /page-name
Debug the last request
Debug /users and fix all issues

# Specific problems
Show all exceptions
Show N+1 queries
Fix issue #1
Fix issue #2

# Read source files
Read file app/Http/Controllers/UserController.php line 45

# Status
Debugbar status
List captured requests
Performance summary

# Laravel
Show route info
Full Laravel report
Show auth info
Show cache operations
```

---

## All 37 MCP tools

### Connection

| Tool | Description |
|---|---|
| `debugbar_connect` | Connect to a PHP/Laravel server |
| `debugbar_disconnect` | Disconnect |
| `debugbar_status` | Connection state and request count |
| `debugbar_chrome_tabs` | List Chrome tabs (CDP) |
| `debugbar_start_chrome_monitor` | Auto-capture via Chrome DevTools |

### Requests

| Tool | Description |
|---|---|
| `debugbar_list_requests` | List all captured requests |
| `debugbar_get_request` | Full details for a specific request |
| `debugbar_fetch_url` | Make an HTTP request and capture debug data |
| `debugbar_refresh_requests` | Pull latest requests from the server |
| `debugbar_clear` | Clear the request cache |

### Database

| Tool | Description |
|---|---|
| `debugbar_get_queries` | SQL queries with duration and bindings |
| `debugbar_get_duplicate_queries` | **N+1 detection** — repeated queries |
| `debugbar_compare_queries` | Compare query counts between two requests |

### Logs & Exceptions

| Tool | Description |
|---|---|
| `debugbar_get_logs` | Log messages filtered by level |
| `debugbar_get_exceptions` | Exceptions with full stack traces |

### Performance

| Tool | Description |
|---|---|
| `debugbar_get_timeline` | Timeline measurements |
| `debugbar_performance_summary` | Request table sorted by duration / SQL count |

### Laravel-specific

| Tool | Description |
|---|---|
| `debugbar_get_route` | Route URI, action, middleware |
| `debugbar_get_views` | Blade templates rendered |
| `debugbar_get_events` | Events fired and their listeners |
| `debugbar_get_auth` | Auth guards and user info |
| `debugbar_get_models` | Eloquent model instances |
| `debugbar_get_cache` | Cache hit / miss / write / delete |
| `debugbar_get_session` | Session data |
| `debugbar_laravel_report` | Full combined Laravel report |

### AI analysis — the key tools

| Tool | Description |
|---|---|
| `debugbar_analyze` | Analyze: N+1, slow queries, exceptions, memory |
| `debugbar_analyze_all` | Health report across all captured requests |
| `debugbar_suggest_fixes` | Prioritized fix list for the latest request |
| **`debugbar_auto_debug`** | **One-shot:** fetch URL → load data → read source files → report with code and fixes |
| **`debugbar_fix_issue`** | Focus on issue #N: source code + exact line + concrete fix |
| **`debugbar_read_source`** | Read any PHP file from `PROJECT_ROOT` around a specific line |

### IDE integration

| Tool | Description |
|---|---|
| `debugbar_open_preview` | Open Cursor built-in preview |
| `debugbar_start_polling` | Poll for new requests periodically |
| `debugbar_stop_polling` | Stop polling |
| `debugbar_watch_and_debug` | Auto-analyze new requests as they arrive |
| `debugbar_auto_analyze` | Analyze the last N requests |
| `debugbar_webhook_start` | Start a webhook listener |
| `debugbar_preview_modes` | Show available preview connection modes |

---

## Environment variables (.env)

```env
# PHP/Laravel dev server URL (required)
DEBUGBAR_BASE_URL=http://localhost:8000

# Open handler path
# Laravel:      /_debugbar/open
# Vanilla PHP:  /debugbar/open
DEBUGBAR_OPEN_HANDLER=/_debugbar/open

# Project type: laravel | php | auto  (auto checks for artisan file)
DEBUGBAR_TYPE=auto

# Absolute path to your PHP project (enables source file reading and AI fixes)
# Examples: /var/www/myapp   C:/projects/myapp   /home/user/laravel-app
PROJECT_ROOT=

# Chrome remote debugging (optional — enables auto-capture on page visit)
CHROME_HOST=localhost
CHROME_PORT=9222
CHROME_AUTO_CONNECT=false

# Other
MAX_REQUESTS=100
REQUEST_TIMEOUT=10000
LOG_LEVEL=info
```

---

## Example project

The `Example/` folder contains a ready-to-use PHP DebugBar demo:

- Home page with an **intentional N+1 problem** and a caught exception
- `/users.php` — standard SQL queries
- `/error.php` — 4 different exception types
- `/slow.php` — simulated slow page (~850 ms timeline)
- `/api.php` — JSON API endpoint

```bash
# Start the example server
php -S localhost:8000 -t Example/public Example/public/router.php

# Direct test (no MCP needed)
node test/direct-debugbar.mjs

# Full MCP smoke test (all 37 tools)
node test/smoke-test.mjs
```

---

## Development

```bash
npm run dev      # run without building (tsx)
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

> `.env` is in `.gitignore` — your local paths and secrets will not be committed.

---

## Roadmap

- [x] PHP DebugBar v3.5
- [x] Laravel Debugbar v4.1
- [x] Auto-detection of Laravel via `artisan` file
- [x] `PROJECT_ROOT` — source file reading
- [x] `debugbar_auto_debug` — one-shot debug with code context
- [x] `debugbar_fix_issue` — code + fix for a specific issue
- [x] N+1 detection, slow query analysis, exception analysis
- [x] **Cursor** support
- [x] **Claude Desktop** support
- [x] **OpenAI Codex** support
- [ ] **VS Code** — stable support (GitHub Copilot MCP)
- [ ] **Antigravity** — native integration
- [ ] `npm publish` — `npx mcp-php-debugbar`
- [ ] Auto-apply fixes (write to file)
- [ ] EXPLAIN analysis (missing index detection)
- [ ] Xdebug integration

---

## License

MIT
