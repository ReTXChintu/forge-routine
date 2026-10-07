import { Icon } from '~/components/Icon';
import { Badge, Button, Card } from '~/components/ui';
import {
  useAgentSettings,
  useCreatePairingCode,
  useRevokeAgent,
  useSetAgentOrder,
  type AgentDeviceView,
  type LocalToolId,
} from '~/lib/queries';

/**
 * The ForgeRoutine Agent: your own Claude Code and Codex, answering first.
 *
 * The agent is a small helper on your computer. A web page cannot start a
 * program, so the agent connects to the server instead and runs the CLIs you
 * already have, signed in as you. While it is connected it answers before any
 * saved key; when it is not, calls carry on with your keys.
 */

const TOOL_LABEL: Record<LocalToolId, string> = {
  CLAUDE_CODE: 'Claude Code',
  CODEX: 'Codex (ChatGPT)',
};

const ALL_TOOLS: LocalToolId[] = ['CLAUDE_CODE', 'CODEX'];

const AGENT_DOWNLOAD = '/downloads/ForgeRoutine-Agent-Setup.exe';

export function AgentPanel() {
  const { data: agent } = useAgentSettings();
  const pairing = useCreatePairingCode();
  const setOrder = useSetAgentOrder();

  if (!agent) return null;

  const connected = agent.devices.filter((device) => device.connection);
  const found = new Set(
    connected.flatMap((device) =>
      ALL_TOOLS.filter((tool) => device.connection!.tools[tool].available),
    ),
  );

  // Enabled tools in order, then the disabled ones, so both can be toggled.
  const rows = [...agent.order, ...ALL_TOOLS.filter((tool) => !agent.order.includes(tool))];

  const move = (tool: LocalToolId, by: -1 | 1) => {
    const order = [...agent.order];
    const at = order.indexOf(tool);
    const to = at + by;
    if (at < 0 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to]!, order[at]!];
    setOrder.mutate(order);
  };

  const toggle = (tool: LocalToolId) =>
    setOrder.mutate(
      agent.order.includes(tool) ? agent.order.filter((t) => t !== tool) : [...agent.order, tool],
    );

  return (
    <Card>
      <div className="row items-center justify-between g3 mb1 wrap">
        <div className="row items-center g2">
          <span className="t-h4">ForgeRoutine Agent</span>
          {connected.length > 0 ? (
            <Badge variant="success" icon="monitor">
              connected
            </Badge>
          ) : (
            <Badge variant="neutral">not running</Badge>
          )}
        </div>

        {/* Served by the web app itself: `pnpm agent:build` copies the
            installer to public/downloads under this fixed name. */}
        <a className="t-caption row items-center g1" href={AGENT_DOWNLOAD} download>
          <Icon name="download" size={14} />
          Download for Windows
        </a>
      </div>

      <div className="t-small mb4">
        Uses the Claude Code and Codex already installed and signed in on your computer, so they
        answer before any key below. When the agent is not running, your saved keys take over — the
        selected one first, then the others.
      </div>

      <div className="col g2 mb4">
        <div className="field-label">Try in this order</div>
        {rows.map((tool) => {
          const enabled = agent.order.includes(tool);
          const position = agent.order.indexOf(tool);
          return (
            <div key={tool} className="row items-center g2 wrap">
              <span
                className={`chip ${enabled ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => toggle(tool)}
                title={enabled ? 'Click to stop using it' : 'Click to use it'}
              >
                {enabled && <Icon name="check" size={12} />}
                {enabled ? `${position + 1}. ` : ''}
                {TOOL_LABEL[tool]}
              </span>
              {enabled && agent.order.length > 1 && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={position === 0}
                    onClick={() => move(tool, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={position === agent.order.length - 1}
                    onClick={() => move(tool, 1)}
                  >
                    ↓
                  </Button>
                </>
              )}
              {connected.length > 0 && (
                <span className="t-caption">
                  {found.has(tool) ? 'found on your computer' : 'not found on your computer'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {agent.devices.length > 0 && (
        <div className="col g2 mb4">
          {agent.devices.map((device) => (
            <DeviceRow key={device.id} device={device} />
          ))}
        </div>
      )}

      <div className="row g2 wrap items-center">
        <Button variant="secondary" onClick={() => pairing.mutate()} disabled={pairing.isPending}>
          {agent.devices.length > 0 ? 'Connect another computer' : 'Connect the agent'}
        </Button>
        {pairing.data && (
          <div className="col g1">
            <span className="mono t-h4" style={{ letterSpacing: 2 }}>
              {pairing.data.code}
            </span>
            <span className="t-caption">
              Open ForgeRoutine Agent on your computer (
              <a href={AGENT_DOWNLOAD} download>
                download it
              </a>{' '}
              if you have not yet) and enter this code. It works once and expires at{' '}
              {new Date(pairing.data.expiresAt).toLocaleTimeString()}.
            </span>
          </div>
        )}
      </div>

      {(pairing.isError || setOrder.isError) && (
        <div className="t-caption mt3" style={{ color: 'var(--error)' }}>
          {((pairing.error ?? setOrder.error) as Error).message}
        </div>
      )}
    </Card>
  );
}

function DeviceRow({ device }: { device: AgentDeviceView }) {
  const revoke = useRevokeAgent();
  const tools = device.connection
    ? ALL_TOOLS.filter((tool) => device.connection!.tools[tool].available).map(
        (tool) => TOOL_LABEL[tool],
      )
    : [];

  return (
    <div
      className="row items-center justify-between g2 wrap card p3"
      style={{ background: 'var(--surface-2)' }}
    >
      <div className="col g1">
        <span className="t-small">{device.name}</span>
        <span className="t-caption">
          {device.connection
            ? tools.length > 0
              ? `Connected · ${tools.join(', ')}`
              : 'Connected · found neither Claude Code nor Codex'
            : device.lastSeenAt
              ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`
              : 'Paired, never connected'}
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => revoke.mutate(device.id)}
        disabled={revoke.isPending}
      >
        Disconnect
      </Button>
    </div>
  );
}
