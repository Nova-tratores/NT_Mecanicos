-- Tabela para check-in diario do tecnico (escolha de veiculo + destino)
CREATE TABLE IF NOT EXISTS checkin_diario (
  id BIGSERIAL PRIMARY KEY,
  tecnico_nome TEXT NOT NULL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  placa TEXT NOT NULL,
  id_ordem TEXT NOT NULL,
  cliente TEXT,
  destino TEXT,
  lat_destino DOUBLE PRECISION,
  lng_destino DOUBLE PRECISION,
  distancia_km DOUBLE PRECISION,
  tempo_estimado_min INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tecnico_nome, data)
);

-- RLS
ALTER TABLE checkin_diario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkin_diario_all" ON checkin_diario FOR ALL USING (true) WITH CHECK (true);
