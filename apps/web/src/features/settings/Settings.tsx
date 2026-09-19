import { useState } from 'react';

import { Icon } from '~/components/Icon';
import { Badge, Button, Card, SectionHead, Spinner } from '~/components/ui';
import {
  useAISettings,
  useRemoveAIKey,
  useSaveAIKey,
  useSelectAIProvider,
  useTestAIKey,
  useVendorModels,
  type AISettingsView,
  type ModelOption,
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
          Your calls go to the provider you pick here, billed to your own key. This server keeps no
          key of its own, so nobody spends anyone else's money — and with none selected, AI is
          simply off for you.
        </div>

        <div className="row g2 wrap">
          <span
            className={`chip ${settings.selected === null ? 'selected' : ''}`}
            onClick={() => select.mutate(null)}
          >
            {settings.selected === null && <Icon name="check" size={12} />}
            Off
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

        {settings.selected === null && (
          // Not framed as an error. Everything that matters still works, and
          // saying so stops "AI off" reading as "the app is broken".
          <div className="t-caption mt3">
            AI is off for your account. Everything else still works — exercises run and are graded
            on their tests, the routine plans itself, and questions come from the seeded curriculum.
            What you lose is hints, written reviews and mock interviews.
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

  const save = useSaveAIKey();
  const remove = useRemoveAIKey();
  const test = useTestAIKey();

  const looksWrong = apiKey.length > 0 && !apiKey.trim().startsWith(vendor.keyPrefix);

  // Key only. Models are saved separately, by ModelPicker, so that
  // changing one never requires pasting the other.
  const submit = () => {
    save.mutate({ provider: vendor.id, apiKey }, { onSuccess: () => setApiKey('') });
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

      {vendor.configured ? (
        <ModelPicker vendor={vendor} />
      ) : (
        <div className="t-caption">
          Save a key to choose models. Until then these are used:{' '}
          <span className="mono">{vendor.defaultFast}</span> and{' '}
          <span className="mono">{vendor.defaultReasoning}</span>.
        </div>
      )}
    </Card>
  );
}

/**
 * Chooses the two models, from what the vendor says the key can reach.
 *
 * A free-text box over a hard-coded default was the old shape, and it had
 * two faults at once: the defaults went stale when a vendor retired a
 * model, and the Save button required an API key, so editing a model name
 * alone silently did nothing and calls kept going to the retired one.
 *
 * The list is fetched from the vendor, and saving models no longer needs
 * the key. Free text stays available underneath, because a brand-new model
 * can reach the API before it reaches any listing.
 */
function ModelPicker({ vendor }: { vendor: VendorSettingView }) {
  const [open, setOpen] = useState(false);
  const [fast, setFast] = useState(vendor.modelFast);
  const [reasoning, setReasoning] = useState(vendor.modelReasoning);

  const { data: models, isLoading, error } = useVendorModels(vendor.id, open);
  const save = useSaveAIKey();

  const dirty = fast !== vendor.modelFast || reasoning !== vendor.modelReasoning;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
        Models · <span className="mono">{vendor.modelFast}</span> /{' '}
        <span className="mono">{vendor.modelReasoning}</span>
      </Button>

      {open && (
        <div className="mt3">
          {isLoading && <div className="t-caption">Asking {vendor.label} what it offers…</div>}

          {error && (
            // The vendor's own sentence. Usually the key, occasionally a
            // permission, and either way not something to paper over.
            <div className="t-small mb3" style={{ color: 'var(--error)' }}>
              Could not list models: {(error as Error).message}
            </div>
          )}

          <div className="grid grid-2 g3 cq-grid-2">
            <ModelField
              label="Fast"
              hint="Hints, concept detail, grading prose."
              value={fast}
              options={models}
              onChange={setFast}
            />
            <ModelField
              label="Reasoning"
              hint="Curriculum, reviews, interviews."
              value={reasoning}
              options={models}
              onChange={setReasoning}
            />
          </div>

          <div className="row items-center g3 mt3">
            <Button
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate({ provider: vendor.id, modelFast: fast, modelReasoning: reasoning })
              }
            >
              {save.isPending ? 'Saving…' : 'Save models'}
            </Button>

            {dirty && <span className="t-caption">Unsaved</span>}
            {save.isError && (
              <span className="t-caption" style={{ color: 'var(--error)' }}>
                {(save.error as Error).message}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ModelField({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: ModelOption[] | undefined;
  onChange: (value: string) => void;
}) {
  // A configured model the vendor no longer lists is the exact failure that
  // started this — say so on the screen rather than at the next call.
  const retired = options !== undefined && value !== '' && !options.some((m) => m.id === value);

  return (
    <div>
      <label className="field-label">{label}</label>

      {options && options.length > 0 && (
        <select
          className="select mb2"
          value={options.some((m) => m.id === value) ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>
            Choose a model…
          </option>
          {options.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label === model.id ? model.id : `${model.label} — ${model.id}`}
            </option>
          ))}
        </select>
      )}

      <input
        className={`input mono ${retired ? 'has-error' : ''}`}
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />

      {retired ? (
        <div className="field-error">{vendorRetiredMessage}</div>
      ) : (
        <div className="field-hint">{hint}</div>
      )}
    </div>
  );
}

const vendorRetiredMessage =
  'Not in this key’s model list. It may have been retired — calls using it will fail.';
