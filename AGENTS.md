# AGENTS.md - PM2 Prometheus Module

This file contains guidelines for agents working on this PM2 Prometheus metrics collection module.

## Build & Development Commands

```bash
# Build the project (TypeScript to JavaScript)
npm run build

# Watch mode for development
npm run watch

# Development (install as PM2 module)
npm run dev

# Development for EC2 user
npm run dev:ec2-user

# Development for GCP
npm run dev:gcp

# Release (build and publish)
npm run release

# Bump version
npm run bump-version
```

**Note:** This project does not have test files or linting configuration. Focus on manual testing and TypeScript compilation.

## Code Style Guidelines

### TypeScript Configuration
- Target: ES2015, Module: Node16
- Strict mode is partially enabled (strictNullChecks: true, but noImplicitAny: false)
- Always use `tsc` to verify compilation before committing changes

### Import Style
```typescript
// Node.js built-ins with 'node:' prefix
import os from 'node:os';
import { readFile } from 'node:fs/promises';

// Third-party packages
import pm2 from 'pm2';
import axios from 'axios';

// Local modules with relative paths
import { getLogger } from '../utils/logger';
import type { IPidDataInput } from './app';
```

### Naming Conventions
- **Classes:** PascalCase (e.g., `App`, `SimpleLogger`)
- **Functions/Variables:** camelCase (e.g., `getServerUrl`, `pidsMonit`)
- **Constants:** SCREAMING_SNAKE_CASE (e.g., `METRIC_FREE_MEMORY`, `DEFAULT_PREFIX`)
- **Interfaces/Types:** Prefix with `I` (e.g., `IConfig`, `IPMXConfig`, `IPidDataInput`)
- **Enums:** PascalCase with uppercase values (e.g., `APP_STATUS.RUNNING`)

### Type Definitions
- Export types in `types.ts` or `@types/` directory
- Use `type` for simple type aliases, `interface` for object shapes
- Prefer `Record<string, T>` for object types over `{ [key: string]: T }`
- Mark optional properties with `?` in type definitions

### Error Handling
```typescript
// Use try/catch for async operations
export async function getAvailableMemory(): Promise<number> {
    try {
        const data = (await readFile('/sys/fs/cgroup/memory.max', { encoding: 'utf8' })).trim();
        return parseInt(data, 10);
    } catch {
        // Return safe default on error
        return 0;
    }
}

// Log errors with console.error()
try {
    await someOperation();
} catch (error) {
    console.error('Operation failed:', error);
}
```

### Async/Await Patterns
- Prefer `async/await` over callbacks for new code
- Use Promise.all() for parallel operations
- Handle Promise rejections properly
- Use `p-all` for controlled concurrency (already a dependency)

### Constants & Configuration
- Define constants at file level with SCREAMING_SNAKE_CASE
- Use enum for fixed sets of values
- Default values should be defined at module level

### Metrics Pattern
```typescript
// Gauge metrics with labels
const metricAppMemory = new client.Gauge({
    name: `${prefix}_app_memory`,
    help: 'Show app memory usage',
    registers: [registry],
    labelNames: ['app', 'instance'],
});

// Update metrics
metricAppMemory.set({ app: 'my-app', instance: 1 }, 1024);
metricAppMemory.remove('my-app'); // Clean up
```

### File Organization
- `core/` - Core PM2 integration logic
- `metrics/` - Prometheus metrics definitions and aggregation
- `utils/` - Utility functions (docker, cpu, domain, server, logger)
- `@types/` - Type definitions
- `types.ts` - Shared types across modules

### Logging
- Use the custom logger from `utils/logger.ts`
```typescript
import { getLogger, debug } from '../utils/logger';

const logger = getLogger();
logger.debug('Debug message');
logger.info('Info message');
logger.error('Error message');

// Or use debug module
debug('Debug message with package name prefix');
```

### Caching
- Use `Keyv` with appropriate TTL for caching
- Default TTLs used in project:
  - Server admin URL: 1 day
  - Store version: 5 minutes
  - App domain list: 1 hour

### Comments
- Keep comments concise
- Write comments in English for code clarity
- Only comment complex logic or non-obvious behavior

### Code Patterns to Follow
1. **Type guards:** Use type predicates when filtering arrays
2. **Null checks:** Always check for undefined/null before accessing properties
3. **String templates:** Use backticks for string interpolation
4. **Object spread:** Prefer spread syntax over Object.assign
5. **Array methods:** Use functional methods (map, filter, reduce) over for loops

### Common Patterns

**Object iteration:**
```typescript
Object.keys(obj).forEach((key) => {
    const value = obj[key];
});
```

**Conditional property access:**
```typescript
const value = obj?.nested?.property ?? defaultValue;
```

**Async with timeout:**
```typescript
const response = await axios.get(url, { timeout: 20_000 });
```

### TypeScript Compiler Options
- `noImplicitAny: false` - Explicit typing not always required
- `strictNullChecks: true` - Must handle null/undefined
- `noUnusedLocals: true` - Remove unused variables
- `noUnusedParameters: true` - Use or mark parameters as `_` prefix

### Module Integration
- This is a PM2 module, uses `pmx` for initialization
- All module config comes from `conf.module_conf` in pmx.initModule
- Use `pm2.list()` to get running processes
- Use `pm2.sendDataToProcessId()` to communicate with app processes

### When Running `tsc`
Always ensure TypeScript compilation succeeds before committing. The build command runs:
```bash
tsc -p tsconfig.json
```

Check for type errors and compilation warnings before marking work as complete.
