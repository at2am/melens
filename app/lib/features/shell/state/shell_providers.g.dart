// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'shell_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(CardItemRequests)
final cardItemRequestsProvider = CardItemRequestsProvider._();

final class CardItemRequestsProvider
    extends $NotifierProvider<CardItemRequests, CardItemRequest?> {
  CardItemRequestsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'cardItemRequestsProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$cardItemRequestsHash();

  @$internal
  @override
  CardItemRequests create() => CardItemRequests();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(CardItemRequest? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<CardItemRequest?>(value),
    );
  }
}

String _$cardItemRequestsHash() => r'0abb82a3406a41d015ece6d69cc12b5394d1ca11';

abstract class _$CardItemRequests extends $Notifier<CardItemRequest?> {
  CardItemRequest? build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<CardItemRequest?, CardItemRequest?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<CardItemRequest?, CardItemRequest?>,
              CardItemRequest?,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// Asks the shell to open the agent chat, for a page above the tabs such as
/// a saved plan; each request has a new sequence.

@ProviderFor(ChatOpenRequests)
final chatOpenRequestsProvider = ChatOpenRequestsProvider._();

/// Asks the shell to open the agent chat, for a page above the tabs such as
/// a saved plan; each request has a new sequence.
final class ChatOpenRequestsProvider
    extends $NotifierProvider<ChatOpenRequests, int> {
  /// Asks the shell to open the agent chat, for a page above the tabs such as
  /// a saved plan; each request has a new sequence.
  ChatOpenRequestsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'chatOpenRequestsProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$chatOpenRequestsHash();

  @$internal
  @override
  ChatOpenRequests create() => ChatOpenRequests();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(int value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<int>(value),
    );
  }
}

String _$chatOpenRequestsHash() => r'e65fcfd95854df4820c3ad701e5fd8f88da66242';

/// Asks the shell to open the agent chat, for a page above the tabs such as
/// a saved plan; each request has a new sequence.

abstract class _$ChatOpenRequests extends $Notifier<int> {
  int build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<int, int>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<int, int>,
              int,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

@ProviderFor(AppThemeSetting)
final appThemeSettingProvider = AppThemeSettingProvider._();

final class AppThemeSettingProvider
    extends $NotifierProvider<AppThemeSetting, AppThemeChoice> {
  AppThemeSettingProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'appThemeSettingProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$appThemeSettingHash();

  @$internal
  @override
  AppThemeSetting create() => AppThemeSetting();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(AppThemeChoice value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<AppThemeChoice>(value),
    );
  }
}

String _$appThemeSettingHash() => r'cea161bbf255e57736e3a9681521564724540b60';

abstract class _$AppThemeSetting extends $Notifier<AppThemeChoice> {
  AppThemeChoice build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AppThemeChoice, AppThemeChoice>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AppThemeChoice, AppThemeChoice>,
              AppThemeChoice,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
