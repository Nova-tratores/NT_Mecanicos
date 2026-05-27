-- Cache de vias com maxspeed do OpenStreetMap (Overpass API)
-- Cada linha = um "tile" geográfico (~1.1km × 1.1km na latitude de Botucatu),
-- chave = "lat.XX,lng.XX" (lat e lng arredondados a 2 casas decimais).
-- Conteúdo = lista de vias com geometry + maxspeed + tipo (highway).
--
-- Reaproveitado entre técnicos: vias não mudam de velocidade com frequência.
-- TTL recomendado: 30 dias (refetch quando updated_at fica velho).
--
-- Execute no SQL Editor do Supabase Dashboard.

CREATE TABLE IF NOT EXISTS maxspeed_tile_cache (
  tile_key TEXT PRIMARY KEY,
  vias JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maxspeed_cache_updated
  ON maxspeed_tile_cache (updated_at);

ALTER TABLE maxspeed_tile_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON maxspeed_tile_cache FOR ALL USING (true) WITH CHECK (true);
