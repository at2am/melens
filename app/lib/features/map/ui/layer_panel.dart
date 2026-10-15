import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';

String layerTitle(AppLocalizations strings, MapLayerId layer) =>
    switch (layer) {
      MapLayerId.pedestrian => strings.mapLayerPedestrian,
      MapLayerId.anomaly => strings.mapLayerAnomaly,
      MapLayerId.disruption => strings.mapLayerDisruption,
      MapLayerId.event => strings.mapLayerEvent,
      MapLayerId.planning => strings.mapLayerPlanning,
      MapLayerId.boundary => strings.mapLayerBoundary,
      MapLayerId.news => strings.mapLayerNews,
      MapLayerId.rent => strings.mapLayerRent,
      MapLayerId.census => strings.mapLayerCensus,
    };
