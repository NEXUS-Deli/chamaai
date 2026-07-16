-- ============================================================
-- Campanhas de disparo recorrentes
-- Permite repetir automaticamente a mesma campanha (mensagem/mídia)
-- a cada N dias, excluindo dias da semana opcionalmente, repuxando
-- os contatos atuais das pastas de origem a cada ciclo.
-- ============================================================

ALTER TABLE public.campanhas
  ADD COLUMN IF NOT EXISTS recorrente                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recorrencia_intervalo_dias INTEGER CHECK (recorrencia_intervalo_dias > 0),
  ADD COLUMN IF NOT EXISTS recorrencia_dias_excluidos INTEGER[] NOT NULL DEFAULT '{}'
                             CHECK (recorrencia_dias_excluidos <@ ARRAY[0,1,2,3,4,5,6]),
  ADD COLUMN IF NOT EXISTS pasta_ids                 UUID[],
  ADD COLUMN IF NOT EXISTS serie_recorrencia_id       UUID;

-- Índice para consultar rapidamente todas as execuções de uma mesma série
CREATE INDEX IF NOT EXISTS idx_campanhas_serie_recorrencia
  ON public.campanhas(serie_recorrencia_id) WHERE serie_recorrencia_id IS NOT NULL;
