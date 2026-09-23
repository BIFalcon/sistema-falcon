-- GOP, GG e ADM podem apenas LER a conferência de notas fiscais dos hotéis
-- aos quais têm acesso. Inserção/remoção segue restrita a Controladoria,
-- Patronos e papéis master.
drop policy if exists nf_opera_insert_scoped on public.nf_opera_entries;
create policy nf_opera_insert_scoped on public.nf_opera_entries
for insert to authenticated
with check (
  public.can_view_hotel_data(auth.uid(), hotel_id)
  and (public.is_master(auth.uid()) or public.has_role(auth.uid(), 'controladoria') or public.has_role(auth.uid(), 'patronos'))
);

drop policy if exists nf_opera_delete_scoped on public.nf_opera_entries;
create policy nf_opera_delete_scoped on public.nf_opera_entries
for delete to authenticated
using (
  public.can_view_hotel_data(auth.uid(), hotel_id)
  and (public.is_master(auth.uid()) or public.has_role(auth.uid(), 'controladoria') or public.has_role(auth.uid(), 'patronos'))
);

drop policy if exists nf_nota_insert_scoped on public.nf_nota_entries;
create policy nf_nota_insert_scoped on public.nf_nota_entries
for insert to authenticated
with check (
  public.can_view_hotel_data(auth.uid(), hotel_id)
  and (public.is_master(auth.uid()) or public.has_role(auth.uid(), 'controladoria') or public.has_role(auth.uid(), 'patronos'))
);

drop policy if exists nf_nota_delete_scoped on public.nf_nota_entries;
create policy nf_nota_delete_scoped on public.nf_nota_entries
for delete to authenticated
using (
  public.can_view_hotel_data(auth.uid(), hotel_id)
  and (public.is_master(auth.uid()) or public.has_role(auth.uid(), 'controladoria') or public.has_role(auth.uid(), 'patronos'))
);

drop policy if exists nf_uploads_insert_scoped on public.nf_uploads;
create policy nf_uploads_insert_scoped on public.nf_uploads
for insert to authenticated
with check (
  public.can_view_hotel_data(auth.uid(), hotel_id)
  and (public.is_master(auth.uid()) or public.has_role(auth.uid(), 'controladoria') or public.has_role(auth.uid(), 'patronos'))
);

drop policy if exists nf_uploads_delete_scoped on public.nf_uploads;
create policy nf_uploads_delete_scoped on public.nf_uploads
for delete to authenticated
using (
  public.can_view_hotel_data(auth.uid(), hotel_id)
  and (public.is_master(auth.uid()) or public.has_role(auth.uid(), 'controladoria') or public.has_role(auth.uid(), 'patronos'))
);