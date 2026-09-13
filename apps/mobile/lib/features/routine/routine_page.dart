import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/routine_models.dart';
import '../recall/recall_sheet.dart';

/// Today's routine on mobile (§20).
///
/// The same slice of the roadmap the web app shows, with the same rules: due
/// reviews first, every item carries the reason it is there, and the list is
/// never padded to fill the time.
///
/// What is different is what you can finish here. Reading, recall and review
/// work on a phone. Writing code does not, so those items are shown with
/// their rationale and marked as desk work rather than opening an editor
/// nobody can use one-handed (§4).
class RoutinePage extends StatefulWidget {
  const RoutinePage({required this.api, super.key});

  final ApiClient api;

  @override
  State<RoutinePage> createState() => _RoutinePageState();
}

class _RoutinePageState extends State<RoutinePage> {
  late Future<Routine?> _routine;

  @override
  void initState() {
    super.initState();
    _routine = _load();
  }

  Future<Routine?> _load() async {
    final json = await widget.api.get<Map<String, dynamic>?>('/routines/today');
    // An empty body means no routine generated yet, not an empty routine.
    if (json == null || json.isEmpty) return null;
    return Routine.fromJson(json);
  }

  Future<void> _refresh() async {
    setState(() => _routine = _load());
    await _routine;
  }

  Future<void> _generate({bool force = false}) async {
    final json = await widget.api.post<Map<String, dynamic>>(
      force ? '/routines/regenerate' : '/routines/generate',
    );
    if (mounted) setState(() => _routine = Future.value(Routine.fromJson(json)));
  }

  /// Completing an item is a boundary, which is the one safe moment to ask a
  /// recall question.
  Future<void> _complete(RoutineItem item) async {
    await widget.api.patch<Map<String, dynamic>>(
      '/routines/items/${item.id}',
      body: {'status': 'DONE'},
    );

    if (!mounted) return;
    await _refresh();
    if (!mounted) return;

    final due = await widget.api.get<List<dynamic>>('/recall/due');
    if (!mounted || due.isEmpty) return;

    await showRecallPrompt(
      context,
      api: widget.api,
      prompt: RecallPrompt.fromJson(due.first as Map<String, dynamic>),
    );
  }

  Future<void> _skip(RoutineItem item) async {
    await widget.api.patch<Map<String, dynamic>>(
      '/routines/items/${item.id}',
      body: {'status': 'SKIPPED'},
    );
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _refresh,
      color: ForgeColors.forge,
      backgroundColor: ForgeColors.surface100,
      child: FutureBuilder<Routine?>(
        future: _routine,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return _Message(
              title: 'Could not load today',
              body: '${snapshot.error}',
              action: 'Try again',
              onAction: _refresh,
            );
          }

          final routine = snapshot.data;
          if (routine == null) {
            return _Message(
              title: 'Nothing planned yet',
              body: "Today's work is a slice of your roadmap, weighted towards "
                  'anything due for review.',
              action: 'Plan today',
              onAction: _generate,
            );
          }

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
            children: [
              _Header(routine: routine, onReplan: () => _generate(force: true)),
              const SizedBox(height: 16),
              for (final item in routine.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _ItemCard(
                    item: item,
                    onComplete: () => _complete(item),
                    onSkip: () => _skip(item),
                  ),
                ),
              if (routine.isFinished) ...[
                const SizedBox(height: 24),
                const Text(
                  'That is today’s work done.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: ForgeColors.ink300, fontSize: 14),
                ),
                const SizedBox(height: 4),
                // No confetti and no streak counter. Finishing is the reward;
                // a celebration loop trains people to chase the animation.
                const Text(
                  'Stopping here is the right call — tomorrow’s spacing depends on it.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: ForgeColors.ink500, fontSize: 12, height: 1.5),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.routine, required this.onReplan});

  final Routine routine;
  final VoidCallback onReplan;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Today',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: ForgeColors.ink100,
              ),
            ),
            TextButton(
              onPressed: onReplan,
              child: const Text('Replan', style: TextStyle(color: ForgeColors.ink500)),
            ),
          ],
        ),
        Text(
          '${routine.completedMinutes} of ${routine.totalMinutes} minutes'
          '${routine.recallDue > 0 ? ' · ${routine.recallDue} due for review' : ''}',
          style: const TextStyle(fontSize: 13, color: ForgeColors.ink400),
        ),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: LinearProgressIndicator(
            value: routine.progress,
            minHeight: 4,
            backgroundColor: ForgeColors.surface200,
            valueColor: AlwaysStoppedAnimation<Color>(
              routine.progress >= 1 ? ForgeColors.pass : ForgeColors.forge,
            ),
          ),
        ),
      ],
    );
  }
}

const _kindLabels = <String, String>{
  'LEARN': 'Read',
  'RECALL': 'Recall',
  'CODE': 'Write',
  'BLIND_CODE': 'Blind',
  'DEBUG': 'Debug',
  'EXPLAIN': 'Explain',
  'PROJECT': 'Project',
  'CHECKPOINT': 'Checkpoint',
  'REVIEW': 'Review',
  'INTERVIEW': 'Interview',
};

class _ItemCard extends StatelessWidget {
  const _ItemCard({required this.item, required this.onComplete, required this.onSkip});

  final RoutineItem item;
  final VoidCallback onComplete;
  final VoidCallback onSkip;

  @override
  Widget build(BuildContext context) {
    final settled = item.isDone || item.isSkipped;

    return Opacity(
      opacity: settled ? 0.5 : 1,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: item.isDone ? Colors.transparent : ForgeColors.surface50,
          border: Border.all(color: ForgeColors.surface300),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: item.kind == 'REVIEW'
                        ? ForgeColors.surface300
                        : ForgeColors.surface200,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    _kindLabels[item.kind] ?? item.kind,
                    style: const TextStyle(fontSize: 10, color: ForgeColors.ink300),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    item.title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: ForgeColors.ink100,
                      decoration: settled ? TextDecoration.lineThrough : null,
                    ),
                  ),
                ),
                Text(
                  '${item.minutes}m',
                  style: const TextStyle(fontSize: 11, color: ForgeColors.ink500),
                ),
              ],
            ),
            const SizedBox(height: 6),
            // The reason is always shown. An opaque routine is not a trusted
            // one, and that matters more on a phone where there is no room to
            // go and check the roadmap.
            Text(
              item.rationale,
              style: const TextStyle(fontSize: 12, color: ForgeColors.ink400, height: 1.4),
            ),

            if (item.requiresDesktop && !settled) ...[
              const SizedBox(height: 8),
              const Row(
                children: [
                  Icon(Icons.desktop_windows_outlined, size: 13, color: ForgeColors.ink500),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Writing code happens at a desk. Open this on the web.',
                      style: TextStyle(fontSize: 11, color: ForgeColors.ink500),
                    ),
                  ),
                ],
              ),
            ],

            if (!settled) ...[
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: onSkip,
                    child: const Text(
                      'Skip',
                      style: TextStyle(color: ForgeColors.ink500, fontSize: 13),
                    ),
                  ),
                  const SizedBox(width: 4),
                  TextButton(
                    onPressed: onComplete,
                    child: const Text('Done', style: TextStyle(fontSize: 13)),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.title,
    required this.body,
    required this.action,
    required this.onAction,
  });

  final String title;
  final String body;
  final String action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    // Inside a ListView so pull-to-refresh still works on an empty screen.
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 80),
      children: [
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            color: ForgeColors.ink100,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          body,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 13, color: ForgeColors.ink400, height: 1.6),
        ),
        const SizedBox(height: 24),
        Center(child: FilledButton(onPressed: onAction, child: Text(action))),
      ],
    );
  }
}
