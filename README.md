# 🔥 Forge IDE

> **AI-powered code editor that writes, tests, and ships code for you.**

![Version](https://img.shields.io/badge/version-1.0.0--beta-orange)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows-blue)

---

## ✨ What is Forge IDE?

Forge IDE is a **browser-automated AI code editor**. It drives **DeepSeek** or **Gemini** through a real Chromium browser — no API keys, no subscriptions, no rate limits. You just log in once and start coding.

---

## 🚀 Features

| Feature | Description |
|---------|-------------|
| 🌐 **Browser Automation** | Drives DeepSeek/Gemini through real browser. No API key needed |
| 🛠️ **37+ Built-in Tools** | File I/O, git, shell, search, tests, packages, diff, screenshots |
| 🧠 **Persistent Memory** | Remembers your project, tech stack, and past tasks |
| 🎨 **Dark Theme** | VS Code-style dark UI with orange accents |
| 💻 **Built-in Terminal** | Run commands directly in your workspace |
| 📁 **File Explorer** | Browse, create, rename, delete files from the sidebar |
| 📝 **Smart Templates** | 10 built-in templates. Add TypeScript, Jest, Docker in one command |
| 🔒 **Security Sandbox** | Blocks access to SSH keys, credentials, and sensitive files |
| 🔄 **Session Resume** | Continue tasks that stopped halfway |
| 🤖 **Multi-Model** | Switch between DeepSeek and Gemini mid-conversation |

---

## 📦 Installation

### Option 1: Installer (Recommended)

1. Download `installer.zip` from [Releases](https://github.com/hik966811-bit/forge-ide-beta/releases)
2. Extract the zip
3. Double-click `install.bat`
4. Done! A desktop shortcut will be created

### Option 2: From Source

```bash
git clone https://github.com/hik966811-bit/forge-ide-beta.git
cd forge-ide-beta
npm install
node src/index.js --ide
```

---

## 🎯 Quick Start

1. **Launch** Forge IDE — opens at `http://localhost:4040`
2. **First time**: A browser window opens → log into DeepSeek or Gemini
3. **Start coding**: Type what you want in the chat

```
> make a calculator with dark theme
> add a login page with OAuth
> fix the bug in auth.js
```

4. **Watch it work**: The AI reads your files, writes code, runs tests

---

## 🧩 How the Browser Agent Works

```
You type a task
       ↓
Agent opens DeepSeek/Gemini in Chromium
       ↓
Types your message into the chat
       ↓
AI responds with a plan + code
       ↓
Agent executes: read files, write code, run commands
       ↓
Loops until task is complete
```

- 🔍 **Thinking Detection** — Shows real-time stats while AI thinks
- ⚡ **Auto Retry** — Handles failures, rate limits, crashes
- 💾 **Session Saved** — Browser hides after login, runs in background
- 🔄 **Multi-Model** — Switch AI providers mid-conversation

---

## 📂 Project Structure

```
forge-ide/
├── src/
│   ├── index.js              # Entry point
│   ├── agent.js              # ForgeAgent (browser automation)
│   ├── browser.js            # ForgeBrowser (Playwright wrapper)
│   ├── ide-server.js         # HTTP server + API
│   ├── config.js             # Configuration
│   ├── commands.js           # Tool definitions
│   ├── tools.js              # Tool execution
│   ├── parser.js             # Response parser
│   ├── memory.js             # Persistent memory
│   ├── system-prompt.js      # AI system prompt
│   ├── adapters/
│   │   ├── deepseek-adapter.js
│   │   └── gemini-adapter.js
│   └── ide/
│       ├── index.html        # UI
│       ├── app.js            # Frontend logic
│       ├── style.css         # Dark theme
│       └── forge-logo.svg    # Logo
├── installer/
│   ├── install.bat           # Windows installer
│   ├── forge-ide-1.0.0.tgz  # Package
│   └── forge-icon.ico        # App icon
├── package.json
└── README.md
```

---

## 🛠️ Built-in Tools

| Tool | What it does |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create/overwrite files |
| `edit_file` | Edit specific lines |
| `list_files` | Browse directory tree |
| `search_code` | Search across files |
| `run_command` | Execute shell commands |
| `run_tests` | Run test suites |
| `git_*` | Git operations |
| `browser_*` | Take screenshots, get info |
| `clipboard_*` | Copy/paste |
| `docker_*` | Docker operations |
| `package_*` | Install/manage packages |
| `diff` | Compare files |
| `env_*` | Environment variables |
| `process_*` | Process management |

---

## ⚙️ Configuration

Config is stored at `~/.forge-ide/`:

```json
{
  "provider": "deepseek",
  "model": "deepseek_chat",
  "theme": "dark",
  "headless": true,
  "maxTokens": 16384,
  "browserTimeout": 300000
}
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Browser won't open | Run `npx playwright install chromium` |
| Port 4040 in use | Change port in config or kill the process |
| Login fails | Delete `~/.forge-ide/.browser-auth-done` and retry |
| Slow responses | Switch to DeepSeek (faster than Gemini) |

---

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

## 🙏 Credits

Built with ❤️ by the AI browser agent.
