import 'package:flutter/material.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';

/// Sign in.
///
/// Mobile is a companion to the web app, not a second front door: there is no
/// registration here and no onboarding. Choosing technologies and having a
/// roadmap generated is a sit-down decision, and doing it on a phone while
/// half-attending produces a plan the user did not mean.
class SignInPage extends StatefulWidget {
  const SignInPage({required this.api, required this.onSignedIn, super.key});

  final ApiClient api;
  final VoidCallback onSignedIn;

  @override
  State<SignInPage> createState() => _SignInPageState();
}

class _SignInPageState extends State<SignInPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final tokens = await widget.api.post<Map<String, dynamic>>(
        '/auth/login',
        body: {'email': _email.text.trim(), 'password': _password.text},
      );

      await widget.api.saveTokens(
        tokens['accessToken'] as String,
        tokens['refreshToken'] as String,
      );

      if (mounted) widget.onSignedIn();
    } on ApiException catch (error) {
      // The API deliberately does not say which half was wrong, and neither
      // does this: a message that distinguishes them confirms which addresses
      // have accounts.
      setState(() => _error = error.toString());
    } on Exception {
      setState(() => _error = 'Could not reach ForgeRoutine. Check the connection.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset('assets/brand/app-icon.png', height: 52),
                  const SizedBox(height: 20),
                  RichText(
                    textAlign: TextAlign.center,
                    text: const TextSpan(
                      children: [
                        TextSpan(
                          text: 'Forge',
                          style: TextStyle(
                            color: ForgeColors.forge,
                            fontWeight: FontWeight.w700,
                            fontSize: 24,
                          ),
                        ),
                        TextSpan(
                          text: 'Routine',
                          style: TextStyle(
                            color: ForgeColors.ink300,
                            fontWeight: FontWeight.w700,
                            fontSize: 24,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    AppConfig.tagline,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: ForgeColors.ink500, fontSize: 12),
                  ),
                  const SizedBox(height: 36),

                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    textInputAction: TextInputAction.go,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(labelText: 'Password'),
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      _error!,
                      style: const TextStyle(color: ForgeColors.fail, fontSize: 13),
                    ),
                  ],

                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Sign in'),
                  ),

                  const SizedBox(height: 20),
                  const Text(
                    'New here? Set up your technologies and roadmap on the web first — '
                    'it is a sit-down decision, not a phone one.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: ForgeColors.ink500, fontSize: 12, height: 1.5),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
