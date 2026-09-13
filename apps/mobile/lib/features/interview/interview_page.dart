import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/routine_models.dart';
import 'interview_session_page.dart';

/// The interview tab: the readiness guide, and a way to start one.
///
/// The guide answers "if the interview were tomorrow, where would I be caught
/// out". It is ordered by preparation value — shaky, then weak, then
/// untouched, with what you already know last, because rereading that is the
/// most comfortable way to waste the time you have left.
class InterviewPage extends StatefulWidget {
  const InterviewPage({required this.api, super.key});

  final ApiClient api;

  @override
  State<InterviewPage> createState() => _InterviewPageState();
}

class _InterviewPageState extends State<InterviewPage> {
  late Future<(InterviewGuide, List<InterviewSummary>)> _data;

  String _mode = 'QUICK';
  bool _starting = false;

  @override
  void initState() {
    super.initState();
    _data = _load();
  }

  Future<(InterviewGuide, List<InterviewSummary>)> _load() async {
    final guide = await widget.api.get<Map<String, dynamic>>('/interviews/guide');
    final history = await widget.api.get<List<dynamic>>('/interviews');

    return (
      InterviewGuide.fromJson(guide),
      history
          .map((dynamic e) => InterviewSummary.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<void> _refresh() async {
    setState(() => _data = _load());
    await _data;
  }

  Future<void> _start() async {
    if (_starting) return;
    setState(() => _starting = true);

    try {
      final json = await widget.api.post<Map<String, dynamic>>(
        '/interviews',
        body: {'mode': _mode, 'targetLevel': 'MID'},
      );
      if (!mounted) return;

      await _open(Interview.fromJson(json).id);
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _open(String interviewId) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => InterviewSessionPage(api: widget.api, interviewId: interviewId),
      ),
    );
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _refresh,
      color: ForgeColors.forge,
      backgroundColor: ForgeColors.surface100,
      child: FutureBuilder<(InterviewGuide, List<InterviewSummary>)>(
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

          final (guide, history) = snapshot.data!;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
            children: [
              _ReadinessCard(
                guide: guide,
                mode: _mode,
                starting: _starting,
                onModeChanged: (mode) => setState(() => _mode = mode),
                onStart: _start,
              ),

              if (guide.priorities.isNotEmpty) ...[
                const SizedBox(height: 24),
                const _SectionLabel('Fix these first'),
                for (var index = 0; index < guide.priorities.length; index += 1)
                  _PriorityRow(index: index + 1, priority: guide.priorities[index]),
              ],

              if (guide.recurringWeaknesses.isNotEmpty) ...[
                const SizedBox(height: 24),
                const _SectionLabel('Came up more than once'),
                const Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: Text(
                    'Weaknesses two or more past interviews agreed on. '
                    'One interview is an off day; two is a pattern.',
                    style: TextStyle(fontSize: 11, color: ForgeColors.ink500, height: 1.5),
                  ),
                ),
                for (final weakness in guide.recurringWeaknesses)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      '· $weakness',
                      style: const TextStyle(
                        fontSize: 13,
                        color: ForgeColors.ink200,
                        height: 1.5,
                      ),
                    ),
                  ),
              ],

              if (history.isNotEmpty) ...[
                const SizedBox(height: 24),
                const _SectionLabel('Past interviews'),
                for (final interview in history)
                  _HistoryRow(interview: interview, onTap: () => _open(interview.id)),
              ],
            ],
          );
        },
      ),
    );
  }
}

const _modes = <String, String>{
  'QUICK': 'Quick · 3 areas',
  'TECHNICAL': 'Technical · 4 areas',
  'SYSTEM_DESIGN': 'System design · deep',
  'SENIOR': 'Senior · 5 areas, deep',
};

class _ReadinessCard extends StatelessWidget {
  const _ReadinessCard({
    required this.guide,
    required this.mode,
    required this.starting,
    required this.onModeChanged,
    required this.onStart,
  });

  final InterviewGuide guide;
  final String mode;
  final bool starting;
  final ValueChanged<String> onModeChanged;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ForgeColors.surface50,
        border: Border.all(color: ForgeColors.surface300),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (guide.overallReadiness != null) ...[
            Text(
              '${(guide.overallReadiness! * 100).round()}%',
              style: const TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w700,
                color: ForgeColors.forge,
                height: 1,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'weighted readiness',
              style: TextStyle(fontSize: 11, color: ForgeColors.ink500),
            ),
          ] else ...[
            const Text(
              'Not enough yet',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: ForgeColors.ink300,
              ),
            ),
            const SizedBox(height: 4),
            // Refusing to give a number is the honest answer, and saying why
            // stops it reading as a bug.
            const Text(
              'A number from two practised concepts would be a guess.',
              style: TextStyle(fontSize: 11, color: ForgeColors.ink500, height: 1.5),
            ),
          ],

          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: mode,
            isDense: true,
            dropdownColor: ForgeColors.surface100,
            style: const TextStyle(fontSize: 13, color: ForgeColors.ink100),
            items: [
              for (final entry in _modes.entries)
                DropdownMenuItem<String>(value: entry.key, child: Text(entry.value)),
            ],
            onChanged: (value) => value == null ? null : onModeChanged(value),
          ),
          const SizedBox(height: 10),
          FilledButton(
            onPressed: starting ? null : onStart,
            child: starting
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Start interview'),
          ),
        ],
      ),
    );
  }
}

class _PriorityRow extends StatelessWidget {
  const _PriorityRow({required this.index, required this.priority});

  final int index;
  final GuidePriority priority;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: ForgeColors.surface300),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 20,
            child: Text(
              '$index',
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: ForgeColors.forge,
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  priority.title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: ForgeColors.ink100,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  priority.reason,
                  style: const TextStyle(
                    fontSize: 11,
                    color: ForgeColors.ink400,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.interview, required this.onTap});

  final InterviewSummary interview;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final score = interview.overallScore;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    interview.mode.replaceAll('_', ' '),
                    style: const TextStyle(fontSize: 13, color: ForgeColors.ink200),
                  ),
                  Text(
                    '${interview.startedAt.day}/${interview.startedAt.month} · '
                    '${interview.questionCount} questions',
                    style: const TextStyle(fontSize: 11, color: ForgeColors.ink500),
                  ),
                ],
              ),
            ),
            Text(
              score == null
                  ? (interview.status == 'IN_PROGRESS' ? 'unfinished' : '—')
                  : '${(score * 100).round()}%',
              style: TextStyle(
                fontSize: 13,
                color: score == null ? ForgeColors.ink500 : ForgeColors.ink200,
              ),
            ),
          ],
        ),
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
