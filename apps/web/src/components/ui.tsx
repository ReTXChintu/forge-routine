import type { CSSProperties, ReactNode } from 'react';

import { Icon } from './Icon';

/**
 * The prototype's helper components, as React.
 *
 * Direct ports of the `btn`, `badge`, `sectionHead`, `statRow`, `skillMeter`
 * and `card` helpers in design.html. Kept as thin wrappers over the CSS
 * classes rather than re-styled components, so the markup a screen produces
 * is the markup the prototype produces.
 */

export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export function Badge({
  children,
  variant = 'neutral',
  icon,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  icon?: string;
}) {
  return (
    <span className={`badge badge-${variant}`}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'solid-danger';

export function Button({
  children,
  variant = 'primary',
  size,
  icon,
  block,
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'lg';
  icon?: string;
  block?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', block ? 'btn-block' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} {...rest}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

export function Card({
  children,
  elevated,
  hover,
  flush,
  className = '',
  style,
  onClick,
}: {
  children: ReactNode;
  elevated?: boolean;
  hover?: boolean;
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const classes = [
    elevated ? 'card-elevated' : 'card',
    hover ? 'card-hover' : '',
    flush ? 'card-flush' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} style={style} onClick={onClick}>
      {children}
    </div>
  );
}

/**
 * Green above 70, amber above 45, red below.
 *
 * The same thresholds the prototype uses. A number the user is meant to act
 * on should not need a legend to interpret.
 */
export function metricColor(pct: number): string {
  if (pct >= 70) return 'var(--success)';
  if (pct >= 45) return 'var(--warning)';
  return 'var(--error)';
}

export function SkillMeter({ pct, color }: { pct: number; color?: string }) {
  return (
    <div className="skill-meter">
      <div
        className="seg"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: color ?? metricColor(pct),
        }}
      />
    </div>
  );
}

export function StatRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="mb3">
      <div className="stat-row mb1">
        <span className="t-small" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <span className="t-code" style={{ fontWeight: 700, fontSize: 12.5 }}>
          {Math.round(pct)}%
        </span>
      </div>
      <SkillMeter pct={pct} />
    </div>
  );
}

export function SectionHead({
  eyebrow,
  title,
  description,
  right,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <div className="row justify-between items-end mb6 g4 wrap">
      <div>
        {eyebrow && <div className="t-caption mb1">{eyebrow}</div>}
        <div className="t-h1">{title}</div>
        {description && (
          <div className="t-body mt1" style={{ maxWidth: 640 }}>
            {description}
          </div>
        )}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

export function ProgressBar({ pct, thin }: { pct: number; thin?: boolean }) {
  return (
    <div className={`progress-linear ${thin ? 'thin' : ''}`}>
      <div className="fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/**
 * Centred empty/loading/error block.
 *
 * The one place a centred column is correct: there is nothing to fill the
 * width with, and left-aligning a two-line message across a 1600px screen
 * reads as a rendering fault.
 */
export function StateBlock({
  icon: iconName,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-block">
      <div className="state-icon">
        <Icon name={iconName} size={22} />
      </div>
      <div className="t-h3">{title}</div>
      {body && (
        <div className="t-body" style={{ maxWidth: 420 }}>
          {body}
        </div>
      )}
      {action && <div className="mt4">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="state-block">
      <div className="skeleton" style={{ width: 180, height: 10, borderRadius: 99 }} />
      {label && <div className="t-caption mt3">{label}</div>}
    </div>
  );
}
