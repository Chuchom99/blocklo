import "./config/env.js";
import { startWorkers } from "./jobs/workers.js";

// Standalone worker process: run with RUN_WORKERS=false on the API servers.
await startWorkers();
