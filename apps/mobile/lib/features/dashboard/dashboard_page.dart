import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';

/// The mobile dashboard (§4).
///
/// Scope is deliberately narrow: today's routine, review, progress. Coding
/// exercises are surfaced for reading and started on the web — reproducing the
/// desktop IDE on a phone in v1 would be a worse version of both.
class DashboardPage extends StatefulWidget {
  const DashboardPage({required this.api, super.key});

  final ApiClient api;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  late Future<DashboardOverview> _overview;

  @override
  void initState() {
    super.initState();
    _overview = _load();
  }

  Future<DashboardOverview> _load() async {
    final json = await widget.api.get<Map<String, dynamic>>('/progress/overview');
    return DashboardOverview.fromJson(json);
  }

  Future<void> _refresh() async {
    setState(() => _overview = _load());
    await _overview;
  }

  @override
  Widget build(BuildContext context) {
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
      ),
      body: FutureBuilder<DashboardOverview>(
        future: _overview,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return _ErrorState(error: snapshot.error, onRetry: _refresh);
          }

          final data = snapshot.data;
          if (data == null) return const SizedBox.shrink();

          return RefreshIndicator(
            onRefresh: _refresh,
            color: ForgeColors.forge,
            backgroundColor: ForgeColors.surface200,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: [
                Text(data.greeting, style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 16),
                IndependenceCard(score: data.independence),
                const SizedBox(height: 12),
                _TodayCard(done: data.todayMinutesDone, target: data.todayMinutesTarget),
                if (data.nextAction != null) ...[
                  const SizedBox(height: 12),
                  _NextActionCard(action: data.nextAction!),
                ],
                if (data.weakestSkills.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _WeakestCard(skills: data.weakestSkills),
                ],
                const SizedBox(height: 24),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// The headline number.
///
/// Shows a dash and a progress count when there is not enough evidence.
/// Telling a new user they are at 12% would be both wrong and demoralising.
class IndependenceCard extends StatelessWidget {
  const IndependenceCard({required this.score, super.key});

  final IndependenceScore score;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('INDEPENDENT CODING', style: Theme.of(context).textTheme.labelSmall),
            const SizedBox(height: 8),
            if (!score.hasEnoughData) ...[
              const Text(
                '—',
                style: TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w700,
                  color: ForgeColors.ink500,
                ),
              ),
              Text(
                '${score.attemptsConsidered} of 5 attempts needed',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ] else ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    '${(score.score! * 100).round()}%',
                    style: const TextStyle(
                      fontSize: 34,
                      fontWeight: FontWeight.w700,
                      color: ForgeColors.forge,
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (score.deltaFromPreviousWindow != null &&
                      score.deltaFromPreviousWindow != 0)
                    Text(
                      '${score.deltaFromPreviousWindow! > 0 ? '+' : ''}'
                      '${score.deltaFromPreviousWindow!.toStringAsFixed(1)}',
                      style: TextStyle(
                        fontSize: 14,
                        color: score.deltaFromPreviousWindow! > 0
                            ? ForgeColors.pass
                            : ForgeColors.fail,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(3),
                child: LinearProgressIndicator(value: score.score, minHeight: 4),
              ),
              const SizedBox(height: 6),
              Text(
                'Last ${score.windowDays} days · ${score.attemptsConsidered} attempts',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.done, required this.target});

  final int done;
  final int target;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('TODAY', style: Theme.of(context).textTheme.labelSmall),
            const SizedBox(height: 8),
            Text(
              '$done / $target min',
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w600,
                color: ForgeColors.ink100,
              ),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: target == 0 ? 0 : (done / target).clamp(0.0, 1.0),
                minHeight: 4,
                color: ForgeColors.ink300,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NextActionCard extends StatelessWidget {
  const _NextActionCard({required this.action});

  final NextAction action;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('NEXT', style: Theme.of(context).textTheme.labelSmall),
            const SizedBox(height: 8),
            Text(action.title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            // The rationale is always shown: an opaque recommendation is not a
            // trusted one.
            Text(action.rationale, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 12),
            if (action.requiresDesktop)
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: ForgeColors.surface200,
                  borderRadius: BorderRadius.circular(6),
                  border: const Border(
                    left: BorderSide(color: ForgeColors.forge, width: 2),
                  ),
                ),
                child: Text(
                  'Open ForgeRoutine on your computer to write this one. '
                  '${action.estimatedMinutes} min.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              )
            else
              FilledButton(
                onPressed: () {},
                child: Text('Start · ${action.estimatedMinutes} min'),
              ),
          ],
        ),
      ),
    );
  }
}

class _WeakestCard extends StatelessWidget {
  const _WeakestCard({required this.skills});

  final List<WeakSkill> skills;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('WEAKEST', style: Theme.of(context).textTheme.labelSmall),
            const SizedBox(height: 8),
            for (final skill in skills)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            skill.conceptName,
                            style: const TextStyle(
                              color: ForgeColors.ink200,
                              fontSize: 14,
                            ),
                          ),
                          Text(
                            skill.technologyName,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '${(skill.value * 100).round()}%',
                      style: const TextStyle(color: ForgeColors.fail, fontSize: 14),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.error, required this.onRetry});

  final Object? error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiException
        ? (error! as ApiException).toString()
        : 'Could not reach ForgeRoutine.';

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}
