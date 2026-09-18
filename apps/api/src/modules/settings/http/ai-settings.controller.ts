import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  AISettingsService,
  parseVendor,
  type AISettingsView,
} from '../application/ai-settings.service.js';

const selectSchema = z.object({
  /** Null means "follow the server's configuration". */
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI']).nullable(),
});

const keySchema = z.object({
  apiKey: z.string().min(8).max(400),
  modelFast: z.string().max(120).nullish(),
  modelReasoning: z.string().max(120).nullish(),
});

type SelectInput = z.infer<typeof selectSchema>;
type KeyInput = z.infer<typeof keySchema>;

/**
 * Settings for which model vendor a user's AI calls go to.
 *
 * There is deliberately no endpoint that returns an API key. The view
 * carries `configured` and the last four characters and nothing else — a
 * key that can be read back out of an API is a key that ends up in a log,
 * a screenshot or a support ticket.
 */
@ApiTags('settings')
@Controller('settings/ai')
@UseGuards(JwtAuthGuard)
export class AISettingsController {
  constructor(private readonly settings: AISettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Which vendors are configured, and which one is in use' })
  view(@CurrentUser() user: AuthenticatedUser): Promise<AISettingsView> {
    return this.settings.view(user.userId);
  }

  @Put('provider')
  @ApiOperation({ summary: 'Choose the vendor. Null follows the server default.' })
  select(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(selectSchema)) body: SelectInput,
  ): Promise<AISettingsView> {
    return this.settings.select(user.userId, body.provider);
  }

  @Put('keys/:provider')
  @ApiOperation({ summary: 'Save an API key. Encrypted at rest; never returned.' })
  saveKey(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(keySchema)) body: KeyInput,
  ): Promise<AISettingsView> {
    return this.settings.saveKey(user.userId, parseVendor(provider), body);
  }

  @Delete('keys/:provider')
  @ApiOperation({ summary: 'Forget a saved key' })
  removeKey(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
  ): Promise<AISettingsView> {
    return this.settings.removeKey(user.userId, parseVendor(provider));
  }

  @Post('keys/:provider/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make one tiny real call to prove the key works' })
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
  ): Promise<{ ok: boolean; detail: string }> {
    return this.settings.test(user.userId, parseVendor(provider));
  }
}
