import config from "./config/env.js";
import logger from "./config/logger.js";
import app from "./app.js";
import { startWorkers } from "./jobs/workers.js";

app.listen(config.port, () => logger.info(`Server listening on port ${config.port}`));

// Workers can run in this process (default) or separately via `npm run worker`.
if (config.runWorkers) await startWorkers();
