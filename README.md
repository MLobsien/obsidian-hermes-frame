# Hermes Frame

Obsidian sidebar plugin that shows your PC's Hermes Agent when the PC is online, or a fallback page when it's off.

## How it works

1. Polls `http://server-von-mads:8080/action/status` every 5 seconds (configurable)
2. **PC online** (HTTP 200): renders Hermes Agent dashboard (`http://Desktop-von-Mads:9119`) in an iframe
3. **PC offline** (error/timeout): renders fallback page (`http://server-von-mads:8080`) in an iframe

## Install

### Manual

1. Clone this repo into your vault's `.obsidian/plugins/` directory
2. Run `npm install && npm run build`
3. Enable "Hermes Frame" in Obsidian → Settings → Community plugins

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Status URL | `http://server-von-mads:8080/action/status` | Endpoint polled for PC status (GET, 200 = online) |
| Fallback URL | `http://server-von-mads:8080` | Shown when PC is offline |
| Hermes URL | `http://Desktop-von-Mads:9119` | Hermes Agent dashboard (shown when PC is online) |
| Poll interval | 5s | How often to check status (2–30 seconds) |

## Usage

- Click the monitor icon in the ribbon to toggle the sidebar
- Or use the command palette: "Toggle Hermes Frame sidebar"
- The status indicator shows green (online) or red (offline)
