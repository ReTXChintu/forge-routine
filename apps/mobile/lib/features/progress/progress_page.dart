import 'package:flutter/material.dart';

import '../../core/notifications.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';

/// Progress, and the one setting mobile owns.
///
/// The independence score leads because it is the number this product exists
/// to move: whether the user can write code without help. Everything else on
/// this screen is context for it.
///
/// `INSUFFICIENT_DATA` renders as a dash and an explanation, never as 0%. A
/// score we did not earn is a lie the user will act on.
class ProgressPage extends StatefulWidget {
  const ProgressPage({required this.api, required this.reminders, super.key});

  final ApiClient api;
  final RoutineReminders reminders;

  @override
  State<ProgressPage> createState() => _ProgressPageState();
}

class _ProgressPageState extends State<ProgressPage> {
  late Future<(IndependenceScore, List<WeakSkill>)> _data;

  bool _remindersOn = false;
  TimeOfDay _reminderAt = const TimeOfDay(hour: 19, minute: 0);

  @override
  void initState() {
    super.initState();
    _data = _load();
  }

  Future<(IndependenceScore, List<WeakSkill>)> _load() async {
    final independence =
        await widget.api.get<Map<String, dynamic>>('/progress/independence');
    final weakest = await widget.api.get<List<dynamic>>('/skills/weakest');

    return (
      IndependenceScore.fromJson(independence),
      weakest.map((dynamic e) => WeakSkill.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<void> _refresh() async {
    setState(() => _data = _load());
    await _data;
  }

  Future<void> _toggleReminders(bool value) async {
    if (!value) {
      await widget.reminders.cancelDaily();
      setState(() => _remindersOn = false);
      return;
    }

    // Asked for here rather than at launch, where the user has no context
    // for why and simply declines.
    final granted = await widget.reminders.requestPermission();
    if (!granted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Notifications are off in system settings.')),
        );
      }
      return;
    }

    await widget.reminders.scheduleDaily(
      hour: _reminderAt.hour,
      minute: _reminderAt.minute,
    );
    if (mounted) setState(() => _remindersOn = true);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: _reminderAt);
    if (picked == null) return;

    setState(() => _reminderAt = picked);
    if (_remindersOn) {
      await widget.reminders.scheduleDaily(hour: picked.hour, minute: picked.minute);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _refresh,
      color: ForgeColors.forge,
      backgroundColor: ForgeColors.surface100,
      child: FutureBuilder<(IndependenceScore, List<WeakSkill>)>(
        future: _data,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (!snapshot.hasData) {
            return ListView(
              padding: const EdgeInsets.all(32),
              children: [
                Text(
                  '${snapshot.error}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: ForgeColors.fail, fontSize: 13),
                ),
              ],
            );
          }

          final (independence, weakest) = snapshot.data!;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
            children: [
              _IndependenceCard(score: independence),

              if (weakest.isNotEmpty) ...[
                const SizedBox(height: 24),
                const _SectionLabel('Weakest right now'),
                for (final skill in weakest)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                skill.conceptName,
                                style: const TextStyle(
                                  fontSize: 13,
                                  color: ForgeColors.ink200,
                                ),
                              ),
                              Text(
                                skill.technologyName,
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: ForgeColors.ink500,
                                ),
                              ),
                            ],
                          ),
                        ),
                        SizedBox(
                          width: 90,
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(99),
                            child: LinearProgressIndicator(
                              value: skill.value,
                              minHeight: 4,
                              backgroundColor: ForgeColors.surface300,
                              valueColor: const AlwaysStoppedAnimation<Color>(
                                ForgeColors.warn,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],

              const SizedBox(height: 28),
              const _SectionLabel('Reminders'),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _remindersOn,
                onChanged: _toggleReminders,
                activeThumbColor: ForgeColors.forge,
                title: const Text(
                  'Daily reminder',
                  style: TextStyle(fontSize: 14, color: ForgeColors.ink100),
                ),
                subtitle: const Text(
                  // Said plainly, because most apps do the opposite.
                  'One a day, and never a streak. Missing it costs nothing — the '
                  'review schedule already allows for gaps.',
                  style: TextStyle(fontSize: 11, color: ForgeColors.ink500, height: 1.5),
                ),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                onTap: _pickTime,
                title: const Text(
                  'Remind me at',
                  style: TextStyle(fontSize: 14, color: ForgeColors.ink100),
                ),
                trailing: Text(
                  _reminderAt.format(context),
                  style: const TextStyle(fontSize: 14, color: ForgeColors.forge),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _IndependenceCard extends StatelessWidget {
  const _IndependenceCard({required this.score});

  final IndependenceScore score;

  @override
  Widget build(BuildContext context) {
    final delta = score.deltaFromPreviousWindow;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ForgeColors.surface50,
        border: Border.all(color: ForgeColors.surface300),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Independent Coding Score',
            style: TextStyle(fontSize: 12, color: ForgeColors.ink400),
          ),
          const SizedBox(height: 8),

          if (score.hasEnoughData) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  '${(score.score! * 100).round()}',
                  style: const TextStyle(
                    fontSize: 40,
                    fontWeight: FontWeight.w700,
                    color: ForgeColors.forge,
                    height: 1,
                  ),
                ),
                const SizedBox(width: 8),
                if (delta != null)
                  Text(
                    '${delta >= 0 ? '+' : ''}${(delta * 100).round()} vs last month',
                    style: TextStyle(
                      fontSize: 12,
                      color: delta >= 0 ? ForgeColors.pass : ForgeColors.warn,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'From ${score.attemptsConsidered} attempts over ${score.windowDays} days.',
              style: const TextStyle(fontSize: 11, color: ForgeColors.ink500),
            ),
          ] else ...[
            const Text(
              '—',
              style: TextStyle(
                fontSize: 40,
                fontWeight: FontWeight.w700,
                color: ForgeColors.ink500,
                height: 1,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Not enough attempts yet (${score.attemptsConsidered} so far). '
              'A score from three attempts would move on every submission and '
              'mean nothing.',
              style: const TextStyle(
                fontSize: 11,
                color: ForgeColors.ink500,
                height: 1.5,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 10,
          letterSpacing: 0.8,
          fontWeight: FontWeight.w600,
          color: ForgeColors.ink500,
        ),
      ),
    );
  }
}
