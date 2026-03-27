-- Track when end-counting last ran, so recounts only use newer sessions
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS last_count_ended_at timestamptz;
