-- 破冰局 · 集成修正 17：一局结束后房间仍停在「游戏中」，直到主持人结束本局
--
-- 新的结束流程（产品定稿）：
--   1. 一局自然结束 → 所有人停在结算页；
--   2. 玩家可以自己点「退出，回到大厅」，也可以在大厅点「回到游戏」再进来（仍是结算页）；
--   3. 只有主持人点「结束本局」→ 房间回大厅 + 全场恢复未准备。
--
-- 原来 uc_commit_action 在 ended 时直接把房间打回 lobby，导致结算页一出现
-- 「回到游戏」就消失、大家被动回大厅。这里去掉那两条 update：
-- 结束本局只由 end_room_game（主持人操作）触发。

create or replace function public.uc_commit_action(
  p_game_id uuid,
  p_actor uuid,
  p_request_id text,
  p_fingerprint text,
  p_state jsonb,
  p_view jsonb,
  p_version bigint,
  p_status text default 'active',
  p_ended_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.game_receipts%rowtype;
  v_room uuid;
begin
  select * into v_existing
  from public.game_receipts
  where game_id = p_game_id and user_id = p_actor and request_id = p_request_id;

  if found then
    if v_existing.fingerprint <> p_fingerprint then
      raise exception 'REQUEST_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing.result_version;
  end if;

  if p_status not in ('active', 'ended') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;

  insert into public.game_receipts (game_id, user_id, request_id, fingerprint, result_version)
  values (p_game_id, p_actor, p_request_id, p_fingerprint, p_version);

  update public.games
  set state = p_state,
      view = p_view,
      version = p_version,
      status = p_status,
      ended_at = case when p_status = 'ended' then now() else ended_at end,
      ended_reason = coalesce(p_ended_reason, ended_reason)
  where id = p_game_id
  returning room_id into v_room;

  if v_room is null then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 注意：这里**不**动 rooms。一局结束只代表「结算中」，
  -- 房间仍是 playing，结算页因此可以一直停留、也能从大厅点「回到游戏」回来。
  -- 真正的收尾（回大厅 + 清准备）由主持人调用 end_room_game 完成。

  return p_version;
end;
$$;

revoke all on function public.uc_commit_action(uuid, uuid, text, text, jsonb, jsonb, bigint, text, text) from public;
