/// Read models mirroring the API DTOs.
///
/// A `null` score means *unscored* and must render as a dash, never as 0% —
/// the same rule the web app follows, for the same reason: a number we did not
/// earn is a lie the user will act on.
class IndependenceScore {
  const IndependenceScore({
    required this.score,
    required this.status,
    required this.attemptsConsidered,
    required this.windowDays,
    this.deltaFromPreviousWindow,
  });

  factory IndependenceScore.fromJson(Map<String, dynamic> json) => IndependenceScore(
        score: (json['score'] as num?)?.toDouble(),
        status: json['status'] as String? ?? 'INSUFFICIENT_DATA',
        attemptsConsidered: json['attemptsConsidered'] as int? ?? 0,
        windowDays: json['windowDays'] as int? ?? 30,
        deltaFromPreviousWindow: (json['deltaFromPreviousWindow'] as num?)?.toDouble(),
      );

  final double? score;
  final String status;
  final int attemptsConsidered;
  final int windowDays;
  final double? deltaFromPreviousWindow;

  bool get hasEnoughData => status == 'OK' && score != null;
}

class WeakSkill {
  const WeakSkill({
    required this.conceptId,
    required this.conceptName,
    required this.technologyName,
    required this.value,
  });

  factory WeakSkill.fromJson(Map<String, dynamic> json) => WeakSkill(
        conceptId: json['conceptId'] as String,
        conceptName: json['conceptName'] as String,
        technologyName: json['technologyName'] as String,
        value: (json['value'] as num).toDouble(),
      );

  final String conceptId;
  final String conceptName;
  final String technologyName;
  final double value;
}

class NextAction {
  const NextAction({
    required this.kind,
    required this.title,
    required this.rationale,
    required this.estimatedMinutes,
    this.conceptId,
    this.exerciseId,
  });

  factory NextAction.fromJson(Map<String, dynamic> json) => NextAction(
        kind: json['kind'] as String,
        title: json['title'] as String,
        rationale: json['rationale'] as String,
        estimatedMinutes: json['estimatedMinutes'] as int? ?? 15,
        conceptId: json['conceptId'] as String?,
        exerciseId: json['exerciseId'] as String?,
      );

  final String kind;
  final String title;
  final String rationale;
  final int estimatedMinutes;
  final String? conceptId;
  final String? exerciseId;

  /// v1 deliberately does not reproduce the desktop IDE on a phone (§4).
  /// Coding work is surfaced here for review and started on the web.
  bool get requiresDesktop =>
      kind == 'CODE' || kind == 'BLIND_CODE' || kind == 'DEBUG';
}

class DashboardOverview {
  const DashboardOverview({
    required this.greeting,
    required this.todayMinutesDone,
    required this.todayMinutesTarget,
    required this.independence,
    required this.currentFocus,
    required this.weakestSkills,
    this.interviewReadiness,
    this.nextAction,
  });

  factory DashboardOverview.fromJson(Map<String, dynamic> json) => DashboardOverview(
        greeting: json['greeting'] as String? ?? 'Hello.',
        todayMinutesDone: json['todayMinutesDone'] as int? ?? 0,
        todayMinutesTarget: json['todayMinutesTarget'] as int? ?? 45,
        independence: IndependenceScore.fromJson(
          json['independence'] as Map<String, dynamic>? ?? const <String, dynamic>{},
        ),
        interviewReadiness: (json['interviewReadiness'] as num?)?.toDouble(),
        currentFocus: (json['currentFocus'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => e as String)
            .toList(),
        weakestSkills: (json['weakestSkills'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => WeakSkill.fromJson(e as Map<String, dynamic>))
            .toList(),
        nextAction: json['nextAction'] == null
            ? null
            : NextAction.fromJson(json['nextAction'] as Map<String, dynamic>),
      );

  final String greeting;
  final int todayMinutesDone;
  final int todayMinutesTarget;
  final IndependenceScore independence;
  final double? interviewReadiness;
  final List<String> currentFocus;
  final List<WeakSkill> weakestSkills;
  final NextAction? nextAction;
}
