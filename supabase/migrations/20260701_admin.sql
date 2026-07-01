-- ── PROFILES (sincroniza nome/email de auth.users) ──────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome      TEXT,
  email     TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own profile" ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Trigger para sincronizar automaticamente
CREATE OR REPLACE FUNCTION sync_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, nome, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'nome', NEW.email)
  ON CONFLICT (id) DO UPDATE
    SET nome  = EXCLUDED.nome,
        email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile ON auth.users;
CREATE TRIGGER trg_sync_profile
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_profile();

-- Backfill de usuários existentes
INSERT INTO profiles (id, nome, email)
SELECT id, raw_user_meta_data->>'nome', email FROM auth.users
ON CONFLICT (id) DO UPDATE
  SET nome  = EXCLUDED.nome,
      email = EXCLUDED.email;

-- ── ADMINS ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admins (
  user_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- Usuário pode verificar se ele mesmo é admin
CREATE POLICY "admins read self" ON admins FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admins podem ler todos os profiles
CREATE POLICY "admins read all profiles" ON profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));

-- ── RLS: ADMIN VÊ DADOS DE TODOS OS USUÁRIOS ─────────────────────────────────

CREATE POLICY "admins see all campanhas" ON campanhas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));

CREATE POLICY "admins see all contatos_campanha" ON contatos_campanha FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));

CREATE POLICY "admins see all instancias" ON instancias FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));

CREATE POLICY "admins see all leads" ON leads FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));

CREATE POLICY "admins see all pastas" ON pastas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));
