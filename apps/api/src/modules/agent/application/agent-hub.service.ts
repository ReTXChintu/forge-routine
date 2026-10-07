import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import {
  AIUnavailable,
  type CallContext,
  type CliExecutor,
  type CliJob,
  type CliOutcome,
  type CliTool,
} from '@forgeroutine/ai';
import type { AppConfig } from '@forgeroutine/config';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

/**
 * The live connections from ForgeRoutine Agents, and the way AI calls reach
 * them.
 *
 * The agent is a small helper on the user's own machine. A browser cannot
 * start a program, and this server cannot reach into anybody's computer, so
 * the agent dials out instead: it holds one WebSocket open to here, says
 * which CLIs it found, and runs whatever jobs arrive on it. That turns the
 * user's own signed-in Claude Code or Codex into a provider this server can
 * use, with nothing installed here.
 *
 * Jobs are described by meaning (`CliJob`), never as a command line. The
 * agent builds the argument list itself and runs nothing else, so this
 * socket cannot be used to run arbitrary commands on somebody's machine —
 * not by this server, and not by anyone who got hold of it.
 *
 * In memory, because the API is one process (ecosystem.config.cjs). Running
 * it as a cluster would need the registry moved to Redis.
 */

/** What an agent says it can run. */
export type AgentTools = Record<CliTool, { available: boolean; detail: string | null }>;

export interface AgentConnectionView {
  deviceId: string;
  version: string | null;
  connectedAt: string;
  tools: AgentTools;
}

interface Pending {
  resolve: (outcome: CliOutcome) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  agent: string;
}

interface AgentConnection {
  deviceId: string;
  userId: string;
  socket: WebSocket;
  connectedAt: Date;
  version: string | null;
  /** Null until the agent's hello arrives; nothing is sent to it before. */
  tools: AgentTools | null;
  alive: boolean;
  pending: Map<string, Pending>;
}

/** Messages from the agent. Anything else is ignored. */
type AgentMessage =
  | { type: 'hello'; version?: string; tools?: unknown }
  | { type: 'tools'; tools?: unknown }
  | { type: 'result'; id?: string; outcome?: Partial<CliOutcome> }
  | { type: 'failed'; id?: string; error?: string };

/** Close codes the agent acts on: stop retrying, the pairing is gone. */
export const AGENT_CLOSE_REVOKED = 4401;
/** A newer connection from the same device replaced this one. */
export const AGENT_CLOSE_REPLACED = 4409;

const HEARTBEAT_MS = 30_000;
/** Beyond the job's own timeout: the agent's process start and the round trip. */
const RESULT_GRACE_MS = 15_000;
const TOOLS: readonly CliTool[] = ['CLAUDE_CODE', 'CODEX'];

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AgentHub implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgentHub.name);

  /** Prompts and schemas are text; a few MB covers the largest generation prompt. */
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

  private readonly connections = new Map<string, AgentConnection>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The path agents connect to, under the API's own prefix. */
  get path(): string {
    return `/${this.config.env.API_GLOBAL_PREFIX}/v1/agent/connect`;
  }

  onApplicationBootstrap(): void {
    const http = this.adapterHost.httpAdapter?.getHttpServer() as
      import('node:http').Server | undefined;
    if (!http) return;

    http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.onUpgrade(request, socket, head);
    });

    // Ping every agent; one that missed the last ping is gone, whatever its
    // socket thinks. A laptop going to sleep never sends a close frame.
    this.heartbeat = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (!connection.alive) {
          connection.socket.terminate();
          continue;
        }
        connection.alive = false;
        connection.socket.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const connection of this.connections.values())
      connection.socket.close(1001, 'Server shutting down');
    this.server.close();
  }

  // -- Connecting ---------------------------------------------------------------

  private async onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== this.path) {
      socket.destroy();
      return;
    }

    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const device = token
      ? await this.prisma.agentDevice.findUnique({
          where: { tokenHash: hashAgentToken(token) },
          select: { id: true, userId: true, revokedAt: true },
        })
      : null;

    if (!device || device.revokedAt) {
      // A plain HTTP refusal: there is no socket yet to send a close code on.
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    this.server.handleUpgrade(request, socket, head, (ws) =>
      this.accept(ws, device.id, device.userId),
    );
  }

  private accept(socket: WebSocket, deviceId: string, userId: string): void {
    // One connection per device. A restarted agent whose old socket has not
    // timed out yet would otherwise be counted twice.
    const previous = this.connections.get(deviceId);
    if (previous) previous.socket.close(AGENT_CLOSE_REPLACED, 'Replaced by a newer connection');

    const connection: AgentConnection = {
      deviceId,
      userId,
      socket,
      connectedAt: new Date(),
      version: null,
      tools: null,
      alive: true,
      pending: new Map(),
    };
    this.connections.set(deviceId, connection);
    void this.touch(deviceId);

    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data) => this.onMessage(connection, data));
    socket.on('close', () => this.onClose(connection));
    socket.on('error', (error) =>
      this.logger.warn(`Agent ${deviceId} socket error: ${error.message}`),
    );

    this.send(connection, { type: 'welcome', deviceId });
  }

  private onClose(connection: AgentConnection): void {
    if (this.connections.get(connection.deviceId) === connection) {
      this.connections.delete(connection.deviceId);
    }

    // Whatever was in flight cannot come back now. Failing it as unavailable
    // lets routing move on to the next vendor straight away.
    for (const [id, pending] of connection.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AIUnavailable(
          pending.agent,
          new Error('The ForgeRoutine Agent disconnected mid-request'),
        ),
      );
      connection.pending.delete(id);
    }

    void this.touch(connection.deviceId);
  }

  private onMessage(connection: AgentConnection, data: RawData): void {
    let message: AgentMessage;
    try {
      message = JSON.parse(data.toString()) as AgentMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case 'hello':
        connection.version =
          typeof message.version === 'string' ? message.version.slice(0, 40) : null;
        connection.tools = parseTools(message.tools);
        return;

      case 'tools':
        connection.tools = parseTools(message.tools);
        return;

      case 'result': {
        const pending = message.id ? connection.pending.get(message.id) : undefined;
        if (!pending) return;
        connection.pending.delete(message.id!);
        clearTimeout(pending.timer);
        const outcome = message.outcome ?? {};
        pending.resolve({
          stdout: typeof outcome.stdout === 'string' ? outcome.stdout : '',
          stderr: typeof outcome.stderr === 'string' ? outcome.stderr : '',
          code: typeof outcome.code === 'number' ? outcome.code : null,
          answer: typeof outcome.answer === 'string' ? outcome.answer : null,
        });
        return;
      }

      case 'failed': {
        const pending = message.id ? connection.pending.get(message.id) : undefined;
        if (!pending) return;
        connection.pending.delete(message.id!);
        clearTimeout(pending.timer);
        pending.reject(
          new AIUnavailable(
            pending.agent,
            new Error(
              `ForgeRoutine Agent: ${String(message.error ?? 'the run failed').slice(0, 500)}`,
            ),
          ),
        );
        return;
      }
    }
  }

  private send(connection: AgentConnection, message: unknown): void {
    connection.socket.send(JSON.stringify(message));
  }

  private async touch(deviceId: string): Promise<void> {
    await this.prisma.agentDevice
      .update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  // -- Using it -----------------------------------------------------------------

  /** Which tools this user's connected agents can run right now. */
  toolsFor(userId: string): Set<CliTool> {
    const tools = new Set<CliTool>();
    for (const connection of this.connections.values()) {
      if (connection.userId !== userId || !connection.tools) continue;
      for (const tool of TOOLS) if (connection.tools[tool].available) tools.add(tool);
    }
    return tools;
  }

  /** This user's live connections, for the settings screen. */
  connectionsFor(userId: string): AgentConnectionView[] {
    return [...this.connections.values()]
      .filter((connection) => connection.userId === userId)
      .map((connection) => ({
        deviceId: connection.deviceId,
        version: connection.version,
        connectedAt: connection.connectedAt.toISOString(),
        tools: connection.tools ?? emptyTools(),
      }));
  }

  /** Runs jobs on whichever of this user's agents can, newest connection first. */
  executorFor(userId: string): CliExecutor {
    return (job, context) => this.run(userId, job, context);
  }

  /** Ends a revoked device's connection, telling it not to come back. */
  disconnect(deviceId: string): void {
    this.connections
      .get(deviceId)
      ?.socket.close(AGENT_CLOSE_REVOKED, 'This agent was disconnected in Settings');
  }

  private run(userId: string, job: CliJob, context: CallContext): Promise<CliOutcome> {
    const connection = [...this.connections.values()]
      .filter((candidate) => candidate.userId === userId && candidate.tools?.[job.tool].available)
      .sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime())[0];

    if (!connection) {
      return Promise.reject(
        new AIUnavailable(
          context.agent,
          new Error(
            `No connected ForgeRoutine Agent can run ${job.tool === 'CODEX' ? 'Codex' : 'Claude Code'}`,
          ),
        ),
      );
    }

    const id = randomUUID();

    return new Promise<CliOutcome>((resolve, reject) => {
      const settle = () => {
        connection.pending.delete(id);
        context.signal?.removeEventListener('abort', onAbort);
      };

      const timer = setTimeout(() => {
        settle();
        this.send(connection, { type: 'cancel', id });
        reject(
          new AIUnavailable(
            context.agent,
            new Error(
              `The ForgeRoutine Agent did not answer within ${job.timeoutMs + RESULT_GRACE_MS}ms`,
            ),
          ),
        );
      }, job.timeoutMs + RESULT_GRACE_MS);

      const onAbort = () => {
        clearTimeout(timer);
        settle();
        this.send(connection, { type: 'cancel', id });
        reject(new AIUnavailable(context.agent, new Error('Cancelled')));
      };
      context.signal?.addEventListener('abort', onAbort, { once: true });

      connection.pending.set(id, {
        agent: context.agent,
        timer,
        resolve: (outcome) => {
          settle();
          resolve(outcome);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      });

      this.send(connection, { type: 'run', id, job });
    });
  }
}

function emptyTools(): AgentTools {
  return {
    CLAUDE_CODE: { available: false, detail: null },
    CODEX: { available: false, detail: null },
  };
}

/** Whatever the agent claimed, narrowed to the two tools and their shape. */
function parseTools(raw: unknown): AgentTools {
  const tools = emptyTools();
  if (!raw || typeof raw !== 'object') return tools;

  for (const tool of TOOLS) {
    const entry = (raw as Record<string, unknown>)[tool] as
      { available?: unknown; detail?: unknown } | undefined;
    if (!entry) continue;
    tools[tool] = {
      available: entry.available === true,
      detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 500) : null,
    };
  }

  return tools;
}
