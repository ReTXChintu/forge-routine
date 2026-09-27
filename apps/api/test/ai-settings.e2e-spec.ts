import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * Choosing a model vendor, end to end.
 *
 * The assertion that matters most is the negative one: no response, on any
 * route, may contain the key that was saved. Everything else here is
 * plumbing; that one is the reason the feature is allowed to store secrets
 * at all.
 *
 * No real vendor is contacted. The key is fake, and the only endpoint that
 * would spend money — the test button — is deliberately not exercised.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;

const user = {
  email: `aisettings-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'AI Settings Test',
};

/** Recognisable, obviously fake, and shaped like the real thing. */
const FAKE_KEY = 'sk-ant-api03-not-a-real-key-000000-TAIL';

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());

  const registered = await http.post('/api/v1/auth/register').send(user).expect(201);
  accessToken = registered.body.accessToken;
}, 120_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('AI provider settings', () => {
  it('lists every vendor, none configured, AI off until a key is saved', async () => {
    const response = await http.get('/api/v1/settings/ai').set(auth()).expect(200);

    // Null is not "follow the server" — there is no server key. It means
    // this account has no AI at all, which is the default for everyone.
    expect(response.body.selected).toBeNull();
    expect(response.body.serverDefault).toBeUndefined();
    expect(response.body.vendors.map((v: { id: string }) => v.id).sort()).toEqual([
      'ANTHROPIC',
      'CLAUDE_CODE',
      'GEMINI',
      'OPENAI',
    ]);
    for (const vendor of response.body.vendors) {
      expect(vendor.configured).toBe(false);
      expect(vendor.keyLast4).toBeNull();
    }
  });

  it('marks exactly one vendor as keyless', async () => {
    // Claude Code runs a CLI that is already signed in, so there is no key to
    // paste — the settings form reads this to stop asking for something that
    // does not exist. Every other vendor must still demand one.
    const response = await http.get('/api/v1/settings/ai').set(auth()).expect(200);

    const keyless = response.body.vendors.filter((v: { keyless: boolean }) => v.keyless);
    expect(keyless.map((v: { id: string }) => v.id)).toEqual(['CLAUDE_CODE']);
  });

  it('reports whether the local CLI vendor can run on this machine', async () => {
    // Every HTTP vendor can always be reached in principle; Claude Code runs a
    // process that has to exist here, so it is the only one that can answer
    // "no" — and it must answer before being chosen, not on the first question.
    const response = await http.get('/api/v1/settings/ai').set(auth()).expect(200);

    for (const vendor of response.body.vendors) {
      if (vendor.id === 'CLAUDE_CODE') continue;
      expect(vendor.available).toBe(true);
      expect(vendor.unavailableReason).toBeNull();
    }

    const claudeCode = response.body.vendors.find((v: { id: string }) => v.id === 'CLAUDE_CODE');
    expect(typeof claudeCode.available).toBe('boolean');
    // Whichever way it goes, an unavailable vendor must say why in words the
    // reader can act on rather than leaving them to find out by failing.
    if (!claudeCode.available) {
      expect(claudeCode.unavailableReason).toContain('CLAUDE_CODE_BIN');
    }
  });

  it('refuses to enable or select a vendor this machine cannot run', async () => {
    // The case that caused the report: one database shared between a laptop and
    // a deployed server carries a selection from the machine that can run it to
    // the one that cannot. Simulated by pointing the override at nothing.
    const previous = process.env.CLAUDE_CODE_BIN;
    process.env.CLAUDE_CODE_BIN = '';

    try {
      const available = (
        await http.get('/api/v1/settings/ai').set(auth()).expect(200)
      ).body.vendors.find((v: { id: string }) => v.id === 'CLAUDE_CODE').available;

      // Only meaningful where the CLI is genuinely absent. On a machine that
      // has it, the guard has nothing to refuse and this asserts nothing.
      if (available) return;

      await http.put('/api/v1/settings/ai/keys/CLAUDE_CODE').set(auth()).send({}).expect(400);
      await http
        .put('/api/v1/settings/ai/provider')
        .set(auth())
        .send({ provider: 'CLAUDE_CODE' })
        .expect(400);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CODE_BIN;
      else process.env.CLAUDE_CODE_BIN = previous;
    }
  });

  it('enables the keyless vendor with no key, and refuses one if offered', async () => {
    // The whole point: no ENCRYPTION_KEY needed, nothing to store, and a key
    // pasted here would be silently ignored rather than used — so it is
    // rejected instead.
    await http
      .put('/api/v1/settings/ai/keys/CLAUDE_CODE')
      .set(auth())
      .send({ apiKey: 'sk-ant-should-be-refused' })
      .expect(400);

    const enabled = await http
      .put('/api/v1/settings/ai/keys/CLAUDE_CODE')
      .set(auth())
      .send({})
      .expect(200);

    const claudeCode = enabled.body.vendors.find((v: { id: string }) => v.id === 'CLAUDE_CODE');
    expect(claudeCode.configured).toBe(true);
    // Nothing to show: an empty string rather than a placeholder that reads
    // like a truncated key.
    expect(claudeCode.keyLast4).toBe('');

    // And it can be selected, which a vendor with no credential row cannot.
    const selected = await http
      .put('/api/v1/settings/ai/provider')
      .set(auth())
      .send({ provider: 'CLAUDE_CODE' })
      .expect(200);
    expect(selected.body.selected).toBe('CLAUDE_CODE');

    // Put the suite back where it found it: later cases assume no selection.
    await http.delete('/api/v1/settings/ai/keys/CLAUDE_CODE').set(auth()).expect(200);
  });

  it('refuses to select a vendor with no key', async () => {
    // Otherwise every agent silently falls back and the product looks
    // broken rather than unfinished.
    await http
      .put('/api/v1/settings/ai/provider')
      .set(auth())
      .send({ provider: 'GEMINI' })
      .expect(400);
  });

  it('saves a key and reports only its last four characters', async () => {
    const response = await http
      .put('/api/v1/settings/ai/keys/ANTHROPIC')
      .set(auth())
      .send({ apiKey: FAKE_KEY })
      .expect(200);

    const anthropic = response.body.vendors.find((v: { id: string }) => v.id === 'ANTHROPIC');
    expect(anthropic.configured).toBe(true);
    expect(anthropic.keyLast4).toBe('TAIL');
    // Never verified on save, even if a previous key was — a tick carried
    // over would vouch for a key nobody has tried.
    expect(anthropic.verifiedAt).toBeNull();
  });

  it('never returns the key itself, on any settings route', async () => {
    const view = await http.get('/api/v1/settings/ai').set(auth()).expect(200);

    const serialised = JSON.stringify(view.body);
    expect(serialised).not.toContain(FAKE_KEY);
    // Nor any recognisable fragment beyond the deliberate last four.
    expect(serialised).not.toContain('not-a-real-key');
    expect(serialised).not.toContain('keyCipher');
  });

  it('encrypts the key at rest rather than storing it as written', async () => {
    const row = await prisma.aICredential.findFirst({
      where: { user: { email: user.email }, provider: 'ANTHROPIC' },
    });

    expect(row).toBeTruthy();
    expect(row!.keyCipher).not.toContain(FAKE_KEY);
    expect(row!.keyCipher.startsWith('v1:')).toBe(true);
  });

  it('selects the vendor once it has a key', async () => {
    const response = await http
      .put('/api/v1/settings/ai/provider')
      .set(auth())
      .send({ provider: 'ANTHROPIC' })
      .expect(200);

    expect(response.body.selected).toBe('ANTHROPIC');
  });

  it('accepts model overrides and falls back to the vendor default', async () => {
    const response = await http
      .put('/api/v1/settings/ai/keys/ANTHROPIC')
      .set(auth())
      .send({ apiKey: FAKE_KEY, modelFast: 'claude-haiku-4-5', modelReasoning: '' })
      .expect(200);

    const anthropic = response.body.vendors.find((v: { id: string }) => v.id === 'ANTHROPIC');
    expect(anthropic.modelFast).toBe('claude-haiku-4-5');
    // Blank means "use the default", not "use an empty model id".
    expect(anthropic.modelReasoning).toBe(anthropic.defaultReasoning);
  });

  it('saves a model change without re-entering the key', async () => {
    // The bug this covers: the endpoint required an apiKey, and the Save
    // button was disabled without one, so editing a model name alone
    // silently did nothing and calls kept going to the old model.
    const response = await http
      .put('/api/v1/settings/ai/keys/ANTHROPIC')
      .set(auth())
      .send({ modelFast: 'claude-opus-5' })
      .expect(200);

    const anthropic = response.body.vendors.find((v: { id: string }) => v.id === 'ANTHROPIC');
    expect(anthropic.modelFast).toBe('claude-opus-5');
    // Still configured — the stored key was kept, not wiped.
    expect(anthropic.configured).toBe(true);
    expect(anthropic.keyLast4).toBe('TAIL');
  });

  it('keeps the assistant’s model separate from the tier that grades code', async () => {
    // The whole reason modelTutor exists. The fast tier is shared by the
    // assistant and the submission evaluator, so pinning a better model for
    // tutoring must not change how code is marked.
    const before = await http.get('/api/v1/settings/ai').set(auth()).expect(200);
    const fastBefore = before.body.vendors.find(
      (v: { id: string }) => v.id === 'ANTHROPIC',
    ).modelFast;

    const response = await http
      .put('/api/v1/settings/ai/tutor')
      .set(auth())
      .send({ model: 'claude-sonnet-5' })
      .expect(200);

    expect(response.body.selected).toBe('claude-sonnet-5');
    expect(response.body.effective).toBe('claude-sonnet-5');

    const after = await http.get('/api/v1/settings/ai').set(auth()).expect(200);
    const anthropic = after.body.vendors.find((v: { id: string }) => v.id === 'ANTHROPIC');
    expect(anthropic.modelTutor).toBe('claude-sonnet-5');
    expect(anthropic.modelFast).toBe(fastBefore);
  });

  it('follows the fast tier again when the pin is cleared', async () => {
    const response = await http
      .put('/api/v1/settings/ai/tutor')
      .set(auth())
      .send({ model: null })
      .expect(200);

    const settings = await http.get('/api/v1/settings/ai').set(auth()).expect(200);
    const anthropic = settings.body.vendors.find((v: { id: string }) => v.id === 'ANTHROPIC');

    // Nothing pinned, but something is still in use — the tier's model.
    expect(response.body.selected).toBeNull();
    expect(response.body.effective).toBe(anthropic.modelFast);
  });

  it('keeps the verified tick when only the model changes', async () => {
    // Unlike saving a key or a tier model, which clears it: the tick says the
    // key works, and picking a different model does not call that into doubt.
    await http
      .put('/api/v1/settings/ai/keys/ANTHROPIC')
      .set(auth())
      .send({ apiKey: 'sk-ant-verify-TICK' })
      .expect(200);

    await prisma.aICredential.updateMany({
      where: { user: { email: user.email }, provider: 'ANTHROPIC' },
      data: { verifiedAt: new Date() },
    });

    await http
      .put('/api/v1/settings/ai/tutor')
      .set(auth())
      .send({ model: 'claude-haiku-4-5' })
      .expect(200);

    const settings = await http.get('/api/v1/settings/ai').set(auth()).expect(200);
    const anthropic = settings.body.vendors.find((v: { id: string }) => v.id === 'ANTHROPIC');
    expect(anthropic.verifiedAt).not.toBeNull();
  });

  it('will not create a credential from models alone', async () => {
    // Saving models for a vendor with no key would leave a row that looks
    // configured but cannot make a call.
    await http
      .put('/api/v1/settings/ai/keys/OPENAI')
      .set(auth())
      .send({ modelFast: 'gpt-4o' })
      .expect(400);
  });

  it('refuses to list models for a provider with no key', async () => {
    await http.get('/api/v1/settings/ai/keys/OPENAI/models').set(auth()).expect(400);
  });

  it('rejects a provider that does not exist', async () => {
    await http
      .put('/api/v1/settings/ai/keys/DEEPMIND')
      .set(auth())
      .send({ apiKey: FAKE_KEY })
      .expect(404);
  });

  it('clears the selection when the selected key is removed', async () => {
    // Leaving it selected would point every call at a vendor with no key.
    const response = await http
      .delete('/api/v1/settings/ai/keys/ANTHROPIC')
      .set(auth())
      .expect(200);

    expect(response.body.selected).toBeNull();
    const anthropic = response.body.vendors.find((v: { id: string }) => v.id === 'ANTHROPIC');
    expect(anthropic.configured).toBe(false);
  });

  it('requires authentication', async () => {
    await http.get('/api/v1/settings/ai').expect(401);
  });
});
