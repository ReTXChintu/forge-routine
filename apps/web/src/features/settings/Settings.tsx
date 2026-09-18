import { useState } from 'react';

import { Icon } from '~/components/Icon';
import { Badge, Button, Card, SectionHead, Spinner } from '~/components/ui';
import {
  useAISettings,
  useRemoveAIKey,
  useSaveAIKey,
  useSelectAIProvider,
  useTestAIKey,
  type AISettingsView,
  type VendorSettingView,
} from '~/lib/queries';

/**
 * Settings, in the prototype's shape: a tab rail on the left, one panel on
 * the right, both filling the width.
 *
 * Only the AI tab does anything yet. The others are listed because the
 * prototype lists them and because a rail that grows one entry at a time
 * is less disorienting than one that appears fully formed later — but each
 * says plainly that it is not built, rather than showing a control that
 * silently does nothing.
 */

const TABS = ['AI provider', 'Profile', 'Daily routine', 'Appearance', 'Account'] as const;
type Tab = (typeof TABS)[number];

export function Settings() {
  const [tab, setTab] = useState<Tab>('AI provider');
  const { data: settings, isLoading } = useAISettings();

  return (
    <>
      <SectionHead
        eyebrow="System"
        title="Settings"
        description="Who answers your AI calls, and what they cost you."
      />

      <div className="row g6 items-start wrap">
        <div className="col g1" style={{ width: 200, flexShrink: 0 }}>
          {TABS.map((name) => (
            <div
              key={name}
              className={`app-nav-item ${name === tab ? 'active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => setTab(name)}
            >
              {name}
            </div>
          ))}
        </div>

        <div className="flex-1" style={{ minWidth: 320 }}>
          {tab === 'AI provider' ? (
            isLoading || !settings ? (
              <Spinner label="Loading providers" />
            ) : (
              <AIProviderPanel settings={settings} />
            )
          ) : (
            <Card>
              <div className="t-h4">{tab}</div>
              <div className="t-small mt1">
                Not built yet. Nothing here is wired to anything, so it is left out rather than
                shown as a control that does nothing.
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function AIProviderPanel({ settings }: { settings: AISettingsView }) {
  const select = useSelectAIProvider();

  return (
    <div className="col g4">
      {!settings.canStoreKeys && (
        <Card style={{ borderColor: 'var(--warning)' }}>
          <div className="t-h4" style={{ color: 'var(--warning)' }}>
            This server cannot store keys
          </div>
          {/* Said here rather than failing on save. A key is a secret; a
              server with nowhere safe to put one should say so first. */}
          <div className="t-small mt1">
            <span className="mono">ENCRYPTION_KEY</span> is not set, so keys cannot be encrypted at
            rest. Set one on the server — <span className="mono">openssl rand -base64 32</span> —
            and restart.
          </div>
        </Card>
      )}

      <Card>
        <div className="t-h4 mb1">Who answers</div>
        <div className="t-small mb4">
          Your calls go to the provider you pick here, billed to your own key. Leave it on the
          server default and they go wherever this deployment is configured to send them.
        </div>

        <div className="row g2 wrap">
          <span
            className={`chip ${settings.selected === null ? 'selected' : ''}`}
            onClick={() => select.mutate(null)}
          >
            {settings.selected === null && <Icon name="check" size={12} />}
            Server default
            {settings.serverDefault && ` (${settings.serverDefault.toLowerCase()})`}
          </span>

          {settings.vendors.map((vendor) => (
            <span
              key={vendor.id}
              className={`chip ${settings.selected === vendor.id ? 'selected' : ''}`}
              style={{ opacity: vendor.configured ? 1 : 0.5 }}
              title={vendor.configured ? undefined : 'Add a key first'}
              onClick={() => vendor.configured && select.mutate(vendor.id)}
            >
              {settings.selected === vendor.id && <Icon name="check" size={12} />}
              {vendor.label}
            </span>
          ))}
        </div>

        {settings.serverDefault === null && settings.selected === null && (
          <div className="t-caption mt3" style={{ color: 'var(--warning)' }}>
            No provider is configured anywhere, so AI features are off. Everything else works —
            exercises run, the routine plans itself, questions are asked from seeded content.
          </div>
        )}

        {select.isError && (
          <div className="t-caption mt3" style={{ color: 'var(--error)' }}>
            {(select.error as Error).message}
          </div>
        )}
      </Card>

      {settings.vendors.map((vendor) => (
        <VendorCard key={vendor.id} vendor={vendor} disabled={!settings.canStoreKeys} />
      ))}
    </div>
  );
}

function VendorCard({ vendor, disabled }: { vendor: VendorSettingView; disabled: boolean }) {
  const [apiKey, setApiKey] = useState('');
  const [showModels, setShowModels] = useState(false);
  const [modelFast, setModelFast] = useState(vendor.modelFast);
  const [modelReasoning, setModelReasoning] = useState(vendor.modelReasoning);

  const save = useSaveAIKey();
  const remove = useRemoveAIKey();
  const test = useTestAIKey();

  const looksWrong = apiKey.length > 0 && !apiKey.trim().startsWith(vendor.keyPrefix);

  const submit = () => {
    save.mutate(
      { provider: vendor.id, apiKey, modelFast, modelReasoning },
      { onSuccess: () => setApiKey('') },
    );
  };

  return (
    <Card>
      <div className="row items-center justify-between g3 mb3 wrap">
        <div className="row items-center g2">
          <span className="t-h4">{vendor.label}</span>
          {vendor.configured ? (
            <Badge variant="success" icon="check">
              ••••{vendor.keyLast4}
            </Badge>
          ) : (
            <Badge variant="neutral">no key</Badge>
          )}
          {vendor.verifiedAt && <Badge variant="info">verified</Badge>}
        </div>

        <a className="t-caption" href={vendor.keyUrl} target="_blank" rel="noreferrer">
          Get a key ↗
        </a>
      </div>

      <div className="t-small mb4">{vendor.note}</div>

      <div className="row g2 wrap items-end">
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="field-label">{vendor.configured ? 'Replace key' : 'API key'}</label>
          <input
            className={`input ${looksWrong ? 'has-error' : ''}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={`${vendor.keyPrefix}…`}
            value={apiKey}
            disabled={disabled}
            onChange={(event) => setApiKey(event.target.value)}
          />
          {looksWrong && (
            <div className="field-error">
              {vendor.label} keys normally start with{' '}
              <span className="mono">{vendor.keyPrefix}</span>. Saving anyway is fine if you know
              better.
            </div>
          )}
        </div>

        <Button onClick={submit} disabled={disabled || apiKey.trim().length < 8 || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>

        {vendor.configured && (
          <>
            <Button
              variant="secondary"
              onClick={() => test.mutate(vendor.id)}
              disabled={test.isPending}
            >
              {test.isPending ? 'Testing…' : 'Test'}
            </Button>
            <Button variant="ghost" onClick={() => remove.mutate(vendor.id)}>
              Remove
            </Button>
          </>
        )}
      </div>

      {/* The key is never echoed back, so there is nothing to reveal. */}
      <div className="t-caption mt2">
        Encrypted before it is stored and never sent back to this page.
      </div>

      {test.isSuccess && test.variables === vendor.id && (
        <div
          className="t-small mt3"
          style={{ color: test.data.ok ? 'var(--success)' : 'var(--error)' }}
        >
          {test.data.detail}
        </div>
      )}
      {save.isError && (
        <div className="t-small mt3" style={{ color: 'var(--error)' }}>
          {(save.error as Error).message}
        </div>
      )}

      <div className="divider mt4 mb3" />

      <Button variant="ghost" size="sm" onClick={() => setShowModels((open) => !open)}>
        <Icon name={showModels ? 'chevronDown' : 'chevronRight'} size={13} />
        Models
      </Button>

      {showModels && (
        <div className="grid grid-2 g3 mt3 cq-grid-2">
          <div>
            <label className="field-label">Fast</label>
            <input
              className="input mono"
              value={modelFast}
              onChange={(event) => setModelFast(event.target.value)}
            />
            {/* Which tier does what, so the choice is not made blind. */}
            <div className="field-hint">
              Hints, concept detail, grading prose. Default{' '}
              <span className="mono">{vendor.defaultFast}</span>.
            </div>
          </div>
          <div>
            <label className="field-label">Reasoning</label>
            <input
              className="input mono"
              value={modelReasoning}
              onChange={(event) => setModelReasoning(event.target.value)}
            />
            <div className="field-hint">
              Curriculum, reviews, interviews. Default{' '}
              <span className="mono">{vendor.defaultReasoning}</span>.
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
