-- Tabela para armazenar push subscriptions dos técnicos
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tecnico_nome text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_sub_tecnico ON push_subscriptions (tecnico_nome);

-- Permitir acesso via anon key (RLS)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Técnicos podem gerenciar suas subscriptions"
  ON push_subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger: quando uma OS é inserida, notifica o técnico
CREATE OR REPLACE FUNCTION notify_tecnico_nova_os()
RETURNS trigger AS $$
BEGIN
  -- Notifica técnico principal
  IF NEW."Os_Tecnico" IS NOT NULL AND NEW."Os_Tecnico" <> '' THEN
    INSERT INTO mecanico_notificacoes (tecnico_nome, tipo, titulo, descricao, link, lida)
    VALUES (
      NEW."Os_Tecnico",
      'nova_os',
      'Nova OS atribuída: ' || NEW."Id_Ordem",
      'Cliente: ' || COALESCE(NEW."Os_Cliente", '-'),
      '/os/' || NEW."Id_Ordem" || '/preencher',
      false
    );
  END IF;

  -- Notifica técnico secundário (se houver)
  IF NEW."Os_Tecnico2" IS NOT NULL AND NEW."Os_Tecnico2" <> '' THEN
    INSERT INTO mecanico_notificacoes (tecnico_nome, tipo, titulo, descricao, link, lida)
    VALUES (
      NEW."Os_Tecnico2",
      'nova_os',
      'Nova OS atribuída: ' || NEW."Id_Ordem",
      'Cliente: ' || COALESCE(NEW."Os_Cliente", '-'),
      '/os/' || NEW."Id_Ordem" || '/preencher',
      false
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ativar trigger
DROP TRIGGER IF EXISTS trg_nova_os_notifica ON "Ordem_Servico";
CREATE TRIGGER trg_nova_os_notifica
  AFTER INSERT ON "Ordem_Servico"
  FOR EACH ROW
  EXECUTE FUNCTION notify_tecnico_nova_os();
