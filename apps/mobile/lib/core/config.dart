/// Runtime configuration.
///
/// Supplied at build time so the same binary is never silently pointed at the
/// wrong backend:
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:50005/api/v1
abstract final class AppConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    // 10.0.2.2 is the host loopback as seen from the Android emulator.
    defaultValue: 'http://10.0.2.2:50005/api/v1',
  );

  static const appName = 'ForgeRoutine';
  static const tagline = 'Forge your coding skills. Build your engineering mind.';
}
