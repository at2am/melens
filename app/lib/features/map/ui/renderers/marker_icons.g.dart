// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'marker_icons.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The drawn pins for one device pixel ratio. Callers show
/// [MapMarkerIcons.fallback] while this loads or if it fails.

@ProviderFor(mapMarkerIcons)
final mapMarkerIconsProvider = MapMarkerIconsFamily._();

/// The drawn pins for one device pixel ratio. Callers show
/// [MapMarkerIcons.fallback] while this loads or if it fails.

final class MapMarkerIconsProvider
    extends
        $FunctionalProvider<
          AsyncValue<MapMarkerIcons>,
          MapMarkerIcons,
          FutureOr<MapMarkerIcons>
        >
    with $FutureModifier<MapMarkerIcons>, $FutureProvider<MapMarkerIcons> {
  /// The drawn pins for one device pixel ratio. Callers show
  /// [MapMarkerIcons.fallback] while this loads or if it fails.
  MapMarkerIconsProvider._({
    required MapMarkerIconsFamily super.from,
    required double super.argument,
  }) : super(
         retry: null,
         name: r'mapMarkerIconsProvider',
         isAutoDispose: false,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$mapMarkerIconsHash();

  @override
  String toString() {
    return r'mapMarkerIconsProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<MapMarkerIcons> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<MapMarkerIcons> create(Ref ref) {
    final argument = this.argument as double;
    return mapMarkerIcons(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is MapMarkerIconsProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$mapMarkerIconsHash() => r'12bfbcd5f71980d8dda498f6eb735692137ec0fd';

/// The drawn pins for one device pixel ratio. Callers show
/// [MapMarkerIcons.fallback] while this loads or if it fails.

final class MapMarkerIconsFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<MapMarkerIcons>, double> {
  MapMarkerIconsFamily._()
    : super(
        retry: null,
        name: r'mapMarkerIconsProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: false,
      );

  /// The drawn pins for one device pixel ratio. Callers show
  /// [MapMarkerIcons.fallback] while this loads or if it fails.

  MapMarkerIconsProvider call(double pixelRatio) =>
      MapMarkerIconsProvider._(argument: pixelRatio, from: this);

  @override
  String toString() => r'mapMarkerIconsProvider';
}
