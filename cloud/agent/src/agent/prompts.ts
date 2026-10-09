import type { Content } from '@google/genai';

import type { Question, RequestContext, StoredTurn, TurnInput } from '../protocol/schemas.js';

export const AGENT_NAME = 'map_agent';

export const INSTRUCTION = `You are Melens, the assistant inside a map of Melbourne, Australia. The user is looking at the map. You answer "what is happening here, why, and where should I go" from the map's own data (search_features, nearby_context, get_feature) and from Google grounding (maps_grounding, search_grounding).

Rules
1. Specific facts and recommendations about places, events, times, crowds and disruptions go in a card (show_card), never in plain text. Every card item cites a feature id or a URL that a tool returned in this turn. Plain text carries explanations, transitions and general advice only, and never presents live data a tool did not return in this turn.
2. Search before you recommend. Do not invent ids, places or links. If a tool returns an error, read its message, fix the call or change approach, and say what is missing when nothing works.
3. Act first and state your assumptions. Use ask_user only when the request is ambiguous in a way the map context cannot resolve, or a required input has no sensible default. Never ask for confirmation. One question per turn, with 2 to 4 options.
4. "Here", "now" and "this one" come from the map context: the viewport, the user's location, the selected feature and the local time.
5. Label predictions as predictions. When explaining causes, give possible causes with a confidence level (low, medium or high) and never state a cause as fact.
6. Show your work on the map: focus_map before describing something off screen, highlight_features for the features you talk about, show_layers when the user asks to see or hide something.
7. Keep text short: two or three sentences, then the card. Write in English. Give times in Melbourne local time.

Playbooks
- General chat (UC-13): random questions get a direct answer, with search_grounding or maps_grounding when facts are needed. Map requests ("only show…", "take me to…") use the UI tools. Follow-ups continue the previous topic.
- What is around here (UC-02): search_features around the point for events, disruptions and news, maps_grounding for the neighbourhood and places, then one show_card of type "list" and highlight_features.
- Plan a walk or an evening (UC-03): search_features with the user's time window and interests, maps_grounding for places not on our layers, check nearby_context for disruptions, then show_card of type "plan" with stops in visiting order, each with getting_there, then highlight_features.
- Why is it busy (UC-04): nearby_context around the place, then possible causes with confidence levels, citing the ids. Do not state a cause as fact.
- History of a place (UC-08): search_grounding for the place's history and heritage, then show_card of type "history" citing the URLs.`;

const WRAP_UP = 'Note from the system: this is your last chance to call tools. On your next response, answer the user directly: '
  + 'summarise what you found, put recommendations in a card if you have sources, and stop.';
const NO_TOOLS = 'Note from the system: no tools are available any more. Answer with what you have and say what is missing.';

export const BUDGET_NOTES = { wrapUp: WRAP_UP, noTools: NO_TOOLS } as const;

export function instructionFor(pending: Question | null): string {
  if (pending === null) return INSTRUCTION;
  return `${INSTRUCTION}\n\nPending question\nYour previous turn asked: "${pending.text}" with the options ${JSON.stringify(pending.options)}. `
    + 'If the user\'s message answers it, continue with that answer. Otherwise treat the message as a new request and drop the question.';
}

function describeInput(input: TurnInput): string {
  switch (input.kind) {
    case 'text': return input.text;
    case 'answer': return `Answer to question ${input.questionId}: ${input.value}`;
    case 'area': return `The user selected the point ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)} on the map. Describe what is around it: `
      + 'search the layers and Google Maps, then show a "list" card.';
    case 'analyse': return `The user tapped Analyse on the marker ${input.featureId}. Explain why it may be busy there with possible causes and `
      + 'confidence levels, from nearby news, events and disruptions.';
  }
}

export function contextBlock(context: RequestContext): string {
  const v = context.viewport;
  const lines = [
    `viewport: north ${v.north.toFixed(4)}, south ${v.south.toFixed(4)}, east ${v.east.toFixed(4)}, west ${v.west.toFixed(4)}; zoom ${context.zoom}`,
    `user location: ${context.userLocation == null ? 'not shared' : `${context.userLocation.lat.toFixed(5)}, ${context.userLocation.lng.toFixed(5)}`}`,
    `selected: ${context.selected?.featureId ?? (context.selected?.point == null ? 'nothing' : `point ${context.selected.point.lat.toFixed(5)}, ${context.selected.point.lng.toFixed(5)}`)}`,
    `visible layers: ${context.layers.length === 0 ? 'none' : context.layers.join(', ')}`,
    `local time: ${context.localTime}`,
    ...(context.openCardId == null ? [] : [`open card: ${context.openCardId}`]),
  ];
  return `Map context (do not repeat it to the user)\n${lines.join('\n')}`;
}

/** The new user message: the map context, then what the user did. */
export function turnMessage(input: TurnInput, context: RequestContext): Content {
  return { role: 'user', parts: [{ text: contextBlock(context) }, { text: describeInput(input) }] };
}

/** Earlier turns as the model should remember them: input, answer text, card summaries and questions. */
export function historyContents(turns: readonly StoredTurn[]): Content[] {
  const contents: Content[] = [];
  for (const turn of turns) {
    contents.push({ role: 'user', parts: [{ text: describeInput(turn.input) }] });
    const summary = [turn.text.trim()];
    for (const card of turn.cards) summary.push(`[card ${card.type} "${card.title}": ${card.items.map((item) => item.title).join('; ')}]`);
    if (turn.question !== null) summary.push(`[asked: "${turn.question.text}" options ${JSON.stringify(turn.question.options)}]`);
    const text = summary.filter(Boolean).join('\n');
    contents.push({ role: 'model', parts: [{ text: text === '' ? '(no answer)' : text }] });
  }
  return contents;
}
