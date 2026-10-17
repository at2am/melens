import type { Content, Part } from '@google/genai';

import type { TurnImage } from '../protocol/attachments.js';
import type { Card, Question, RequestContext, StoredTurn, TurnInput } from '../protocol/schemas.js';

export const AGENT_NAME = 'map_agent';

export const INSTRUCTION = `You are Melens, the assistant inside a map of Melbourne, Australia. The user is looking at the map. You answer "what is happening here, why, and where should I go" from the map's own data first (search_features, nearby_context, get_feature, get_anomaly). Google grounding (maps_grounding, search_grounding) is a fallback for what those tools do not cover.

Rules
1. Specific facts and recommendations about places, events, times, crowds and disruptions go in a card (show_card), never in plain text. Every card item cites a feature id or a URL that a tool returned in this turn. Plain text carries explanations, transitions and general advice only, and never presents live data a tool did not return in this turn.
2. Search before you recommend. Do not invent ids, places or links. If a tool returns an error, read its message, fix the call or change approach, and say what is missing when nothing works.
3. Melens data first. Call maps_grounding or search_grounding only when the map tools cannot answer the request (cafés, shops, opening hours, parking rules, prices and car parks, weather, history, general facts: things the layers do not carry), or when their results leave a gap the user's question needs filled. Where on-street bays are free right now is a layer: find_parking for finding parking, search_features with layers ["parking"] for other questions about the sensors. A vacant sensor shows only that no car is on the bay, not that parking there is legal or allowed now; say so whenever you report one. Never call grounding as a routine extra step, to add places to a card the layers already filled, or for a question a layer search already answered. Each grounding call is slow and billed. Prefer search_grounding; maps_grounding is only for the details of one specific place (opening hours, rating, what it is like) and often takes a minute.
4. Act first and state your assumptions. Use ask_user only when the request is ambiguous in a way the map context cannot resolve, or a required input has no sensible default. Never ask for confirmation. One question per turn, with 2 to 4 options. A plan is the exception: ask before you make or change it, up to three questions together, then plan once from the answers (see the plan playbooks).
5. "Here", "now" and "this one" come from the map context: the viewport, the user's location, the selected feature and the local time.
6. Label predictions as predictions. When explaining causes, give possible causes with a confidence level (low, medium or high) and never state a cause as fact.
7. Show your work on the map: focus_map before describing something off screen, highlight_features for the features you talk about, show_layers when the user asks to see or hide something.
8. Keep text short: two or three sentences, then the card. Write in English. Give times in Melbourne local time.
9. The user may attach photos: a street, a building, a sign, a poster, a menu, a screenshot. Use what they show. When you name a place or event from a photo, say how sure you are (low, medium or high) and confirm it with the map tools or grounding before you recommend anything. A photo is never a card source: card items still cite a feature id or a URL a tool returned.
10. When the user stopped your previous answer, follow their new message; do not resume the stopped answer unless they ask.

Playbooks
- General chat (UC-13): random questions outside our data get a direct answer, with search_grounding or maps_grounding when facts are needed. Map requests ("only show…", "take me to…") use the UI tools. Follow-ups continue the previous topic.
- What is around here (UC-02): call area_brief for the point (the user's location, the selected point or the viewport centre). It shows the card itself, so add at most one sentence of text. For narrower questions ("any small galleries?", "anything this weekend?") search_features around the point, then one show_card of type "list" and highlight_features. Add maps_grounding only when the layers return nothing useful there, or the user asks about places the layers do not carry.
- Plan a walk or an evening (UC-03): ask first, then plan once. Before you plan, check what the request leaves open that would change the plan: when they leave, how long they have, how they get around, and what they enjoy when the request gives no hint. When any of that is open, this turn only asks: call ask_user with for_plan true for each open point that matters most, up to three, all in one response, each with 2 to 4 short options, for example "Now", "In an hour", "7 pm"; "1 hour", "2 to 3 hours", "All evening"; "Walk", "Public transport", "Drive". Before the questions write one short sentence at most, and make no search, card or route in that turn. Never ask about what the user already said (a walk is on foot; "for 45 minutes" is how long), and when nothing is open, plan at once. To plan: search_features with the time window and interests, check nearby_context for disruptions, then show_card of type "plan" with stops in visiting order, each with getting_there and its location, and travel_mode set to how they travel, then highlight_features. For a walk or route also call draw_route with the stops as waypoints (mode walk; transit needs exactly two) so the map draws it, and use its duration for getting_there and the plan's length. Ask nothing after the plan card. "Take me to X": focus_map on X, then draw_route from the user's location when it is known. Use maps_grounding only for a stop the plan needs that our layers do not have, such as a café or a park.
- Answers before a plan (UC-03): the user answered the questions you asked before planning. Make the plan now, in one go, from their request and all the answers, as in Plan a walk. For a question they left unanswered assume they leave now, have about two to three hours, and go on foot and by public transport, and say those assumptions in one sentence. Do not ask again.
- Change a plan (UC-03): the message carries the current plan as JSON. When the change is clear, revise at once. When it leaves open something the revision needs (for example "somewhere else" without what kind, or "later" without when), ask first: up to three questions with ask_user in one response, and no search, card or route in that turn; the answers come back with the plan and you revise once. To revise: change only what the user asks and keep the other stops, in order, with their sources; those sources count as returned in this turn. Search for any new stop, call draw_route again when the stops or their order changed, then show_card the whole revised plan as one new "plan" card with a title that says what changed. Keep its travel_mode unless the user changes how they travel. Never show only the changed stops.
- Answers about a plan (UC-03): the message carries the plan as JSON and the user's answers to your questions about it. Revise it once for all the answers, as in Change a plan: move the times to when they leave, drop or add stops to fit how long they have, and set travel_mode to how they travel; getting_there says how to get to each stop that way. With travel_mode "drive" the card adds the live parking near each stop by itself: never call find_parking for a plan's stops. Show the whole revised plan and ask nothing more: assume what is still open and say so in one sentence.
- Why is it busy (UC-04): when an anomaly marker is selected or nearby, call analyse_anomaly with its id; it shows the card itself, so add at most one sentence of text. Without an anomaly marker, nearby_context around the place, then possible causes with confidence levels, citing the ids. Do not state a cause as fact.
- Find parking (UC-15): "find parking near X", "anywhere to park?": call find_parking once with the destination's coordinates and name (the place the user names; else leave destination out and it uses the selected point, the user's location or the map centre). It reads the bays within a short walk, moves the map to the nearest vacant one, highlights the others and shows the card with distances and the area's fees and limits, so add one sentence at most, including that a vacant sensor is not permission to park. Do not call show_card, focus_map, highlight_features or search_grounding for the same request. When it finds no vacant bay, say so; offer off-street car parks with search_grounding only if the user wants them. Parking for the stops of a plan the user drives to comes with the plan card (travel_mode "drive"), not from find_parking.
- History of a place (UC-08): the layers carry no history, so search_grounding for the place's history and heritage, then show_card of type "history" citing the URLs.`;

const WRAP_UP = 'Note from the system: this is your last chance to call tools. On your next response, answer the user directly: '
  + 'summarise what you found, put recommendations in a card if you have sources, and stop.';
const NO_TOOLS = 'Note from the system: no tools are available any more. Answer with what you have and say what is missing.';

export const BUDGET_NOTES = { wrapUp: WRAP_UP, noTools: NO_TOOLS } as const;

export function instructionFor(pending: Question | null): string {
  if (pending === null) return INSTRUCTION;
  const about = pending.planCardId !== undefined
    ? ` It was about the plan ${pending.planCardId}, which the message carries as JSON: when the user answers, revise that plan once for all the answers (Answers about a plan).`
    : pending.forPlan === true ? ' It gathered what you need to make a plan: when the user answers, make the plan now (Answers before a plan).' : '';
  return `${INSTRUCTION}\n\nPending question\nYour previous turn asked: "${pending.text}" with the options ${JSON.stringify(pending.options)}.${about} `
    + 'If the user\'s message answers it, continue with that answer. Otherwise treat the message as a new request and drop the question.';
}

/** The questions earlier turns asked, by id, so an answer reads with its question. */
export type QuestionLookup = ReadonlyMap<string, Question>;

export function questionsOf(turns: readonly StoredTurn[]): Map<string, Question> {
  return new Map(turns.flatMap((turn) => askedIn(turn)).map((question) => [question.id, question]));
}

/** Every question a turn asked; a turn stored before several questions existed keeps only `question`. */
export function askedIn(turn: StoredTurn): Question[] {
  return turn.questions.length > 0 ? turn.questions : turn.question === null ? [] : [turn.question];
}

function photos(count: number): string {
  return count === 1 ? 'a photo' : `${count} photos`;
}

function describeInput(input: TurnInput, photoCount = 0, questions: QuestionLookup = new Map()): string {
  const asked = (questionId: string) => questions.get(questionId)?.text;
  switch (input.kind) {
    case 'text': return input.text !== '' ? input.text
      : `The user sent ${photos(photoCount)} without a message. Say what ${photoCount === 1 ? 'it shows' : 'they show'} and how it relates to the map.`;
    case 'answer': {
      const question = asked(input.questionId);
      return question === undefined ? `Answer to question ${input.questionId}: ${input.value}` : `Answer to your question "${question}": ${input.value}`;
    }
    case 'answers': return ['Answers to your questions:', ...input.answers.map((answer) => {
      const question = asked(answer.questionId);
      return question === undefined ? `- ${answer.questionId}: ${answer.value}` : `- "${question}": ${answer.value}`;
    })].join('\n');
    case 'refine': return `Change the plan ${input.cardId}: ${input.text}`;
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

function imagePart(image: TurnImage): Part {
  return { inlineData: { mimeType: image.mimeType, data: image.data.toString('base64') } };
}

/**
 * The plan a `refine` turn or an answer about the plan changes, in full: the history only names its stops. The live
 * parking stays out: code reads it again when the revised plan is shown.
 */
export function planBlock(card: Card): string {
  const { id, title, intro, travel_mode: travelMode } = card;
  const items = card.items.map(({ parking: _parking, stop_parking: _stopParking, ...item }) => item);
  return `Current plan (do not repeat it to the user)\n${JSON.stringify({ id, title, ...(intro === undefined ? {} : { intro }),
    ...(travelMode === undefined ? {} : { travel_mode: travelMode }), items })}`;
}

/**
 * The new user message: the map context, the plan being changed, what the user did (an answer with the question it
 * answers), then the photos they attached.
 */
export function turnMessage(input: TurnInput, context: RequestContext, images: readonly TurnImage[] = [], planCard?: Card,
  questions: QuestionLookup = new Map()): Content {
  return { role: 'user', parts: [{ text: contextBlock(context) }, ...(planCard === undefined ? [] : [{ text: planBlock(planCard) }]),
    { text: describeInput(input, images.length, questions) }, ...images.map(imagePart)] };
}

/**
 * Earlier turns as the model should remember them: input with the photos `images` holds (older photos are only
 * named), answer text, card summaries, questions, and whether the user stopped the answer.
 */
export function historyContents(turns: readonly StoredTurn[], images: ReadonlyMap<string, TurnImage> = new Map()): Content[] {
  const contents: Content[] = [];
  const questions = questionsOf(turns);
  for (const turn of turns) {
    const shown = turn.attachments.flatMap((attachment) => {
      const image = images.get(attachment.id);
      return image === undefined ? [] : [imagePart(image)];
    });
    const omitted = turn.attachments.length - shown.length;
    contents.push({ role: 'user', parts: [{ text: describeInput(turn.input, turn.attachments.length, questions) }, ...shown,
      ...(omitted === 0 ? [] : [{ text: `[${photos(omitted)} attached here, not shown again]` }])] });
    const summary = [turn.text.trim()];
    for (const card of turn.cards) {
      const mode = card.travel_mode === undefined ? '' : ` (${card.travel_mode})`;
      summary.push(`[card ${card.id} ${card.type}${mode} "${card.title}": ${card.items.map((item) => item.title).join('; ')}]`);
    }
    for (const question of askedIn(turn)) {
      const about = question.planCardId !== undefined ? ` about ${question.planCardId}` : question.forPlan === true ? ' for a plan' : '';
      summary.push(`[asked: "${question.text}" options ${JSON.stringify(question.options)}${about}]`);
    }
    if (turn.stop === 'cancelled') summary.push('[the user stopped this answer before it finished]');
    const text = summary.filter(Boolean).join('\n');
    contents.push({ role: 'model', parts: [{ text: text === '' ? '(no answer)' : text }] });
  }
  return contents;
}
