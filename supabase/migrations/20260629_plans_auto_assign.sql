-- ============================================================
-- Trigger: atribui o plano Starter automaticamente ao novo usuário
-- ============================================================
-- Sem isso, todo novo cadastro ficaria bloqueado sem plano.
-- O plano pode ser alterado manualmente via SQL Editor do Supabase.

CREATE OR REPLACE FUNCTION public.assign_default_plan()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_id UUID;
BEGIN
  SELECT id INTO v_plan_id FROM public.plans WHERE name = 'Starter' LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.user_plans (user_id, plan_id, active)
    VALUES (NEW.id, v_plan_id, true)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_assign_default_plan
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_default_plan();
