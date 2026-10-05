## server/package.json

```json
{
  "name": "@devdigest/api",
  "dependencies": {
    "fastify": "5.1.0",
    "drizzle-orm": "0.36.0",
    "zod": "3.23.8",
    "pg": "8.13.0",
    "moment": "2.30.1"
  },
  "devDependencies": { "vitest": "2.1.4", "typescript": "5.6.3", "tsx": "4.19.0" },
  "scripts": { "dev": "tsx watch src/server.ts", "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

## client/package.json

```json
{
  "name": "@devdigest/web",
  "dependencies": {
    "next": "15.0.3",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@tanstack/react-query": "5.59.0",
    "zod": "3.22.4",
    "date-fns": "4.1.0"
  },
  "devDependencies": { "vitest": "2.1.4", "typescript": "5.6.3", "tailwindcss": "3.4.14" },
  "scripts": { "dev": "next dev", "build": "next build", "test": "vitest run" }
}
```

## reviewer-core/package.json

```json
{
  "name": "@devdigest/reviewer-core",
  "dependencies": { "zod": "3.23.8" },
  "devDependencies": { "typescript": "5.6.3" },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

## e2e/package.json

```json
{
  "name": "@devdigest/e2e",
  "devDependencies": { "playwright": "1.48.2", "typescript": "5.6.3" },
  "scripts": { "test": "playwright test" }
}
```

## tsconfig paths

```
server/tsconfig.json   "@shared/*": ["./src/vendor/shared/*"]
client/tsconfig.json   "@shared/*": ["../server/src/vendor/shared/*"]
```

## du -shL <pkg>/node_modules/<dep>

```
4.2M    server/node_modules/moment
8.1M    server/node_modules/drizzle-orm
6.5M    server/node_modules/fastify
3.8M    server/node_modules/pg
2.1M    server/node_modules/zod
132M    client/node_modules/next
6.9M    client/node_modules/react-dom
22M     client/node_modules/date-fns
1.9M    client/node_modules/zod
2.1M    reviewer-core/node_modules/zod
210M    e2e/node_modules/playwright
```

## rg -n "^import .* from ['\"]" --glob '*.ts' --glob '*.tsx' server/src client/src reviewer-core/src

```
server/src/app.ts:1:import Fastify from "fastify";
server/src/app.ts:2:import { z } from "zod";
server/src/db/client.ts:1:import { drizzle } from "drizzle-orm/node-postgres";
server/src/db/client.ts:2:import pg from "pg";
server/src/db/schema.ts:1:import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
server/src/routes/reviews.ts:1:import type { FastifyInstance } from "fastify";
server/src/routes/reviews.ts:2:import type { Review } from "@shared/review-types";
server/src/services/review-service.ts:1:import { runPipeline } from "../../../reviewer-core/src/pipeline.js";
server/src/services/review-service.ts:2:import type { Review } from "@shared/review-types";
server/src/services/date.ts:1:import { formatISO } from "date-fns";
client/src/app/page.tsx:1:import { useQuery } from "@tanstack/react-query";
client/src/app/page.tsx:2:import { format } from "date-fns";
client/src/lib/api-types.ts:1:import type { Review } from "@shared/review-types";
client/src/lib/api-types.ts:2:import { z } from "zod";
reviewer-core/src/index.ts:1:export { runPipeline } from "./pipeline.js";
reviewer-core/src/pipeline.ts:1:import { z } from "zod";
```
