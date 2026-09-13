import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:forgeroutine_mobile/core/theme.dart';
import 'package:forgeroutine_mobile/core/voice.dart';
import 'package:forgeroutine_mobile/data/api_client.dart';
import 'package:forgeroutine_mobile/features/interview/interview_session_page.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_storage.dart';

/// Two properties of this screen are product rules rather than presentation,
/// and both fail silently:
///
///  - nothing is graded in front of the user mid-interview;
///  - a dimension the interview never tested is omitted, never shown at zero.
void main() {
  Widget wrap(ApiClient api, {VoiceInput? voice}) => MaterialApp(
        theme: buildForgeTheme(),
        home: InterviewSessionPage(api: api, interviewId: 'iv1', voice: voice),
      );

  ApiClient client({
    required Map<String, Object?> interview,
    Map<String, Object?>? report,
  }) {
    final fake = MockClient((request) async {
      if (request.url.path.endsWith('/report')) {
        return http.Response(jsonEncode(report ?? <String, Object?>{}), 200, headers: _json);
      }
      if (request.url.path.endsWith('/interviews/iv1')) {
        return http.Response(jsonEncode(interview), 200, headers: _json);
      }
      return http.Response('{}', 200, headers: _json);
    });

    return ApiClient(httpClient: fake, storage: FakeStorage(token: 'test-token'));
  }

  testWidgets('shows the question and no score while the interview is running', (
    tester,
  ) async {
    await tester.pumpWidget(wrap(client(interview: _inProgress)));
    await tester.pumpAndSettle();

    expect(find.text('What happens between two await points?'), findsOneWidget);
    // Feedback between turns would make this a tutorial, and the candidate
    // would start answering for approval.
    expect(find.textContaining('%'), findsNothing);
    expect(find.text('Debrief'), findsNothing);
  });

  testWidgets('hides dictation when the device cannot do it', (tester) async {
    // A dead microphone button is worse than no microphone button.
    await tester.pumpWidget(
      wrap(client(interview: _inProgress), voice: FakeVoiceInput(available: false)),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.mic_none), findsNothing);
  });

  testWidgets('offers dictation when the device can do it', (tester) async {
    await tester.pumpWidget(
      wrap(client(interview: _inProgress), voice: FakeVoiceInput(transcript: 'hello')),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.mic_none), findsOneWidget);
  });

  testWidgets('says what happens to the audio, because it asked for a microphone', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrap(client(interview: _inProgress), voice: FakeVoiceInput(transcript: 'x')),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Dictation runs on your device. Only the text is sent.'),
      findsOneWidget,
    );
  });

  testWidgets('dictation appends to what was already typed', (tester) async {
    // Overwriting a half-typed answer the moment the microphone opens would
    // lose work the user cannot get back.
    await tester.pumpWidget(
      wrap(
        client(interview: _inProgress),
        voice: FakeVoiceInput(transcript: 'the microtask queue drains'),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'First,');
    await tester.tap(find.byIcon(Icons.mic_none));
    await tester.pumpAndSettle();

    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller!.text, 'First, the microtask queue drains');
  });

  testWidgets('omits untested dimensions rather than showing them at zero', (tester) async {
    await tester.pumpWidget(
      wrap(client(interview: _finished, report: _report)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Debrief'), findsOneWidget);
    expect(find.text('Technical Correctness'), findsOneWidget);
    // Null in the payload: this interview never tested it.
    expect(find.text('Architecture Thinking'), findsNothing);
    expect(
      find.text('Dimensions this interview did not test are left out, not scored zero.'),
      findsOneWidget,
    );
  });

  testWidgets('admits when the written review is missing instead of dressing it up', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrap(
        client(
          interview: _finished,
          report: {..._report, 'summary': null, 'degraded': true},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('arithmetic only'), findsOneWidget);
  });

  testWidgets('hides the composer once the interview is over', (tester) async {
    await tester.pumpWidget(wrap(client(interview: _finished, report: _report)));
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsNothing);
  });
}

const _json = {'content-type': 'application/json'};

final _inProgress = <String, Object?>{
  'id': 'iv1',
  'mode': 'TECHNICAL',
  'targetLevel': 'MID',
  'status': 'IN_PROGRESS',
  'startedAt': '2026-09-13T09:00:00.000Z',
  'endedAt': null,
  'turnsRemaining': 11,
  'currentQuestion': {'id': 'q1', 'prompt': 'What happens between two await points?'},
  'turns': [
    {
      'questionId': 'q1',
      'orderIndex': 0,
      'prompt': 'What happens between two await points?',
      'conceptName': 'Event loop',
      'answer': null,
    },
  ],
};

final _finished = <String, Object?>{
  ..._inProgress,
  'status': 'COMPLETED',
  'currentQuestion': null,
  'endedAt': '2026-09-13T09:20:00.000Z',
};

final _report = <String, Object?>{
  'overallScore': 0.62,
  'dimensions': {
    'technicalCorrectness': 0.7,
    'depth': 0.5,
    'architectureThinking': null,
    'debugging': null,
  },
  'strongAreas': ['explained closures precisely'],
  'weakAreas': ['could not say when a microtask runs'],
  'recommendedTopics': ['event loop'],
  'summary': 'Solid fundamentals, thin on async scheduling.',
  'degraded': false,
};
