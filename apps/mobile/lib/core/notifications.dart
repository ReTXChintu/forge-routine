import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

/// Daily routine reminders.
///
/// Scheduled locally rather than pushed. A push backend for one notification
/// a day is infrastructure with no user benefit, and it would mean the server
/// knowing when someone is asleep.
///
/// **One notification a day, and it is not a streak.** Streak notifications
/// work by making people anxious, and an anxious learner opens the app to
/// clear a badge rather than to think. The reminder says what today's work
/// is; if it is ignored, nothing nags and nothing is lost — the spaced
/// repetition schedule already accounts for gaps.
class RoutineReminders {
  RoutineReminders({FlutterLocalNotificationsPlugin? plugin})
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  static const _channelId = 'forgeroutine.routine';
  static const _dailyId = 1;

  final FlutterLocalNotificationsPlugin _plugin;
  bool _ready = false;

  /// Initialises the plugin and asks for permission.
  ///
  /// Returns false when the user declined or the platform refused. Declining
  /// must leave a working app, so every caller treats false as ordinary.
  Future<bool> prepare() async {
    if (_ready) return true;

    tz.initializeTimeZones();

    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(
        // Requested explicitly later, on a screen where the user has context
        // for why. A permission prompt on first launch gets denied.
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      ),
    );

    _ready = await _plugin.initialize(settings) ?? false;
    return _ready;
  }

  Future<bool> requestPermission() async {
    if (!await prepare()) return false;

    final android = _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) {
      return await android.requestNotificationsPermission() ?? false;
    }

    final ios = _plugin
        .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    if (ios != null) {
      return await ios.requestPermissions(alert: true, badge: false, sound: true) ?? false;
    }

    return false;
  }

  /// Schedules the daily reminder, replacing any existing one.
  Future<void> scheduleDaily({required int hour, required int minute}) async {
    if (!await prepare()) return;

    await _plugin.zonedSchedule(
      _dailyId,
      'Today’s work is ready',
      'A few minutes now keeps the spacing intact.',
      _nextInstanceOf(hour, minute),
      const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          'Daily routine',
          channelDescription: 'One reminder a day that today’s work is waiting.',
          importance: Importance.defaultImportance,
          priority: Priority.defaultPriority,
        ),
        iOS: DarwinNotificationDetails(presentBadge: false),
      ),
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      // Wall-clock, not absolute: "8pm" must stay 8pm when the clocks change
      // or the user flies somewhere.
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.wallClockTime,
      matchDateTimeComponents: DateTimeComponents.time,
    );
  }

  Future<void> cancelDaily() => _plugin.cancel(_dailyId);

  /// The next occurrence of a wall-clock time, in the device's timezone.
  ///
  /// Local time rather than UTC deliberately: "remind me at 8pm" must survive
  /// the user flying somewhere and daylight saving changing under them.
  tz.TZDateTime _nextInstanceOf(int hour, int minute) {
    final now = tz.TZDateTime.now(tz.local);
    var next = tz.TZDateTime(tz.local, now.year, now.month, now.day, hour, minute);

    if (!next.isAfter(now)) next = next.add(const Duration(days: 1));
    return next;
  }
}
