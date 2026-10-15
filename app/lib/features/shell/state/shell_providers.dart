import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../agent/data/agent_models.dart';

part 'shell_providers.g.dart';

/// A card item the user tapped in the chat, waiting for the map to show it.
/// The chat is global but the map is one tab, so the shell parks the item
/// here, switches to the map and the map takes it.
final class CardItemRequest {
  const CardItemRequest({required this.sequence, required this.item});

  final int sequence;
  final CardItem item;
}

@Riverpod(keepAlive: true)
class CardItemRequests extends _$CardItemRequests {
  int _sequence = 0;

  @override
  CardItemRequest? build() => null;

  void request(CardItem item) =>
      state = CardItemRequest(sequence: ++_sequence, item: item);

  /// The map has taken the request.
  void consume(int sequence) {
    if (state?.sequence == sequence) state = null;
  }
}

/// The user's choice of light, dark or the device setting.
enum AppThemeChoice { system, light, dark }

@Riverpod(keepAlive: true)
class AppThemeSetting extends _$AppThemeSetting {
  @override
  AppThemeChoice build() => AppThemeChoice.system;

  void choose(AppThemeChoice choice) => state = choice;
}
