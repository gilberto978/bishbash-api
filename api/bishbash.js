// api/bishbash.js

export default async function handler(req, res) {
  try {
    const query = req.query.query || "Give me brutal life advice";

    // Safety guard: crisis phrases → redirect to professional help
    const crisisCheck = /(suicide|kill myself|self-harm|want to die)/i.test(query);
    if (crisisCheck) {
      return res.status(200).json({
        illusion: "You’re not ‘beyond help’. That’s the lie.",
        reframe: "Pain distorts perspective. Right now you need humans, not hot takes.",
        clarity: "This is urgent, not philosophical.",
        shove: "Call your local crisis line now or reach out to someone you trust immediately."
      });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // cheaper, fast model
        temperature: 0.8,
        max_tokens: 280,
        messages: [
          {
            role: "system",
            content: `You are BishBash: brutally honest, contrarian, anti-status-quo.
Always answer in 4 labeled parts:
1) Cut Illusion
2) Reframe Reality
3) Brutal Clarity
4) Actionable Shove

Rules:
- Rotate which logic you draw from (movement > stasis, shrink self, serve collective, brutal clarity, boring builds, comparison is poison, pain isn’t special).
- Keep it short, sharp, quotable. Max 6 sentences total.
- Do not repeat the same phrases across responses.
- If user hints at self-harm or suicide, stop and redirect them to professional help.`
          },
          { role: "user", content: query }
        ]
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "No response.";

    res.status(200).json({ answer: text });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
}
