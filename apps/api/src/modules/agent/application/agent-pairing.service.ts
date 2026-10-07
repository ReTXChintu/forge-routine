import { randomBytes, randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { CliTool } from '@forgeroutine/ai';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

import { AgentHub, hashAgentToken, type AgentConnectionView } from './agent-hub.service.js';

/**
 * Linking a ForgeRoutine Agent to an account, and everything about it the
 * settings screen shows.
 *
 * The agent never sees a password. Settings shows a short one-time code; the
 * user types it into the agent, which trades it for a device token of its
 * own. That token is all the agent ever holds, it can only connect the agent
 * socket, and revoking the device here kills it.
 */

/** No 0/O or 1/I: the code is read off one screen and typed into another. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60_000;

export const LOCAL_TOOLS: readonly CliTool[] = ['CLAUDE_CODE', 'CODEX'];

export interface AgentDeviceView {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  /** Null when this device is not connected right now. */
  connection: AgentConnectionView | null;
}

export interface AgentSettingsView {
  /** Which local CLIs to try, in order, before any saved key. */
  order: CliTool[];
  devices: AgentDeviceView[];
}

export interface PairingCodeView {
  /** Shown as XXXX-XXXX. */
  code: string;
  expiresAt: string;
}

export interface PairedAgent {
  token: string;
  deviceId: string;
  name: string;
  email: string;
}

@Injectable()
export class AgentPairingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: AgentHub,
  ) {}

  async view(userId: string): Promise<AgentSettingsView> {
    const [preferences, devices] = await Promise.all([
      this.prisma.userPreferences.findUnique({ where: { userId }, select: { localAiOrder: true } }),
      this.prisma.agentDevice.findMany({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const live = new Map(
      this.hub.connectionsFor(userId).map((connection) => [connection.deviceId, connection]),
    );

    return {
      order: (preferences?.localAiOrder as CliTool[] | undefined) ?? [...LOCAL_TOOLS],
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        createdAt: device.createdAt.toISOString(),
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        connection: live.get(device.id) ?? null,
      })),
    };
  }

  /** A fresh code. Earlier unused ones stay valid until they expire. */
  async createCode(userId: string): Promise<PairingCodeView> {
    const code = Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await this.prisma.agentPairing.create({
      data: { userId, codeHash: hashAgentToken(code), expiresAt },
    });

    return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: expiresAt.toISOString() };
  }

  /** Trades a code for a device token. The code is spent either way it is used. */
  async pair(rawCode: string, rawName: string): Promise<PairedAgent> {
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pairing = await this.prisma.agentPairing.findUnique({
      where: { codeHash: hashAgentToken(code) },
      include: { user: { select: { email: true } } },
    });

    if (!pairing || pairing.usedAt || pairing.expiresAt.getTime() < Date.now()) {
      throw Problems.badRequest('That code is not valid. Create a new one in Settings → AI.');
    }

    // Conditional, so two agents racing on one code cannot both win.
    const claimed = await this.prisma.agentPairing.updateMany({
      where: { id: pairing.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw Problems.badRequest(
        'That code has already been used. Create a new one in Settings → AI.',
      );
    }

    const token = `fra_${randomBytes(32).toString('base64url')}`;
    const name = rawName.trim().slice(0, 80) || 'ForgeRoutine Agent';
    const device = await this.prisma.agentDevice.create({
      data: { userId: pairing.userId, name, tokenHash: hashAgentToken(token) },
    });

    return { token, deviceId: device.id, name, email: pairing.user.email };
  }

  async revoke(userId: string, deviceId: string): Promise<AgentSettingsView> {
    const revoked = await this.prisma.agentDevice.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw Problems.notFound('Agent');

    this.hub.disconnect(deviceId);
    return this.view(userId);
  }

  async setOrder(userId: string, order: CliTool[]): Promise<AgentSettingsView> {
    if (new Set(order).size !== order.length)
      throw Problems.badRequest('Each tool may appear once.');

    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, localAiOrder: order },
      update: { localAiOrder: order },
    });

    return this.view(userId);
  }
}
