import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/voice.dart';
import '../../data/api_client.dart';
import '../../data/routine_models.dart';

/// A live interview on mobile, typed or spoken (§15-16).
///
/// Deliberately bare: one question, one box, no scores, no countdown to a
/// grade. Feedback between turns would turn this into a tutorial, and the
/// user would start answering for approval rather than saying what they
/// actually think — which is the one thing an interview is for.
///
/// The phone is arguably the *better* device for this. An interview is
/// spoken, and dictating an answer while walking is far closer to the real
/// thing than typing one at a desk with a backspace key.
class InterviewSessionPage extends StatefulWidget {
  const InterviewSessionPage({
    required this.api,
    required this.interviewId,
    this.voice,
    super.key,
  });

  final ApiClient api;
  final String interviewId;

  /// Injected so the screen is testable without a microphone.
  final VoiceInput? voice;

  @override
  State<InterviewSessionPage> createState() => _InterviewSessionPageState();
}

class _InterviewSessionPageState extends State<InterviewSessionPage> {
  late final VoiceInput _voice = widget.voice ?? PlatformVoiceInput();
  final _controller = TextEditingController();
  final _scroll = ScrollController();

  Interview? _interview;
  InterviewReport? _report;
  bool _busy = false;
  bool _voiceReady = false;
  bool _listening = false;
  String? _error;

  /// What was typed before dictation started, so speech appends rather than
  /// replacing an answer the user had already begun.
  String _textBeforeDictation = '';

  @override
  void initState() {
    super.initState();
    _load();
    _voice.prepare().then((ready) {
      if (mounted) setState(() => _voiceReady = ready);
    });
  }

  @override
  void dispose() {
    _voice.stop();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final json = await widget.api.get<Map<String, dynamic>>(
        '/interviews/${widget.interviewId}',
      );
      if (!mounted) return;

      final interview = Interview.fromJson(json);
      setState(() => _interview = interview);
      if (interview.isFinished) await _loadReport();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _loadReport() async {
    try {
      final json = await widget.api.get<Map<String, dynamic>>(
        '/interviews/${widget.interviewId}/report',
      );
      if (mounted) setState(() => _report = InterviewReport.fromJson(json));
    } on ApiException {
      // A missing report is not worth an error screen: the transcript above
      // is still the useful part.
    }
  }

  Future<void> _send() async {
    final interview = _interview;
    final questionId = interview?.currentQuestionId;
    final text = _controller.text.trim();

    if (interview == null || questionId == null || text.isEmpty || _busy) return;

    await _stopDictation();
    setState(() {
      _busy = true;
      _error = null;
    });
    _controller.clear();

    try {
      final json = await widget.api.post<Map<String, dynamic>>(
        '/interviews/${interview.id}/answer',
        body: {'questionId': questionId, 'text': text},
      );
      if (!mounted) return;

      final next = Interview.fromJson(json);
      setState(() => _interview = next);
      if (next.isFinished) await _loadReport();
      _scrollToEnd();
    } on ApiException catch (error) {
      if (mounted) {
        // Put the answer back. Losing what someone just said because the
        // network dropped is the worst possible moment to lose it.
        _controller.text = text;
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _end() async {
    setState(() => _busy = true);
    try {
      final json = await widget.api.post<Map<String, dynamic>>(
        '/interviews/${widget.interviewId}/end',
      );
      if (!mounted) return;
      setState(() => _report = InterviewReport.fromJson(json));
      await _load();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleDictation() async {
    if (_listening) {
      await _stopDictation();
      return;
    }

    _textBeforeDictation = _controller.text;
    setState(() => _listening = true);

    await _voice.start((transcript) {
      if (!mounted) return;
      final prefix = _textBeforeDictation.isEmpty ? '' : '${_textBeforeDictation.trim()} ';
      _controller.value = TextEditingValue(
        text: '$prefix$transcript',
        selection: TextSelection.collapsed(offset: prefix.length + transcript.length),
      );
    });
  }

  Future<void> _stopDictation() async {
    if (!_listening) return;
    await _voice.stop();
    if (mounted) setState(() => _listening = false);
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final interview = _interview;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          interview == null ? 'Interview' : '${interview.mode.replaceAll('_', ' ')} interview',
        ),
        actions: [
          if (interview != null && !interview.isFinished)
            TextButton(
              onPressed: _busy ? null : _end,
              child: const Text('End', style: TextStyle(color: ForgeColors.ink400)),
            ),
        ],
      ),
      body: interview == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: ForgeColors.fail),
                      ),
                    ),
            )
          : Column(
              children: [
                Expanded(
                  child: ListView(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    children: [
                      for (final turn in interview.turns) _Turn(turn: turn),
                      if (_busy && !interview.isFinished)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Row(
                            children: [
                              SizedBox(
                                height: 12,
                                width: 12,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              ),
                              SizedBox(width: 10),
                              Text(
                                'Thinking about your answer…',
                                style: TextStyle(fontSize: 12, color: ForgeColors.ink500),
                              ),
                            ],
                          ),
                        ),
                      if (_report != null) _Debrief(report: _report!),
                    ],
                  ),
                ),
                if (!interview.isFinished) _composer(interview),
              ],
            ),
    );
  }

  Widget _composer(Interview interview) {
    return Container(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 12,
        bottom: MediaQuery.of(context).viewInsets.bottom + 12,
      ),
      decoration: const BoxDecoration(
        color: ForgeColors.surface50,
        border: Border(top: BorderSide(color: ForgeColors.surface300)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[
            Text(_error!, style: const TextStyle(color: ForgeColors.fail, fontSize: 12)),
            const SizedBox(height: 8),
          ],
          TextField(
            controller: _controller,
            minLines: 3,
            maxLines: 8,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              hintText: _listening
                  ? 'Listening — say it as you would out loud.'
                  : 'Answer as you would out loud.',
              hintStyle: TextStyle(
                color: _listening ? ForgeColors.forge : ForgeColors.ink500,
                fontSize: 13,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              if (_voiceReady)
                IconButton(
                  onPressed: _busy ? null : _toggleDictation,
                  icon: Icon(_listening ? Icons.stop_circle_outlined : Icons.mic_none),
                  color: _listening ? ForgeColors.forge : ForgeColors.ink400,
                  tooltip: _listening ? 'Stop dictating' : 'Dictate your answer',
                ),
              Expanded(
                child: Text(
                  // Said plainly, because asking for a microphone deserves a
                  // plain answer about what happens to the audio.
                  _voiceReady
                      ? 'Dictation runs on your device. Only the text is sent.'
                      : 'Nothing is graded in front of you — the debrief comes at the end.',
                  style: const TextStyle(fontSize: 11, color: ForgeColors.ink500),
                ),
              ),
              FilledButton(
                onPressed: _busy ? null : _send,
                child: const Text('Send'),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Up to ${interview.turnsRemaining} questions left.',
            style: const TextStyle(fontSize: 11, color: ForgeColors.ink500),
          ),
        ],
      ),
    );
  }
}

class _Turn extends StatelessWidget {
  const _Turn({required this.turn});

  final InterviewTurn turn;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (turn.conceptName != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: Text(
                turn.conceptName!.toUpperCase(),
                style: const TextStyle(
                  fontSize: 10,
                  letterSpacing: 0.7,
                  color: ForgeColors.ink500,
                ),
              ),
            ),
          Text(
            turn.prompt,
            style: const TextStyle(fontSize: 15, color: ForgeColors.ink100, height: 1.55),
          ),
          if (turn.answer != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.only(left: 12),
              decoration: const BoxDecoration(
                border: Border(left: BorderSide(color: ForgeColors.surface400, width: 2)),
              ),
              child: Text(
                turn.answer!,
                style: const TextStyle(
                  fontSize: 14,
                  color: ForgeColors.ink300,
                  height: 1.55,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Debrief extends StatelessWidget {
  const _Debrief({required this.report});

  final InterviewReport report;

  @override
  Widget build(BuildContext context) {
    // Only dimensions the interview actually tested. The rest are omitted
    // rather than shown at zero: a zero gets acted on as "bad at this" when
    // the truth is "never asked about this".
    final scored = report.dimensions.entries
        .where((entry) => entry.value != null)
        .map((entry) => MapEntry(entry.key, entry.value!))
        .toList();

    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.only(top: 20),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: ForgeColors.surface300)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Text(
                'Debrief',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: ForgeColors.ink100,
                ),
              ),
              if (report.overallScore != null)
                Text(
                  '${(report.overallScore! * 100).round()}%',
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: ForgeColors.forge,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),

          if (report.degraded)
            const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: Text(
                'This debrief is the arithmetic only — the written review could not be '
                'generated.',
                style: TextStyle(fontSize: 12, color: ForgeColors.warn, height: 1.5),
              ),
            ),

          if (report.summary != null)
            Text(
              report.summary!,
              style: const TextStyle(fontSize: 14, color: ForgeColors.ink200, height: 1.6),
            ),

          if (scored.isNotEmpty) ...[
            const SizedBox(height: 20),
            const _Label('Scored'),
            for (final entry in scored)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    SizedBox(
                      width: 130,
                      child: Text(
                        _humanise(entry.key),
                        style: const TextStyle(fontSize: 11, color: ForgeColors.ink400),
                      ),
                    ),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(99),
                        child: LinearProgressIndicator(
                          value: entry.value,
                          minHeight: 4,
                          backgroundColor: ForgeColors.surface300,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            entry.value >= 0.7
                                ? ForgeColors.pass
                                : entry.value >= 0.45
                                    ? ForgeColors.warn
                                    : ForgeColors.fail,
                          ),
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 34,
                      child: Text(
                        '${(entry.value * 100).round()}',
                        textAlign: TextAlign.right,
                        style: const TextStyle(fontSize: 11, color: ForgeColors.ink400),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            const Text(
              'Dimensions this interview did not test are left out, not scored zero.',
              style: TextStyle(fontSize: 11, color: ForgeColors.ink500, height: 1.5),
            ),
          ],

          if (report.strongAreas.isNotEmpty) ...[
            const SizedBox(height: 20),
            const _Label('Held up'),
            for (final area in report.strongAreas) _Bullet(area),
          ],

          if (report.weakAreas.isNotEmpty) ...[
            const SizedBox(height: 20),
            const _Label('Did not'),
            for (final area in report.weakAreas) _Bullet(area),
          ],

          if (report.recommendedTopics.isNotEmpty) ...[
            const SizedBox(height: 20),
            const _Label('Study next'),
            Text(
              report.recommendedTopics.join(' · '),
              style: const TextStyle(fontSize: 13, color: ForgeColors.ink300, height: 1.6),
            ),
          ],
        ],
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
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

class _Bullet extends StatelessWidget {
  const _Bullet(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(
        '· $text',
        style: const TextStyle(fontSize: 13, color: ForgeColors.ink200, height: 1.5),
      ),
    );
  }
}

String _humanise(String dimension) {
  final spaced = dimension.replaceAllMapped(
    RegExp('([A-Z])'),
    (match) => ' ${match[1]}',
  );
  return spaced.isEmpty ? spaced : spaced[0].toUpperCase() + spaced.substring(1).trim();
}
