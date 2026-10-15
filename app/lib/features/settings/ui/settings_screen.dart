import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/config/env.dart';
import '../../../l10n/app_localizations.dart';
import '../../events/state/user_events_providers.dart';
import '../../location/data/device_location.dart';
import '../../location/state/user_location.dart';
import '../../map/state/viewport_controller.dart';
import '../../shell/state/shell_providers.dart';

/// The third tab: who you are, what you follow, how the app looks and what
/// data it is showing.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final name = ref.watch(userEventDisplayNameProvider);
    final choice = ref.watch(appThemeSettingProvider);
    final autoSearch = ref.watch(mapAutoSearchProvider);
    final env = ref.watch(envProvider);

    return SafeArea(
      bottom: false,
      child: ListView(
        key: const ValueKey('settings-list'),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 112),
        children: [
          Text(
            strings.tabSettings,
            style: theme.textTheme.displaySmall?.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -1,
            ),
          ),
          const SizedBox(height: 24),
          _Section(strings.settingsProfile),
          ListTile(
            key: const ValueKey('settings-profile'),
            leading: CircleAvatar(
              child: name == null
                  ? const Icon(Icons.person_outline)
                  : Text(name.characters.first.toUpperCase()),
            ),
            title: Text(name ?? strings.settingsNameUnset),
            subtitle: Text(strings.settingsProfileHint),
            trailing: const Icon(Icons.edit_outlined),
            onTap: () => _rename(context, ref, name ?? ''),
          ),
          const SizedBox(height: 16),
          _Section(strings.settingsLocation),
          _LocationSwitch(),
          const SizedBox(height: 16),
          _Section(strings.settingsMap),
          SwitchListTile(
            key: const ValueKey('settings-map-auto-search'),
            secondary: const Icon(Icons.travel_explore),
            title: Text(strings.settingsMapAutoSearch),
            subtitle: Text(
              autoSearch
                  ? strings.settingsMapAutoSearchOn
                  : strings.settingsMapAutoSearchOff,
            ),
            value: autoSearch,
            onChanged: (value) =>
                ref.read(mapAutoSearchProvider.notifier).set(enabled: value),
          ),
          const SizedBox(height: 16),
          _Section(strings.settingsAppearance),
          SegmentedButton<AppThemeChoice>(
            key: const ValueKey('settings-theme'),
            showSelectedIcon: false,
            segments: [
              ButtonSegment(
                value: AppThemeChoice.system,
                label: Text(strings.settingsThemeSystem),
              ),
              ButtonSegment(
                value: AppThemeChoice.light,
                label: Text(strings.settingsThemeLight),
              ),
              ButtonSegment(
                value: AppThemeChoice.dark,
                label: Text(strings.settingsThemeDark),
              ),
            ],
            selected: {choice},
            onSelectionChanged: (value) =>
                ref.read(appThemeSettingProvider.notifier).choose(value.first),
          ),
          const SizedBox(height: 24),
          _Section(strings.settingsAbout),
          ListTile(
            leading: const Icon(Icons.dataset_outlined),
            title: Text(strings.settingsData),
            subtitle: Text(
              env.usesSampleMapData
                  ? strings.settingsDataSample
                  : strings.settingsDataLive,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: Text(strings.settingsAboutBody),
          ),
        ],
      ),
    );
  }

  Future<void> _rename(
    BuildContext context,
    WidgetRef ref,
    String current,
  ) async {
    final name = await showDialog<String>(
      context: context,
      builder: (context) => _RenameDialog(initial: current),
    );
    if (name != null) {
      ref.read(userEventDisplayNameProvider.notifier).remember(name.trim());
    }
  }
}

/// Owns its text controller, so the controller outlives the dialog's exit
/// animation instead of being disposed under it.
class _RenameDialog extends StatefulWidget {
  const _RenameDialog({required this.initial});

  final String initial;

  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  late final _controller = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(strings.settingsProfile),
      content: TextField(
        key: const ValueKey('settings-name-field'),
        controller: _controller,
        autofocus: true,
        maxLength: 40,
        decoration: InputDecoration(labelText: strings.settingsNameLabel),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(strings.settingsCancel),
        ),
        FilledButton(
          key: const ValueKey('settings-name-save'),
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: Text(strings.settingsSave),
        ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      title,
      style: Theme.of(context).textTheme.labelLarge?.copyWith(
        color: Theme.of(context).colorScheme.primary,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

/// The same switch as the map's My location chip: both drive
/// [userLocationProvider], so the position is shared with the assistant only
/// while it is on.
class _LocationSwitch extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final location = ref.watch(userLocationProvider);
    final on = location.status == UserLocationStatus.on;
    final locating = location.status == UserLocationStatus.locating;
    final subtitle = switch (location.failure) {
      _ when location.status != UserLocationStatus.failed =>
        on ? strings.settingsLocationOn : strings.settingsLocationOff,
      DeviceLocationFailure.denied => strings.mapMyLocationDenied,
      DeviceLocationFailure.timeout => strings.mapMyLocationTimeout,
      DeviceLocationFailure.unsupported => strings.mapMyLocationUnsupported,
      _ => strings.mapMyLocationUnavailable,
    };
    return SwitchListTile(
      key: const ValueKey('settings-location'),
      secondary: locating
          ? const SizedBox.square(
              dimension: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(on ? Icons.my_location : Icons.location_searching),
      title: Text(strings.settingsLocationShare),
      subtitle: Text(subtitle),
      value: on || locating,
      onChanged: locating
          ? null
          : (value) {
              final controller = ref.read(userLocationProvider.notifier);
              if (value) {
                unawaited(controller.enable());
              } else {
                controller.disable();
              }
            },
    );
  }
}
