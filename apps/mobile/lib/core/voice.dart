import 'package:speech_to_text/speech_to_text.dart';

/// Dictation for the voice interview (§16).
///
/// **No audio leaves the device.** This uses the platform recogniser, and
/// only the resulting text is sent — byte for byte the same request a typed
/// answer produces. There is no recording, no upload, and no audio stored
/// anywhere, which is worth being exact about for a feature that asks for
/// the microphone.
///
/// Why voice at all: an interview is spoken. Typing an answer lets you edit
/// it into shape, which is the one thing you cannot do in the room. Speaking
/// it surfaces the hesitation and the circling that an interviewer actually
/// hears — and `explanationAbility` is the dimension this product has the
/// least evidence for.
///
/// Wrapped behind an interface so the interview screen has no dependency on
/// the plugin: the screen is unit-testable against [FakeVoiceInput], and a
/// device without a recogniser degrades to typing rather than to a dead
/// button.
abstract interface class VoiceInput {
  /// Whether dictation can be used at all on this device.
  ///
  /// False on an emulator without speech services, on a device where the
  /// user declined the microphone, and on platforms with no recogniser.
  Future<bool> prepare();

  /// Streams partial transcripts until [stop] is called.
  Future<void> start(void Function(String transcript) onResult);

  Future<void> stop();

  bool get isListening;
}

class PlatformVoiceInput implements VoiceInput {
  PlatformVoiceInput({SpeechToText? speech}) : _speech = speech ?? SpeechToText();

  final SpeechToText _speech;
  bool _available = false;

  @override
  bool get isListening => _speech.isListening;

  @override
  Future<bool> prepare() async {
    if (_available) return true;

    // initialize() asks for the microphone permission and reports failure
    // rather than throwing, so a refusal is an ordinary false.
    _available = await _speech.initialize(
      onError: (_) {},
      onStatus: (_) {},
    );

    return _available;
  }

  @override
  Future<void> start(void Function(String transcript) onResult) async {
    if (!await prepare()) return;

    await _speech.listen(
      onResult: (result) => onResult(result.recognizedWords),
      listenOptions: SpeechListenOptions(
        // Partial results let the user watch the transcript form, which is
        // how they notice a misheard word before they have said four more.
        partialResults: true,
        cancelOnError: false,
        // An interview answer is a paragraph with pauses in it. The defaults
        // are tuned for short commands and would cut someone off mid-thought.
        listenFor: const Duration(minutes: 4),
        pauseFor: const Duration(seconds: 6),
      ),
    );
  }

  @override
  Future<void> stop() => _speech.stop();
}

/// Deterministic stand-in for tests and for platforms with no recogniser.
class FakeVoiceInput implements VoiceInput {
  FakeVoiceInput({this.available = true, this.transcript = ''});

  final bool available;
  final String transcript;

  bool _listening = false;

  @override
  bool get isListening => _listening;

  @override
  Future<bool> prepare() async => available;

  @override
  Future<void> start(void Function(String transcript) onResult) async {
    if (!available) return;
    _listening = true;
    onResult(transcript);
  }

  @override
  Future<void> stop() async {
    _listening = false;
  }
}
