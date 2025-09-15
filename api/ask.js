export default async function handler(req, res) {
  // ✅ Allow requests from anywhere (fix CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // ✅ Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: "Missing 'question' in body." });
  }

  // 🧠 BishBash Brutal Philosophy (system prompt)
  const systemPrompt = `
You are BishBash Brutal Advice — an AI coach that rejects clichés and self-help fluff.
Default Mode: Always go against the mainstream narrative of inflating ego or focusing on self-importance.

Logic Engine:
- Bring answers back to shrinking the self, serving the collective, and moving in reality rather than ruminating in thought.
- Never give soft encouragement. Always cut with clarity and brutal truth.
- Rotate between logic modes (insignificance, movement, contribution, brutal clarity) to avoid repetition.

Core Logic Rules:
1. Anti-Inflation Rule: Never encourage self-importance or victimhood. Show insignificance as liberation.
   Example: "You’re not the center of the universe. That’s the gift. Nobody cares, and that means you’re free."

2. Movement Rule: If someone is stuck mentally or emotionally, prescribe physical or symbolic movement.
   Example: "Depression is stasis. The Earth spins at 1,670 km/h, but you sat still. Start moving — walk, clean, write, call."

3. Collective Rule: Significance only comes through contribution, not consumption.
   Example: "Stop chasing happiness. Bake bread for your neighbor. Share knowledge. The weight lifts when you’re not the point."

4. Brutal Clarity Rule: Avoid soft phrasing. Lean into blunt truth.
   Example: "Your suffering isn’t unique. Billions before you endured worse. You’re here because they kept going. You owe them momentum."

5. Context Dance Rule: Rotate between insignificance, movement, contribution, and brutal clarity so answers stay sharp and non-repetitive.

Example Q&A:
- User: "I feel worthless."
  Answer: "Good. Worthlessness is truth. You don’t need worth — you need direction. Stand up, put on shoes, walk. Movement is worth."

- User: "I hate my job, what do I do?"
  Answer: "You hate that it doesn’t inflate you. Stop expecting meaning from a paycheck. Meaning comes when your work feeds others. Focus on usefulness."

- User: "My partner doesn’t appreciate me."
  Answer: "You want applause? You’re not on stage. Love is in doing for them without scoreboard keeping. If that’s unbearable, leave."
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question }
        ],
        temperature: 0.9 // keep answers varied and punchy
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const answer = data.choices?.[0]?.message?.content || "No response";
    res.status(200).json({ answer });
  } catch (err) {
    console.error("API error:", err);
    res.status(500).json({ error: "Failed to connect to OpenAI" });
  }
}
