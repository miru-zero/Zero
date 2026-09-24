# Zero Agent

Local worker agent for Zero MCP multi-device execution.

## Quick start

```powershell
npx @miruzero/zero-agent@latest start --once
```

On first run, `start` creates local config, a launcher, and a Windows user-logon autostart file automatically.

## Commands

```powershell
zero-agent setup --name TON --code ZERO-XXXX
zero-agent start --once
zero-agent start
zero-agent status
zero-agent doctor
zero-agent providers
zero-agent tools
zero-agent capabilities
```

## Autostart

Default state path:

```text
%USERPROFILE%\.zero-agent\device.json
%USERPROFILE%\.zero-agent\start-zero-agent.cmd
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MiruZeroAgent.vbs
```

The launcher uses `npx -y @miruzero/zero-agent@<current-version> start` so the user-logon agent does not depend on a stale global install.

Device tokens are local secrets and must not be printed or committed.

## Package checks

```powershell
npm test
npm pack --dry-run
```
