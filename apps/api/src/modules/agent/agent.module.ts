import { Global, Module } from '@nestjs/common';

import { AgentHub } from './application/agent-hub.service.js';
import { AgentPairingService } from './application/agent-pairing.service.js';
import { AgentController, AgentSettingsController } from './http/agent.controller.js';

/**
 * The ForgeRoutine Agent: the helper on a user's own machine that runs their
 * Claude Code and Codex for them. Global because AI routing, in the settings
 * module, asks the hub which agents are connected on every call.
 */
@Global()
@Module({
  controllers: [AgentSettingsController, AgentController],
  providers: [AgentHub, AgentPairingService],
  exports: [AgentHub],
})
export class AgentModule {}
