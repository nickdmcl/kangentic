<p align="center">
  <img src="resources/icon-256.png" alt="Kangentic Logo" width="128" />
</p>

<h1 align="center"><a href="https://www.kangentic.com">Kangentic</a></h1>

<p align="center">
  <strong>Visual Agent Orchestration for Claude Code</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kangentic"><img src="https://img.shields.io/npm/v/kangentic?style=flat-square" alt="npm version" /></a>
  <a href="https://github.com/Kangentic/kangentic/releases/latest"><img src="https://img.shields.io/github/v/release/Kangentic/kangentic?style=flat-square" alt="GitHub release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square" alt="AGPL-3.0 License" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen.svg?style=flat-square" alt="Platform" />
  <a href="https://www.kangentic.com"><img src="https://img.shields.io/badge/website-kangentic.com-purple.svg?style=flat-square" alt="Website" /></a>
  <a href="https://github.com/Kangentic/kangentic/stargazers"><img src="https://img.shields.io/github/stars/Kangentic/kangentic?style=social" alt="GitHub Stars" /></a>
</p>

One board to manage all your Claude Code agents.

<p align="center">
  <img src="resources/kanban-demo.png" alt="Kangentic Kanban Board" width="800" />
</p>

## How It Works

1. **Add tasks** to your board -- describe the work in plain text
2. **Drag a task** into an active column -- Kangentic spawns a Claude Code agent in an isolated git worktree
3. **Watch progress** in the built-in terminal, or let it run and check back later
4. **Review and merge** when the agent finishes

## Features

- **Agent orchestration** -- drag tasks between columns to spawn, suspend, and resume Claude Code sessions
- **Git worktrees** -- each agent works on its own branch in an isolated checkout, no conflicts
- **Built-in terminals** -- full xterm.js terminals with WebGL rendering, right in the app
- **Session persistence** -- close the app, reopen it, pick up where you left off
- **Real-time status** -- see what each agent is doing (tool calls, idle detection, token usage)
- **Customizable columns** -- configure swimlanes with transition actions that trigger automatically
- **Themes** -- light, dark, and system-matched
- **Cross-platform** -- Windows, macOS, and Linux

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (for npx)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Git 2.25+](https://git-scm.com/)

## Setup

```bash
npx kangentic
```

One command to download, install, and launch. After the first run, auto-updates handle everything.

For more details, see the [Installation & Setup guide](https://www.kangentic.com/getting-started/).

## Documentation

Get started at [kangentic.com/getting-started](https://www.kangentic.com/getting-started/).

## Development

```bash
git clone https://github.com/Kangentic/kangentic.git
cd kangentic
npm install
npm start
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project structure, testing, and code style.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. All contributors must sign a [CLA](CLA.md) before their first PR can be merged.

## Support

- [GitHub Discussions](https://github.com/Kangentic/kangentic/discussions) -- questions and feature requests
- [GitHub Issues](https://github.com/Kangentic/kangentic/issues) -- bug reports

## License

[AGPL-3.0](LICENSE) -- if AGPL doesn't work for you, drop us a line at licensing@kangentic.com.

---

<h4 align="center">Built with</h4>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/xterm.js-000000?style=for-the-badge" alt="xterm.js" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white" alt="Playwright" />
</p>
