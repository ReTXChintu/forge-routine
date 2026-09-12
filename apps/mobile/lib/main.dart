import 'package:flutter/material.dart';

import 'core/config.dart';
import 'core/theme.dart';
import 'data/api_client.dart';
import 'features/dashboard/dashboard_page.dart';

void main() {
  runApp(ForgeRoutineApp(api: ApiClient()));
}

class ForgeRoutineApp extends StatelessWidget {
  const ForgeRoutineApp({required this.api, super.key});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: buildForgeTheme(),
      home: DashboardPage(api: api),
    );
  }
}
