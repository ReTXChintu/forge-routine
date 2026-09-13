import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { DownloadApkCard } from '~/components/DownloadApk';
import { Icon } from '~/components/Icon';
import { Button } from '~/components/ui';
import { ApiError } from '~/lib/api';
import { useIndependence, useLogin, useRegister } from '~/lib/queries';

/**
 * Sign in and register, in the prototype's split layout.
 *
 * Two full-height halves, each `flex:1` — the form on the left, the pitch on
 * the right. The form itself is the one element with a max width, because a
 * 1600px-wide email field is not a design, it is an accident. Everything
 * around it uses the whole screen.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = useLogin();
  const register = useRegister();
  const navigate = useNavigate();

  const pending = login.isPending || register.isPending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      if (mode === 'login') await login.mutateAsync({ email, password });
      else await register.mutateAsync({ email, password, displayName });

      navigate('/', { replace: true });
    } catch (caught) {
      // The API deliberately does not say which half was wrong, and neither
      // does this: a message that distinguishes them confirms which
      // addresses have accounts.
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not reach ForgeRoutine. Check your connection.',
      );
    }
  };

  return (
    <div className="row" style={{ height: '100%' }}>
      <div className="col justify-center" style={{ flex: 1, padding: 60, overflowY: 'auto' }}>
        <div style={{ maxWidth: 380, margin: '0 auto', width: '100%' }}>
          <div className="row items-center g2 mb7">
            <div
              className="mark"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--on-primary)',
                fontWeight: 800,
              }}
            >
              F
            </div>
            <span className="t-h3">ForgeRoutine</span>
          </div>

          <div className="t-h1 mb1">
            {mode === 'login' ? 'Welcome back' : 'Start rebuilding your edge'}
          </div>
          <div className="t-body mb6">
            {mode === 'login'
              ? "Sign in to continue today's routine."
              : 'Create your account — it takes about two minutes.'}
          </div>

          <form onSubmit={submit}>
            {mode === 'register' && (
              <>
                <label className="field-label" htmlFor="displayName">
                  Name
                </label>
                <input
                  id="displayName"
                  className="input mb3"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </>
            )}

            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input mb3"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />

            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input mb2"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
            {mode === 'register' && <div className="field-hint mb4">At least 6 characters.</div>}

            {error && <div className="field-error mb4">{error}</div>}

            <Button
              type="submit"
              size="lg"
              block
              disabled={pending}
              style={{ marginTop: 'var(--sp-4)' }}
            >
              {pending ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <div className="row items-center g3 mt5 mb5">
            <div className="divider" style={{ flex: 1 }} />
            <span className="t-caption">or</span>
            <div className="divider" style={{ flex: 1 }} />
          </div>

          <div className="t-caption" style={{ textAlign: 'center' }}>
            {mode === 'login' ? 'New to ForgeRoutine? ' : 'Already have an account? '}
            <a
              className="text-primary-c"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </a>
          </div>

          <DownloadApkCard />
        </div>
      </div>

      <AuthAside />
    </div>
  );
}

/**
 * The right half.
 *
 * Shows the real independent coding score when the visitor already has a
 * session, and the product's actual claim when they do not — rather than a
 * fabricated number, which is exactly the thing this product refuses to do
 * everywhere else.
 */
function AuthAside() {
  const { data } = useIndependence();
  const known = data?.status === 'OK' && data.score !== null;

  return (
    <div
      className="col justify-center items-center cq-hide-right"
      style={{
        flex: 1,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 30% 20%, var(--primary-subtle), transparent 45%)',
        }}
      />

      <div style={{ maxWidth: 420, padding: 40, position: 'relative' }}>
        <div className="t-caption mb2">Independent coding score</div>

        {known ? (
          <div className="row items-end g2 mb4">
            <span className="t-metric-lg text-primary-c">{Math.round(data.score! * 100)}%</span>
            {data.deltaFromPreviousWindow !== null && (
              <span className="text-success t-small">
                <Icon name="trend" size={14} /> {data.deltaFromPreviousWindow >= 0 ? '+' : ''}
                {Math.round(data.deltaFromPreviousWindow * 100)}% this window
              </span>
            )}
          </div>
        ) : (
          <div className="mb4">
            <div className="t-metric-lg" style={{ color: 'var(--text-muted)' }}>
              —
            </div>
            <div className="t-small mt1">
              Measured from what you write unaided, once there is enough of it to mean anything.
            </div>
          </div>
        )}

        <div className="code-block">
          <pre>
            <span className="cb-kw">async function</span>{' '}
            <span className="cb-fn">handleRequest</span>
            (req) {'{\n'}
            {'  '}
            <span className="cb-kw">const</span> data = <span className="cb-kw">await</span>{' '}
            fetchUser(req.id);{'\n'}
            {'  '}
            <span className="cb-kw">return</span> res.json(data);{'\n'}
            {'}'}
          </pre>
        </div>

        <div className="t-body mt5">
          AI that makes you better at writing code, not a machine that writes it for you.
        </div>
      </div>
    </div>
  );
}
