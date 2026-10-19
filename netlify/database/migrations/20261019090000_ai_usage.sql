-- No prompts, IP addresses or credentials are stored here.
CREATE TABLE ai_usage_months (
  month text PRIMARY KEY,
  total integer NOT NULL CHECK (total >= 0),
  daily jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
