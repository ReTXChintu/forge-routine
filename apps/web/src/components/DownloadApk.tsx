import { Icon } from './Icon';

/**
 * The Android build, offered as a direct download.
 *
 * Served as a static file by the same host as the web app, so this is an
 * ordinary link rather than an API call — deliberately, because it must work
 * on the sign-in screen where there is no token to send.
 *
 * `download` on a cross-origin URL is ignored by browsers, so the file is
 * referenced by an absolute path on this origin. If the APK ever moves to a
 * CDN this will start opening the file instead of saving it, and the
 * attribute will need replacing with a Content-Disposition header.
 */
export const APK_URL = '/Forgeroutine.apk';

export function DownloadApkButton() {
  return (
    <a className="btn btn-ghost btn-sm" href={APK_URL} download title="Download the Android app">
      <Icon name="download" size={14} />
      Android
    </a>
  );
}

/**
 * The same download with an explanation, for the sign-in screen.
 *
 * Reachable without an account: someone deciding whether this is worth their
 * evening should be able to look at it on their phone first, and making them
 * register to find out is the wrong order.
 */
export function DownloadApkCard() {
  return (
    <div className="card mt6">
      <div className="row items-center g2 mb2">
        <Icon name="smartphone" size={15} />
        <span className="t-h4">Prefer your phone?</span>
      </div>

      <div className="t-small mb3">
        The Android app covers today&apos;s work, reviews and interviews — including answering an
        interview out loud. Writing code stays at a desk.
      </div>

      <a className="btn btn-secondary btn-block" href={APK_URL} download>
        <Icon name="download" size={15} />
        Download the APK
      </a>

      {/* Said plainly. A browser will warn about this file, and a user who
          was not expecting the warning assumes something is wrong. */}
      <div className="field-hint mt3">
        Installing outside the Play Store means allowing your browser to install unknown apps. Your
        phone will ask.
      </div>
    </div>
  );
}
