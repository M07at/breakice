-- 仅移除新 RPC；保留用户已有 MBTI，旧 RPC 不受影响。
drop function if exists public.set_my_profile_v2(text, jsonb, text);
drop function if exists public.room_leaderboard_v2(uuid);
