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
  className = '',
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'lg';
  icon?: string;
  block?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // Merged, not spread over: `className` arrives in `rest` otherwise and
  // silently replaces every button class, leaving an unstyled element.
  const classes = [
    'btn',
    `btn-${variant}`,
    size ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    className,
  ]
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

/**
 * Marks a number that comes from the prototype rather than from the user.
 *
 * Some screens in design.html show data the backend does not produce yet.
 * Rather than leave a hole or quietly imply the figure is real, the figure
 * is shown and labelled. The label is not decoration: this product's whole
 * argument is that it never shows a score it has not earned, and an
 * unmarked placeholder would break that in the one place it matters most.
 *
 * Every one of these is a to-do. When the endpoint lands, the note goes.
 */
export function StaticNote({
  children = 'Static figure — not your data yet',
}: {
  children?: string;
}) {
  return (
    <div
      className="t-caption mt1"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: 0.75 }}
    >
      <Icon name="info" size={11} />
      {children}
    </div>
  );
}

/** The prototype's ring gauge, used where one number is the whole answer. */
export function CircularProgress({
  pct,
  size = 64,
  stroke = 6,
  color,
  label,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, pct)) / 100) * circumference;

  return (
    <div className="circ" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--surface-2)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color ?? metricColor(pct)}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset .6s var(--ease)' }}
        />
      </svg>
      <div className="circ-label">
        <span style={{ fontSize: size * 0.26, fontWeight: 800 }}>{Math.round(pct)}%</span>
        {label && (
          <span className="t-caption" style={{ marginTop: 1 }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Marks output that came from a model.
 *
 * Never decorative. The product's whole claim is that AI assists rather than
 * substitutes, and the user is entitled to know which sentences it wrote.
 */
export function AiTag({ children = 'AI Mentor' }: { children?: string }) {
  return (
    <div className="ai-tag">
      <span className="ai-mark">
        <Icon name="zap" size={10} />
      </span>
      {children}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: readonly string[];
  active: string;
  onChange: (tab: string) => void;
  className?: string;
}) {
  return (
    <div className={`tabs ${className}`}>
      {tabs.map((tab) => (
        <div
          key={tab}
          className={`tab ${tab === active ? 'active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {tab}
        </div>
      ))}
    </div>
  );
}
