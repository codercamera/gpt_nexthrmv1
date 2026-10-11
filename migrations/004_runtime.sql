BEGIN;
CREATE INDEX ix_employee_user_company ON employees(user_id,organization_id);
CREATE INDEX ix_employee_person_company ON employees(person_id,organization_id);
CREATE TABLE request_idempotency (
 user_id TEXT NOT NULL REFERENCES users(id), organization_id TEXT NOT NULL REFERENCES organizations(id),
 key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,organization_id,key)
);
CREATE TABLE export_downloads (
 id TEXT PRIMARY KEY, export_id TEXT NOT NULL REFERENCES data_exports(id), user_id TEXT NOT NULL REFERENCES users(id), downloaded_at TEXT NOT NULL
);
CREATE TABLE attendance_change_requests (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 check_in_at TEXT NOT NULL, check_out_at TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')), submitted_by TEXT NOT NULL REFERENCES users(id),
 reviewed_by TEXT REFERENCES users(id), created_at TEXT NOT NULL, reviewed_at TEXT
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TRIGGER result_no_update BEFORE UPDATE ON payroll_results BEGIN SELECT RAISE(ABORT,'Calculation snapshots are immutable'); END;
CREATE TRIGGER result_no_delete BEFORE DELETE ON payroll_results BEGIN SELECT RAISE(ABORT,'Calculation snapshots are immutable'); END;
CREATE TRIGGER cycle_no_delete BEFORE DELETE ON payroll_cycles BEGIN SELECT RAISE(ABORT,'Payroll cannot be deleted'); END;
CREATE TRIGGER payslip_no_delete BEFORE DELETE ON payslips BEGIN SELECT RAISE(ABORT,'Payslip cannot be deleted'); END;
INSERT INTO schema_migrations(version) VALUES('004_runtime');
COMMIT;
