// ai.js — reads a play sheet picture and returns play data, so coaches don't have to place players by hand.
//
// On GitHub, the coach pastes their own Anthropic API key in Settings. It is stored only in this browser,
// never in the code on GitHub. For a whole league, move this call into a small server function
// (see the requirements doc) so nobody needs a key.

export const PROMPT = `You are reading an American football play diagram for a youth team. Read it carefully and return ONLY a JSON object, no other text.

HOW THESE DIAGRAMS ARE DRAWN
- Offensive players are circles with labels (examples: LT, LG, C, RG, RT, TE, TEX, TEY, SE, WB3, QB1, FB4, TB2, HB, X, Y, Z, H). The center is often a square marked C.
- A filled or colored player (often red) is the ball carrier.
- A solid line ending in an arrow is the path a player runs. Curved lines curve: follow the curve with enough points.
- A line ending in a short bar (T) or a diamond is a block; the end of the line is where the block happens.
- A dashed line between two players is the ball being tossed, pitched or handed off.
- A gray or faint line is still a player's path (often a pulling lineman). Follow it.
- Triangles, V shapes or letters like E, T, M, S, C on the far side of the line are DEFENDERS.
- Ignore watermarks, website names and decorations.

COORDINATES (yards)
- The center starts at [0, -1]. x = left (negative) / right (positive) as you look at the picture. y = up the picture (toward the defense) is positive.
- Use the line spacing to set the scale: neighboring offensive linemen are about 2 yards apart.
- Offensive players start behind the line (y between -1 and -8). Defenders start at y between 0.5 and 12.

RETURN THIS SHAPE
{
  "name": "play name written on the sheet",
  "formation": "formation name if written or obvious (e.g. Wing T, I-form, Shotgun), else empty",
  "type": "run" | "pass" | "screen" | "trick",
  "goal": "one plain sentence a 12 year old understands: what the play is trying to do",
  "players": [
    { "label": "label exactly as written, max 4 characters",
      "role": "LT|LG|C|RG|RT|TE|TE2|SE|X|Z|H|Y|W|WB|QB|FB|TB|RB",
      "start": [x, y],
      "action": "block|lead|route|carry|handoff|pass|fake",
      "path": [[x, y], [x, y]] }
  ],
  "ball": { "type": "handoff" | "pitch" | "pass" | "keep", "to": "label of the player who gets the ball" },
  "defense": [[x, y]]
}
RULES
- Exactly the offensive players drawn (normally 11). Role: TE2 = a tight end on the left when there is another tight end; WB = wingback; TB = tailback.
- path = every point along the drawn line from just after the start to the end, 2 to 8 points; curves need more points.
- action: "carry" for the ball carrier; "pass" for a QB who throws or tosses; "handoff" for a QB who hands off; "lead" for a back who blocks ahead of the ball carrier; "fake" for a player faking.
- "defense" = the starting spot of every defender drawn (empty list if none).`;

// Pull the JSON object out of the AI's answer, even if it added words or code fences around it.
export function parsePlayJson(text) {
  const match = String(text || '').replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The reading came back without play data. Try again, or use a clearer picture.');
  try { return JSON.parse(match[0]); } catch { throw new Error('The reading came back incomplete. Try again.'); }
}

// Is reading available? (On GitHub: only when the coach has added an API key.)
export async function aiAvailable(settings) {
  return !!settings?.apiKey;
}

export async function readPlayWithAI(imageDataUrl, { apiKey, model }) {
  if (!apiKey) throw new Error('Add your API key in Settings first.');
  const [meta, data] = imageDataUrl.split(',');
  const mediaType = meta.match(/data:(.*?);/)[1];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: PROMPT }
        ]
      }]
    })
  });
  if (!res.ok) {
    throw new Error(`The AI request failed (error ${res.status}). Check the API key and model name in Settings.`);
  }
  const body = await res.json();
  const text = body.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  return parsePlayJson(text);
}
