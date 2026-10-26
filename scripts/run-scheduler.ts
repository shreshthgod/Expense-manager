/**
 * Runs the scheduler once for all users (local development or a container
 * cron). Equivalent to POST /api/cron/run.
 *   npm run cron
 */
import { runScheduledJobs } from "../server/jobs/scheduler";
import { prisma } from "../lib/db/prisma";

runScheduledJobs({ housekeeping: true })
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
