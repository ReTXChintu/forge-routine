import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/routine_models.dart';

/// A recall prompt, shown as a bottom sheet.
///
/// **Where this appears is a product rule, not a presentation choice.** Only
/// at boundaries: after an item is finished, or when the user opens reviews
/// deliberately. Never mid-task. An interruption while someone is working
/// destroys the state the product exists to build, and teaches them to
/// dismiss prompts unread — at which point the spaced-repetition data becomes
/// noise and every schedule built on it is wrong.
Future<void> showRecallPrompt(
  BuildContext context, {
  required ApiClient api,
  required RecallPrompt prompt,
}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: ForgeColors.surface50,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
    ),
    builder: (_) => _RecallSheet(api: api, prompt: prompt),
  );
}

class _RecallSheet extends StatefulWidget {
  const _RecallSheet({required this.api, required this.prompt});

  final ApiClient api;
  final RecallPrompt prompt;

  @override
  State<_RecallSheet> createState() => _RecallSheetState();
}

class _RecallSheetState extends State<_RecallSheet> {
  int? _selected;
  RecallAnswer? _result;
  bool _busy = false;

  Future<void> _answer(int index) async {
    if (_busy || _result != null) return;

    setState(() {
      _selected = index;
      _busy = true;
    });

    try {
      final json = await widget.api.post<Map<String, dynamic>>(
        '/recall/answer',
        body: {'questionId': widget.prompt.id, 'selectedIndex': index},
      );
      if (mounted) setState(() => _result = RecallAnswer.fromJson(json));
    } on ApiException {
      if (mounted) setState(() => _selected = null);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: ForgeColors.surface300,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text(
                  'Recall',
                  style: TextStyle(fontSize: 11, color: ForgeColors.ink300),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${widget.prompt.technologyName} · ${widget.prompt.conceptName}',
                  style: const TextStyle(fontSize: 11, color: ForgeColors.ink500),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          Text(
            widget.prompt.prompt,
            style: const TextStyle(fontSize: 15, color: ForgeColors.ink100, height: 1.5),
          ),
          const SizedBox(height: 18),

          for (var index = 0; index < widget.prompt.options.length; index += 1)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _Option(
                label: widget.prompt.options[index],
                // Nothing is coloured until an answer is committed, so the
                // right option cannot be read off the styling.
                state: result == null
                    ? _OptionState.pending
                    : result.correctIndex == index
                        ? _OptionState.correct
                        : _selected == index
                            ? _OptionState.wrong
                            : _OptionState.neutral,
                busy: _busy && _selected == index,
                onTap: () => _answer(index),
              ),
            ),

          if (result != null) ...[
            const SizedBox(height: 10),
            const Divider(color: ForgeColors.surface300, height: 24),
            // Shown either way. Being right for the wrong reason is still
            // worth correcting, and the explanation is where the learning is.
            Text(
              result.explanation,
              style: const TextStyle(fontSize: 13, color: ForgeColors.ink200, height: 1.6),
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Next review ${_describeDue(result.nextDueAt)}',
                  style: const TextStyle(fontSize: 11, color: ForgeColors.ink500),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Continue'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

enum _OptionState { pending, correct, wrong, neutral }

class _Option extends StatelessWidget {
  const _Option({
    required this.label,
    required this.state,
    required this.busy,
    required this.onTap,
  });

  final String label;
  final _OptionState state;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final border = switch (state) {
      _OptionState.correct => ForgeColors.pass,
      _OptionState.wrong => ForgeColors.fail,
      _ => ForgeColors.surface400,
    };

    return InkWell(
      onTap: state == _OptionState.pending ? onTap : null,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            if (state == _OptionState.correct)
              const Icon(Icons.check, size: 16, color: ForgeColors.pass),
            if (state == _OptionState.wrong)
              const Icon(Icons.close, size: 16, color: ForgeColors.fail),
            if (busy)
              const SizedBox(
                height: 14,
                width: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            if (state != _OptionState.pending || busy) const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  color: state == _OptionState.neutral
                      ? ForgeColors.ink500
                      : ForgeColors.ink100,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _describeDue(DateTime due) {
  final days = due.difference(DateTime.now()).inDays;
  if (days <= 0) return 'today';
  if (days == 1) return 'tomorrow';
  if (days < 30) return 'in $days days';
  return 'in ${(days / 30).round()} months';
}
