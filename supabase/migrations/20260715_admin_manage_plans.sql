-- ============================================================
-- Permite que admins leiam e alterem o plano de qualquer usuário
-- (hoje só existia a policy "own_user_plans", que restringe leitura/
-- escrita ao próprio usuário — nada permitia um admin ver ou trocar
-- o plano de outra pessoa pelo client).
-- ============================================================

CREATE POLICY "admins see all user_plans" ON public.user_plans
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()));

CREATE POLICY "admins manage user_plans" ON public.user_plans
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()));
