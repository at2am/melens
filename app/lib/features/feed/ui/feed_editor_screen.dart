import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../map/data/map_models.dart';
import '../data/feed_models.dart';
import '../data/melbourne_areas.dart';
import '../state/feed_providers.dart';
import 'area_picker_screen.dart';
import 'feed_labels.dart';
import 'feed_topic_list.dart';

/// The three ways a feed picks where it reads.
enum _ScopeKind { map, area, city }

/// Creates a feed, or edits the one with [feedId]: its topics, where it
/// reads, and the options its topics have.
class FeedEditorScreen extends ConsumerStatefulWidget {
  const FeedEditorScreen({this.feedId, super.key});

  final String? feedId;

  @override
  ConsumerState<FeedEditorScreen> createState() => _FeedEditorScreenState();
}

class _FeedEditorScreenState extends ConsumerState<FeedEditorScreen> {
  final _name = TextEditingController();
  FeedSubscription? _original;
  bool _initialised = false;
  bool _saving = false;

  Set<FeedTopic> _topics = {FeedTopic.events, FeedTopic.disruptions};
  _ScopeKind _kind = _ScopeKind.area;
  String _areaId = cbdAreaId;
  MapBounds? _box;
  bool _includeUnlocated = false;
  CommunityHorizon _horizon = CommunityHorizon.fortnight;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _initialise(List<FeedSubscription> feeds) {
    if (_initialised) return;
    _initialised = true;
    final feed = [
      for (final feed in feeds)
        if (feed.id == widget.feedId) feed,
    ].firstOrNull;
    if (feed == null) return;
    _original = feed;
    _name.text = feed.name;
    _topics = {...feed.topics};
    _includeUnlocated = feed.includeUnlocated;
    _horizon = feed.communityHorizon;
    switch (feed.scope) {
      case CityFeedScope():
        _kind = _ScopeKind.city;
      case AreaFeedScope(:final areaId):
        _kind = _ScopeKind.area;
        _areaId = areaId;
      case BoxFeedScope(:final bounds):
        _kind = _ScopeKind.map;
        _box = bounds;
    }
  }

  FeedScope? get _scope => switch (_kind) {
    _ScopeKind.city => const CityFeedScope(),
    _ScopeKind.area => AreaFeedScope(_areaId),
    _ScopeKind.map => _box == null ? null : BoxFeedScope(_box!),
  };

  bool get _canSave => !_saving && _topics.isNotEmpty && _scope != null;

  Future<void> _pickArea() async {
    final bounds = await Navigator.of(context).push<MapBounds>(
      MaterialPageRoute(builder: (context) => AreaPickerScreen(initial: _box)),
    );
    if (bounds != null && mounted) setState(() => _box = bounds);
  }

  Future<void> _save() async {
    final strings = AppLocalizations.of(context);
    final scope = _scope;
    if (scope == null || _topics.isEmpty) return;
    final typed = _name.text.trim();
    final name = typed.isEmpty
        ? feedScopeSummary(strings, scope)
        : typed.substring(0, math.min(typed.length, maxFeedNameLength));
    final original = _original;
    final feed = FeedSubscription(
      id: original?.id ?? newFeedId(),
      name: name,
      topics: _topics,
      scope: scope,
      includeUnlocated:
          _includeUnlocated && _topics.any(unlocatedFeedTopics.contains),
      communityHorizon: _horizon,
      enabled: original?.enabled ?? true,
    );
    final controller = ref.read(feedSubscriptionsProvider.notifier);
    setState(() => _saving = true);
    // The list shows the change at once; the editor closes without waiting
    // for the service, and a failed save is reported where the user lands.
    final messenger = ScaffoldMessenger.of(context);
    final saved = original == null
        ? controller.add(feed)
        : controller.replace(feed);
    if (original == null) {
      ref.read(selectedFeedProvider.notifier).select(null);
    }
    context.pop();
    unawaited(
      saved.catchError((Object _) {
        messenger.showSnackBar(SnackBar(content: Text(strings.feedSaveFailed)));
      }),
    );
  }

  Future<void> _delete() async {
    final strings = AppLocalizations.of(context);
    final original = _original;
    if (original == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(strings.feedEditorDeleteTitle(original.name)),
        content: Text(strings.feedEditorDeleteBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(strings.feedEditorCancel),
          ),
          FilledButton(
            key: const ValueKey('feed-delete-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(strings.feedEditorDeleteConfirm),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final removed = ref
        .read(feedSubscriptionsProvider.notifier)
        .remove(original.id);
    if (ref.read(selectedFeedProvider) == original.id) {
      ref.read(selectedFeedProvider.notifier).select(null);
    }
    context.pop();
    unawaited(
      removed.catchError((Object _) {
        messenger.showSnackBar(SnackBar(content: Text(strings.feedSaveFailed)));
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final feeds = ref.watch(feedSubscriptionsProvider);
    final editing = widget.feedId != null;
    final list = feeds.value;
    if (list != null) _initialise(list);

    final Widget body;
    if (list == null) {
      body = feeds.hasError
          ? Center(child: Text(strings.settingsFeedsError))
          : const Center(child: CircularProgressIndicator());
    } else if (editing && _original == null) {
      body = Center(child: Text(strings.feedNotFound));
    } else if (!editing && list.length >= maxFeedSubscriptions) {
      body = Center(
        child: Text(strings.feedLimitReached(maxFeedSubscriptions)),
      );
    } else {
      body = _form(context);
    }
    final ready = list != null && (!editing || _original != null);

    return Scaffold(
      appBar: AppBar(
        title: Text(editing ? strings.feedEdit : strings.feedNew),
        actions: [
          if (ready && editing)
            IconButton(
              key: const ValueKey('feed-delete'),
              tooltip: strings.feedEditorDelete,
              onPressed: () => unawaited(_delete()),
              icon: const Icon(Icons.delete_outline),
            ),
          if (ready && (editing || list.length < maxFeedSubscriptions))
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilledButton(
                key: const ValueKey('feed-save'),
                onPressed: _canSave ? () => unawaited(_save()) : null,
                child: Text(strings.feedEditorSave),
              ),
            ),
        ],
      ),
      body: body,
    );
  }

  Widget _form(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final hint = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final unlocatedApplies = _topics.any(unlocatedFeedTopics.contains);
    return ListView(
      key: const ValueKey('feed-editor'),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      children: [
        TextField(
          key: const ValueKey('feed-name'),
          controller: _name,
          maxLength: maxFeedNameLength,
          decoration: InputDecoration(
            labelText: strings.feedEditorName,
            hintText: strings.feedEditorNameHint,
          ),
        ),
        const SizedBox(height: 16),
        _Heading(strings.feedEditorTopics),
        FeedTopicChips(
          selected: _topics,
          onChanged: (topics) => setState(() => _topics = topics),
        ),
        if (_topics.isEmpty) ...[
          const SizedBox(height: 8),
          Text(
            strings.feedEditorTopicsNone,
            style: hint?.copyWith(color: theme.colorScheme.error),
          ),
        ],
        const SizedBox(height: 24),
        _Heading(strings.feedEditorWhere),
        SegmentedButton<_ScopeKind>(
          key: const ValueKey('feed-scope'),
          showSelectedIcon: false,
          segments: [
            ButtonSegment(
              value: _ScopeKind.map,
              label: Text(strings.feedScopeMap),
            ),
            ButtonSegment(
              value: _ScopeKind.area,
              label: Text(strings.feedScopeArea),
            ),
            ButtonSegment(
              value: _ScopeKind.city,
              label: Text(strings.feedScopeCity),
            ),
          ],
          selected: {_kind},
          onSelectionChanged: (kinds) => setState(() => _kind = kinds.first),
        ),
        const SizedBox(height: 12),
        ...switch (_kind) {
          _ScopeKind.map => [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _box == null
                        ? strings.feedScopeMapNone
                        : feedScopeSummary(strings, BoxFeedScope(_box!)),
                    key: const ValueKey('feed-scope-map-summary'),
                  ),
                ),
                OutlinedButton.icon(
                  key: const ValueKey('feed-scope-map-pick'),
                  onPressed: () => unawaited(_pickArea()),
                  icon: const Icon(Icons.map_outlined),
                  label: Text(
                    _box == null
                        ? strings.feedScopeMapPick
                        : strings.feedScopeMapChange,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(strings.feedScopeMapHint, style: hint),
          ],
          _ScopeKind.area => [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final area in melbourneAreas)
                  ChoiceChip(
                    key: ValueKey('feed-area-${area.id}'),
                    label: Text(area.name),
                    selected: _areaId == area.id,
                    onSelected: (_) => setState(() => _areaId = area.id),
                  ),
              ],
            ),
          ],
          _ScopeKind.city => [Text(strings.feedScopeCityHint, style: hint)],
        },
        if (unlocatedApplies) ...[
          const SizedBox(height: 16),
          SwitchListTile(
            key: const ValueKey('feed-unlocated'),
            contentPadding: EdgeInsets.zero,
            title: Text(strings.feedEditorUnlocated),
            subtitle: Text(strings.feedEditorUnlocatedHint),
            value: _includeUnlocated,
            onChanged: (value) => setState(() => _includeUnlocated = value),
          ),
        ],
        if (_topics.contains(FeedTopic.community)) ...[
          const SizedBox(height: 16),
          _Heading(strings.feedEditorHorizon),
          SegmentedButton<CommunityHorizon>(
            key: const ValueKey('feed-horizon'),
            showSelectedIcon: false,
            segments: [
              ButtonSegment(
                value: CommunityHorizon.today,
                label: Text(strings.feedHorizonToday),
              ),
              ButtonSegment(
                value: CommunityHorizon.week,
                label: Text(strings.feedHorizonWeek),
              ),
              ButtonSegment(
                value: CommunityHorizon.fortnight,
                label: Text(strings.feedHorizonFortnight),
              ),
            ],
            selected: {_horizon},
            onSelectionChanged: (values) =>
                setState(() => _horizon = values.first),
          ),
        ],
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      title,
      style: Theme.of(context).textTheme.titleSmall
          ?.copyWith(fontWeight: FontWeight.w700),
    ),
  );
}

final _random = math.Random();

/// A new feed id: `^[A-Za-z0-9_-]{1,64}$`, unique enough for one user's
/// twenty feeds.
String newFeedId() =>
    'f${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}'
    '${_random.nextInt(1 << 30).toRadixString(36)}';
