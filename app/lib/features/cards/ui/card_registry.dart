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
  Widget? footer,
}) => switch (card.type) {
  CardType.areaBrief => AgentCardView(
    card: card,
    icon: Icons.explore_outlined,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
    footer: footer,
  ),
  CardType.anomalyAnalysis => AgentCardView(
    card: card,
    icon: Icons.insights_outlined,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
    footer: footer,
  ),
  CardType.plan => AgentCardView(
    card: card,
    icon: Icons.route_outlined,
    numbered: true,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
    footer: footer,
  ),
  CardType.history => AgentCardView(
    card: card,
    icon: Icons.history_edu_outlined,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
    footer: footer,
  ),
  CardType.list => AgentCardView(
    card: card,
    icon: Icons.list_alt_outlined,
    onItemTap: onItemTap,
    onOpenSource: onOpenSource,
    footer: footer,
  ),
};
