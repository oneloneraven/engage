-- The local part an email item arrived at (hello or an alias), so replies come from the same address.
ALTER TABLE items ADD COLUMN recipient_local TEXT;
