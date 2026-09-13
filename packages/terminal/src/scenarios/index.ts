import type { TerminalScenario } from '../scenario.js';

/**
 * Curated terminal scenarios.
 *
 * Hand-written rather than generated, deliberately. A generated coding
 * exercise can be verified by executing it; a generated Linux scenario can
 * only be verified against this simulator, which would prove it consistent
 * with the simulation rather than correct about Linux. A wrong Linux exercise
 * teaches a wrong fact and the user carries it to a real machine.
 *
 * Each scenario is a situation, not a command drill. "Use chmod to set 600"
 * tests whether you read the man page; "this deploy key is being rejected as
 * too permissive" tests whether you know why.
 */

const LOG_SAMPLE = `2026-03-01T09:14:02Z INFO  worker started pid=118
2026-03-01T09:14:09Z INFO  cache warm hit_rate=0.00
2026-03-01T09:15:41Z WARN  slow query duration_ms=2140 table=orders
2026-03-01T09:16:03Z ERROR upstream timeout service=payments attempt=1
2026-03-01T09:16:09Z ERROR upstream timeout service=payments attempt=2
2026-03-01T09:16:21Z ERROR upstream timeout service=payments attempt=3
2026-03-01T09:16:22Z ERROR circuit opened service=payments
2026-03-01T09:18:00Z INFO  circuit half-open service=payments
2026-03-01T09:18:02Z INFO  circuit closed service=payments
2026-03-01T09:22:15Z WARN  slow query duration_ms=3310 table=orders
`;

export const TERMINAL_SCENARIOS: readonly TerminalScenario[] = [
  {
    slug: 'find-the-error-window',
    title: 'Find when the incident started',
    task: `A payments outage was reported this morning. The service log is at /var/log/app/service.log.

Write the ERROR lines — and only the ERROR lines — to /home/forge/errors.txt, so you can hand the on-call engineer the window rather than the whole file.`,
    tree: {
      home: { forge: {} },
      var: { log: { app: { 'service.log': LOG_SAMPLE } } },
    },
    cwd: '/home/forge',
    checks: [
      { kind: 'fileExists', path: '/home/forge/errors.txt' },
      { kind: 'fileContains', path: '/home/forge/errors.txt', text: 'circuit opened' },
      { kind: 'fileContains', path: '/home/forge/errors.txt', text: 'attempt=3' },
      // The point is filtering. A file with the INFO lines still in it is a
      // copy of the log, not an answer.
      { kind: 'outputMatches', pattern: '^$' },
      { kind: 'commandNotUsed', pattern: 'cp\\s' },
    ],
    hints: [
      'What distinguishes the lines you want from the lines you do not?',
      'Where does a command send its output if you do not tell it otherwise?',
    ],
  },

  {
    slug: 'deploy-key-permissions',
    title: 'A deploy key the agent refuses to load',
    task: `Your deploy fails with "UNPROTECTED PRIVATE KEY FILE" for /home/forge/.ssh/id_deploy.

Fix the permissions so the key is usable. The directory matters as well as the file.`,
    tree: {
      home: {
        forge: {
          '.ssh': {
            id_deploy: { content: 'PRIVATE KEY MATERIAL', mode: 0o644 },
            'id_deploy.pub': { content: 'ssh-ed25519 AAAA...', mode: 0o644 },
            config: { content: 'Host deploy\n  IdentityFile ~/.ssh/id_deploy\n', mode: 0o644 },
          },
        },
      },
    },
    cwd: '/home/forge',
    checks: [
      { kind: 'fileMode', path: '/home/forge/.ssh/id_deploy', mode: 0o600 },
      { kind: 'fileMode', path: '/home/forge/.ssh', mode: 0o700 },
      // The public key is public. Locking it down too suggests the rule was
      // copied rather than understood.
      { kind: 'fileMode', path: '/home/forge/.ssh/id_deploy.pub', mode: 0o644 },
    ],
    hints: [
      'Who else can currently read the private key?',
      'A directory’s permissions decide who can list what is inside it. Does that matter here?',
    ],
  },

  {
    slug: 'config-drift',
    title: 'Two config files, one difference',
    task: `Staging works and production does not. Both config files are in /srv/config.

Find the setting that differs and write just that line from the production file to /home/forge/drift.txt.`,
    tree: {
      home: { forge: {} },
      srv: {
        config: {
          'staging.env': 'LOG_LEVEL=debug\nPOOL_SIZE=20\nTIMEOUT_MS=5000\nRETRIES=3\n',
          'production.env': 'LOG_LEVEL=info\nPOOL_SIZE=20\nTIMEOUT_MS=500\nRETRIES=3\n',
        },
      },
    },
    cwd: '/home/forge',
    checks: [
      { kind: 'fileExists', path: '/home/forge/drift.txt' },
      { kind: 'fileContains', path: '/home/forge/drift.txt', text: 'TIMEOUT_MS=500' },
      // LOG_LEVEL also differs but is not the fault. Including it means the
      // difference was found and the cause was not.
      { kind: 'fileEquals', path: '/home/forge/drift.txt', content: 'TIMEOUT_MS=500' },
    ],
    hints: [
      'Both files differ in two places. Which difference could cause a failure rather than just noise?',
      'A 500ms timeout against an upstream that usually answers in 800ms — what happens?',
    ],
  },

  {
    slug: 'reclaim-disk',
    title: 'The disk is full of rotated logs',
    task: `/var/log/app is full of rotated logs. The application only needs service.log.

Delete every rotated file (the ones ending in a number) and leave service.log untouched.`,
    tree: {
      home: { forge: {} },
      var: {
        log: {
          app: {
            'service.log': LOG_SAMPLE,
            'service.log.1': 'older\n',
            'service.log.2': 'older still\n',
            'service.log.3': 'oldest\n',
            'audit.log': 'keep me\n',
          },
        },
      },
    },
    cwd: '/var/log/app',
    checks: [
      { kind: 'fileExists', path: '/var/log/app/service.log' },
      { kind: 'fileExists', path: '/var/log/app/audit.log' },
      { kind: 'fileAbsent', path: '/var/log/app/service.log.1' },
      { kind: 'fileAbsent', path: '/var/log/app/service.log.2' },
      { kind: 'fileAbsent', path: '/var/log/app/service.log.3' },
    ],
    hints: [
      'What do the files you want to delete have in common that service.log does not?',
      'A pattern ending in * would match service.log too. What sits between the name and the number?',
    ],
  },

  {
    slug: 'safe-restructure',
    title: 'Restructure a release without losing it',
    task: `/srv/app/current holds a running release. Ops wants it under /srv/app/releases/2026-03-01, with /srv/app/current removed afterwards.

Nothing may be lost. Do it without deleting anything before it has been copied.`,
    tree: {
      srv: {
        app: {
          current: {
            'server.js': 'console.log("up");\n',
            'package.json': '{"name":"app"}\n',
            config: { 'app.env': 'PORT=8080\n' },
          },
        },
      },
      home: { forge: {} },
    },
    cwd: '/srv/app',
    checks: [
      { kind: 'fileExists', path: '/srv/app/releases/2026-03-01/server.js' },
      { kind: 'fileExists', path: '/srv/app/releases/2026-03-01/config/app.env' },
      {
        kind: 'fileContains',
        path: '/srv/app/releases/2026-03-01/config/app.env',
        text: 'PORT=8080',
      },
      { kind: 'fileAbsent', path: '/srv/app/current' },
    ],
    hints: [
      'The target directory does not exist yet. Does your command create intermediate directories?',
      'A directory is not copied by default. Which flag changes that?',
    ],
  },
];

export function findScenario(slug: string): TerminalScenario | undefined {
  return TERMINAL_SCENARIOS.find((scenario) => scenario.slug === slug);
}
