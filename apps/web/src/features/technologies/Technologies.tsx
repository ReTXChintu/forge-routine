import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { UserTechnology } from '@forgeroutine/shared-types';

import { Icon } from '~/components/Icon';
import { Badge, Button, Card, SectionHead, Spinner, StateBlock } from '~/components/ui';
import {
  useAddTechnology,
  useArchiveTechnology,
  useCatalogue,
  useMyTechnologies,
} from '~/lib/queries';

/**
 * Technology management (§25).
 *
 * The user owns their learning universe. Anything in the catalogue can be
 * added, and anything *not* in the catalogue can be created by typing its
 * name — Rust today, Kubernetes next week, with no release in between
 * (§41).
 *
 * Full width: owned technologies as a grid, the catalogue beneath it as
 * another. Both scale with the window rather than sitting in a column.
 */
export function Technologies() {
  const [search, setSearch] = useState('');
  const { data: mine, isLoading } = useMyTechnologies();
  const { data: catalogue } = useCatalogue(search);
  const addTechnology = useAddTechnology();
  const archive = useArchiveTechnology();
  const navigate = useNavigate();

  const ownedIds = new Set((mine ?? []).map((t) => t.technologyId));
  const available = (catalogue ?? []).filter((t) => !ownedIds.has(t.id));
  const exactMatch = (catalogue ?? []).some(
    (t) => t.name.toLowerCase() === search.trim().toLowerCase(),
  );
  const canCreate = search.trim().length > 1 && !exactMatch;

  const add = async (input: { technologyId?: string; name?: string }) => {
    await addTechnology.mutateAsync(input);
    setSearch('');
  };

  if (isLoading) return <Spinner label="Loading your technologies" />;

  return (
    <>
      <SectionHead
        eyebrow="Technologies"
        title="My technologies"
        description="Add anything. Removing one keeps your history — skill data is never destroyed."
      />

      {(mine ?? []).length === 0 ? (
        <StateBlock
          icon="tech"
          title="Nothing added yet"
          body="Pick from the catalogue below, or type a name to add something that is not there."
        />
      ) : (
        <div className="grid grid-4 g3 mb7 cq-grid-4">
          {(mine ?? []).map((item) => (
            <OwnedCard
              key={item.id}
              item={item}
              onOpen={() => navigate(`/technology/${item.technologyId}`)}
              onRemove={() => archive.mutate(item.technologyId)}
            />
          ))}
        </div>
      )}

      <div className="row justify-between items-end mb4 g4 wrap">
        <div>
          <div className="t-h3">Add a technology</div>
          <div className="t-small mt1">
            Curriculum is generated on demand, one technology at a time, in learning order.
          </div>
        </div>

        <div className="row g2" style={{ minWidth: 280 }}>
          <input
            className="input"
            placeholder="Search or type a new name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {canCreate && (
            <Button
              icon="plus"
              onClick={() => void add({ name: search.trim() })}
              disabled={addTechnology.isPending}
            >
              Add “{search.trim()}”
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-4 g3 cq-grid-4">
        {available.map((technology) => (
          <Card key={technology.id} hover onClick={() => void add({ technologyId: technology.id })}>
            <div className="row items-center justify-between mb2">
              <Icon name={iconFor(technology.category)} size={17} />
              <Icon name="plus" size={14} />
            </div>
            <div className="t-h4">{technology.name}</div>
            <div className="t-caption mt1">{technology.category}</div>
          </Card>
        ))}
      </div>

      {available.length === 0 && !canCreate && (
        <div className="t-small">Everything in the catalogue is already yours.</div>
      )}
    </>
  );
}

function OwnedCard({
  item,
  onOpen,
  onRemove,
}: {
  item: UserTechnology;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const paused = item.status === 'PAUSED';

  return (
    <Card hover style={{ opacity: paused ? 0.6 : 1 }}>
      <div className="row items-start justify-between mb3">
        <div className="row items-center g2" style={{ cursor: 'pointer' }} onClick={onOpen}>
          <Icon name={iconFor(item.technology?.category)} size={17} />
          <span className="t-h4">{item.technology?.name ?? 'Unknown'}</span>
        </div>

        <button
          type="button"
          className="icon-btn"
          style={{ width: 24, height: 24 }}
          onClick={onRemove}
          title={`Remove ${item.technology?.name ?? 'technology'}`}
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="row g2 wrap">
        <Badge variant={item.priority === 'CRITICAL' ? 'primary' : 'neutral'}>
          {item.priority.toLowerCase()}
        </Badge>
        <Badge variant="neutral">{item.targetProficiency.toLowerCase()}</Badge>
        {paused && <Badge variant="warning">paused</Badge>}
      </div>

      <div className="t-caption mt3">Interview weight {item.interviewImportance}/5</div>
    </Card>
  );
}

/** Category to icon. Falls back rather than guessing at an unknown category. */
function iconFor(category: string | undefined): string {
  switch (category) {
    case 'language':
      return 'code';
    case 'runtime':
    case 'backend':
      return 'cpu';
    case 'frontend':
      return 'layers';
    case 'database':
      return 'database';
    case 'devops':
    case 'infrastructure':
      return 'zap';
    case 'systems':
      return 'monitor';
    case 'tooling':
      return 'git';
    case 'architecture':
      return 'layers';
    default:
      return 'tech';
  }
}
