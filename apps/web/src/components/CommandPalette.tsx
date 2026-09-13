import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon } from './Icon';

/**
 * Global command palette (§37), Ctrl/Cmd+K.
 *
 * Keyboard-first is part of the design language: this is a developer tool,
 * and reaching for a mouse to start today's work is friction the product
 * cannot afford if it wants to be opened every day.
 *
 * Also opens on a `forge:open-command-palette` event, so the topbar's search
 * affordance and the shortcut share one implementation rather than two that
 * drift.
 */

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  run: (navigate: ReturnType<typeof useNavigate>) => void;
}

const COMMANDS: Command[] = [
  { id: 'dashboard', label: 'Open dashboard', icon: 'home', run: (n) => n('/') },
  { id: 'routine', label: "Start today's routine", icon: 'routine', run: (n) => n('/today') },
  {
    id: 'roadmap',
    label: 'Open roadmap',
    hint: 'Your whole path',
    icon: 'learn',
    run: (n) => n('/roadmap'),
  },
  {
    id: 'practice',
    label: 'Engineering challenges',
    icon: 'practice',
    run: (n) => n('/engineering'),
  },
  { id: 'interview', label: 'Interview readiness', icon: 'interview', run: (n) => n('/interview') },
  { id: 'technologies', label: 'Technologies', icon: 'tech', run: (n) => n('/technologies') },
  { id: 'progress', label: 'Progress', icon: 'progress', run: (n) => n('/progress') },
];

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const open = () => {
      setIsOpen(true);
      setQuery('');
      setSelected(0);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((wasOpen) => !wasOpen);
        setQuery('');
        setSelected(0);
      }
      if (event.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('forge:open-command-palette', open);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('forge:open-command-palette', open);
    };
  }, []);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return COMMANDS;
    return COMMANDS.filter((command) => command.label.toLowerCase().includes(needle));
  }, [query]);

  if (!isOpen) return null;

  const run = (command: Command) => {
    setIsOpen(false);
    command.run(navigate);
  };

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, matches.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = matches[selected];
      if (command) run(command);
    }
  };

  return (
    <div className="cmdk-overlay" onClick={() => setIsOpen(false)}>
      <div className="cmdk" onClick={(event) => event.stopPropagation()}>
        <div className="cmdk-input">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search or jump to…"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <span className="kbd">ESC</span>
        </div>

        <div className="cmdk-list">
          {matches.length === 0 ? (
            <div className="cmdk-item" style={{ color: 'var(--text-muted)' }}>
              Nothing matches “{query}”
            </div>
          ) : (
            matches.map((command, index) => (
              <div
                key={command.id}
                className={`cmdk-item ${index === selected ? 'sel' : ''}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(command)}
              >
                <Icon name={command.icon} size={16} />
                <span>{command.label}</span>
                {command.hint && <span className="t-caption">{command.hint}</span>}
                {index === selected && <span className="kbd kbd-hint">↵</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
