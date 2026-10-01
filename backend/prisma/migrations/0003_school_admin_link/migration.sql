-- Registration creates the school (inactive) and the future super admin's user.
-- This column remembers who that user is, so approval can give them the role.
ALTER TABLE schools
  ADD COLUMN admin_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT;
