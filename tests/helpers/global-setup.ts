import { execSync } from "node:child_process";

/**
 * Integration tests run against TEST_DATABASE_URL (never DATABASE_URL).
 * The schema is rebuilt from the migration history, so the tests also prove
 * that the migrations produce a working database.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Point it at a disposable PostgreSQL database (it will be reset).");
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — the test database is wiped.");
  }
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}
