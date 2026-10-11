## server/package.json

```json
{
  "name": "@devdigest/api",
  "dependencies": { "fastify": "5.1.0", "zod": "3.23.8" },
  "devDependencies": { "vitest": "2.1.4", "typescript": "5.6.3", "tsx": "4.19.0" },
  "scripts": { "dev": "tsx watch src/server.ts", "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

## reviewer-core/package.json

```json
{
  "name": "@devdigest/reviewer-core",
  "dependencies": { "zod": "3.23.8" },
  "devDependencies": { "vitest": "2.1.4", "typescript": "5.6.3" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

## tsconfig paths

```
server/tsconfig.json   "@devdigest/reviewer-core": ["../reviewer-core/src/index.ts"]
```

## du -shL <pkg>/node_modules/<dep>

```
6.5M    server/node_modules/fastify
2.1M    server/node_modules/zod
2.1M    reviewer-core/node_modules/zod
```

## rg -n "^import .* from ['\"]" --glob '*.ts' server/src reviewer-core/src

```
server/src/app.ts:1:import Fastify from "fastify";
server/src/app.ts:2:import { z } from "zod";
server/src/services/review-service.ts:1:import { runPipeline } from "@devdigest/reviewer-core";
reviewer-core/src/index.ts:1:export { runPipeline } from "./pipeline.js";
reviewer-core/src/pipeline.ts:1:import { z } from "zod";
```
