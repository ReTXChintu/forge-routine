import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AIUnavailable, type AIProvider, type CliJob } from '@forgeroutine/ai';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';
import { AI_PROVIDER } from '../src/modules/ai/ai.tokens.js';

/**
 * The ForgeRoutine Agent, end to end, with a stand-in agent.
 *
 * The real agent is a desktop helper that runs Claude Code or Codex on the
 * user's machine. Here a plain WebSocket client plays its part — pairs with a
 * code, connects with the token it got, says which tools it has, and answers
 * jobs with the output the real CLI would print — so what is under test is
 * everything on this side: pairing, the socket, and AI calls actually being
 * routed down it, in the user's order, falling back when it cannot answer.
 *
 * No model is called, and no key is saved.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let ai: AIProvider;
let accessToken: string;
let userId: string;
let socketUrl: string;

const user = {
  email: `agent-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Agent Test',
};

const auth = () => ({ Authorization: `Bearer ${accessToken}` });
const ctx = () => ({ userId, agent: 'agent-e2e', promptVersion: 'v1' });
const prompt = { model: 'fast' as const, messages: [{ role: 'user' as const, content: 'hello' }] };

/** What `claude -p --output-format json` prints for a plain answer. */
const claudeEnvelope = (text: string) =>
  JSON.stringify({
    type: 'result',
    is_error: false,
    result: text,
    usage: { input_tokens: 3, output_tokens: 2 },
  });

interface FakeAgent {
  socket: WebSocket;
  jobs: CliJob[];
  closed: Promise<number>;
}

/**
 * Connects a stand-in agent. `answer` decides each job: an outcome to send
 * back, or a string to report as a failure to run.
 */
async function connectAgent(
  token: string,
  tools: { CLAUDE_CODE: boolean; CODEX: boolean },
  answer: (job: CliJob) => { stdout: string; answer?: string | null } | string,
): Promise<FakeAgent> {
  const socket = new WebSocket(socketUrl, { headers: { Authorization: `Bearer ${token}` } });
  const jobs: CliJob[] = [];
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as { type: string; id?: string; job?: CliJob };
    if (message.type !== 'run' || !message.job) return;

    jobs.push(message.job);
    const reply = answer(message.job);
    socket.send(
      JSON.stringify(
        typeof reply === 'string'
          ? { type: 'failed', id: message.id, error: reply }
          : {
              type: 'result',
              id: message.id,
              outcome: { stdout: reply.stdout, stderr: '', code: 0, answer: reply.answer ?? null },
            },
      ),
    );
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('message', () => resolve());
    socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    socket.once('error', reject);
  });

  socket.send(
    JSON.stringify({
      type: 'hello',
      version: 'test',
      tools: {
        CLAUDE_CODE: { available: tools.CLAUDE_CODE, detail: null },
        CODEX: { available: tools.CODEX, detail: null },
      },
    }),
  );
  // The hello is processed asynchronously; one round trip settles it.
  await waitFor(async () =>
    (await agentView()).devices.some(
      (device) =>
        device.connection?.tools.CLAUDE_CODE.available === tools.CLAUDE_CODE &&
        device.connection.tools.CODEX.available === tools.CODEX,
    ),
  );

  return { socket, jobs, closed };
}

async function agentView() {
  return (await http.get('/api/v1/settings/ai/agent').set(auth()).expect(200)).body as {
    order: string[];
    devices: {
      id: string;
      name: string;
      connection: { tools: Record<'CLAUDE_CODE' | 'CODEX', { available: boolean }> } | null;
    }[];
  };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting');
}

async function pairDevice(name = 'Test laptop'): Promise<{ token: string; deviceId: string }> {
  const { code } = (
    await http.post('/api/v1/settings/ai/agent/pairing-code').set(auth()).expect(201)
  ).body;
  const paired = await http.post('/api/v1/agent/pair').send({ code, name }).expect(200);
  return { token: paired.body.token, deviceId: paired.body.deviceId };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  // Listening for real: the agent connects over a socket, not supertest.
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  socketUrl = `ws://127.0.0.1:${port}/api/v1/agent/connect`;
  http = request(app.getHttpServer());
  ai = app.get(AI_PROVIDER);

  const registered = await http.post('/api/v1/auth/register').send(user).expect(201);
  accessToken = registered.body.accessToken;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: user.email } })).id;
}, 120_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('pairing', () => {
  it('trades a one-time code for a device token, once', async () => {
    const { code } = (
      await http.post('/api/v1/settings/ai/agent/pairing-code').set(auth()).expect(201)
    ).body;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Typed loosely — lower case, no dash — as somebody would.
    const paired = await http
      .post('/api/v1/agent/pair')
      .send({ code: code.replace('-', '').toLowerCase(), name: 'My PC' })
      .expect(200);
    expect(paired.body.token).toMatch(/^fra_/);
    expect(paired.body.email).toBe(user.email);

    await http.post('/api/v1/agent/pair').send({ code, name: 'Again' }).expect(400);
    await http.post('/api/v1/agent/pair').send({ code: 'ZZZZ-ZZZZ' }).expect(400);

    // Only a hash is stored.
    const stored = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: paired.body.deviceId },
    });
    expect(stored.tokenHash).not.toContain(paired.body.token);

    await http
      .delete(`/api/v1/settings/ai/agent/devices/${paired.body.deviceId}`)
      .set(auth())
      .expect(200);
  });

  it('refuses a socket with no token or a wrong one', async () => {
    const refused = (headers: Record<string, string>) =>
      new Promise<number>((resolve) => {
        const socket = new WebSocket(socketUrl, { headers });
        socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        socket.on('error', () => resolve(-1));
      });

    expect(await refused({})).toBe(401);
    expect(await refused({ Authorization: 'Bearer fra_not-a-real-token' })).toBe(401);
  });
});

describe('AI calls through the agent', () => {
  it('has no AI at all with no agent and no key, and says how to get some', async () => {
    const error = await ai.generate({ prompt, context: ctx() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIUnavailable);
  });

  it('routes a call to the connected agent’s Claude Code, by meaning not by argv', async () => {
    const { token, deviceId } = await pairDevice();
    const agent = await connectAgent(token, { CLAUDE_CODE: true, CODEX: false }, () => ({
      stdout: claudeEnvelope('hi from your laptop'),
    }));

    const result = await ai.generate({ prompt, context: ctx() });

    expect(result.text).toBe('hi from your laptop');
    expect(agent.jobs).toHaveLength(1);
    expect(agent.jobs[0]).toMatchObject({
      tool: 'CLAUDE_CODE',
      conversation: 'hello',
      model: 'haiku',
    });
    // A job, not a command line: nothing in it could name a program to run.
    expect(Object.keys(agent.jobs[0]!).sort()).toEqual(
      ['conversation', 'jsonSchema', 'model', 'system', 'timeoutMs', 'tool'].sort(),
    );

    await http.delete(`/api/v1/settings/ai/agent/devices/${deviceId}`).set(auth()).expect(200);
    expect(await agent.closed).toBe(4401);
  });

  it('follows the order chosen in Settings, and moves on when a tool cannot run', async () => {
    const { token, deviceId } = await pairDevice();
    await http
      .put('/api/v1/settings/ai/agent/order')
      .set(auth())
      .send({ order: ['CODEX', 'CLAUDE_CODE'] })
      .expect(200);

    const agent = await connectAgent(token, { CLAUDE_CODE: true, CODEX: true }, (job) =>
      job.tool === 'CODEX'
        ? 'Codex is not signed in'
        : { stdout: claudeEnvelope('claude answered') },
    );

    const result = await ai.generate({ prompt, context: ctx() });

    expect(agent.jobs.map((job) => job.tool)).toEqual(['CODEX', 'CLAUDE_CODE']);
    expect(result.text).toBe('claude answered');

    await http.delete(`/api/v1/settings/ai/agent/devices/${deviceId}`).set(auth()).expect(200);
    await agent.closed;
  });

  it('reads Codex’s answer file contents sent back by the agent', async () => {
    const { token, deviceId } = await pairDevice();
    await http
      .put('/api/v1/settings/ai/agent/order')
      .set(auth())
      .send({ order: ['CODEX'] })
      .expect(200);

    const agent = await connectAgent(token, { CLAUDE_CODE: true, CODEX: true }, () => ({
      stdout: JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
      answer: 'codex answered\n',
    }));

    const result = await ai.generate({ prompt, context: ctx() });
    expect(result.text).toBe('codex answered');
    // An empty order entry is respected: Claude Code was left out on purpose.
    expect(agent.jobs.map((job) => job.tool)).toEqual(['CODEX']);

    await http.delete(`/api/v1/settings/ai/agent/devices/${deviceId}`).set(auth()).expect(200);
    await agent.closed;
  });

  it('shows connected agents in Settings, and forgets them once unpaired', async () => {
    const { token, deviceId } = await pairDevice('Workstation');
    const agent = await connectAgent(token, { CLAUDE_CODE: false, CODEX: true }, () => 'unused');

    const view = await agentView();
    const device = view.devices.find((d) => d.id === deviceId)!;
    expect(device.name).toBe('Workstation');
    expect(device.connection?.tools.CODEX.available).toBe(true);

    await http.delete(`/api/v1/settings/ai/agent/devices/${deviceId}`).set(auth()).expect(200);
    expect(await agent.closed).toBe(4401);
    expect((await agentView()).devices.some((d) => d.id === deviceId)).toBe(false);

    // And the revoked token no longer opens a socket.
    await expect(
      connectAgent(token, { CLAUDE_CODE: true, CODEX: true }, () => 'x'),
    ).rejects.toThrow('HTTP 401');
  });

  it('rejects an order that names a tool twice', async () => {
    await http
      .put('/api/v1/settings/ai/agent/order')
      .set(auth())
      .send({ order: ['CODEX', 'CODEX'] })
      .expect(400);
  });
});
