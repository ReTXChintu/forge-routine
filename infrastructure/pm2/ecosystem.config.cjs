/**
 * PM2 process definitions (docs/deployment.md).
 *
 * No containers anywhere. PostgreSQL and Redis are external managed services
 * reached by connection string.
 *
 *   pnpm start                      # everything, production env
 *   pnpm restart                    # zero-downtime reload
 *   pnpm stop
 *   pm2 save && pm2 startup         # survive reboot
 *
 * Ports: the web bundle is served on 50004 and the API listens on 50005.
 * Both are behind nginx in production, which is the only thing bound to 80
 * and 443.
 *
 * Secrets live in an .env file outside the repository, mode 0600, owned by the
 * service user. Set FORGEROUTINE_ENV_FILE if it is not at the default path.
 */

const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const ENV_FILE = process.env.FORGEROUTINE_ENV_FILE ?? '/etc/forgeroutine/.env';

const WEB_PORT = process.env.WEB_PORT ?? 50004;
const API_PORT = process.env.API_PORT ?? 50005;

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
      // PORT is set here rather than only in the env file so the process
      // cannot silently come up on the default and leave nginx proxying to
      // nothing.
      env: { NODE_ENV: 'development', API_PORT },
      env_production: { NODE_ENV: 'production', API_PORT },

      out_file: '/var/log/forgeroutine/api.out.log',
      error_file: '/var/log/forgeroutine/api.err.log',
      merge_logs: true,
      time: true,
    },

    {
      name: 'forgeroutine-web',
      cwd: resolve(ROOT, 'apps/web'),

      // PM2's own static server, configured the documented way: `script:
      // 'serve'` plus PM2_SERVE_* environment variables. Not the `serve` npm
      // package, which is a different program with different flags — an
      // earlier version of this file passed `--spa` to it and the process
      // died on startup with "unknown or unexpected option".
      //
      // Using the built-in also means the server needs no network access to
      // start, which matters on a box that may not reach the registry.
      script: 'serve',

      // Fork, single instance. Serving static files is not the bottleneck,
      // and nginx sits in front of it anyway.
      instances: 1,
      exec_mode: 'fork',

      max_memory_restart: '256M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 2_000,

      env: {
        NODE_ENV: 'development',
        PM2_SERVE_PATH: resolve(ROOT, 'apps/web/dist'),
        PM2_SERVE_PORT: WEB_PORT,
        // SPA mode. Load-bearing: without it a refresh on /roadmap asks the
        // static server for a file that does not exist and gets a 404.
        PM2_SERVE_SPA: 'true',
        PM2_SERVE_HOMEPAGE: '/index.html',
      },
      env_production: {
        NODE_ENV: 'production',
        PM2_SERVE_PATH: resolve(ROOT, 'apps/web/dist'),
        PM2_SERVE_PORT: WEB_PORT,
        PM2_SERVE_SPA: 'true',
        PM2_SERVE_HOMEPAGE: '/index.html',
      },

      out_file: '/var/log/forgeroutine/web.out.log',
      error_file: '/var/log/forgeroutine/web.err.log',
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
