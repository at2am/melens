import 'package:material_ui/material_ui.dart';

import '../../agent/data/agent_models.dart';
import 'agent_card_view.dart';

typedef CardItemCallback = void Function(CardItem item);

/// One widget per card type (agent-protocol.md, Flutter implementation).
///
/// The switch must handle every [CardType], so a new type never renders as
/// nothing. The first version shares one layout and varies the icon and the
/// numbering; the use-case owners replace entries as their cards settle.
Widget buildAgentCard(
  AgentCard card, {
  CardItemCallback? onItemTap,
  ValueChanged<Uri>? onOpenSource,
}) => switch (card.type) {
  CardType.areaBrief => AgentCardView(
    card: card,
    icon: Icons.explore_outlined,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
  ),
  CardType.anomalyAnalysis => AgentCardView(
    card: card,
    icon: Icons.insights_outlined,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
  ),
  CardType.plan => AgentCardView(
    card: card,
    icon: Icons.route_outlined,
    numbered: true,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
  ),
  CardType.history => AgentCardView(
    card: card,
    icon: Icons.history_edu_outlined,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
  ),
  CardType.list => AgentCardView(
    card: card,
    icon: Icons.list_alt_outlined,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
  ),
};
