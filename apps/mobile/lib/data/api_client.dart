import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../core/config.dart';

/// Problem details (RFC 9457) — the only error shape the API emits.
class ApiException implements Exception {
  ApiException({
    required this.status,
    required this.title,
    this.detail,
    this.type = 'unknown',
  });

  final int status;
  final String title;
  final String? detail;
  final String type;

  @override
  String toString() => detail ?? title;
}

/// Typed API client with transparent refresh-token rotation.
///
/// Tokens live in the platform keystore rather than shared preferences: this
/// account holds a long-term record of the user's ability.
class ApiClient {
  ApiClient({http.Client? httpClient, FlutterSecureStorage? storage})
      : _http = httpClient ?? http.Client(),
        _storage = storage ?? const FlutterSecureStorage();

  static const _accessKey = 'forgeroutine.accessToken';
  static const _refreshKey = 'forgeroutine.refreshToken';

  final http.Client _http;
  final FlutterSecureStorage _storage;

  Future<String?> get accessToken => _storage.read(key: _accessKey);

  Future<void> saveTokens(String access, String refresh) async {
    await _storage.write(key: _accessKey, value: access);
    await _storage.write(key: _refreshKey, value: refresh);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }

  Future<T> get<T>(String path) => _send<T>('GET', path);

  Future<T> post<T>(String path, {Object? body}) => _send<T>('POST', path, body: body);

  Future<T> patch<T>(String path, {Object? body}) => _send<T>('PATCH', path, body: body);

  Future<T> _send<T>(
    String method,
    String path, {
    Object? body,
    bool isRetry = false,
  }) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    final token = await accessToken;

    final headers = <String, String>{
      if (body != null) 'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };

    final encoded = jsonEncode(body ?? <String, Object?>{});

    final response = switch (method) {
      'POST' => await _http.post(uri, headers: headers, body: encoded),
      'PATCH' => await _http.patch(uri, headers: headers, body: encoded),
      _ => await _http.get(uri, headers: headers),
    };

    // One transparent refresh. The isRetry guard stops an expired refresh
    // token from spinning forever.
    if (response.statusCode == 401 && !isRetry) {
      if (await _refresh()) {
        return _send<T>(method, path, body: body, isRetry: true);
      }
      await clearTokens();
    }

    if (response.statusCode == 204) return null as T;

    final decoded = response.body.isEmpty ? null : jsonDecode(response.body);

    if (response.statusCode >= 400) {
      final problem = decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
      throw ApiException(
        status: response.statusCode,
        title: problem['title'] as String? ?? 'Request failed',
        detail: problem['detail'] as String?,
        type: (problem['type'] as String? ?? '').split('/').last,
      );
    }

    return decoded as T;
  }

  Future<bool> _refresh() async {
    final refreshToken = await _storage.read(key: _refreshKey);
    if (refreshToken == null) return false;

    try {
      final response = await _http.post(
        Uri.parse('${AppConfig.apiBaseUrl}/auth/refresh'),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refreshToken}),
      );
      if (response.statusCode != 200) return false;

      final tokens = jsonDecode(response.body) as Map<String, dynamic>;
      await saveTokens(tokens['accessToken'] as String, tokens['refreshToken'] as String);
      return true;
    } on Exception {
      return false;
    }
  }
}
