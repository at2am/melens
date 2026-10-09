// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chat_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Conversation state: the open session, its turns, the turn in progress,
/// any pending question and the session list (agent-protocol.md, Flutter
/// implementation). One turn runs at a time; events are ordered by `seq`.

@ProviderFor(ChatController)
final chatControllerProvider = ChatControllerProvider._();

/// Conversation state: the open session, its turns, the turn in progress,
/// any pending question and the session list (agent-protocol.md, Flutter
/// implementation). One turn runs at a time; events are ordered by `seq`.
final class ChatControllerProvider
    extends $NotifierProvider<ChatController, ChatState> {
  /// Conversation state: the open session, its turns, the turn in progress,
  /// any pending question and the session list (agent-protocol.md, Flutter
  /// implementation). One turn runs at a time; events are ordered by `seq`.
  ChatControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'chatControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$chatControllerHash();

  @$internal
  @override
  ChatController create() => ChatController();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(ChatState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<ChatState>(value),
    );
  }
}

String _$chatControllerHash() => r'1550c8bb4808755441ff3287966178f3e6c9c65e';

/// Conversation state: the open session, its turns, the turn in progress,
/// any pending question and the session list (agent-protocol.md, Flutter
/// implementation). One turn runs at a time; events are ordered by `seq`.

abstract class _$ChatController extends $Notifier<ChatState> {
  ChatState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<ChatState, ChatState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<ChatState, ChatState>,
              ChatState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
