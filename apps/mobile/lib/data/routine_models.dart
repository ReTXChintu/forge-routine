/// Read models for the routine, recall and interview screens (Phase 10).
///
/// Kept in a second file rather than growing `models.dart`: these mirror
/// endpoints the dashboard never touches, and one file per bounded area is
/// easier to keep honest than one file per app.
///
/// The rule from `models.dart` holds throughout: a `null` score means
/// *unscored* and renders as a dash, never as 0%. A number we did not earn is
/// a lie the user will act on.
library;

class RoutineItem {
  const RoutineItem({
    required this.id,
    required this.kind,
    required this.status,
    required this.minutes,
    required this.title,
    required this.rationale,
    this.conceptId,
    this.exerciseId,
  });

  factory RoutineItem.fromJson(Map<String, dynamic> json) => RoutineItem(
        id: json['id'] as String,
        kind: json['kind'] as String,
        status: json['status'] as String,
        minutes: json['minutes'] as int? ?? 0,
        title: json['title'] as String? ?? '',
        rationale: json['rationale'] as String? ?? '',
        conceptId: json['conceptId'] as String?,
        exerciseId: json['exerciseId'] as String?,
      );

  final String id;
  final String kind;
  final String status;
  final int minutes;
  final String title;
  final String rationale;
  final String? conceptId;
  final String? exerciseId;

  bool get isDone => status == 'DONE';
  bool get isSkipped => status == 'SKIPPED';

  /// Coding work is surfaced here and started on the web (§4).
  ///
  /// Reproducing the desktop editor on a phone would be a worse version of
  /// both. Reading the brief on the train and writing the code at a desk is
  /// the workflow this supports.
  bool get requiresDesktop =>
      kind == 'CODE' ||
      kind == 'BLIND_CODE' ||
      kind == 'DEBUG' ||
      kind == 'PROJECT' ||
      kind == 'CHECKPOINT';
}

class Routine {
  const Routine({
    required this.id,
    required this.date,
    required this.totalMinutes,
    required this.completedMinutes,
    required this.items,
    required this.recallDue,
  });

  factory Routine.fromJson(Map<String, dynamic> json) => Routine(
        id: json['id'] as String,
        date: DateTime.parse(json['date'] as String),
        totalMinutes: json['totalMinutes'] as int? ?? 0,
        completedMinutes: json['completedMinutes'] as int? ?? 0,
        items: (json['items'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => RoutineItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        recallDue: json['recallDue'] as int? ?? 0,
      );

  final String id;
  final DateTime date;
  final int totalMinutes;
  final int completedMinutes;
  final List<RoutineItem> items;
  final int recallDue;

  double get progress => totalMinutes == 0 ? 0 : completedMinutes / totalMinutes;

  bool get isFinished =>
      items.isNotEmpty && items.every((item) => item.isDone || item.isSkipped);
}

// -- Recall -------------------------------------------------------------------

class RecallPrompt {
  const RecallPrompt({
    required this.id,
    required this.conceptId,
    required this.conceptName,
    required this.technologyName,
    required this.prompt,
    required this.options,
  });

  factory RecallPrompt.fromJson(Map<String, dynamic> json) => RecallPrompt(
        id: json['id'] as String,
        conceptId: json['conceptId'] as String,
        conceptName: json['conceptName'] as String? ?? '',
        technologyName: json['technologyName'] as String? ?? '',
        prompt: json['prompt'] as String,
        options: (json['options'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => e as String)
            .toList(),
      );

  final String id;
  final String conceptId;
  final String conceptName;
  final String technologyName;
  final String prompt;

  /// Never carries the correct index. The client cannot mark its own homework.
  final List<String> options;
}

class RecallAnswer {
  const RecallAnswer({
    required this.correct,
    required this.correctIndex,
    required this.explanation,
    required this.nextDueAt,
  });

  factory RecallAnswer.fromJson(Map<String, dynamic> json) => RecallAnswer(
        correct: json['correct'] as bool? ?? false,
        correctIndex: json['correctIndex'] as int? ?? 0,
        explanation: json['explanation'] as String? ?? '',
        nextDueAt: DateTime.parse(json['nextDueAt'] as String),
      );

  final bool correct;
  final int correctIndex;
  final String explanation;
  final DateTime nextDueAt;
}

// -- Interview ----------------------------------------------------------------

class InterviewTurn {
  const InterviewTurn({
    required this.questionId,
    required this.prompt,
    this.conceptName,
    this.answer,
  });

  factory InterviewTurn.fromJson(Map<String, dynamic> json) => InterviewTurn(
        questionId: json['questionId'] as String,
        prompt: json['prompt'] as String,
        conceptName: json['conceptName'] as String?,
        answer: json['answer'] as String?,
      );

  final String questionId;
  final String prompt;
  final String? conceptName;
  final String? answer;
}

class Interview {
  const Interview({
    required this.id,
    required this.mode,
    required this.targetLevel,
    required this.status,
    required this.turns,
    required this.turnsRemaining,
    this.currentQuestionId,
    this.currentQuestion,
  });

  factory Interview.fromJson(Map<String, dynamic> json) {
    final current = json['currentQuestion'] as Map<String, dynamic>?;

    return Interview(
      id: json['id'] as String,
      mode: json['mode'] as String? ?? 'TECHNICAL',
      targetLevel: json['targetLevel'] as String? ?? 'MID',
      status: json['status'] as String? ?? 'IN_PROGRESS',
      turns: (json['turns'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => InterviewTurn.fromJson(e as Map<String, dynamic>))
          .toList(),
      turnsRemaining: json['turnsRemaining'] as int? ?? 0,
      currentQuestionId: current?['id'] as String?,
      currentQuestion: current?['prompt'] as String?,
    );
  }

  final String id;
  final String mode;
  final String targetLevel;
  final String status;
  final List<InterviewTurn> turns;
  final int turnsRemaining;
  final String? currentQuestionId;
  final String? currentQuestion;

  bool get isFinished => status != 'IN_PROGRESS';
}

class InterviewReport {
  const InterviewReport({
    required this.dimensions,
    required this.strongAreas,
    required this.weakAreas,
    required this.recommendedTopics,
    required this.degraded,
    this.overallScore,
    this.summary,
  });

  factory InterviewReport.fromJson(Map<String, dynamic> json) => InterviewReport(
        overallScore: (json['overallScore'] as num?)?.toDouble(),
        dimensions: (json['dimensions'] as Map<String, dynamic>? ?? <String, dynamic>{})
            .map((key, dynamic value) => MapEntry(key, (value as num?)?.toDouble())),
        strongAreas: _strings(json['strongAreas']),
        weakAreas: _strings(json['weakAreas']),
        recommendedTopics: _strings(json['recommendedTopics']),
        summary: json['summary'] as String?,
        degraded: json['degraded'] as bool? ?? false,
      );

  final double? overallScore;

  /// Dimensions the interview did not test come back null and are omitted
  /// from the UI entirely, rather than shown at zero.
  final Map<String, double?> dimensions;
  final List<String> strongAreas;
  final List<String> weakAreas;
  final List<String> recommendedTopics;
  final String? summary;

  /// True when the written review could not be generated and only the
  /// arithmetic is present. Said out loud rather than passed off as insight.
  final bool degraded;
}

class InterviewSummary {
  const InterviewSummary({
    required this.id,
    required this.mode,
    required this.status,
    required this.startedAt,
    required this.questionCount,
    this.overallScore,
  });

  factory InterviewSummary.fromJson(Map<String, dynamic> json) => InterviewSummary(
        id: json['id'] as String,
        mode: json['mode'] as String? ?? '',
        status: json['status'] as String? ?? '',
        startedAt: DateTime.parse(json['startedAt'] as String),
        questionCount: json['questionCount'] as int? ?? 0,
        overallScore: (json['overallScore'] as num?)?.toDouble(),
      );

  final String id;
  final String mode;
  final String status;
  final DateTime startedAt;
  final int questionCount;
  final double? overallScore;
}

// -- Interview guide ----------------------------------------------------------

class GuideTopic {
  const GuideTopic({
    required this.conceptId,
    required this.name,
    required this.status,
    required this.commonMistakes,
    this.readiness,
  });

  factory GuideTopic.fromJson(Map<String, dynamic> json) => GuideTopic(
        conceptId: json['conceptId'] as String,
        name: json['name'] as String? ?? '',
        status: json['status'] as String? ?? 'UNPRACTISED',
        readiness: (json['readiness'] as num?)?.toDouble(),
        commonMistakes: _strings(json['commonMistakes']),
      );

  final String conceptId;
  final String name;
  final String status;
  final double? readiness;
  final List<String> commonMistakes;
}

class GuideTechnology {
  const GuideTechnology({
    required this.technologyId,
    required this.name,
    required this.interviewImportance,
    required this.topics,
    this.readiness,
  });

  factory GuideTechnology.fromJson(Map<String, dynamic> json) => GuideTechnology(
        technologyId: json['technologyId'] as String,
        name: json['name'] as String? ?? '',
        interviewImportance: json['interviewImportance'] as int? ?? 3,
        readiness: (json['readiness'] as num?)?.toDouble(),
        topics: (json['topics'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => GuideTopic.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String technologyId;
  final String name;
  final int interviewImportance;
  final double? readiness;
  final List<GuideTopic> topics;
}

class GuidePriority {
  const GuidePriority({required this.title, required this.reason, this.conceptId});

  factory GuidePriority.fromJson(Map<String, dynamic> json) => GuidePriority(
        title: json['title'] as String? ?? '',
        reason: json['reason'] as String? ?? '',
        conceptId: json['conceptId'] as String?,
      );

  final String title;
  final String reason;
  final String? conceptId;
}

class InterviewGuide {
  const InterviewGuide({
    required this.technologies,
    required this.priorities,
    required this.recurringWeaknesses,
    required this.interviewsTaken,
    this.overallReadiness,
  });

  factory InterviewGuide.fromJson(Map<String, dynamic> json) => InterviewGuide(
        overallReadiness: (json['overallReadiness'] as num?)?.toDouble(),
        technologies: (json['technologies'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => GuideTechnology.fromJson(e as Map<String, dynamic>))
            .toList(),
        priorities: (json['priorities'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => GuidePriority.fromJson(e as Map<String, dynamic>))
            .toList(),
        recurringWeaknesses: _strings(json['recurringWeaknesses']),
        interviewsTaken: json['interviewsTaken'] as int? ?? 0,
      );

  /// Null below five practised concepts. One well-drilled concept is not 90%
  /// interview readiness, and the API declines to imply that it is.
  final double? overallReadiness;
  final List<GuideTechnology> technologies;
  final List<GuidePriority> priorities;
  final List<String> recurringWeaknesses;
  final int interviewsTaken;
}

List<String> _strings(Object? value) =>
    (value as List<dynamic>? ?? <dynamic>[]).map((dynamic e) => e as String).toList();
