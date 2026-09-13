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

import { Icon } from '~/components/Icon';
import { Badge, Button, Spinner, StateBlock, Tabs } from '~/components/ui';
import { ApiError } from '~/lib/api';
import {
  useExercise,
  useMarkFirstCode,
  useRequestHint,
  useStartAttempt,
  useSubmitCode,
} from '~/lib/queries';

import { AssistancePanel, type HintEntry } from './AssistancePanel';
import { DiagnosisPanel } from './DiagnosisPanel';
import { ResultsPanel } from './ResultsPanel';

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

  // Advisory signals only. They never reach the Independent Coding Score —
  // the server counts what matters.
  const signals = useRef({ keystrokeCount: 0, largePasteEvents: 0 });
  const firstCodeSent = useRef(false);

  const startAttempt = useStartAttempt();
  const markFirstCode = useMarkFirstCode();
  const submitCode = useSubmitCode();
  const requestHint = useRequestHint();

  const view = servedExercise ?? exercise ?? null;

  const begin = useCallback(
    async (blind: boolean) => {
      if (!exerciseId) return;

      const result = await startAttempt.mutateAsync({ exerciseId, blindMode: blind });
      setAttemptId(result.attemptId);
      setServedExercise(result.exercise);
      setBlindMode(blind);
      // A debugging exercise starts from the faulty code: that is the problem.
      setCode(result.exercise.brokenCode ?? result.exercise.starterCode ?? '');
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

  const started = Boolean(attemptId);
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
