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

import { AI_VENDORS, type AIVendor, type ModelOption } from '@forgeroutine/ai';

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
  type TutorModelView,
} from '../application/ai-settings.service.js';

const selectSchema = z.object({
  /** Null means "follow the server's configuration". */
  // Built from the catalogue rather than restated: a vendor added there and
  // not here would be rejected by validation with no clue why.
  provider: z.enum(AI_VENDORS as unknown as [AIVendor, ...AIVendor[]]).nullable(),
});

const keySchema = z.object({
  /** Optional: omit it to change only the models and keep the stored key. */
  apiKey: z.string().max(400).nullish(),
  modelFast: z.string().max(120).nullish(),
  modelReasoning: z.string().max(120).nullish(),
  modelTutor: z.string().max(120).nullish(),
});

/** Null means "follow the fast tier" rather than pinning one model. */
const tutorSchema = z.object({ model: z.string().max(120).nullable() });

type SelectInput = z.infer<typeof selectSchema>;
type KeyInput = z.infer<typeof keySchema>;
type TutorInput = z.infer<typeof tutorSchema>;

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

  @Get('tutor')
  @ApiOperation({ summary: 'The assistant’s model, and what it can be switched to' })
  tutor(@CurrentUser() user: AuthenticatedUser): Promise<TutorModelView> {
    return this.settings.tutorView(user.userId);
  }

  @Put('tutor')
  @ApiOperation({ summary: 'Switch the assistant’s model. Null follows the fast tier.' })
  setTutor(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(tutorSchema)) body: TutorInput,
  ): Promise<TutorModelView> {
    return this.settings.setTutorModel(user.userId, body.model);
  }

  @Get('keys/:provider/models')
  @ApiOperation({ summary: 'The models this key can reach, asked of the vendor' })
  listModels(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
  ): Promise<ModelOption[]> {
    return this.settings.listModels(user.userId, parseVendor(provider));
  }

  @Put('keys/:provider')
  @ApiOperation({ summary: 'Save a key and/or models. Keys are encrypted; never returned.' })
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
