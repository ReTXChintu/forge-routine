import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import {
  Badge,
  Button,
  Card,
  CircularProgress,
  SectionHead,
  SkillMeter,
  Spinner,
  type BadgeVariant,
} from '~/components/ui';
import {
  useInterviewGuide,
  useInterviewHistory,
  useStartInterview,
  type GuideTechnology,
  type GuideTopic,
} from '~/lib/queries';

/**
 * The interview guide (§17): a readiness dossier, not a study plan.
 *
 * The roadmap answers "what should I learn next". This answers "if the
 * interview were tomorrow, where would I be caught out", and the two give
 * different answers on purpose. Topics are ordered by preparation value, so
 * what you already know sinks to the bottom — rereading it is the most
 * comfortable way to waste the time you have left.
 */

const MODES = [
  { value: 'QUICK', label: 'Quick — 3 areas, shallow' },
  { value: 'TECHNICAL', label: 'Technical — 4 areas' },
  { value: 'CODING', label: 'Coding' },
  { value: 'DEBUGGING', label: 'Debugging' },
  { value: 'SYSTEM_DESIGN', label: 'System design — 2 areas, deep' },
  { value: 'SENIOR', label: 'Senior — 5 areas, deep' },
];

const STATUS_VARIANT: Record<GuideTopic['status'], BadgeVariant> = {
  STRONG: 'success',
  SHAKY: 'warning',
  WEAK: 'error',
  UNPRACTISED: 'neutral',
};

const STATUS_LABEL: Record<GuideTopic['status'], string> = {
  STRONG: 'Solid',
  SHAKY: 'Shaky',
  WEAK: 'Weak',
  UNPRACTISED: 'Untouched',
};

export function InterviewGuide() {
  const { data: guide, isLoading } = useInterviewGuide();
  const { data: history } = useInterviewHistory();
  const start = useStartInterview();
  const navigate = useNavigate();

  const [mode, setMode] = useState('TECHNICAL');
  const [level, setLevel] = useState('MID');

  if (isLoading) return <Spinner label="Loading readiness" />;

  const begin = async () => {
    const interview = await start.mutateAsync({ mode, targetLevel: level });
    navigate(`/interview/${interview.id}`);
  };

  const readiness = guide?.overallReadiness;

  return (
    <>
      <SectionHead
        eyebrow="Interview"
        title="Interview readiness"
        description="Where you would be caught out, ordered by what is worth fixing first."
      />

      <Card elevated className="mb7">
        <div className="row items-center g6 wrap">
          {/* The headline number, or an honest refusal to give one. */}
          <div className="row items-center g4" style={{ minWidth: 220 }}>
            {readiness !== null && readiness !== undefined ? (
              <>
                <CircularProgress pct={readiness * 100} size={76} />
                <div>
                  <div className="t-h4">Weighted readiness</div>
                  <div className="t-caption mt1">
                    Weighted by how much each technology matters to you.
                  </div>
                </div>
              </>
            ) : (
              <div>
                <div className="t-h3">Not enough yet</div>
                <div className="t-caption mt1">
                  A number from two practised concepts would be a guess.
                </div>
              </div>
            )}
          </div>

          <div className="vdivider" />

          <div className="col g2 flex-1" style={{ minWidth: 280 }}>
            <select
              className="select"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              {MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="row g2">
              <select
                className="select"
                value={level}
                onChange={(event) => setLevel(event.target.value)}
                style={{ maxWidth: 150 }}
              >
                <option value="JUNIOR">Junior</option>
                <option value="MID">Mid</option>
                <option value="SENIOR">Senior</option>
              </select>
              <Button icon="mic" onClick={() => void begin()} disabled={start.isPending}>
                {start.isPending ? 'Starting…' : 'Start interview'}
              </Button>
            </div>

            {start.isError && (
              <div className="t-caption" style={{ color: 'var(--error)' }}>
                Practise something first — an interview on material you have never studied measures
                nothing.
              </div>
            )}
          </div>
        </div>
      </Card>

      {guide && guide.priorities.length > 0 && (
        <div className="mb7">
          <div className="t-caption mb3">FIX THESE FIRST</div>
          <div className="grid grid-2 g3 cq-grid-2">
            {guide.priorities.map((priority, index) => (
              <Card
                key={priority.title}
                hover={Boolean(priority.conceptId)}
                onClick={() => priority.conceptId && navigate(`/concept/${priority.conceptId}`)}
              >
                <div className="row items-start g3">
                  <span
                    className="t-metric"
                    style={{ fontSize: 18, color: 'var(--primary)', flexShrink: 0 }}
                  >
                    {index + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="t-h4">{priority.title}</div>
                    <div className="t-caption mt1">{priority.reason}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {guide && guide.recurringWeaknesses.length > 0 && (
        <div className="mb7">
          <div className="t-caption mb1">CAME UP MORE THAN ONCE</div>
          {/* One interview is an off day; two is a pattern. */}
          <div className="t-small mb3">Weaknesses two or more past interviews agreed on.</div>
          <div className="col g1">
            {guide.recurringWeaknesses.map((weakness) => (
              <div key={weakness} className="t-body">
                · {weakness}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb7">
        <div className="t-caption mb3">BY TECHNOLOGY</div>
        <div className="grid grid-2 g4 cq-grid-2">
          {guide?.technologies.map((technology) => (
            <TechnologyBlock key={technology.technologyId} technology={technology} />
          ))}
        </div>
      </div>

      {history && history.length > 0 && (
        <div>
          <div className="t-caption mb3">PAST INTERVIEWS</div>
          <table className="table">
            <thead>
              <tr>
                <th>Mode</th>
                <th>Date</th>
                <th>Questions</th>
                <th style={{ textAlign: 'right' }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {history.map((interview) => (
                <tr
                  key={interview.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/interview/${interview.id}`)}
                >
                  <td>{interview.mode}</td>
                  <td className="t-caption">
                    {new Date(interview.startedAt).toLocaleDateString()}
                  </td>
                  <td className="t-caption">{interview.questionCount}</td>
                  <td className="t-code" style={{ textAlign: 'right' }}>
                    {interview.overallScore === null
                      ? interview.status === 'IN_PROGRESS'
                        ? 'unfinished'
                        : '—'
                      : `${Math.round(interview.overallScore * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TechnologyBlock({ technology }: { technology: GuideTechnology }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? technology.topics : technology.topics.slice(0, 4);

  return (
    <Card>
      <div className="row items-center justify-between g2 mb3">
        <div className="row items-center g2" style={{ minWidth: 0 }}>
          <span className="t-h4">{technology.name}</span>
          <Badge variant="neutral">{technology.interviewImportance}/5 for interviews</Badge>
        </div>
        <span className="t-code" style={{ fontWeight: 700 }}>
          {technology.readiness === null ? '—' : `${Math.round(technology.readiness * 100)}%`}
        </span>
      </div>

      {technology.readiness !== null && (
        <div className="mb3">
          <SkillMeter pct={technology.readiness * 100} />
        </div>
      )}

      <div className="col g2">
        {shown.map((topic) => (
          <div key={topic.conceptId} className="row items-start g3">
            <span style={{ flexShrink: 0, width: 78 }}>
              <Badge variant={STATUS_VARIANT[topic.status]}>{STATUS_LABEL[topic.status]}</Badge>
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="t-small" style={{ color: 'var(--text-primary)' }}>
                {topic.name}
              </div>
              {topic.commonMistakes.length > 0 && topic.status !== 'STRONG' && (
                <div className="t-caption mt1">Watch for: {topic.commonMistakes[0]}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {technology.topics.length > 4 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt3"
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
          {expanded ? 'Show less' : `${technology.topics.length - 4} more`}
        </Button>
      )}
    </Card>
  );
}
