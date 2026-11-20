-- ai_scores 增加 AI 猜测结果与用时，画廊要展示
alter table public.ai_scores add column if not exists ai_guess text;
alter table public.ai_scores add column if not exists ai_seconds numeric;
