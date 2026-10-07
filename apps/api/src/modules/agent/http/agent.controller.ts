import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { Problems } from '../../../common/http/problem-details.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  AgentPairingService,
  type AgentSettingsView,
  type PairedAgent,
  type PairingCodeView,
} from '../application/agent-pairing.service.js';

const pairSchema = z.object({
  code: z.string().min(4).max(20),
  /** The machine's name, so Settings can tell two agents apart. */
  name: z.string().max(120).default(''),
});

const orderSchema = z.object({
  order: z.array(z.enum(['CLAUDE_CODE', 'CODEX'])).max(2),
});

type PairInput = z.infer<typeof pairSchema>;
type OrderInput = z.infer<typeof orderSchema>;

/** The ForgeRoutine Agent as the settings screen manages it. */
@ApiTags('settings')
@Controller('settings/ai/agent')
@UseGuards(JwtAuthGuard)
export class AgentSettingsController {
  constructor(private readonly pairing: AgentPairingService) {}

  @Get()
  @ApiOperation({ summary: 'Paired agents, which are connected, and the local CLI order' })
  view(@CurrentUser() user: AuthenticatedUser): Promise<AgentSettingsView> {
    return this.pairing.view(user.userId);
  }

  @Post('pairing-code')
  @ApiOperation({ summary: 'A one-time code to type into the agent' })
  createCode(@CurrentUser() user: AuthenticatedUser): Promise<PairingCodeView> {
    return this.pairing.createCode(user.userId);
  }

  @Delete('devices/:id')
  @ApiOperation({ summary: 'Unpair an agent and disconnect it' })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AgentSettingsView> {
    return this.pairing.revoke(user.userId, id);
  }

  @Put('order')
  @ApiOperation({ summary: 'Which local CLIs to try, in order, before any saved key' })
  setOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(orderSchema)) body: OrderInput,
  ): Promise<AgentSettingsView> {
    return this.pairing.setOrder(user.userId, body.order);
  }
}

/** Attempts per address in the window below. Codes are 40 bits; this keeps guessing pointless. */
const PAIR_ATTEMPTS = 10;
const PAIR_WINDOW_MS = 10 * 60_000;

/**
 * The one unauthenticated agent endpoint: the agent has no account session,
 * only the code the user typed into it.
 */
@ApiTags('agent')
@Controller('agent')
export class AgentController {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly pairing: AgentPairingService) {}

  @Post('pair')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trade a pairing code for an agent device token' })
  pair(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(pairSchema)) body: PairInput,
  ): Promise<PairedAgent> {
    const now = Date.now();
    const recent = (this.attempts.get(ip) ?? []).filter((at) => now - at < PAIR_WINDOW_MS);
    if (recent.length >= PAIR_ATTEMPTS) {
      throw Problems.tooManyRequests(
        'Too many pairing attempts. Wait a few minutes and try again.',
      );
    }
    recent.push(now);
    this.attempts.set(ip, recent);
    if (this.attempts.size > 1_000) this.attempts.clear();

    return this.pairing.pair(body.code, body.name);
  }
}
