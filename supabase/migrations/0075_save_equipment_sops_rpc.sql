-- Migration 0075 — atomic save for the equipment SOP editor.
--
-- The Phase-1 editor saves a whole working-copy (N tasks + their SOPs + deletes)
-- at once. Doing that as a client-side loop is non-transactional: a mid-loop
-- failure (e.g. a duplicate facet+name) commits some rows and strands others,
-- and a retry double-inserts. This SECURITY DEFINER RPC does the entire save in
-- ONE transaction — any error rolls the whole thing back — and stamps updated_by
-- from the caller. Gate mirrors the table RLS: current_user_can_edit_kb().
--
-- p_rows = jsonb array of
--   { taskId?, sopId?, facet, name, body, tools, frequency, safetyLoto, sortOrder }
-- p_deleted = uuid[] of equipment_tasks ids to remove (cascade removes their sops).

create or replace function save_equipment_sops(
  p_equipment_id uuid,
  p_rows         jsonb,
  p_deleted      uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid;
  r          jsonb;
  v_task_id  uuid;
  v_name     text;
  v_has_sop  boolean;
begin
  if not current_user_can_edit_kb() then
    raise exception 'not authorized to edit SOPs';
  end if;

  select id into v_uid from users where auth_user_id = auth.uid() and active limit 1;

  if p_deleted is not null and array_length(p_deleted, 1) is not null then
    delete from equipment_tasks
     where id = any(p_deleted) and equipment_id = p_equipment_id;
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_name := btrim(coalesce(r->>'name', ''));
    if v_name = '' then continue; end if;  -- skip blank rows

    if coalesce(r->>'taskId', '') = '' then
      insert into equipment_tasks (equipment_id, facet, name, sort_order, updated_by)
      values (p_equipment_id, r->>'facet', v_name, coalesce((r->>'sortOrder')::int, 0), v_uid)
      returning id into v_task_id;
    else
      v_task_id := (r->>'taskId')::uuid;
      update equipment_tasks
         set facet = r->>'facet', name = v_name,
             sort_order = coalesce((r->>'sortOrder')::int, 0),
             updated_by = v_uid, updated_at = now()
       where id = v_task_id and equipment_id = p_equipment_id;
    end if;

    v_has_sop := coalesce(btrim(r->>'body'), '')      <> ''
              or coalesce(btrim(r->>'tools'), '')     <> ''
              or coalesce(btrim(r->>'frequency'), '') <> ''
              or coalesce(r->>'safetyLoto', '')       <> '';

    if coalesce(r->>'sopId', '') <> '' then
      if v_has_sop then
        update sops set
          body        = nullif(btrim(coalesce(r->>'body', '')), ''),
          tools       = nullif(btrim(coalesce(r->>'tools', '')), ''),
          frequency   = nullif(btrim(coalesce(r->>'frequency', '')), ''),
          safety_loto = nullif(r->>'safetyLoto', ''),
          updated_by  = v_uid, updated_at = now()
        where id = (r->>'sopId')::uuid;
      else
        delete from sops where id = (r->>'sopId')::uuid;  -- cleared to empty
      end if;
    elsif v_has_sop then
      insert into sops (level, equipment_task_id, body, tools, frequency, safety_loto, updated_by)
      values ('equipment', v_task_id,
              nullif(btrim(coalesce(r->>'body', '')), ''),
              nullif(btrim(coalesce(r->>'tools', '')), ''),
              nullif(btrim(coalesce(r->>'frequency', '')), ''),
              nullif(r->>'safetyLoto', ''),
              v_uid);
    end if;
  end loop;
end;
$$;

grant execute on function save_equipment_sops(uuid, jsonb, uuid[]) to authenticated;
