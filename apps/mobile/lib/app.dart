import 'package:flutter/material.dart';

import 'core/config.dart';
import 'core/notifications.dart';
import 'core/theme.dart';
import 'data/api_client.dart';
import 'data/routine_models.dart';
import 'features/auth/sign_in_page.dart';
import 'features/dashboard/dashboard_page.dart';
import 'features/interview/interview_page.dart';
import 'features/progress/progress_page.dart';
import 'features/recall/recall_sheet.dart';
import 'features/routine/routine_page.dart';

/// The mobile shell.
///
/// Four tabs, chosen by what actually works one-handed: today's work,
/// reviews, interviews, progress. Writing code is absent on purpose (§4) —
/// reproducing the desktop editor on a phone would be a worse version of
/// both, so coding items are surfaced with their rationale and opened at a
/// desk.
class ForgeRoutineApp extends StatefulWidget {
  const ForgeRoutineApp({required this.api, this.reminders, super.key});

  final ApiClient api;
  final RoutineReminders? reminders;

  @override
  State<ForgeRoutineApp> createState() => _ForgeRoutineAppState();
}

class _ForgeRoutineAppState extends State<ForgeRoutineApp> {
  late final RoutineReminders _reminders = widget.reminders ?? RoutineReminders();

  bool? _signedIn;

  @override
  void initState() {
    super.initState();
    _checkSession();
  }

  Future<void> _checkSession() async {
    final token = await widget.api.accessToken;
    if (mounted) setState(() => _signedIn = token != null);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: buildForgeTheme(),
      home: switch (_signedIn) {
        // A stored token is not proof of a valid session — the first request
        // settles that, and the client refreshes or clears on a 401. This
        // only decides which screen to show first.
        null => const Scaffold(body: Center(child: CircularProgressIndicator())),
        false => SignInPage(
            api: widget.api,
            onSignedIn: () => setState(() => _signedIn = true),
          ),
        true => HomeShell(
            api: widget.api,
            reminders: _reminders,
            onSignedOut: () => setState(() => _signedIn = false),
          ),
      },
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({
    required this.api,
    required this.reminders,
    required this.onSignedOut,
    super.key,
  });

  final ApiClient api;
  final RoutineReminders reminders;
  final VoidCallback onSignedOut;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  Future<void> _signOut() async {
    await widget.api.clearTokens();
    widget.onSignedOut();
  }

  /// Opens whatever is due, one prompt at a time.
  ///
  /// Reached only by tapping the Review tab. Nothing here ever interrupts:
  /// a prompt that arrives mid-task destroys the state the product exists to
  /// build, and teaches the user to dismiss prompts unread.
  Future<void> _openReviews() async {
    try {
      final due = await widget.api.get<List<dynamic>>('/recall/due');

      if (!mounted) return;

      if (due.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Nothing due. Come back when something is.')),
        );
        setState(() => _tab = 0);
        return;
      }

      for (final raw in due) {
        if (!mounted) return;
        await showRecallPrompt(
          context,
          api: widget.api,
          prompt: RecallPrompt.fromJson(raw as Map<String, dynamic>),
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _tab = 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      RoutinePage(api: widget.api),
      // Never built: selecting this tab opens the review sheets and bounces
      // back to Today. A placeholder keeps the index arithmetic honest.
      const SizedBox.shrink(),
      InterviewPage(api: widget.api),
      ProgressPage(api: widget.api, reminders: widget.reminders),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Image.asset('assets/brand/app-icon.png', height: 22),
            const SizedBox(width: 8),
            RichText(
              text: const TextSpan(
                children: [
                  TextSpan(
                    text: 'Forge',
                    style: TextStyle(
                      color: ForgeColors.forge,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                  TextSpan(
                    text: 'Routine',
                    style: TextStyle(
                      color: ForgeColors.ink300,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => DashboardPage(api: widget.api),
              ),
            ),
            icon: const Icon(Icons.speed_outlined, size: 20),
            tooltip: 'Overview',
          ),
          IconButton(
            onPressed: _signOut,
            icon: const Icon(Icons.logout, size: 20),
            tooltip: 'Sign out',
          ),
        ],
      ),
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        backgroundColor: ForgeColors.surface50,
        indicatorColor: ForgeColors.surface300,
        onDestinationSelected: (index) {
          if (index == 1) {
            void _() => _openReviews();
            _();
            return;
          }
          setState(() => _tab = index);
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.today_outlined),
            selectedIcon: Icon(Icons.today),
            label: 'Today',
          ),
          NavigationDestination(
            icon: Icon(Icons.refresh_outlined),
            label: 'Review',
          ),
          NavigationDestination(
            icon: Icon(Icons.record_voice_over_outlined),
            selectedIcon: Icon(Icons.record_voice_over),
            label: 'Interview',
          ),
          NavigationDestination(
            icon: Icon(Icons.insights_outlined),
            selectedIcon: Icon(Icons.insights),
            label: 'Progress',
          ),
        ],
      ),
    );
  }
}
