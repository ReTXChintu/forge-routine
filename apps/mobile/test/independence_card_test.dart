import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:forgeroutine_mobile/core/theme.dart';
import 'package:forgeroutine_mobile/data/models.dart';
import 'package:forgeroutine_mobile/features/dashboard/dashboard_page.dart';

/// Widget tests for the one rule that matters most on this screen: never show a
/// user a score we have not earned the right to show.
Future<void> pumpCard(WidgetTester tester, IndependenceScore score) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildForgeTheme(),
      home: Scaffold(body: IndependenceCard(score: score)),
    ),
  );
}

void main() {
  group('IndependenceCard', () {
    testWidgets('shows a dash, not 0%, when there is not enough evidence', (tester) async {
      await pumpCard(
        tester,
        const IndependenceScore(
          score: null,
          status: 'INSUFFICIENT_DATA',
          attemptsConsidered: 2,
          windowDays: 30,
        ),
      );

      expect(find.text('—'), findsOneWidget);
      expect(find.text('0%'), findsNothing);
      expect(find.text('2 of 5 attempts needed'), findsOneWidget);
    });

    testWidgets('shows the percentage once there is enough evidence', (tester) async {
      await pumpCard(
        tester,
        const IndependenceScore(
          score: 0.78,
          status: 'OK',
          attemptsConsidered: 12,
          windowDays: 30,
        ),
      );

      expect(find.text('78%'), findsOneWidget);
      expect(find.text('Last 30 days · 12 attempts'), findsOneWidget);
    });

    testWidgets('shows an improvement in the pass colour', (tester) async {
      await pumpCard(
        tester,
        const IndependenceScore(
          score: 0.78,
          status: 'OK',
          attemptsConsidered: 12,
          windowDays: 30,
          deltaFromPreviousWindow: 12.0,
        ),
      );

      final delta = tester.widget<Text>(find.text('+12.0'));
      expect(delta.style?.color, ForgeColors.pass);
    });

    testWidgets('shows a decline in the fail colour', (tester) async {
      await pumpCard(
        tester,
        const IndependenceScore(
          score: 0.5,
          status: 'OK',
          attemptsConsidered: 12,
          windowDays: 30,
          deltaFromPreviousWindow: -8.0,
        ),
      );

      final delta = tester.widget<Text>(find.text('-8.0'));
      expect(delta.style?.color, ForgeColors.fail);
    });

    testWidgets('hides a zero delta rather than showing "+0.0"', (tester) async {
      await pumpCard(
        tester,
        const IndependenceScore(
          score: 0.6,
          status: 'OK',
          attemptsConsidered: 9,
          windowDays: 30,
          deltaFromPreviousWindow: 0,
        ),
      );

      expect(find.text('+0.0'), findsNothing);
    });
  });

  group('NextAction', () {
    test('routes coding work to the desktop, per the v1 mobile scope', () {
      for (final kind in ['CODE', 'BLIND_CODE', 'DEBUG']) {
        final action = NextAction(
          kind: kind,
          title: 'x',
          rationale: 'y',
          estimatedMinutes: 20,
        );
        expect(action.requiresDesktop, isTrue, reason: '$kind should need a desktop');
      }
    });

    test('keeps review and learning on the phone', () {
      for (final kind in ['REVIEW', 'LEARN', 'RECALL', 'INTERVIEW']) {
        final action = NextAction(
          kind: kind,
          title: 'x',
          rationale: 'y',
          estimatedMinutes: 10,
        );
        expect(action.requiresDesktop, isFalse, reason: '$kind should work on mobile');
      }
    });
  });

  group('DashboardOverview.fromJson', () {
    test('survives a sparse payload without throwing', () {
      final overview = DashboardOverview.fromJson(const <String, dynamic>{});

      expect(overview.greeting, 'Hello.');
      expect(overview.todayMinutesTarget, 45);
      expect(overview.independence.hasEnoughData, isFalse);
      expect(overview.weakestSkills, isEmpty);
      expect(overview.nextAction, isNull);
    });

    test('parses a full payload', () {
      final overview = DashboardOverview.fromJson(const <String, dynamic>{
        'greeting': 'Good morning.',
        'todayMinutesDone': 42,
        'todayMinutesTarget': 60,
        'independence': {
          'score': 0.78,
          'status': 'OK',
          'attemptsConsidered': 14,
          'windowDays': 30,
        },
        'interviewReadiness': 0.71,
        'currentFocus': ['Node.js', 'Docker'],
        'weakestSkills': [
          {
            'conceptId': 'c1',
            'conceptName': 'Docker networking',
            'technologyName': 'Docker',
            'value': 0.31,
          },
        ],
        'nextAction': {
          'kind': 'REVIEW',
          'title': 'Review Buffers',
          'rationale': 'Due for review.',
          'estimatedMinutes': 10,
        },
      });

      expect(overview.greeting, 'Good morning.');
      expect(overview.todayMinutesDone, 42);
      expect(overview.independence.score, 0.78);
      expect(overview.currentFocus, ['Node.js', 'Docker']);
      expect(overview.weakestSkills.single.conceptName, 'Docker networking');
      expect(overview.nextAction?.requiresDesktop, isFalse);
    });
  });
}
