import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';

/// The home screen. A placeholder until UC-01 builds the map and layers.
class MapScreen extends StatelessWidget {
  const MapScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(child: Text(AppLocalizations.of(context).mapPlaceholder)),
    );
  }
}
