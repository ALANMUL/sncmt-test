-- =========================================================
-- SNCMT — PostgreSQL schema v5
-- Requires PostgreSQL 15+ (security_invoker views). Run on an EMPTY database.
--
-- Keep this as a raw SQL migration (Prisma cannot express the triggers,
-- partial/expression indexes or the exclusion constraint). Afterwards run
-- `prisma db pull` to sync schema.prisma.
--
-- HOW THE DB KNOWS WHO IS ACTING (no session variables, safe with pooling):
--   * INSERT into money/role/permission tables: the row's own created_by /
--     assigned_by / granted_by column is the actor.
--   * UPDATE of fee_rates / exam_results: the app sets the WRITE-ONLY column
--     acting_user_id on every update. A trigger copies it to updated_by and
--     clears it, so a forgotten value can never be reused (fails closed).
--
-- BOOTSTRAP: create the first platform admin with assigned_by = NULL (only
-- allowed while no PLATFORM_ADMIN exists), then assign everything else with
-- assigned_by set.
-- =========================================================
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- ENUMS ----------
CREATE TYPE gender_type    AS ENUM ('MALE','FEMALE','OTHER');
CREATE TYPE fee_category   AS ENUM ('ONE_TIME','MONTHLY');
CREATE TYPE fee_status     AS ENUM ('UNPAID','PARTIAL','PAID','WAIVED');
CREATE TYPE payment_method AS ENUM ('CASH','BANK','BKASH','NAGAD','ROCKET','CARD','OTHER');
CREATE TYPE txn_type       AS ENUM ('PAYMENT','REVERSAL','ADJUSTMENT');
CREATE TYPE adjust_reason  AS ENUM ('WAIVER','WRITE_OFF','DISCOUNT','SCHOLARSHIP','CORRECTION');

-- ---------- generic helpers ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; insert a correcting row instead', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

-- =========================================================
-- CORE / SAAS
-- =========================================================
CREATE TABLE schools (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  subdomain   CITEXT NOT NULL UNIQUE,
  email       CITEXT NOT NULL UNIQUE,
  mobile      VARCHAR(50),
  address     TEXT,
  logo_url    VARCHAR(500),
  banner_url   VARCHAR(500),
  timezone    VARCHAR(60) NOT NULL DEFAULT 'Asia/Dhaka',
  currency    VARCHAR(10) NOT NULL DEFAULT 'BDT',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ
);

CREATE TABLE modules (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        VARCHAR(100) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ
);

CREATE TABLE school_modules (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  module_id    BIGINT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  purchased_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ,
  UNIQUE (school_id, module_id)
);

-- =========================================================
-- AUTH / RBAC / PERMISSIONS
-- =========================================================
CREATE TABLE roles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        VARCHAR(100) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ
);

-- email: platform admin + school super admin. mobile (+8801XXXXXXXXX): everyone else.
-- The app converts 017XXXXXXXX -> +88017XXXXXXXX before saving.
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  profile_picture_url VARCHAR(500),
  email         CITEXT UNIQUE,
  mobile        VARCHAR(20) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ,
  CONSTRAINT chk_users_identifier CHECK (email IS NOT NULL OR mobile IS NOT NULL),
  CONSTRAINT chk_users_mobile_fmt CHECK (mobile IS NULL OR mobile ~ '^\+8801[0-9]{9}$')
);

CREATE TABLE user_roles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id   BIGINT REFERENCES schools(id) ON DELETE RESTRICT,   -- NULL only for PLATFORM_ADMIN
  role_id     BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,     -- NULL only for the bootstrap platform admin
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_user_school_role
  ON user_roles (user_id, COALESCE(school_id, 0), role_id);
CREATE INDEX idx_user_roles_school ON user_roles (school_id, role_id);

CREATE TABLE refresh_tokens (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id            BIGINT REFERENCES schools(id) ON DELETE CASCADE,
  token_hash           VARCHAR(255) NOT NULL UNIQUE,
  expires_at           TIMESTAMPTZ NOT NULL,
  revoked_at           TIMESTAMPTZ,
  replaced_by_token_id BIGINT REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  ip                   INET,
  user_agent           VARCHAR(500),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

-- Permission catalog. Adding a permission is an INSERT, never a migration.
-- module_id NULL = core permission (always available). Otherwise the school
-- must own that module (school_modules) unless the actor is a platform admin.
CREATE TABLE permissions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        VARCHAR(100) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  module      VARCHAR(50)  NOT NULL,                       -- UI grouping label
  module_id   BIGINT REFERENCES modules(id) ON DELETE RESTRICT,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ
);

-- PLATFORM_ADMIN and SCHOOL_SUPER_ADMIN need NO rows here: has_permission()
-- treats them as wildcards, so new permissions reach them automatically.
CREATE TABLE role_permissions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id       BIGINT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

-- Per-user override. allow = false is an explicit DENY that beats roles
-- (even for a school super admin). school_id NULL = global (platform admin only).
CREATE TABLE user_permissions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  school_id     BIGINT REFERENCES schools(id)              ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  allow         BOOLEAN NOT NULL,
  reason        VARCHAR(255),
  granted_by    BIGINT NOT NULL REFERENCES users(id)       ON DELETE RESTRICT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_user_permission
  ON user_permissions (user_id, COALESCE(school_id, 0), permission_id);
CREATE INDEX idx_user_permissions_user ON user_permissions (user_id, school_id);

-- ---------- identity helpers ----------
CREATE OR REPLACE FUNCTION is_platform_admin(p_user BIGINT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN users u ON u.id = ur.user_id
     WHERE ur.user_id = p_user AND r.code = 'PLATFORM_ADMIN' AND u.is_active);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_school_super_admin(p_user BIGINT, p_school BIGINT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN users u ON u.id = ur.user_id
     WHERE ur.user_id = p_user AND ur.school_id = p_school
       AND r.code = 'SCHOOL_SUPER_ADMIN' AND u.is_active);
$$ LANGUAGE sql STABLE;

-- Effective permission:
--   inactive user / school  -> false
--   platform admin          -> true, every school, every module
--   module not owned        -> false
--   user override (DENY or ALLOW, school-scoped beats global) wins next
--   school super admin      -> true (wildcard)
--   otherwise               -> union of the user's role permissions in that school
CREATE OR REPLACE FUNCTION has_permission(
  p_user   BIGINT,
  p_perm   TEXT,
  p_school BIGINT
) RETURNS BOOLEAN AS $$
DECLARE
  v_perm_id   BIGINT;
  v_module_id BIGINT;
  v_override  BOOLEAN;
BEGIN
  SELECT id, module_id INTO v_perm_id, v_module_id FROM permissions WHERE code = p_perm;
  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION 'Unknown permission code: %', p_perm;
  END IF;

  IF p_user IS NULL OR p_school IS NULL THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user AND is_active) THEN RETURN FALSE; END IF;

  IF is_platform_admin(p_user) THEN RETURN TRUE; END IF;

  IF NOT EXISTS (SELECT 1 FROM schools WHERE id = p_school AND is_active) THEN RETURN FALSE; END IF;

  IF v_module_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM school_modules sm
        WHERE sm.school_id = p_school AND sm.module_id = v_module_id
          AND sm.is_active AND (sm.expires_at IS NULL OR sm.expires_at > now())) THEN
    RETURN FALSE;
  END IF;

  SELECT allow INTO v_override
    FROM user_permissions
   WHERE user_id = p_user
     AND permission_id = v_perm_id
     AND (school_id = p_school OR school_id IS NULL)
     AND (expires_at IS NULL OR expires_at > now())
   ORDER BY school_id NULLS LAST
   LIMIT 1;
  IF FOUND THEN RETURN v_override; END IF;

  IF is_school_super_admin(p_user, p_school) THEN RETURN TRUE; END IF;

  RETURN EXISTS (
    SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = p_user AND ur.school_id = p_school
       AND rp.permission_id = v_perm_id);
END $$ LANGUAGE plpgsql STABLE;

-- ---------- user_roles rules ----------
-- 1) PLATFORM_ADMIN has no school; every other role must have one.
-- 2) PLATFORM_ADMIN / SCHOOL_SUPER_ADMIN need an email; every other role needs a mobile.
-- 3) Who may assign: PLATFORM_ADMIN <- platform admin only;
--    SCHOOL_SUPER_ADMIN <- platform admin or that school's super admin;
--    any other role <- holder of user.assign_role in that school.
CREATE OR REPLACE FUNCTION check_user_role() RETURNS trigger AS $$
DECLARE
  r_code TEXT; u_email CITEXT; u_mobile VARCHAR; a_ok BOOLEAN;
BEGIN
  SELECT code INTO r_code FROM roles WHERE id = NEW.role_id;
  SELECT email, mobile INTO u_email, u_mobile FROM users WHERE id = NEW.user_id;

  IF r_code = 'PLATFORM_ADMIN' AND NEW.school_id IS NOT NULL THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN must not have a school_id';
  ELSIF r_code <> 'PLATFORM_ADMIN' AND NEW.school_id IS NULL THEN
    RAISE EXCEPTION 'Role % requires a school_id', r_code;
  END IF;

  IF r_code IN ('PLATFORM_ADMIN','SCHOOL_SUPER_ADMIN') AND u_email IS NULL THEN
    RAISE EXCEPTION 'Role % requires the user to have an email', r_code;
  ELSIF r_code NOT IN ('PLATFORM_ADMIN','SCHOOL_SUPER_ADMIN') AND u_mobile IS NULL THEN
    RAISE EXCEPTION 'Role % requires the user to have a mobile number', r_code;
  END IF;

  IF NEW.assigned_by IS NULL THEN
    IF r_code = 'PLATFORM_ADMIN' AND NOT EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE r.code = 'PLATFORM_ADMIN') THEN
      RETURN NEW;   -- bootstrap: the very first platform admin
    END IF;
    RAISE EXCEPTION 'assigned_by is required';
  END IF;

  IF r_code = 'PLATFORM_ADMIN' THEN
    a_ok := is_platform_admin(NEW.assigned_by);
  ELSIF r_code = 'SCHOOL_SUPER_ADMIN' THEN
    a_ok := is_platform_admin(NEW.assigned_by)
         OR is_school_super_admin(NEW.assigned_by, NEW.school_id);
  ELSE
    a_ok := has_permission(NEW.assigned_by, 'user.assign_role', NEW.school_id);
  END IF;

  IF NOT a_ok THEN
    RAISE EXCEPTION 'User % may not assign role % here', NEW.assigned_by, r_code;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_user_roles_check BEFORE INSERT ON user_roles
  FOR EACH ROW EXECUTE FUNCTION check_user_role();

CREATE OR REPLACE FUNCTION block_role_assignment_edit() RETURNS trigger AS $$
BEGIN
  IF (NEW.user_id, NEW.school_id, NEW.role_id)
     IS DISTINCT FROM (OLD.user_id, OLD.school_id, OLD.role_id) THEN
    RAISE EXCEPTION 'Role assignments cannot be edited; delete and assign again';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_user_roles_noedit BEFORE UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION block_role_assignment_edit();

-- Don't allow removing the email/mobile that an existing role depends on.
CREATE OR REPLACE FUNCTION check_user_identifier_kept() RETURNS trigger AS $$
BEGIN
  IF NEW.email IS NULL AND EXISTS (
       SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = NEW.id AND r.code IN ('PLATFORM_ADMIN','SCHOOL_SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'User has an admin role and must keep an email';
  END IF;
  IF NEW.mobile IS NULL AND EXISTS (
       SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = NEW.id AND r.code NOT IN ('PLATFORM_ADMIN','SCHOOL_SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'User has a non-admin role and must keep a mobile number';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_users_identifier_kept BEFORE UPDATE OF email, mobile ON users
  FOR EACH ROW EXECUTE FUNCTION check_user_identifier_kept();

-- A school's email can never belong to a user (and vice versa).
CREATE OR REPLACE FUNCTION enforce_email_separation() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'schools' AND EXISTS (SELECT 1 FROM users WHERE email = NEW.email) THEN
    RAISE EXCEPTION 'Email % already belongs to a user', NEW.email;
  ELSIF TG_TABLE_NAME = 'users' AND NEW.email IS NOT NULL
        AND EXISTS (SELECT 1 FROM schools WHERE email = NEW.email) THEN
    RAISE EXCEPTION 'Email % already belongs to a school', NEW.email;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_schools_email BEFORE INSERT OR UPDATE OF email ON schools
  FOR EACH ROW EXECUTE FUNCTION enforce_email_separation();
CREATE TRIGGER trg_users_email BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW EXECUTE FUNCTION enforce_email_separation();

-- ---------- user_permissions rules ----------
-- Global overrides: platform admin only. School overrides: grantor needs
-- user.grant_permission, must hold the permission they ALLOW, and the target
-- must already have a role in that school.
CREATE OR REPLACE FUNCTION check_user_permission_grant() RETURNS trigger AS $$
DECLARE v_code TEXT;
BEGIN
  SELECT code INTO v_code FROM permissions WHERE id = NEW.permission_id;

  IF NEW.school_id IS NULL THEN
    IF NOT is_platform_admin(NEW.granted_by) THEN
      RAISE EXCEPTION 'Only a platform admin can create a global permission override';
    END IF;
  ELSE
    IF NOT has_permission(NEW.granted_by, 'user.grant_permission', NEW.school_id) THEN
      RAISE EXCEPTION 'User % may not grant permissions in school %', NEW.granted_by, NEW.school_id;
    END IF;
    IF NEW.allow AND NOT has_permission(NEW.granted_by, v_code, NEW.school_id) THEN
      RAISE EXCEPTION 'You cannot grant a permission you do not hold (%)', v_code;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_roles
                    WHERE user_id = NEW.user_id AND school_id = NEW.school_id) THEN
      RAISE EXCEPTION 'Target user has no role in school %', NEW.school_id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_user_permissions_check BEFORE INSERT ON user_permissions
  FOR EACH ROW EXECUTE FUNCTION check_user_permission_grant();

-- Overrides are replaced (delete + insert), never edited, except expiry/reason.
CREATE OR REPLACE FUNCTION block_user_permission_edit() RETURNS trigger AS $$
BEGIN
  IF (NEW.user_id, NEW.school_id, NEW.permission_id, NEW.allow, NEW.granted_by)
     IS DISTINCT FROM (OLD.user_id, OLD.school_id, OLD.permission_id, OLD.allow, OLD.granted_by) THEN
    RAISE EXCEPTION 'Permission overrides cannot be edited; delete and grant again';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_user_permissions_noedit BEFORE UPDATE ON user_permissions
  FOR EACH ROW EXECUTE FUNCTION block_user_permission_edit();

-- =========================================================
-- ACADEMIC STRUCTURE
-- (every school-owned table has UNIQUE (school_id, id) so children can use
--  composite FKs and cross-school references are impossible)
-- =========================================================
CREATE TABLE academic_years (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, name),
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX uq_one_current_year ON academic_years (school_id) WHERE is_current;

CREATE TABLE classes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  code       VARCHAR(50),
  sort_order INT DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, name)
);

CREATE TABLE sections (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id   BIGINT NOT NULL,
  name       VARCHAR(50) NOT NULL,
  capacity   INT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  UNIQUE (school_id, class_id, id),
  UNIQUE (class_id, name),
  FOREIGN KEY (school_id, class_id) REFERENCES classes (school_id, id) ON DELETE CASCADE
);

CREATE TABLE subjects (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code       VARCHAR(50) NOT NULL,
  name       VARCHAR(255) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, code)
);

CREATE TABLE teachers (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_code  VARCHAR(50) NOT NULL,
  joining_date  DATE,
  qualification VARCHAR(255),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, user_id),
  UNIQUE (school_id, teacher_code)
);

CREATE TABLE class_subjects (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id BIGINT NOT NULL,
  class_id         BIGINT NOT NULL,
  subject_id       BIGINT NOT NULL,
  teacher_id       BIGINT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ,
  UNIQUE (academic_year_id, class_id, subject_id),
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, class_id)         REFERENCES classes (school_id, id)        ON DELETE CASCADE,
  FOREIGN KEY (school_id, subject_id)       REFERENCES subjects (school_id, id)       ON DELETE CASCADE,
  FOREIGN KEY (school_id, teacher_id)       REFERENCES teachers (school_id, id)       ON DELETE RESTRICT
);
CREATE INDEX idx_class_subjects_school_year ON class_subjects (school_id, academic_year_id);
CREATE INDEX idx_class_subjects_teacher     ON class_subjects (teacher_id);

-- =========================================================
-- STUDENTS / GUARDIANS
-- =========================================================
CREATE TABLE students (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  student_code   VARCHAR(50) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  gender         gender_type,
  dob            DATE,
  blood_group    VARCHAR(10),
  address        TEXT,
  admission_date DATE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, student_code),
  UNIQUE (school_id, user_id)
);
CREATE INDEX idx_students_school_active ON students (school_id, is_active);

CREATE TABLE student_academic_history (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       BIGINT NOT NULL,
  academic_year_id BIGINT NOT NULL,
  class_id         BIGINT NOT NULL,
  section_id       BIGINT,
  roll_no          VARCHAR(50),
  is_current       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ,
  UNIQUE (student_id, academic_year_id),
  FOREIGN KEY (school_id, student_id)       REFERENCES students (school_id, id)       ON DELETE CASCADE,
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, class_id)         REFERENCES classes (school_id, id)        ON DELETE RESTRICT,
  FOREIGN KEY (school_id, class_id, section_id) REFERENCES sections (school_id, class_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_one_current_history
  ON student_academic_history (student_id) WHERE is_current;
CREATE UNIQUE INDEX uq_class_roll
  ON student_academic_history (academic_year_id, class_id, COALESCE(section_id, 0), roll_no);

CREATE TABLE guardian_students (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guardian_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id       BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relation         VARCHAR(50) NOT NULL,
  is_primary       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_user_id, student_id)
);
CREATE INDEX idx_guardian_students_student ON guardian_students (student_id);

-- =========================================================
-- FEES / FINANCE  (money tables: RESTRICT only, never cascade)
-- =========================================================
CREATE TABLE funds (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(50),
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, name),
  UNIQUE (school_id, code)
);

-- One fund can hold many fee types (General Fund = Tuition + Library + Lab ...).
-- NOTE: your design doc (decision 7) says "each fee type has its own fund".
-- To enforce that strictly, add:  ALTER TABLE fee_types ADD UNIQUE (fund_id);
CREATE TABLE fee_types (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  fund_id    BIGINT NOT NULL,
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(50),
  category   fee_category NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, name),
  UNIQUE (school_id, code),
  FOREIGN KEY (school_id, fund_id) REFERENCES funds (school_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_fee_types_fund ON fee_types (fund_id);

-- Fee amount by month range. class_id NULL = all classes.
-- Months are first-of-month dates. Active ranges for the same fee type, class
-- and year can never overlap (exclusion constraint below).
-- A locked rate can only be changed/deactivated by fee_rate.update holders.
CREATE TABLE fee_rates (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  fee_type_id      BIGINT NOT NULL,
  class_id         BIGINT,
  academic_year_id BIGINT NOT NULL,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  from_month       DATE NOT NULL,
  to_month         DATE,
  is_locked        BOOLEAN NOT NULL DEFAULT FALSE,
  locked_by        BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  locked_at        TIMESTAMPTZ,
  created_by       BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by       BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  acting_user_id   BIGINT REFERENCES users(id) ON DELETE RESTRICT,  -- WRITE-ONLY: set on every UPDATE; always stored as NULL
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ,
  CHECK (to_month IS NULL OR to_month >= from_month),
  CHECK (EXTRACT(DAY FROM from_month) = 1),
  CHECK (to_month IS NULL OR EXTRACT(DAY FROM to_month) = 1),
  FOREIGN KEY (school_id, fee_type_id)      REFERENCES fee_types (school_id, id)      ON DELETE RESTRICT,
  FOREIGN KEY (school_id, class_id)         REFERENCES classes (school_id, id)        ON DELETE RESTRICT,
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_fee_rates_lookup
  ON fee_rates (school_id, academic_year_id, fee_type_id, class_id);

ALTER TABLE fee_rates ADD CONSTRAINT fee_rates_no_overlap EXCLUDE USING gist (
  school_id        WITH =,
  fee_type_id      WITH =,
  academic_year_id WITH =,
  (COALESCE(class_id, 0)) WITH =,
  (daterange(from_month, COALESCE(to_month, DATE '9999-12-31'), '[]')) WITH &&
) WHERE (is_active);

-- INSERT: needs fee_rate.manage; auto-locks if the creator holds fee_rate.update.
CREATE OR REPLACE FUNCTION fee_rate_before_insert() RETURNS trigger AS $$
BEGIN
  NEW.acting_user_id := NULL;

  IF NOT has_permission(NEW.created_by, 'fee_rate.manage', NEW.school_id) THEN
    RAISE EXCEPTION 'Not permitted: fee_rate.manage';
  END IF;

  IF has_permission(NEW.created_by, 'fee_rate.update', NEW.school_id) THEN
    NEW.is_locked := TRUE;
    NEW.locked_by := NEW.created_by;
    NEW.locked_at := now();
  ELSIF NEW.is_locked THEN
    RAISE EXCEPTION 'Only fee_rate.update holders can create locked rates';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fee_rates_before_insert BEFORE INSERT ON fee_rates
  FOR EACH ROW EXECUTE FUNCTION fee_rate_before_insert();

-- UPDATE: every business column is guarded; the actor comes from acting_user_id.
CREATE OR REPLACE FUNCTION fee_rate_before_update() RETURNS trigger AS $$
DECLARE
  v_actor   BIGINT := NEW.acting_user_id;
  v_changed BOOLEAN;
BEGIN
  IF NEW.school_id <> OLD.school_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'school_id and created_by cannot change';
  END IF;

  v_changed :=
    (NEW.fee_type_id, NEW.class_id, NEW.academic_year_id, NEW.amount,
     NEW.from_month, NEW.to_month, NEW.is_active, NEW.is_locked)
    IS DISTINCT FROM
    (OLD.fee_type_id, OLD.class_id, OLD.academic_year_id, OLD.amount,
     OLD.from_month, OLD.to_month, OLD.is_active, OLD.is_locked);

  IF v_changed THEN
    IF OLD.is_locked THEN
      IF NOT has_permission(v_actor, 'fee_rate.update', OLD.school_id) THEN
        RAISE EXCEPTION 'Fee rate % is locked; changing it requires fee_rate.update (set acting_user_id)', OLD.id;
      END IF;
    ELSIF NOT has_permission(v_actor, 'fee_rate.manage', OLD.school_id) THEN
      RAISE EXCEPTION 'Not permitted: fee_rate.manage (set acting_user_id)';
    END IF;
  END IF;

  IF NOT OLD.is_locked AND NEW.is_locked THEN
    IF NOT has_permission(v_actor, 'fee_rate.update', OLD.school_id) THEN
      RAISE EXCEPTION 'Locking a fee rate requires fee_rate.update';
    END IF;
    NEW.locked_by := v_actor;
    NEW.locked_at := now();
  ELSIF OLD.is_locked AND NOT NEW.is_locked THEN
    NEW.locked_by := NULL;
    NEW.locked_at := NULL;
  END IF;

  IF v_actor IS NOT NULL THEN NEW.updated_by := v_actor; END IF;
  NEW.acting_user_id := NULL;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fee_rates_before_update BEFORE UPDATE ON fee_rates
  FOR EACH ROW EXECUTE FUNCTION fee_rate_before_update();

CREATE OR REPLACE FUNCTION fee_rate_before_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.is_locked THEN
    RAISE EXCEPTION 'Locked fee rate % cannot be deleted; deactivate it (needs fee_rate.update)', OLD.id;
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fee_rates_before_delete BEFORE DELETE ON fee_rates
  FOR EACH ROW EXECUTE FUNCTION fee_rate_before_delete();

-- Pre-assigned fees ("decided payment").
-- fee_month NULL = one-time fee (ONE_TIME types); MONTHLY types need a first-of-month date.
-- is_custom = per-student amount.
CREATE TABLE student_fees (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id       BIGINT NOT NULL,
  fee_type_id      BIGINT NOT NULL,
  academic_year_id BIGINT NOT NULL,
  fee_month        DATE,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  is_custom        BOOLEAN NOT NULL DEFAULT FALSE,
  status           fee_status NOT NULL DEFAULT 'UNPAID',
  due_date         DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ,
  UNIQUE (school_id, id),
  CHECK (fee_month IS NULL OR EXTRACT(DAY FROM fee_month) = 1),
  FOREIGN KEY (school_id, student_id)       REFERENCES students (school_id, id)       ON DELETE RESTRICT,
  FOREIGN KEY (school_id, fee_type_id)      REFERENCES fee_types (school_id, id)      ON DELETE RESTRICT,
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_student_fee
  ON student_fees (student_id, fee_type_id, academic_year_id, COALESCE(fee_month, DATE '1900-01-01'));
CREATE INDEX idx_student_fees_school_status ON student_fees (school_id, status);
CREATE INDEX idx_student_fees_student       ON student_fees (student_id);

-- MONTHLY fee types need fee_month; ONE_TIME fee types must not have one.
CREATE OR REPLACE FUNCTION check_student_fee_category() RETURNS trigger AS $$
DECLARE v_cat fee_category;
BEGIN
  SELECT category INTO v_cat FROM fee_types WHERE id = NEW.fee_type_id;
  IF v_cat = 'MONTHLY' AND NEW.fee_month IS NULL THEN
    RAISE EXCEPTION 'A MONTHLY fee needs fee_month';
  ELSIF v_cat = 'ONE_TIME' AND NEW.fee_month IS NOT NULL THEN
    RAISE EXCEPTION 'A ONE_TIME fee must not have fee_month';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_student_fees_category
  BEFORE INSERT OR UPDATE OF fee_type_id, fee_month ON student_fees
  FOR EACH ROW EXECUTE FUNCTION check_student_fee_category();

-- Once a fee has any transaction, its identity and amount are frozen.
CREATE OR REPLACE FUNCTION guard_student_fee_edit() RETURNS trigger AS $$
BEGIN
  IF (NEW.school_id, NEW.student_id, NEW.fee_type_id, NEW.academic_year_id, NEW.fee_month, NEW.amount)
     IS DISTINCT FROM
     (OLD.school_id, OLD.student_id, OLD.fee_type_id, OLD.academic_year_id, OLD.fee_month, OLD.amount)
     AND EXISTS (SELECT 1 FROM transactions WHERE student_fee_id = OLD.id) THEN
    RAISE EXCEPTION 'student_fee % has transactions; use an ADJUSTMENT instead', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_student_fees_guard BEFORE UPDATE ON student_fees
  FOR EACH ROW EXECUTE FUNCTION guard_student_fee_edit();

-- Receipt header. Insert the payment and ALL its transaction lines in ONE DB transaction.
CREATE TABLE payments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id   BIGINT NOT NULL,
  payment_no   VARCHAR(100) NOT NULL,
  payment_date DATE NOT NULL,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method       payment_method NOT NULL,
  reference_no VARCHAR(100),
  note         TEXT,
  created_by   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (school_id, payment_no),
  FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_payments_school_date ON payments (school_id, payment_date);

-- Append-only ledger.
--  PAYMENT    : money received, needs payment_id; created_by needs payment.create.
--  REVERSAL   : undoes ONE PAYMENT line (same amount/fund/fee); needs payment.reverse.
--  ADJUSTMENT : waiver / discount / scholarship etc., no payment_id; needs adjustment.create.
CREATE TABLE transactions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  payment_id     BIGINT,
  student_fee_id BIGINT NOT NULL,
  fund_id        BIGINT NOT NULL,
  type           txn_type NOT NULL,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reverses_id    BIGINT UNIQUE,
  adjust_reason  adjust_reason,
  reason         VARCHAR(255),
  created_by     BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  CONSTRAINT chk_txn_shape CHECK (
    (type = 'PAYMENT'    AND payment_id IS NOT NULL AND reverses_id IS NULL AND adjust_reason IS NULL)
    OR
    (type = 'REVERSAL'   AND reverses_id IS NOT NULL AND adjust_reason IS NULL)
    OR
    (type = 'ADJUSTMENT' AND payment_id IS NULL AND reverses_id IS NULL AND adjust_reason IS NOT NULL)
  ),
  FOREIGN KEY (school_id, payment_id)     REFERENCES payments (school_id, id)      ON DELETE RESTRICT,
  FOREIGN KEY (school_id, student_fee_id) REFERENCES student_fees (school_id, id)  ON DELETE RESTRICT,
  FOREIGN KEY (school_id, fund_id)        REFERENCES funds (school_id, id)         ON DELETE RESTRICT,
  FOREIGN KEY (school_id, reverses_id)    REFERENCES transactions (school_id, id)  ON DELETE RESTRICT
);
CREATE INDEX idx_txn_school_date ON transactions (school_id, created_at);
CREATE INDEX idx_txn_fee         ON transactions (student_fee_id);
CREATE INDEX idx_txn_fund        ON transactions (fund_id);
CREATE INDEX idx_txn_payment     ON transactions (payment_id);

-- Money history is permanent.
CREATE TRIGGER trg_transactions_immutable BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION block_mutation();
CREATE TRIGGER trg_payments_immutable BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- Validates every new ledger row. Locks the fee row first so concurrent payments
-- on the same fee are handled one at a time (no stale status, no overpayment).
-- The acting user is the row's own created_by.
CREATE OR REPLACE FUNCTION validate_transaction() RETURNS trigger AS $$
DECLARE
  v_fee    student_fees%ROWTYPE;
  v_fund   BIGINT;
  v_paid   NUMERIC(12,2);
  v_adj    NUMERIC(12,2);
  v_lines  NUMERIC(12,2);
  pay      payments%ROWTYPE;
  orig     transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_fee FROM student_fees WHERE id = NEW.student_fee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_fee % not found', NEW.student_fee_id;
  END IF;

  SELECT fund_id INTO v_fund FROM fee_types WHERE id = v_fee.fee_type_id;
  IF NEW.fund_id <> v_fund THEN
    RAISE EXCEPTION 'fund_id % does not match the fund of this fee type (%)', NEW.fund_id, v_fund;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type = 'PAYMENT'  THEN amount
                           WHEN type = 'REVERSAL' THEN -amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount ELSE 0 END), 0)
    INTO v_paid, v_adj
    FROM transactions WHERE student_fee_id = NEW.student_fee_id;

  IF NEW.type = 'PAYMENT' THEN
    IF NOT has_permission(NEW.created_by, 'payment.create', NEW.school_id) THEN
      RAISE EXCEPTION 'Not permitted: payment.create';
    END IF;

    SELECT * INTO pay FROM payments WHERE id = NEW.payment_id;
    IF pay.student_id <> v_fee.student_id THEN
      RAISE EXCEPTION 'Payment belongs to a different student than this fee';
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_lines
      FROM transactions WHERE payment_id = NEW.payment_id AND type = 'PAYMENT';
    IF v_lines + NEW.amount > pay.amount THEN
      RAISE EXCEPTION 'Payment lines (%) would exceed payment amount (%)', v_lines + NEW.amount, pay.amount;
    END IF;
    IF v_paid + NEW.amount > v_fee.amount - v_adj THEN
      RAISE EXCEPTION 'Overpayment: fee due is %, attempted +%',
        v_fee.amount - v_adj - v_paid, NEW.amount;
    END IF;

  ELSIF NEW.type = 'REVERSAL' THEN
    IF NOT has_permission(NEW.created_by, 'payment.reverse', NEW.school_id) THEN
      RAISE EXCEPTION 'Not permitted: payment.reverse';
    END IF;

    SELECT * INTO orig FROM transactions WHERE id = NEW.reverses_id;
    IF orig.type <> 'PAYMENT' THEN
      RAISE EXCEPTION 'Only a PAYMENT line can be reversed';
    END IF;
    IF orig.amount <> NEW.amount
       OR orig.fund_id <> NEW.fund_id
       OR orig.student_fee_id <> NEW.student_fee_id THEN
      RAISE EXCEPTION 'REVERSAL must match original amount, fund, and student_fee';
    END IF;
    IF NEW.payment_id IS NOT NULL
       AND NEW.payment_id IS DISTINCT FROM orig.payment_id THEN
      RAISE EXCEPTION 'REVERSAL payment_id must match the original payment';
    END IF;

  ELSE -- ADJUSTMENT
    IF NOT has_permission(NEW.created_by, 'adjustment.create', NEW.school_id) THEN
      RAISE EXCEPTION 'Not permitted: adjustment.create';
    END IF;

    IF v_adj + NEW.amount > v_fee.amount THEN
      RAISE EXCEPTION 'Adjustments (%) would exceed fee amount (%)', v_adj + NEW.amount, v_fee.amount;
    END IF;
    IF v_paid > v_fee.amount - (v_adj + NEW.amount) THEN
      RAISE EXCEPTION 'Adjustment is larger than the remaining due (already paid %)', v_paid;
    END IF;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_txn_validate BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION validate_transaction();

-- Keep student_fees.status derived from the ledger after each ledger row.
CREATE OR REPLACE FUNCTION refresh_student_fee_status() RETURNS trigger AS $$
DECLARE
  v_paid   NUMERIC(12,2);
  v_adj    NUMERIC(12,2);
  v_amount NUMERIC(12,2);
  v_due    NUMERIC(12,2);
  v_status fee_status;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN type = 'PAYMENT'  THEN amount
                           WHEN type = 'REVERSAL' THEN -amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount ELSE 0 END), 0)
    INTO v_paid, v_adj
    FROM transactions WHERE student_fee_id = NEW.student_fee_id;

  SELECT amount INTO v_amount FROM student_fees WHERE id = NEW.student_fee_id;
  v_due := v_amount - v_adj;

  IF v_paid = 0 THEN
    IF v_adj > 0 AND v_due <= 0 THEN v_status := 'WAIVED';
    ELSE v_status := 'UNPAID';
    END IF;
  ELSIF v_paid >= v_due THEN
    v_status := 'PAID';
  ELSE
    v_status := 'PARTIAL';
  END IF;

  UPDATE student_fees SET status = v_status WHERE id = NEW.student_fee_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_txn_refresh_fee_status AFTER INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION refresh_student_fee_status();

-- At COMMIT, a payment's amount must equal the sum of its PAYMENT lines.
CREATE OR REPLACE FUNCTION check_payment_total() RETURNS trigger AS $$
DECLARE v_lines NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_lines
    FROM transactions WHERE payment_id = NEW.id AND type = 'PAYMENT';
  IF v_lines <> NEW.amount THEN
    RAISE EXCEPTION 'Payment % amount (%) does not match its lines (%)',
      NEW.payment_no, NEW.amount, v_lines;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_payment_total AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_payment_total();

-- =========================================================
-- EXAMS / RESULTS
-- =========================================================
CREATE TABLE exam_types (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(50),
  weight     NUMERIC(5,2),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, code)
);

CREATE TABLE exams (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id BIGINT NOT NULL,
  exam_type_id     BIGINT NOT NULL,
  name             VARCHAR(255) NOT NULL,
  start_date       DATE,
  end_date         DATE,
  is_published     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ,
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, exam_type_id)     REFERENCES exam_types (school_id, id)     ON DELETE RESTRICT
);
CREATE INDEX idx_exams_school_year ON exams (school_id, academic_year_id);

CREATE TABLE exam_classes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id    BIGINT NOT NULL,
  class_id   BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (exam_id, class_id),
  FOREIGN KEY (school_id, exam_id)  REFERENCES exams (school_id, id)   ON DELETE CASCADE,
  FOREIGN KEY (school_id, class_id) REFERENCES classes (school_id, id) ON DELETE CASCADE
);

CREATE TABLE exam_subjects (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_class_id BIGINT NOT NULL,
  subject_id    BIGINT NOT NULL,
  max_marks     NUMERIC(8,2) NOT NULL CHECK (max_marks > 0),
  pass_marks    NUMERIC(8,2) CHECK (pass_marks IS NULL OR pass_marks >= 0),
  exam_date     DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (exam_class_id, subject_id),
  CHECK (pass_marks IS NULL OR pass_marks <= max_marks),
  FOREIGN KEY (school_id, exam_class_id) REFERENCES exam_classes (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, subject_id)    REFERENCES subjects (school_id, id)     ON DELETE RESTRICT
);

-- Marks: created_by is the actor on INSERT; acting_user_id (write-only) on UPDATE.
CREATE TABLE exam_results (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_subject_id BIGINT NOT NULL,
  student_id      BIGINT NOT NULL,
  marks_obtained  NUMERIC(8,2) CHECK (marks_obtained IS NULL OR marks_obtained >= 0),
  grade           VARCHAR(10),
  is_absent       BOOLEAN NOT NULL DEFAULT FALSE,
  remarks         VARCHAR(255),
  created_by      BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by      BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  acting_user_id  BIGINT REFERENCES users(id) ON DELETE RESTRICT,   -- WRITE-ONLY: set on every UPDATE; always stored as NULL
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ,
  UNIQUE (exam_subject_id, student_id),
  FOREIGN KEY (school_id, exam_subject_id) REFERENCES exam_subjects (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id)      REFERENCES students (school_id, id)      ON DELETE CASCADE
);
CREATE INDEX idx_exam_results_student ON exam_results (student_id);

-- Who may enter/update marks:
--  * exam_result.manage_all  -> any class (admins)
--  * exam_result.enter/update + an active teacher assignment in class_subjects
--    for that exam's class, subject and academic year (teachers)
CREATE OR REPLACE FUNCTION can_mark_results(
  p_user BIGINT, p_school BIGINT, p_exam_subject BIGINT, p_is_update BOOLEAN
) RETURNS BOOLEAN AS $$
BEGIN
  IF p_user IS NULL THEN RETURN FALSE; END IF;
  IF has_permission(p_user, 'exam_result.manage_all', p_school) THEN RETURN TRUE; END IF;

  IF NOT has_permission(p_user,
       CASE WHEN p_is_update THEN 'exam_result.update' ELSE 'exam_result.enter' END,
       p_school) THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM exam_subjects es
      JOIN exam_classes  ec ON ec.id = es.exam_class_id
      JOIN exams         e  ON e.id  = ec.exam_id
      JOIN teachers      t  ON t.school_id = es.school_id AND t.user_id = p_user AND t.is_active
      JOIN class_subjects cs ON cs.teacher_id = t.id
                            AND cs.class_id = ec.class_id
                            AND cs.subject_id = es.subject_id
                            AND cs.academic_year_id = e.academic_year_id
                            AND cs.is_active
     WHERE es.id = p_exam_subject);
END $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION exam_result_guard() RETURNS trigger AS $$
DECLARE
  v_actor BIGINT;
  v_max   NUMERIC(8,2);
BEGIN
  IF TG_OP = 'INSERT' THEN v_actor := NEW.created_by;
  ELSE                     v_actor := NEW.acting_user_id;
  END IF;

  IF NOT can_mark_results(v_actor, NEW.school_id, NEW.exam_subject_id, TG_OP = 'UPDATE') THEN
    RAISE EXCEPTION 'Not permitted to % marks for this exam subject (UPDATE needs acting_user_id)', lower(TG_OP);
  END IF;

  IF NEW.marks_obtained IS NOT NULL THEN
    SELECT max_marks INTO v_max FROM exam_subjects WHERE id = NEW.exam_subject_id;
    IF v_max IS NOT NULL AND NEW.marks_obtained > v_max THEN
      RAISE EXCEPTION 'marks_obtained (%) exceeds max_marks (%)', NEW.marks_obtained, v_max;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN NEW.updated_by := v_actor; END IF;
  NEW.acting_user_id := NULL;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_exam_results_guard BEFORE INSERT OR UPDATE ON exam_results
  FOR EACH ROW EXECUTE FUNCTION exam_result_guard();

CREATE TABLE grade_scales (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  min_mark   NUMERIC(8,2) NOT NULL,
  max_mark   NUMERIC(8,2) NOT NULL,
  grade      VARCHAR(10) NOT NULL,
  gpa        NUMERIC(4,2),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  CHECK (max_mark >= min_mark)
);

CREATE TABLE result_summary (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  exam_id         BIGINT NOT NULL,
  student_id      BIGINT NOT NULL,
  total_marks     NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_max_marks NUMERIC(10,2) NOT NULL DEFAULT 0,
  gpa             NUMERIC(4,2),
  grade           VARCHAR(10),
  rank_no         INT,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ,
  UNIQUE (exam_id, student_id),
  FOREIGN KEY (school_id, exam_id)    REFERENCES exams (school_id, id)    ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE CASCADE
);

-- =========================================================
-- AUDIT LOG (append-only, no FKs so history outlives the rows)
-- actor_user_id is best effort: INSERT -> created_by/assigned_by/granted_by,
-- UPDATE -> updated_by (fee_rates) else the original creator, DELETE -> NULL.
-- =========================================================
CREATE TABLE audit_logs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT,
  table_name    VARCHAR(100) NOT NULL,
  row_id        BIGINT,
  action        VARCHAR(10) NOT NULL,
  actor_user_id BIGINT,
  old_data      JSONB,
  new_data      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_school_date ON audit_logs (school_id, created_at);
CREATE INDEX idx_audit_row         ON audit_logs (table_name, row_id);
CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION block_mutation();

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger AS $$
DECLARE
  r       JSONB;
  v_old   JSONB;
  v_actor BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := to_jsonb(OLD);
    v_old := r;
  ELSE
    r := to_jsonb(NEW);
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_actor := COALESCE(
      NULLIF(r->>'updated_by', '')::BIGINT,
      NULLIF(r->>'granted_by', '')::BIGINT,
      NULLIF(r->>'assigned_by', '')::BIGINT,
      NULLIF(r->>'created_by', '')::BIGINT);
  END IF;

  INSERT INTO audit_logs (school_id, table_name, row_id, action, actor_user_id, old_data, new_data)
  VALUES (NULLIF(r->>'school_id', '')::BIGINT,
          TG_TABLE_NAME,
          NULLIF(r->>'id', '')::BIGINT,
          TG_OP,
          v_actor,
          v_old,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE r END);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','user_permissions','role_permissions',
                           'school_modules','funds','fee_types','fee_rates']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_audit AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION audit_row()', t, t);
  END LOOP;
END $$;

-- =========================================================
-- Auto-maintain updated_at on every table that has the column
-- (created last so the guard triggers above fire first)
-- =========================================================
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t.table_name, t.table_name);
  END LOOP;
END $$;

-- =========================================================
-- VIEWS (security_invoker: callers only see what their own DB role can see)
-- =========================================================

-- Fees still owing.
CREATE OR REPLACE VIEW v_student_outstanding WITH (security_invoker = true) AS
WITH tx AS (
  SELECT student_fee_id,
         SUM(CASE WHEN type = 'PAYMENT'  THEN amount
                  WHEN type = 'REVERSAL' THEN -amount ELSE 0 END) AS paid_amount,
         SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount ELSE 0 END) AS adjusted_amount
  FROM transactions
  GROUP BY student_fee_id
)
SELECT
  sf.school_id,
  sf.student_id,
  st.name          AS student_name,
  st.student_code,
  sf.id            AS student_fee_id,
  ft.name          AS fee_type,
  f.name           AS fund,
  sf.fee_month,
  sf.due_date,
  sf.amount,
  COALESCE(tx.paid_amount, 0)     AS paid_amount,
  COALESCE(tx.adjusted_amount, 0) AS adjusted_amount,
  sf.amount - COALESCE(tx.adjusted_amount, 0) - COALESCE(tx.paid_amount, 0) AS due_amount,
  sf.status
FROM student_fees sf
JOIN students  st ON st.id = sf.student_id
JOIN fee_types ft ON ft.id = sf.fee_type_id
JOIN funds     f  ON f.id  = ft.fund_id
LEFT JOIN tx ON tx.student_fee_id = sf.id
WHERE sf.status IN ('UNPAID', 'PARTIAL');

-- Net collection per fund per month, using each school's timezone.
CREATE OR REPLACE VIEW v_fund_collection WITH (security_invoker = true) AS
SELECT
  t.school_id,
  f.id   AS fund_id,
  f.name AS fund_name,
  date_trunc('month', t.created_at AT TIME ZONE s.timezone)::date AS month,
  SUM(CASE WHEN t.type = 'PAYMENT'  THEN t.amount
           WHEN t.type = 'REVERSAL' THEN -t.amount
           ELSE 0 END) AS net_collected
FROM transactions t
JOIN funds   f ON f.id = t.fund_id
JOIN schools s ON s.id = t.school_id
GROUP BY t.school_id, f.id, f.name,
         date_trunc('month', t.created_at AT TIME ZONE s.timezone);

-- Safety net: any row here = student_fees.status disagrees with the ledger.
CREATE OR REPLACE VIEW v_student_fee_status_drift WITH (security_invoker = true) AS
WITH tx AS (
  SELECT student_fee_id,
         SUM(CASE WHEN type = 'PAYMENT'  THEN amount
                  WHEN type = 'REVERSAL' THEN -amount ELSE 0 END) AS paid,
         SUM(CASE WHEN type = 'ADJUSTMENT' THEN amount ELSE 0 END) AS adj
  FROM transactions GROUP BY student_fee_id
),
d AS (
  SELECT
    sf.id        AS student_fee_id,
    sf.school_id,
    sf.student_id,
    sf.status::text AS stored_status,
    CASE
      WHEN COALESCE(tx.paid, 0) = 0
           AND COALESCE(tx.adj, 0) > 0
           AND sf.amount - COALESCE(tx.adj, 0) <= 0              THEN 'WAIVED'
      WHEN COALESCE(tx.paid, 0) = 0                              THEN 'UNPAID'
      WHEN COALESCE(tx.paid, 0) >= sf.amount - COALESCE(tx.adj, 0) THEN 'PAID'
      ELSE 'PARTIAL'
    END AS derived_status
  FROM student_fees sf
  LEFT JOIN tx ON tx.student_fee_id = sf.id
)
SELECT * FROM d WHERE stored_status <> derived_status;

-- =========================================================
-- SEED: roles
-- =========================================================
INSERT INTO roles (code, name, is_system) VALUES
  ('PLATFORM_ADMIN',     'Platform Admin',     TRUE),
  ('SCHOOL_SUPER_ADMIN', 'School Super Admin', TRUE),
  ('SCHOOL_ADMIN',       'School Admin',       TRUE),
  ('ACCOUNTANT',         'Accountant',         TRUE),
  ('TEACHER',            'Teacher',            TRUE),
  ('STAFF',              'Staff',              TRUE),
  ('GUARDIAN',           'Guardian',           TRUE),
  ('STUDENT',            'Student',            TRUE);

-- =========================================================
-- SEED: purchasable modules (everything else is core)
-- =========================================================
INSERT INTO modules (code, name) VALUES
  ('FEES',  'Fees & Accounting'),
  ('EXAMS', 'Exams & Results');

-- =========================================================
-- SEED: permission catalog
-- =========================================================
INSERT INTO permissions (code, name, module) VALUES
  ('user.create',            'Create users',                      'auth'),
  ('user.update',            'Update users',                      'auth'),
  ('user.deactivate',        'Deactivate users',                  'auth'),
  ('user.assign_role',       'Assign roles',                      'auth'),
  ('user.grant_permission',  'Grant/revoke permissions',          'auth'),

  ('school.update',          'Update school settings',            'school'),
  ('academic_year.manage',   'Manage academic years',             'school'),
  ('class.manage',           'Manage classes/sections',           'school'),
  ('subject.manage',         'Manage subjects',                   'school'),
  ('audit.view',             'View audit log',                    'school'),

  ('student.create',         'Create students',                   'students'),
  ('student.update',         'Update students',                   'students'),
  ('student.promote',        'Promote students',                  'students'),
  ('guardian.manage',        'Manage guardians',                  'students'),

  ('teacher.manage',         'Manage teachers',                   'staff'),
  ('staff.manage',           'Manage staff',                      'staff'),

  ('fund.manage',            'Manage funds',                      'fees'),
  ('fee_type.manage',        'Manage fee types',                  'fees'),
  ('fee_rate.manage',        'Create/edit unlocked fee rates',    'fees'),
  ('fee_rate.update',        'Create/change locked fee rates',    'fees'),
  ('student_fee.generate',   'Generate student fees',             'fees'),
  ('payment.create',         'Record payments',                   'fees'),
  ('payment.reverse',        'Reverse payments',                  'fees'),
  ('adjustment.create',      'Create adjustments',                'fees'),
  ('report.finance.view',    'View finance reports',              'fees'),

  ('exam.manage',            'Manage exams',                      'exams'),
  ('exam_result.enter',      'Enter results (assigned classes)',  'exams'),
  ('exam_result.update',     'Update results (assigned classes)', 'exams'),
  ('exam_result.manage_all', 'Enter/update results for any class','exams'),
  ('exam_result.publish',    'Publish exam results',              'exams'),
  ('grade_scale.manage',     'Manage grade scales',               'exams');

UPDATE permissions SET module_id = (SELECT id FROM modules WHERE code = 'FEES')  WHERE module = 'fees';
UPDATE permissions SET module_id = (SELECT id FROM modules WHERE code = 'EXAMS') WHERE module = 'exams';

-- =========================================================
-- SEED: role -> permission defaults
-- PLATFORM_ADMIN / SCHOOL_SUPER_ADMIN: wildcard inside has_permission(), no rows needed.
-- =========================================================
-- SCHOOL_ADMIN: everything except granting permissions, reversing payments, locked-rate edits
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'SCHOOL_ADMIN'
  AND p.code NOT IN ('user.grant_permission','payment.reverse','fee_rate.update');

-- ACCOUNTANT: day-to-day fees only (no reversals, adjustments, locked rates or funds)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ACCOUNTANT'
  AND p.code IN ('payment.create','student_fee.generate','report.finance.view',
                 'fee_type.manage','fee_rate.manage');

-- TEACHER: marks only, and only for classes they are assigned to (class_subjects)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'TEACHER'
  AND p.code IN ('exam_result.enter','exam_result.update');

-- STAFF: minimal (add later)
-- GUARDIAN / STUDENT: use "my children" endpoints, no school-wide permissions
