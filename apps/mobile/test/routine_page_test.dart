import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:forgeroutine_mobile/core/theme.dart';
import 'package:forgeroutine_mobile/data/api_client.dart';
import 'package:forgeroutine_mobile/features/routine/routine_page.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_storage.dart';

/// The routine screen's job on a phone is to be honest about what can be done
/// here. Two rules are load-bearing and neither is visible in a screenshot:
/// every item shows the reason it was scheduled, and coding work says out
/// loud that it belongs at a desk.
void main() {
  Widget wrap(ApiClient api) => MaterialApp(
        theme: buildForgeTheme(),
        home: Scaffold(body: RoutinePage(api: api)),
      );

  ApiClient clientReturning(Object? routine) {
    final http.Client fake = MockClient((request) async {
      if (request.url.path.endsWith('/routines/today')) {
        return http.Response(jsonEncode(routine), 200, headers: _json);
      }
      if (request.url.path.endsWith('/recall/due')) {
        return http.Response('[]', 200, headers: _json);
      }
      return http.Response('{}', 200, headers: _json);
    });

    return ApiClient(httpClient: fake, storage: FakeStorage(token: 'test-token'));
  }

  testWidgets('offers to plan the day when nothing is scheduled', (tester) async {
    await tester.pumpWidget(wrap(clientReturning(<String, Object?>{})));
    await tester.pumpAndSettle();

    expect(find.text('Nothing planned yet'), findsOneWidget);
    expect(find.text('Plan today'), findsOneWidget);
  });

  testWidgets('shows the reason every item was scheduled', (tester) async {
    // An opaque routine is not a trusted one, and there is no room on a phone
    // to go and check the roadmap.
    await tester.pumpWidget(wrap(clientReturning(_routine)));
    await tester.pumpAndSettle();

    expect(find.text('Review Closures'), findsOneWidget);
    expect(find.text('3 days overdue — it will start to fade.'), findsOneWidget);
  });

  testWidgets('says coding work belongs at a desk rather than opening an editor', (
    tester,
  ) async {
    await tester.pumpWidget(wrap(clientReturning(_routine)));
    await tester.pumpAndSettle();

    expect(
      find.text('Writing code happens at a desk. Open this on the web.'),
      findsOneWidget,
    );
  });

  testWidgets('does not offer desk-work guidance for a review item', (tester) async {
    await tester.pumpWidget(wrap(clientReturning(_routine)));
    await tester.pumpAndSettle();

    // One CODE item in the fixture, so exactly one notice.
    expect(find.byIcon(Icons.desktop_windows_outlined), findsOneWidget);
  });

  testWidgets('reports the day as finished without celebrating it', (tester) async {
    await tester.pumpWidget(wrap(clientReturning(_finishedRoutine)));
    await tester.pumpAndSettle();

    expect(find.text('That is today’s work done.'), findsOneWidget);
    expect(
      find.text('Stopping here is the right call — tomorrow’s spacing depends on it.'),
      findsOneWidget,
    );
  });

  testWidgets('shows the count of reviews that are due', (tester) async {
    await tester.pumpWidget(wrap(clientReturning(_routine)));
    await tester.pumpAndSettle();

    expect(find.textContaining('2 due for review'), findsOneWidget);
  });
}

const _json = {'content-type': 'application/json'};

final _routine = <String, Object?>{
  'id': 'rt1',
  'date': '2026-09-13T00:00:00.000Z',
  'totalMinutes': 45,
  'completedMinutes': 8,
  'recallDue': 2,
  'items': [
    {
      'id': 'i1',
      'kind': 'REVIEW',
      'status': 'PENDING',
      'minutes': 8,
      'title': 'Review Closures',
      'rationale': '3 days overdue — it will start to fade.',
      'conceptId': 'c1',
      'exerciseId': null,
    },
    {
      'id': 'i2',
      'kind': 'CODE',
      'status': 'PENDING',
      'minutes': 25,
      'title': 'Implement debounce',
      'rationale': 'Next in your roadmap.',
      'conceptId': 'c2',
      'exerciseId': 'e1',
    },
  ],
};

final _finishedRoutine = <String, Object?>{
  'id': 'rt2',
  'date': '2026-09-13T00:00:00.000Z',
  'totalMinutes': 8,
  'completedMinutes': 8,
  'recallDue': 0,
  'items': [
    {
      'id': 'i1',
      'kind': 'REVIEW',
      'status': 'DONE',
      'minutes': 8,
      'title': 'Review Closures',
      'rationale': 'Due today.',
      'conceptId': 'c1',
      'exerciseId': null,
    },
  ],
};
