import Editor, { type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AssistanceLevelName } from '@forgeroutine/shared-types';
import type {
  CodeEvaluation,
  DiagnosisResult,
  ExecutionResult,
  ExerciseView,
  HintKind,
} from '@forgeroutine/shared-types';

import { Assistant } from '~/components/Assistant';
import { Icon } from '~/components/Icon';
import { SessionClock } from '~/components/SessionClock';
import { Badge, Button, Spinner, StateBlock, Tabs } from '~/components/ui';
import { ApiError } from '~/lib/api';
import {
  useExercise,
  useMarkFirstCode,
  useRequestHint,
  useStartAttempt,
  useSubmitCode,
} from '~/lib/queries';
import { useDraftAutosave, type DraftSaveState } from '~/lib/useDraftAutosave';
import { useLearningSession } from '~/lib/useLearningSession';

import { AssistancePanel, type HintEntry } from './AssistancePanel';
import { DiagnosisPanel } from './DiagnosisPanel';
import { ResultsPanel } from './ResultsPanel';

/**
 * Whether the work on screen is safe.
 *
 * Small, and never a modal: the point is that saving is not something the
 * user has to think about, so this only has to be glanceable enough to
 * answer "did that get kept?" without being asked. Failure is the one state
 * worth colouring, because it is the only one that calls for action.
 */
function DraftStatus({ state }: { state: DraftSaveState }) {
  if (state === 'idle') return null;

  if (state === 'error') {
    return (
      <span className="t-caption row items-center g1" style={{ color: 'var(--error)' }}>
        <Icon name="alert" size={11} />
        Not saved
      </span>
    );
  }

  if (state === 'saving') return <span className="t-caption">Saving…</span>;

  return (
    <span className="t-caption row items-center g1">
      <Icon name="check" size={11} />
      Saved
    </span>
  );
}

/**
 * The primary coding environment (§3), in the prototype's workspace layout.
 *
 * A topbar, then three columns — problem, editor, assistance — then the
 * console. The editor is the largest thing on screen because writing code
 * is the activity this product exists to restore.
 */
export function ExerciseWorkspace() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const navigate = useNavigate();
  const { data: exercise, isLoading } = useExercise(exerciseId);

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [servedExercise, setServedExercise] = useState<ExerciseView | null>(null);
  const [code, setCode] = useState('');
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [evaluation, setEvaluation] = useState<CodeEvaluation | null>(null);
  const [nextHint, setNextHint] = useState<string | null>(null);
  const [hints, setHints] = useState<HintEntry[]>([]);
  const [pendingHint, setPendingHint] = useState<HintKind | null>(null);
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [blindMode, setBlindMode] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [consoleTab, setConsoleTab] = useState('Results');
  /**
   * When this exercise was first passed, if it ever was. Set from the
   * server on open and again the moment a run goes green, so the header
   * stops asking for work that is already finished.
   */
  const [solvedAt, setSolvedAt] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  // Advisory signals only. They never reach the Independent Coding Score —
  // the server counts what matters.
  const signals = useRef({ keystrokeCount: 0, largePasteEvents: 0 });
  const firstCodeSent = useRef(false);

  const startAttempt = useStartAttempt();
  const markFirstCode = useMarkFirstCode();
  const submitCode = useSubmitCode();
  const requestHint = useRequestHint();

  const view = servedExercise ?? exercise ?? null;

  // Times this stretch of work. Starts once the exercise is known, pauses
  // when the tab is hidden or the keyboard goes quiet, ends on unmount.
  const session = useLearningSession(view?.conceptId);

  const started = Boolean(attemptId);

  // Keeps the editor's contents on the server while they type. Only once an
  // attempt is open: before that there is nothing to save against.
  const draftState = useDraftAutosave(attemptId, code, started);

  const begin = useCallback(
    async (blind: boolean) => {
      if (!exerciseId) return;

      const result = await startAttempt.mutateAsync({ exerciseId, blindMode: blind });
      setAttemptId(result.attemptId);
      setServedExercise(result.exercise);
      setBlindMode(blind);
      setSolvedAt(result.solvedAt);
      // Their own work first, if there is any. A debugging exercise falls
      // back to the faulty code, because that is the problem, and a fresh
      // one to the starter.
      setCode(result.draftCode ?? result.exercise.brokenCode ?? result.exercise.starterCode ?? '');
      setRestored(result.draftCode !== null);
      setDiagnosis('');
      setDiagnosisResult(null);
      setExecution(null);
      setEvaluation(null);
      setHints([]);
      setNextHint(null);
      firstCodeSent.current = false;
      signals.current = { keystrokeCount: 0, largePasteEvents: 0 };
    },
    [exerciseId, startAttempt],
  );

  const handleEditorMount: OnMount = (editor) => {
    editor.onDidPaste((event) => {
      const pasted = editor.getModel()?.getValueInRange(event.range) ?? '';
      // Advisory. This triggers a question, never an accusation.
      if (pasted.length > 120) signals.current.largePasteEvents += 1;
    });
  };

  const handleChange = (value: string | undefined) => {
    setCode(value ?? '');
    signals.current.keystrokeCount += 1;

    // Time-to-first-code is recorded once, server-side, on the first real edit.
    if (!firstCodeSent.current && attemptId && (value ?? '').trim().length > 0) {
      firstCodeSent.current = true;
      markFirstCode.mutate(attemptId);
    }
  };

  const handleSubmit = async () => {
    if (!attemptId || !view) return;

    const result = await submitCode.mutateAsync({
      attemptId,
      code,
      language: view.language,
      ...(view.requiresDiagnosis ? { diagnosis } : {}),
      clientSignals: { ...signals.current },
    });

    setExecution(result.execution);
    setEvaluation(result.evaluation);
    setDiagnosisResult(result.diagnosis);
    setNextHint(result.nextActionHint);

    // Passing is the completion. The server has already ticked off the
    // routine item this exercise was planned for; the header says so here
    // rather than leaving the user hunting for a button to press.
    if (result.attemptOutcome === 'PASSED') setSolvedAt(new Date().toISOString());
  };

  const handleHint = async (kind: HintKind, overrideGate = false) => {
    if (!attemptId) return;

    setPendingHint(kind);
    setGateMessage(null);

    try {
      const result = await requestHint.mutateAsync({
        attemptId,
        kind,
        code,
        ...(execution?.stderr ? { lastError: execution.stderr } : {}),
        overrideGate,
      });

      setHints((current) => [
        ...current,
        { kind, message: result.hint.response, intervention: result.intervention },
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'assistance-gated') {
        setGateMessage(error.message);
      } else {
        throw error;
      }
    } finally {
      setPendingHint(null);
    }
  };

  // Ctrl/Cmd+Enter runs the code — the shortcut every developer already knows.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (isLoading) return <Spinner label="Loading exercise" />;

  if (!view) return <StateBlock icon="alert" title="Exercise not found" />;

  /**
   * What the assistant is shown: the problem, their code, and how it failed.
   *
   * Built on demand rather than held in state, so it is whatever is true when
   * they actually ask. Failing test names and stderr are the part that makes
   * "why is this wrong" answerable at all.
   */
  const screenText = () => {
    const parts = [
      `Exercise: ${view.title}`,
      `What it asks: ${view.objective}`,
      view.requirements ? `Requirements:\n${view.requirements}` : '',
      started ? `Their code (${view.language}):\n${code}` : 'They have not started yet.',
    ];

    if (execution) {
      parts.push(
        `Last run: ${execution.testsPassed} of ${execution.testsTotal} tests passed.`,
        ...execution.cases
          .filter((testCase) => !testCase.passed)
          .slice(0, 3)
          .map((testCase) =>
            [
              `Failing: ${testCase.name}`,
              testCase.error,
              testCase.expected !== undefined
                ? `expected ${testCase.expected}, got ${testCase.received}`
                : '',
            ]
              .filter(Boolean)
              .join(' — '),
          ),
      );
      if (execution.stderr) parts.push(`stderr:\n${execution.stderr.slice(0, 800)}`);
    }

    // Capped: an assistant question should not quietly carry a few thousand
    // tokens of context the user did not ask to pay for.
    return parts.filter(Boolean).join('\n\n').slice(0, 7_000);
  };

  const diagnosisTooShort =
    view.requiresDiagnosis && diagnosis.trim().split(/\s+/).filter(Boolean).length < 5;

  return (
    <div className="col" style={{ height: '100%' }}>
      <div
        className="row items-center justify-between"
        style={{
          height: 52,
          padding: '0 18px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        <div className="row items-center g3" style={{ minWidth: 0 }}>
          <button type="button" className="icon-btn" onClick={() => navigate(-1)} title="Close">
            <Icon name="x" size={16} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="t-h4" style={{ fontSize: 13.5 }}>
              {view.title}
            </div>
            <div className="t-caption">
              {view.kind.toLowerCase().replace('_', ' ')} · {view.language} · Level{' '}
              {view.assistanceLevel} {AssistanceLevelName[view.assistanceLevel]}
            </div>
          </div>
        </div>

        <div className="row items-center g3">
          <SessionClock durationMs={session.durationMs} counting={session.counting} />

          {started && <DraftStatus state={draftState} />}

          {solvedAt && (
            <Badge variant="success" icon="check">
              Solved
            </Badge>
          )}

          {blindMode && (
            <Badge variant="primary" icon="eye">
              Blind
            </Badge>
          )}

          {!started ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void begin(true)}
                disabled={startAttempt.isPending}
                title="No hints, no autocomplete"
              >
                Blind mode
              </Button>
              <Button
                size="sm"
                icon="play"
                onClick={() => void begin(false)}
                disabled={startAttempt.isPending}
              >
                Start
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => void handleSubmit()}
              disabled={submitCode.isPending || code.trim().length === 0 || diagnosisTooShort}
              title="Ctrl/Cmd + Enter"
            >
              {submitCode.isPending
                ? 'Running…'
                : view.requiresDiagnosis
                  ? 'Submit diagnosis and fix'
                  : 'Run tests'}
            </Button>
          )}
        </div>
      </div>

      <div className="row flex-1" style={{ minHeight: 0 }}>
        <div
          className="col scroll-y"
          style={{
            width: 320,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          <div className="p4">
            <div
              className="card p3 mb4"
              style={{ borderLeft: '2px solid var(--primary)', background: 'var(--surface-2)' }}
            >
              {/* The whole prompt at level 4. It has to stand alone. */}
              <div className="t-body" style={{ color: 'var(--text-primary)' }}>
                {view.objective}
              </div>
            </div>

            {view.requirements && (
              <>
                <div className="t-h4 mb2">Requirements</div>
                <div className="t-small mb4" style={{ whiteSpace: 'pre-wrap' }}>
                  {view.requirements}
                </div>
              </>
            )}

            {view.functionSignature && (
              <>
                <div className="t-h4 mb2">Signature</div>
                <div className="code-block mb4">
                  <pre style={{ fontSize: 11.5 }}>{view.functionSignature}</pre>
                </div>
              </>
            )}

            {view.examples.length > 0 && (
              <>
                <div className="t-h4 mb2">Examples</div>
                <div className="code-block mb4">
                  <pre style={{ fontSize: 11.5 }}>{view.examples.join('\n')}</pre>
                </div>
              </>
            )}

            {view.visibleTestNames.length > 0 && (
              <>
                <div className="t-h4 mb2">Checks</div>
                <div className="col g1">
                  {view.visibleTestNames.map((name) => (
                    <div key={name} className="t-caption mono">
                      {name}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="editor-shell flex-1" style={{ minWidth: 0 }}>
          <div className="editor-tabbar">
            <div className="editor-tab active">
              <Icon name="code" size={13} />
              solution.{view.language === 'typescript' ? 'ts' : 'js'}
            </div>

            {restored && (
              <span className="t-caption row items-center g1" style={{ padding: '0 10px' }}>
                <Icon name="refresh" size={11} />
                Picked up where you left off
              </span>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor
              height="100%"
              language={view.language}
              theme="vs-dark"
              value={code}
              onChange={handleChange}
              onMount={handleEditorMount}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                fontLigatures: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 14 },
                readOnly: !started,
                tabSize: 2,
                renderWhitespace: 'selection',
                // Autocomplete is assistance, and §12 says there is none in
                // blind mode.
                quickSuggestions: !blindMode,
                suggestOnTriggerCharacters: !blindMode,
                wordBasedSuggestions: blindMode ? 'off' : 'currentDocument',
                parameterHints: { enabled: !blindMode },
              }}
            />
          </div>
        </div>

        <div
          className="col"
          style={{
            width: 300,
            borderLeft: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
            minHeight: 0,
          }}
        >
          {view.requiresDiagnosis ? (
            <DiagnosisPanel
              value={diagnosis}
              onChange={setDiagnosis}
              result={diagnosisResult}
              submitted={Boolean(diagnosisResult)}
              onSubmit={() => void handleSubmit()}
              submitting={submitCode.isPending}
              canSubmit={started && code.trim().length > 0}
            />
          ) : (
            <AssistancePanel
              enabled={started}
              blindMode={blindMode}
              hints={hints}
              pending={pendingHint}
              gateMessage={gateMessage}
              onRequest={(kind, override) => void handleHint(kind, override)}
            />
          )}
        </div>
      </div>

      {/*
        Alongside the hint ladder rather than instead of it. The ladder is
        graded and gated — it decides how much help this attempt has earned
        and records that it was taken. The assistant is not scored; it reads
        what is on screen and names what is wrong. It cannot type into the
        editor: it has no mechanism to, which is the rule, not an omission.
      */}
      <Assistant conceptId={view.conceptId} conceptName={view.title} screen={screenText()} />

      <div
        className="col"
        style={{
          height: 190,
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        <Tabs
          tabs={['Results', 'Console']}
          active={consoleTab}
          onChange={setConsoleTab}
          className="px3"
        />

        {consoleTab === 'Results' ? (
          <ResultsPanel
            execution={execution}
            evaluation={evaluation}
            hint={nextHint}
            running={submitCode.isPending}
          />
        ) : (
          <div className="p3 scroll-y mono" style={{ flex: 1, fontSize: 12.5 }}>
            {execution?.stdout ? (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{execution.stdout}</pre>
            ) : (
              <span className="t-caption">Nothing printed.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
