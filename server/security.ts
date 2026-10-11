import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { Repo, Row } from "./db";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export function fail(
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 = 400,
): never {
  throw new HTTPException(status, { message });
}
export function encryption(key: string) {
  if (!/^[0-9a-f]{64}$/i.test(key))
    throw Error("DATA_ENCRYPTION_KEY must be 32 bytes in hex");
  const bytes = Buffer.from(key, "hex");
  return {
    encrypt(value: string) {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", bytes, iv);
      const b = Buffer.concat([c.update(value, "utf8"), c.final()]);
      return [iv, c.getAuthTag(), b].map((x) => x.toString("base64")).join(".");
    },
    decrypt(value: string) {
      const [iv, tag, b] = value
        .split(".")
        .map((x) => Buffer.from(x, "base64"));
      const c = createDecipheriv("aes-256-gcm", bytes, iv);
      c.setAuthTag(tag);
      return Buffer.concat([c.update(b), c.final()]).toString("utf8");
    },
  };
}
export const roles = [
  "EMPLOYEE",
  "MANAGER",
  "HR",
  "GROUP_HR",
  "COMPANY_ADMIN",
  "TENANT_ADMIN",
] as const;
export const permissions: Record<string, string[]> = {
  EMPLOYEE: [
    "employee.self",
    "attendance.self",
    "leave.self",
    "payslip.self",
    "announcement.read",
  ],
  MANAGER: [
    "employee.team",
    "attendance.team",
    "leave.team",
    "leave.approve",
    "ot.approve",
    "announcement.read",
  ],
  HR: [
    "employee.manage",
    "employee.sensitive",
    "attendance.manage",
    "leave.manage",
    "leave.approve",
    "payroll.prepare",
    "announcement.manage",
    "announcement.read",
    "audit.read",
    "export.create",
    "company.read",
  ],
  GROUP_HR: [
    "employee.manage",
    "employee.sensitive",
    "attendance.manage",
    "leave.manage",
    "leave.approve",
    "payroll.prepare",
    "announcement.manage",
    "announcement.read",
    "audit.read",
    "export.create",
    "company.read",
    "report.consolidated",
  ],
  COMPANY_ADMIN: [
    "employee.manage",
    "employee.sensitive",
    "attendance.manage",
    "leave.manage",
    "leave.approve",
    "payroll.prepare",
    "payroll.review",
    "payroll.approve",
    "announcement.manage",
    "announcement.read",
    "audit.read",
    "export.create",
    "user.manage",
    "company.manage",
    "company.read",
  ],
  TENANT_ADMIN: [
    "employee.manage",
    "employee.sensitive",
    "attendance.manage",
    "leave.manage",
    "leave.approve",
    "payroll.prepare",
    "payroll.review",
    "payroll.approve",
    "announcement.manage",
    "announcement.read",
    "audit.read",
    "export.create",
    "user.manage",
    "company.manage",
    "company.read",
    "report.consolidated",
    "tenant.manage",
  ],
};
export type Auth = {
  user: Row;
  company: Row;
  grants: Row[];
  permissionSet: Set<string>;
  employee: Row | null;
};
export function authenticate(r: Repo, raw: string): Row {
  const u = r.one(
    `SELECT u.*,s.id session_id FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=u.tenant_id WHERE s.session_token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='ACTIVE' AND t.status='ACTIVE'`,
    hash(raw),
    new Date().toISOString(),
  );
  if (!u) fail("Session expired. Please sign in.", 401);
  return u;
}
export function authorize(r: Repo, user: Row, companyId: string): Auth {
  const company = r.one(
    `SELECT o.* FROM user_company_access a JOIN organizations o ON o.id=a.organization_id WHERE a.user_id=? AND o.id=? AND o.tenant_id=? AND a.access_status='ACTIVE' AND o.status='ACTIVE'`,
    user.id,
    companyId,
    user.tenant_id,
  );
  if (!company) fail("Company access denied", 403);
  const grants = r.all(
    `SELECT ur.*,r.code role_code,p.code permission FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? AND r.tenant_id=? AND (ur.organization_id=? OR ur.scope_type='TENANT')`,
    user.id,
    user.tenant_id,
    companyId,
  );
  const employee = r.one(
    `SELECT e.* FROM employees e JOIN people p ON p.id=e.person_id WHERE e.organization_id=? AND (e.user_id=? OR p.user_id=?) AND e.deleted_at IS NULL`,
    companyId,
    user.id,
    user.id,
  );
  return {
    user,
    company,
    grants,
    permissionSet: new Set(grants.map((x) => x.permission)),
    employee,
  };
}
export function requirePermission(a: Auth, permission: string) {
  if (!a.permissionSet.has(permission)) fail("Permission denied", 403);
  if (
    !/^(employee|attendance|leave)\.|^ot\.approve$|^announcement\.read$|^payslip\.self$/.test(
      permission,
    ) &&
    !a.grants.some(
      (g) =>
        g.permission === permission &&
        ["TENANT", "COMPANY"].includes(g.scope_type),
    )
  )
    fail("Company-wide permission required", 403);
}
export function employeeScope(
  a: Auth,
  module: string,
  alias = "e",
): { sql: string; params: any[] } {
  const full = a.grants.filter((g) => g.permission === `${module}.manage`);
  if (full.some((g) => ["TENANT", "COMPANY"].includes(g.scope_type)))
    return { sql: "1=1", params: [] };
  const scoped = a.grants.filter(
    (g) =>
      g.permission === `${module}.team` || g.permission === `${module}.manage`,
  );
  const clauses: string[] = [],
    params: any[] = [];
  for (const g of scoped) {
    if (g.scope_type === "DEPARTMENT") {
      clauses.push(`${alias}.department_id=?`);
      params.push(g.scope_id);
    } else if (g.scope_type === "BRANCH") {
      clauses.push(`${alias}.branch_id=?`);
      params.push(g.scope_id);
    } else if (a.employee) {
      clauses.push(`${alias}.manager_employee_id=?`);
      params.push(a.employee.id);
    }
  }
  if (a.employee) {
    clauses.push(`${alias}.id=?`);
    params.push(a.employee.id);
  }
  return { sql: clauses.length ? `(${clauses.join(" OR ")})` : "0=1", params };
}
export function employeeObject(
  r: Repo,
  a: Auth,
  employeeId: string,
  module = "employee",
) {
  const scope = employeeScope(a, module);
  const row = r.one(
    `SELECT e.* FROM employees e JOIN people p ON p.id=e.person_id WHERE e.id=? AND e.organization_id=? AND p.tenant_id=? AND e.deleted_at IS NULL AND ${scope.sql}`,
    employeeId,
    a.company.id,
    a.user.tenant_id,
    ...scope.params,
  );
  if (!row) fail("Employee access denied", 403);
  return row;
}
export function redact(value: any): any {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      /password|token|encrypted|national_id|passport|tax_id|account_number|insured_no/i.test(
        k,
      )
        ? "[REDACTED]"
        : redact(v),
    ]),
  );
}
