import '../../map/data/map_models.dart';

/// A named part of the City of Melbourne a feed can follow. The box is the
/// area's approximate extent, rounded outwards: a feed reads what lies inside
/// it, so it may include a street or two of the next area. It is not a
/// statistical boundary.
final class MelbourneArea {
  const MelbourneArea({
    required this.id,
    required this.name,
    required this.bounds,
  });

  /// Stored in a feed's scope; never renamed.
  final String id;
  final String name;
  final MapBounds bounds;
}

const cbdAreaId = 'cbd';

/// The City of Melbourne's small areas (the CLUE areas), most of the data's
/// coverage, plus the whole municipality.
const melbourneAreas = [
  MelbourneArea(
    id: cbdAreaId,
    name: 'Melbourne CBD',
    bounds: MapBounds(
      west: 144.9500,
      south: -37.8230,
      east: 144.9750,
      north: -37.8060,
    ),
  ),
  MelbourneArea(
    id: 'carlton',
    name: 'Carlton',
    bounds: MapBounds(
      west: 144.9580,
      south: -37.8070,
      east: 144.9760,
      north: -37.7840,
    ),
  ),
  MelbourneArea(
    id: 'docklands',
    name: 'Docklands',
    bounds: MapBounds(
      west: 144.9280,
      south: -37.8280,
      east: 144.9550,
      north: -37.8090,
    ),
  ),
  MelbourneArea(
    id: 'east-melbourne',
    name: 'East Melbourne',
    bounds: MapBounds(
      west: 144.9720,
      south: -37.8220,
      east: 144.9920,
      north: -37.8060,
    ),
  ),
  MelbourneArea(
    id: 'kensington',
    name: 'Kensington',
    bounds: MapBounds(
      west: 144.9140,
      south: -37.8010,
      east: 144.9380,
      north: -37.7830,
    ),
  ),
  MelbourneArea(
    id: 'north-melbourne',
    name: 'North Melbourne',
    bounds: MapBounds(
      west: 144.9360,
      south: -37.8080,
      east: 144.9590,
      north: -37.7890,
    ),
  ),
  MelbourneArea(
    id: 'parkville',
    name: 'Parkville',
    bounds: MapBounds(
      west: 144.9370,
      south: -37.7950,
      east: 144.9650,
      north: -37.7730,
    ),
  ),
  MelbourneArea(
    id: 'port-melbourne',
    name: 'Port Melbourne (Fishermans Bend)',
    bounds: MapBounds(
      west: 144.9000,
      south: -37.8400,
      east: 144.9400,
      north: -37.8180,
    ),
  ),
  MelbourneArea(
    id: 'south-yarra',
    name: 'South Yarra (west)',
    bounds: MapBounds(
      west: 144.9740,
      south: -37.8460,
      east: 144.9910,
      north: -37.8270,
    ),
  ),
  MelbourneArea(
    id: 'southbank',
    name: 'Southbank',
    bounds: MapBounds(
      west: 144.9470,
      south: -37.8370,
      east: 144.9770,
      north: -37.8160,
    ),
  ),
  MelbourneArea(
    id: 'west-melbourne',
    name: 'West Melbourne',
    bounds: MapBounds(
      west: 144.9290,
      south: -37.8160,
      east: 144.9590,
      north: -37.8000,
    ),
  ),
  MelbourneArea(
    id: 'city-of-melbourne',
    name: 'All of the City of Melbourne',
    bounds: MapBounds(
      west: 144.8970,
      south: -37.8510,
      east: 144.9920,
      north: -37.7730,
    ),
  ),
];

MelbourneArea? melbourneAreaById(String id) {
  for (final area in melbourneAreas) {
    if (area.id == id) return area;
  }
  return null;
}
