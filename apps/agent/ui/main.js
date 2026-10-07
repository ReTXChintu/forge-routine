// The agent's window. Everything it shows comes from the Rust side, which
// pushes the whole state on every change; this only draws it.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);

const STATUS_TEXT = {
  unpaired: 'Not connected to an account',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Reconnecting…',
  revoked: 'Disconnected',
};

const TOOL_NAMES = { CLAUDE_CODE: 'Claude Code', CODEX: 'Codex (ChatGPT)' };

function draw(state) {
  const paired = Boolean(state.email);

  $('status').textContent = STATUS_TEXT[state.status] ?? state.status;
  $('status').className = `pill ${state.status}`;

  $('pairing').hidden = paired;
  $('paired').hidden = !paired;
  $('unpair').hidden = !paired;

  if (paired) {
    $('email').textContent = state.email;
    $('device').textContent = state.deviceName ?? '';
    $('server-shown').textContent = state.server;
  } else if (!$('server').value) {
    $('server').value = state.server;
  }

  $('detail').hidden = !state.detail;
  $('detail').textContent = state.detail ?? '';

  const list = $('tools');
  list.replaceChildren();
  for (const id of ['CLAUDE_CODE', 'CODEX']) {
    const tool = state.tools?.[id];
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${TOOL_NAMES[id]} `;
    const verdict = document.createElement('span');
    const where = document.createElement('span');
    where.className = 'where';
    if (!tool) {
      verdict.className = 'no';
      verdict.textContent = 'not checked yet';
    } else {
      verdict.className = tool.available ? 'ok' : 'no';
      verdict.textContent = tool.available ? '✓ found' : '✗ not found';
      where.textContent = tool.detail ?? '';
    }
    item.append(name, verdict, where);
    list.append(item);
  }
}

function showError(message) {
  $('error').hidden = !message;
  $('error').textContent = message ?? '';
}

$('pair-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(null);
  $('pair-button').disabled = true;
  try {
    draw(await invoke('pair', { code: $('code').value, server: $('server').value }));
    $('code').value = '';
  } catch (error) {
    showError(String(error));
  } finally {
    $('pair-button').disabled = false;
  }
});

$('recheck').addEventListener('click', async () => {
  showError(null);
  $('recheck').disabled = true;
  try {
    draw(await invoke('recheck'));
  } catch (error) {
    showError(String(error));
  } finally {
    $('recheck').disabled = false;
  }
});

$('unpair').addEventListener('click', async () => {
  showError(null);
  draw(await invoke('unpair'));
});

listen('agent-state', (event) => draw(event.payload));
invoke('get_state').then(draw);
