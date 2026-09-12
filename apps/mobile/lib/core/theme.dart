import 'package:flutter/material.dart';

/// ForgeRoutine design language on mobile (§36).
///
/// The same dark-first developer aesthetic as the web app, with `#ED7F11` used
/// sparingly. Deliberately not a phone-shaped consumer app: this is the same
/// tool, on a smaller screen.
abstract final class ForgeColors {
  static const forge = Color(0xFFED7F11);
  static const forgeDim = Color(0xFFC9670A);

  static const surface0 = Color(0xFF0B0C0E);
  static const surface50 = Color(0xFF111317);
  static const surface100 = Color(0xFF161920);
  static const surface200 = Color(0xFF1D2129);
  static const surface300 = Color(0xFF252A34);
  static const surface400 = Color(0xFF2F3540);

  static const ink100 = Color(0xFFF2F4F7);
  static const ink200 = Color(0xFFD5DAE2);
  static const ink300 = Color(0xFFA8B0BD);
  static const ink400 = Color(0xFF7B8494);
  static const ink500 = Color(0xFF5A6371);

  static const pass = Color(0xFF3FB950);
  static const fail = Color(0xFFF85149);
  static const warn = Color(0xFFD29922);
}

ThemeData buildForgeTheme() {
  const scheme = ColorScheme.dark(
    primary: ForgeColors.forge,
    onPrimary: ForgeColors.surface0,
    secondary: ForgeColors.forgeDim,
    surface: ForgeColors.surface100,
    onSurface: ForgeColors.ink100,
    error: ForgeColors.fail,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: ForgeColors.surface0,
    fontFamily: 'Roboto',
    appBarTheme: const AppBarTheme(
      backgroundColor: ForgeColors.surface50,
      foregroundColor: ForgeColors.ink100,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: ForgeColors.ink100,
        fontSize: 16,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
      ),
    ),
    cardTheme: CardThemeData(
      color: ForgeColors.surface100,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: ForgeColors.surface300),
      ),
      margin: EdgeInsets.zero,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: ForgeColors.forge,
        foregroundColor: ForgeColors.surface0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    textTheme: const TextTheme(
      headlineSmall: TextStyle(
        color: ForgeColors.ink100,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
      ),
      titleMedium: TextStyle(color: ForgeColors.ink100, fontWeight: FontWeight.w600),
      bodyMedium: TextStyle(color: ForgeColors.ink300, fontSize: 14),
      bodySmall: TextStyle(color: ForgeColors.ink400, fontSize: 12),
      labelSmall: TextStyle(
        color: ForgeColors.ink400,
        fontSize: 11,
        letterSpacing: 0.8,
        fontWeight: FontWeight.w600,
      ),
    ),
    dividerTheme: const DividerThemeData(color: ForgeColors.surface300, thickness: 1),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: ForgeColors.forge,
      linearTrackColor: ForgeColors.surface300,
    ),
  );
}
