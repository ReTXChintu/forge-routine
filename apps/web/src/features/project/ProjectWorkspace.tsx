import Editor from '@monaco-editor/react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import { Badge, Button, Card, Spinner, StateBlock, metricColor } from '~/components/ui';
import {
  useProject,
  useStartProject,
  useSubmitProjectStep,
  type ProjectStepView,
  type ReviewIssue,
  type StepSubmissionResult,
} from '~/lib/queries';

/**
 * The project workspace (§14), in the prototype's workspace layout.
 *
 * Steps as a spine on the left, editor in the middle, requirements and the
 * tech-lead review on the right. A locked step shows its title and nothing
 * else: seeing step three's requirements while working on step one gives
 * away the shape of the answer, and the server withholds them for the same
 * reason.
 *
 * The review is the other half of the grade. Tests passing is necessary,
 * not sufficient — a finished project carrying critical or major issues
 * sends the user back with a specific list rather than waving them through.
 */
export function ProjectWorkspace() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const { data: project, isLoading } = useProject(exerciseId);
  const start = useStartProject();
  const submit = useSubmitProjectStep();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [result, setResult] = useState<StepSubmissionResult | null>(null);

  const currentStep = project?.steps.find((step) => step.status === 'CURRENT');

  // Load the step's starter code once, when the step changes. Re-running on
  // every render would wipe out whatever the user has typed.
  useEffect(() => {
    if (currentStep) setCode(currentStep.starterCode ?? '');
    setResult(null);
  }, [currentStep?.index, currentStep?.starterCode]);

  if (isLoading) return <Spinner label="Loading project" />;
  if (!project) return <StateBlock icon="alert" title="This project could not be loaded" />;

  const notStarted = !project.attemptId;
  const complete = project.steps.every((step) => step.status === 'DONE');

  const run = async () => {
    if (!project.attemptId || !exerciseId) return;
    setResult(await submit.mutateAsync({ exerciseId, attemptId: project.attemptId, code }));
  };

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
              {project.title}
            </div>
            <div className="t-caption">
              {complete
                ? 'Project complete'
                : `Step ${(currentStep?.index ?? 0) + 1} of ${project.steps.length} · ${
                    currentStep?.title ?? ''
                  } · ~${currentStep?.estimatedMinutes ?? 0} min`}
            </div>
          </div>
        </div>

        <div className="row items-center g3">
          <Badge variant="primary" icon="layers">
            Project
          </Badge>

          {notStarted ? (
            <Button
              size="sm"
              icon="play"
              onClick={() => exerciseId && start.mutate(exerciseId)}
              disabled={start.isPending}
            >
              {start.isPending ? 'Starting…' : 'Start project'}
            </Button>
          ) : (
            !complete && (
              <Button
                size="sm"
                onClick={() => void run()}
                disabled={submit.isPending || code.trim().length === 0}
              >
                {submit.isPending ? 'Running…' : 'Submit step'}
              </Button>
            )
          )}
        </div>
      </div>

      <div className="row flex-1" style={{ minHeight: 0 }}>
        <div
          className="col scroll-y p4"
          style={{
            width: 280,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          <div className="t-caption mb1">OBJECTIVE</div>
          <div className="t-small mb5">{project.objective}</div>

          <div className="t-caption mb2">STEPS</div>
          <div className="col g1">
            {project.steps.map((step) => (
              <StepRow key={step.index} step={step} />
            ))}
          </div>
        </div>

        <div className="editor-shell flex-1" style={{ minWidth: 0 }}>
          <div className="editor-tabbar">
            <div className="editor-tab active">
              <Icon name="code" size={13} />
              step{(currentStep?.index ?? 0) + 1}.{project.language === 'typescript' ? 'ts' : 'js'}
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor
              height="100%"
              language={project.language}
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value ?? '')}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                fontLigatures: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 14 },
                readOnly: notStarted || complete,
                tabSize: 2,
                renderWhitespace: 'selection',
              }}
            />
          </div>
        </div>

        <div
          className="col scroll-y p4"
          style={{
            width: 380,
            borderLeft: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          {currentStep && !complete && (
            <div className="mb6">
              <div className="t-caption mb2">WHAT THIS STEP NEEDS</div>
              <div className="t-body" style={{ whiteSpace: 'pre-wrap' }}>
                {currentStep.requirements}
              </div>

              {currentStep.visibleTestNames.length > 0 && (
                <>
                  <div className="t-caption mt4 mb2">CHECKS</div>
                  <div className="col g1">
                    {currentStep.visibleTestNames.map((name) => (
                      <div key={name} className="t-caption mono">
                        {name}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {result && <StepResult result={result} />}

          {complete && !result && (
            <StateBlock
              icon="check"
              title="Every step passed"
              body="Review included. Nothing left to submit here."
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ step }: { step: ProjectStepView }) {
  const colour =
    step.status === 'DONE'
      ? 'var(--success)'
      : step.status === 'CURRENT'
        ? 'var(--primary)'
        : 'var(--text-muted)';

  return (
    <div
      className="row items-start g3 px3 py2"
      style={{
        borderRadius: 'var(--r-md)',
        background: step.status === 'CURRENT' ? 'var(--primary-subtle)' : 'transparent',
      }}
    >
      <span style={{ color: colour, marginTop: 2, flexShrink: 0, lineHeight: 0 }}>
        {step.status === 'DONE' ? (
          <Icon name="check" size={15} />
        ) : step.status === 'LOCKED' ? (
          <Icon name="lock" size={15} />
        ) : (
          <span
            style={{
              display: 'block',
              width: 14,
              height: 14,
              borderRadius: 99,
              border: '2px solid var(--primary)',
            }}
          />
        )}
      </span>

      <span
        className="t-small"
        style={{
          color: step.status === 'LOCKED' ? 'var(--text-muted)' : 'var(--text-primary)',
          fontWeight: step.status === 'CURRENT' ? 600 : 400,
        }}
      >
        {step.index + 1}. {step.title}
      </span>
    </div>
  );
}

const SEVERITY_COLOUR: Record<ReviewIssue['severity'], string> = {
  critical: 'var(--error)',
  major: 'var(--warning)',
  minor: 'var(--text-secondary)',
  nit: 'var(--text-muted)',
};

function StepResult({ result }: { result: StepSubmissionResult }) {
  const pct = result.testsTotal > 0 ? (result.testsPassed / result.testsTotal) * 100 : 0;

  return (
    <>
      <div className="row items-center justify-between mb3">
        <span className="t-caption">TESTS</span>
        <span className="t-code" style={{ fontWeight: 700, color: metricColor(pct) }}>
          {result.testsPassed}/{result.testsTotal} passing
        </span>
      </div>

      <div className="col g2 mb6">
        {result.cases.map((testCase) => (
          <div key={testCase.name}>
            <div className="row items-start g2">
              <span
                style={{
                  color: testCase.passed ? 'var(--success)' : 'var(--error)',
                  marginTop: 2,
                  lineHeight: 0,
                }}
              >
                <Icon name={testCase.passed ? 'check' : 'x'} size={13} />
              </span>
              <span className="t-caption mono">{testCase.name}</span>
            </div>
            {testCase.error && (
              <div
                className="t-caption mono mt1"
                style={{ color: 'var(--error)', paddingLeft: 21, whiteSpace: 'pre-wrap' }}
              >
                {testCase.error}
              </div>
            )}
          </div>
        ))}
      </div>

      {result.checkpointFailed && (
        <Card className="mb5" style={{ borderColor: 'var(--warning)' }}>
          {/* A checkpoint that waves everyone through is not a checkpoint. */}
          <div className="t-h4" style={{ color: 'var(--warning)' }}>
            Tests pass, but this is not finished
          </div>
          <div className="t-small mt1">
            The review below found problems serious enough that shipping this would be a mistake.
            Fix them and resubmit.
          </div>
        </Card>
      )}

      {result.review && (
        <>
          <div className="t-caption mb2">REVIEW</div>
          <div className="t-body mb4">{result.review.summary}</div>

          <div className="col g4">
            {result.review.issues.map((issue) => (
              <div
                key={issue.title}
                style={{
                  borderLeft: `2px solid ${SEVERITY_COLOUR[issue.severity]}`,
                  paddingLeft: 12,
                }}
              >
                <div className="row items-center g2 mb1">
                  <span
                    className="t-caption"
                    style={{ color: SEVERITY_COLOUR[issue.severity], fontWeight: 700 }}
                  >
                    {issue.severity.toUpperCase()}
                  </span>
                  <span className="t-caption">
                    {issue.category}
                    {issue.line !== null && ` · line ${issue.line}`}
                  </span>
                </div>
                <div className="t-h4" style={{ fontSize: 13 }}>
                  {issue.title}
                </div>
                <div className="t-caption mt1" style={{ lineHeight: 1.6 }}>
                  {issue.explanation}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {result.projectComplete && (
        <Card className="mt6">
          <div className="t-h4" style={{ color: 'var(--success)' }}>
            Project complete
          </div>
          <div className="t-small mt1">
            This is the only work that shows whether you can compose several ideas at once, so it
            counts for more than the drills did.
          </div>
        </Card>
      )}
    </>
  );
}
