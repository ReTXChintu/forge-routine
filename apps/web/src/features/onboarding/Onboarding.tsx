import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import { Button, Card, ProgressBar } from '~/components/ui';
import { useCatalogue, useCompleteOnboarding } from '~/lib/queries';

import fullLogo from '../../../../../assets/brand/full-logo-480.png';

/**
 * The first-run flow (docs/learning-path.md), in the prototype's setup shell.
 *
 * Four questions, each narrowing the next. Every one after the first has a
 * sane default and can be skipped: a user who abandons onboarding still gets
 * a usable product, just a generic path.
 *
 * Full-bleed chrome, 560px form. That is what the prototype does here and it
 * is right — a question with four options does not get better at 1600px.
 */

type Step = 0 | 1 | 2 | 3;

const STEP_NAMES = ['Technologies', 'Current level', 'Daily time', 'Goal'] as const;

/**
 * Four buckets, not a slider. Precise self-assessment is exactly the thing
 * this product distrusts, and a slider invites false precision.
 */
const KNOWLEDGE_LEVELS = [
  { value: 0, label: 'New to it', hint: 'Start from the beginning' },
  { value: 0.25, label: 'Some basics', hint: 'I have touched it' },
  { value: 0.55, label: 'Working knowledge', hint: 'I use it, with gaps' },
  { value: 0.8, label: 'Strong', hint: 'Just keep me sharp' },
] as const;

const GOALS = [
  { value: 'CODING', label: 'Write code unaided', hint: 'Rebuild the muscle' },
  { value: 'INTERVIEW', label: 'Pass an interview', hint: 'There is a date' },
  { value: 'JOB_PREPARATION', label: 'Find a job', hint: 'Interviews, plural' },
  { value: 'ENGINEERING_MASTERY', label: 'Go deeper', hint: 'No deadline' },
] as const;

const TIMES = [30, 45, 60, 90, 120] as const;

interface Selection {
  technologyId: string;
  name: string;
  existingKnowledge: number;
  interviewImportance: number;
}

export function Onboarding() {
  const [step, setStep] = useState<Step>(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection[]>([]);
  const [dailyMinutes, setDailyMinutes] = useState<number>(45);
  const [primaryGoal, setPrimaryGoal] = useState<(typeof GOALS)[number]['value']>('CODING');
  const [interviewDate, setInterviewDate] = useState('');

  const { data: catalogue } = useCatalogue(search);
  const completeOnboarding = useCompleteOnboarding();
  const navigate = useNavigate();

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.technologyId)), [selected]);

  const toggle = (id: string, name: string) => {
    setSelected((current) =>
      current.some((s) => s.technologyId === id)
        ? current.filter((s) => s.technologyId !== id)
        : [...current, { technologyId: id, name, existingKnowledge: 0, interviewImportance: 3 }],
    );
  };

  const setKnowledge = (id: string, value: number) => {
    setSelected((current) =>
      current.map((s) => (s.technologyId === id ? { ...s, existingKnowledge: value } : s)),
    );
  };

  const finish = async () => {
    const interviewShaped = primaryGoal === 'INTERVIEW' || primaryGoal === 'JOB_PREPARATION';

    await completeOnboarding.mutateAsync({
      technologies: selected.map((s) => ({
        technologyId: s.technologyId,
        existingKnowledge: s.existingKnowledge,
        // An interview goal raises importance across the board; the roadmap
        // builder uses it to decide where interview checkpoints land.
        interviewImportance: interviewShaped ? 4 : 3,
      })),
      dailyMinutes,
      primaryGoal,
      interviewTarget: 'MID',
      interviewDate: interviewDate || null,
    });

    navigate('/roadmap', { replace: true });
  };

  const canContinue = step === 0 ? selected.length > 0 : true;

  return (
    <div className="col" style={{ height: '100vh', background: 'var(--bg)' }}>
      <div
        className="row items-center justify-between"
        style={{ padding: '20px 40px', borderBottom: '1px solid var(--border)' }}
      >
        <img src={fullLogo} alt="ForgeRoutine" style={{ maxWidth: 150 }} />
        <span className="t-caption">
          Step {step + 1} of 4 — {STEP_NAMES[step]}
        </span>
      </div>

      <ProgressBar pct={((step + 1) / 4) * 100} thin />

      <div
        className="flex-1 scroll-y"
        style={{ padding: 48, display: 'flex', justifyContent: 'center' }}
      >
        <div style={{ maxWidth: 560, width: '100%' }}>
          {step === 0 && (
            <>
              <div className="t-caption mb2">01 · Technologies</div>
              <div className="t-h1 mb2">What do you want to get better at?</div>
              <div className="t-body mb5">
                Pick as many as you like. You can add more at any time.
              </div>

              <input
                className="input mb4"
                placeholder="Search technologies…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />

              <div className="row g2 wrap mb4">
                {(catalogue ?? []).map((technology) => {
                  const isSelected = selectedIds.has(technology.id);
                  return (
                    <span
                      key={technology.id}
                      className={`chip ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggle(technology.id, technology.name)}
                    >
                      {isSelected && <Icon name="check" size={12} />}
                      {technology.name}
                    </span>
                  );
                })}
              </div>

              <div className="t-caption">{selected.length} selected</div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="t-caption mb2">02 · Current level</div>
              <div className="t-h1 mb2">Where are you now?</div>
              <div className="t-body mb5">
                Roughly is fine. This stops you being taught things you already know.
              </div>

              <div className="col g5">
                {selected.map((technology) => (
                  <div key={technology.technologyId}>
                    <div className="t-h4 mb2">{technology.name}</div>
                    <div className="grid grid-4 g2 cq-grid-4">
                      {KNOWLEDGE_LEVELS.map((level) => {
                        const active = technology.existingKnowledge === level.value;
                        return (
                          <Card
                            key={level.value}
                            hover
                            className="p3"
                            style={{
                              borderColor: active ? 'var(--primary)' : undefined,
                              background: active ? 'var(--primary-subtle)' : undefined,
                            }}
                            onClick={() => setKnowledge(technology.technologyId, level.value)}
                          >
                            <div
                              className="t-small"
                              style={{
                                color: active ? 'var(--primary)' : 'var(--text-primary)',
                                fontWeight: 600,
                              }}
                            >
                              {level.label}
                            </div>
                            <div className="t-caption mt1">{level.hint}</div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="t-caption mb2">03 · Daily availability</div>
              <div className="t-h1 mb2">How much time per day?</div>
              <div className="t-body mb5">
                Be honest rather than ambitious. A plan you skip is worse than a small one you keep.
              </div>

              <div className="grid grid-3 g3 cq-grid-3">
                {TIMES.map((minutes) => {
                  const active = dailyMinutes === minutes;
                  return (
                    <Card
                      key={minutes}
                      hover
                      style={{
                        textAlign: 'center',
                        borderColor: active ? 'var(--primary)' : undefined,
                        background: active ? 'var(--primary-subtle)' : undefined,
                      }}
                      onClick={() => setDailyMinutes(minutes)}
                    >
                      <div
                        className="t-h3"
                        style={{ color: active ? 'var(--primary)' : 'var(--text-primary)' }}
                      >
                        {minutes} min
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="t-caption mb2">04 · Goal</div>
              <div className="t-h1 mb2">What is this for?</div>
              <div className="t-body mb5">This changes the order of everything.</div>

              <div className="col g3">
                {GOALS.map((goal) => {
                  const active = primaryGoal === goal.value;
                  return (
                    <Card
                      key={goal.value}
                      hover
                      className="row justify-between items-center"
                      style={{
                        borderColor: active ? 'var(--primary)' : undefined,
                        background: active ? 'var(--primary-subtle)' : undefined,
                      }}
                      onClick={() => setPrimaryGoal(goal.value)}
                    >
                      <div>
                        <div
                          className="t-h4"
                          style={{ color: active ? 'var(--primary)' : 'var(--text-primary)' }}
                        >
                          {goal.label}
                        </div>
                        <div className="t-caption mt1">{goal.hint}</div>
                      </div>
                      {active && <Icon name="check" size={18} />}
                    </Card>
                  );
                })}
              </div>

              {(primaryGoal === 'INTERVIEW' || primaryGoal === 'JOB_PREPARATION') && (
                <div className="mt5">
                  <label className="field-label">Interview date, if you have one</label>
                  <input
                    className="input"
                    type="date"
                    value={interviewDate}
                    onChange={(event) => setInterviewDate(event.target.value)}
                    style={{ maxWidth: 220 }}
                  />
                </div>
              )}
            </>
          )}

          <div className="row justify-between items-center mt7">
            {step > 0 ? (
              <Button
                variant="ghost"
                icon="chevronLeft"
                onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
              >
                Back
              </Button>
            ) : (
              <span />
            )}

            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => Math.min(3, s + 1) as Step)}
                disabled={!canContinue}
              >
                Continue
              </Button>
            ) : (
              <Button
                icon="arrowRight"
                onClick={() => void finish()}
                disabled={completeOnboarding.isPending}
              >
                {completeOnboarding.isPending ? 'Building…' : 'Build my roadmap'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
