import 'package:flutter/material.dart';

import 'app.dart';
import 'data/api_client.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(ForgeRoutineApp(api: ApiClient()));
}
