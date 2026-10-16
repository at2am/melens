import 'package:melens/features/map/data/layer_memory.dart';

/// This device's remembered layers: [layers] and [community] are what reads
/// return (null when nothing is remembered), and each write replaces them.
final class FakeLayerMemory implements LayerMemory {
  FakeLayerMemory({this.layers, this.community});

  RememberedLayers? layers;
  bool? community;
  final layerWrites = <RememberedLayers>[];
  final communityWrites = <bool>[];

  @override
  Future<RememberedLayers?> readLayers() async => layers;

  @override
  Future<void> writeLayers(RememberedLayers layers) async {
    layerWrites.add(layers);
    this.layers = layers;
  }

  @override
  Future<bool?> readCommunity() async => community;

  @override
  Future<void> writeCommunity({required bool enabled}) async {
    communityWrites.add(enabled);
    community = enabled;
  }
}
