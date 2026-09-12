/**
 * PM2 process definitions (docs/deployment.md).
 *
 * No containers anywhere. PostgreSQL and Redis are external managed services
 * reached by connection string.
 *
 *   pm2 start infrastructure/pm2/ecosystem.config.cjs --env production
 *   pm2 reload forgeroutine-api     # zero-downtime, one worker at a time
 *   pm2 save && pm2 startup         # survive reboot
 *
 * Secrets live in an .env file outside the repository, mode 0600, owned by the
 * service user. Set FORGEROUTINE_ENV_FILE if it is not at the default path.
 */

const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const ENV_FILE = process.env.FORGEROUTINE_ENV_FILE ?? '/etc/forgeroutine/.env';

module.exports = {
  apps: [
    {
      name: 'forgeroutine-api',
      cwd: resolve(ROOT, 'apps/api'),
      script: 'dist/main.js',
      // One worker per core. The API is I/O-bound; code execution is somebody
      // else's process entirely.
      instances: 'max',
      exec_mode: 'cluster',

      // Graceful shutdown: the app drains in-flight requests and closes Prisma
      // and Redis before exiting. Give it room to finish a submission.
      kill_timeout: 10_000,
      listen_timeout: 10_000,
      wait_ready: false,

      max_memory_restart: '512M',
      autorestart: true,
      // If it crashes ten times in a row, something is wrong that restarting
      // will not fix. Stop and let the operator see it.
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 2_000,

      env_file: ENV_FILE,
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },

      out_file: '/var/log/forgeroutine/api.out.log',
      error_file: '/var/log/forgeroutine/api.err.log',
      merge_logs: true,
      time: true,
    },

    {
      name: 'forgeroutine-sandbox',
      cwd: resolve(ROOT, 'apps/sandbox'),
      script: 'dist/main.js',

      // Fork, deliberately. These workers spawn child processes of their own;
      // a cluster master sharing a socket with them buys nothing and
      // complicates the shutdown path. Scale by raising `instances`.
      instances: 2,
      exec_mode: 'fork',

      // Longer than the API's: a worker must be allowed to finish the run it is
      // holding and kill its child process group, or a deploy leaves orphaned
      // `node` processes on the box.
      kill_timeout: 20_000,

      max_memory_restart: '512M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 2_000,

      env_file: ENV_FILE,
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },

      out_file: '/var/log/forgeroutine/sandbox.out.log',
      error_file: '/var/log/forgeroutine/sandbox.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
