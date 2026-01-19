# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PM2 module that collects application and system metrics from PM2-managed processes and exposes them via HTTP in Prometheus format. Bridges PM2 process management with Prometheus monitoring at `http://localhost:9988/`.

## Build & Development Commands

```bash
# Build TypeScript
npm run build          # Compile once
npm run watch          # Watch mode

# Local development (uses ~/.arcblock/abtnode as PM2_HOME)
npm run dev            # Runs predev (clean/build) then installs into PM2

# Release
npm run bump-version   # Interactive version bump via zx script
npm run release        # Build and publish to npm
```

**Package Manager:** pnpm (version 10)

## Architecture

### Entry Point
`index.ts` - PMX module initialization, creates HTTP server that merges all metric registries and responds with Prometheus format.

### Core Directory (`core/`)
- **`pm2.ts`** - Connects to PM2 daemon, runs detection loop (default 1000ms), collects CPU/memory via `pidusage`, handles Docker container stats, manages app lifecycle (create/delete/restart)
- **`app.ts`** - `App` class with 30-sample circular buffer per PID for CPU/memory, computes aggregates (avg/total memory, avg CPU, uptime), tracks status (RUNNING/PENDING/STOPPED/ERRORED/UNKNOWN)

### Metrics Directory (`metrics/`)
- **`index.ts`** - Base Prometheus gauges for system/app metrics, registry management
- **`app.ts`** - Processes custom metrics from apps via PM2 IPC, builds per-app registries
- **`prom/`** - Custom Histogram/Summary extensions for label-based value storage

### Utils Directory (`utils/`)
- **`docker.ts`** - Docker detection via cgroup files, memory/CPU limit reading, container stats via Dockerode
- **`domain.ts`** - Fetches app domain aliases from `__blocklet__.js` endpoint, SQLite cache (1hr TTL)
- **`server.ts`** - DID-based server URL construction, admin URL lookup, store version queries with Keyv caching

## Key Patterns

### Metric Types (from `types.ts`)
```typescript
enum MetricType { Counter, Gauge, Histogram, Summary }
type AppResponse = { metrics: IMetric[] }  // IPC message format
```

### Caching Layers
- SQLite (persistent): domain list - 1 hour TTL
- Memory (Keyv): server admin URL - 1 day TTL, store versions - 5 minute TTL

### Response Check Pattern
Always check `response.ok` before calling `.json()` on fetch responses to avoid JSON parse errors when server returns text error messages.

## Configuration

Set via PM2: `pm2 set pm2-prom-module:<key> <value>`

| Key | Default | Description |
|-----|---------|-------------|
| port | 9988 | HTTP port |
| hostname | 0.0.0.0 | Listen address |
| prefix | pm2 | Metric name prefix |
| debug | false | Enable debug logging |
| aggregate_app_metrics | true | Aggregate across instances |
| app_check_interval | 1000 | Detection loop interval (ms) |

## Reserved Labels

`app` and `instance` labels are reserved and will be overwritten by the module.
