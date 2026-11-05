# DeepSeek drawing similarity grading — v23

Recorded: 6 November 2026, Asia/Shanghai.

## Status

Implemented and deployed to the existing Supabase project for ordinary **你画我猜** (`draw-score`)
and **你画我猜谁是卧底** (`ai-score`). After manual use, the user reported DeepSeek satisfactory and
authorized committing the integration and changelog to Gitee `master` on 6 November 2026.
Application smoke tests and additional scoring calls were not run after the instruction to leave drawing verification to the user.

## Grading behavior

The server reads the assigned private prompt and private uploaded artwork, then sends the actual image and prompt
to `deepseek-flash` at the official DeepSeek API. The model returns JSON with a semantic similarity grade,
the subject it actually sees and a short Chinese explanation. The server validates the result and saves it.

The common rubric is:

- 0–10: blank, unrelated scribbles, a written answer without a drawing, or wholly unrelated content.
- 11–39: weak relation to the target.
- 40–69: related shapes, but the subject is unclear or important features are missing.
- 70–89: the main subject is substantially represented.
- 90–100: the subject is clear and has the key identifying features.

Rough finger drawing is acceptable; neatness and drawing speed are not separate scoring factors.
Image text and the target are treated as data, not instructions to change the grade.
The grade is not a calibrated probability or a guarantee that an ambiguous picture has one objectively correct interpretation.

Both modes use `supabase/functions/_shared/deepseek.ts`, with result version `deepseek-similarity-v1`.
Existing room permissions and image-path checks remain. Successful DeepSeek results are cached for consistent repeated display;
old classifier results and old unsupported-prompt receipts are not reused as the new grades.
Failures/timeouts remain unavailable scores rather than invented grades. The Who Undercover round-point rules are unchanged.

The ordinary drawing page's old 46-class word filter was removed. The backend accepts assigned prompts such as 图书馆
without reducing them to a fixed QuickDraw category. A vision model may still disagree with a human about an ambiguous drawing.

## Configuration and operation

- Model: `deepseek-flash`.
- API endpoint: `https://api.deepseek.com/chat/completions`.
- Key: Supabase secret named `DEEPSEEK_API_KEY`; no value is stored in source or this document.
- Requests use a fixed rubric, temperature 0, disabled thinking mode and JSON output.
- The request contains the private artwork and target only; it does not need the player's nickname or MBTI.
- A 40-second model-request timeout fits within the existing client AI request window.
- Calls are billed to the supplied DeepSeek account.
- The temporary local key-configuration file was deleted after setting the Supabase secret.
- AI grading no longer depends on the local Drawzy Python process or Cloudflare quick tunnel. Game timers and hosting behavior are otherwise unchanged.

## Feasibility evidence and verification boundary

Before the user's instruction to skip smoke tests, a bounded direct API feasibility check authenticated successfully
and confirmed access to `deepseek-flash`. The same standalone apple drawing received **85/100 for 苹果**
and **0/100 for 图书馆**, with the model identifying an apple in both requests. Those responses took about 5.5 seconds each.
They demonstrate image-input availability and a useful distinction between matching/mismatching prompts;
they are not an application regression or a prediction of every drawing's grade.

After the user's clarification, only compilation/type checking, server-secret setup and deployment were performed.
No new drawing-score calls or smoke suites were run. The user subsequently reported the DeepSeek behavior satisfactory.
This is user acceptance feedback, not a full regression claim. Existing saved grades from old rounds are historical results.

## Official references checked

- [DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/): image support and request format.
- [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing/): `deepseek-flash` supports vision; Pro is not the vision model.
- [JSON Output](https://api-docs.deepseek.com/guides/json_mode/): structured response configuration.
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/): disabling thinking for this short grading response.
