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

String _$cardItemRequestsHash() => r'a6e4b3f4ccd1b5ace433f0cec9dc63120aa5756a';

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
