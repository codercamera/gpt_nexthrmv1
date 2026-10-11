import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z, ZodError } from "zod";
import { HTTPException } from "hono/http-exception";
import { isAllowedOrigin } from "./origin";
import type { Database } from "bun:sqlite";
import { repository, id, now, type Row } from "./db";
import {
  authenticate,
  authorize,
  requirePermission,
  employeeObject,
  employeeScope,
  encryption,
  fail,
  hash,
  token,
  redact,
  roles,
  type Auth,
} from "./security";
import {
  employeeInput,
  date,
  timestamp,
  text,
  money,
  profileFields,
} from "./validation";
import {
  audit,
  datesBetween,
  scheduleDay,
  balance,
  staffing,
  assertCompanyReferences,
  closePeriod,
  payrollCalculate,
} from "./domain";
export type Env = { Variables: { user: Row; auth: Auth; requestId: string } };
export type EventMessage = {
  tenant: string;
  company: string;
  user?: string;
  type: string;
  id?: string;
};
export function createApp(
  db: Database,
  key: string,
  emit: (event: EventMessage) => void = () => {},
) {
  const r = repository(db),
    secret = encryption(key),
    app = new Hono<Env>();
  const page = (c: any) => ({
    limit: Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25)),
    offset: Math.max(0, Number(c.req.query("offset")) || 0),
  });
  const companyObject = (a: Auth, table: string, objectId: string) => {
    const row = r.one(
      `SELECT * FROM ${table} WHERE id=? AND organization_id=?`,
      objectId,
      a.company.id,
    );
    if (!row) fail("Object access denied", 403);
    return row;
  };
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameAncestors: ["'none'"],
      },
    }),
  );
  app.use("*", async (c, next) => {
    c.set("requestId", id());
    c.header("X-Request-ID", c.get("requestId"));
    if (c.req.path.startsWith("/api")) c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && !isAllowedOrigin(origin, c.req.url))
        fail("Invalid request origin", 403);
    }
    if (
      [
        "/api/health",
        "/api/auth/login",
        "/api/auth/accept-invitation",
      ].includes(c.req.path)
    )
      return next();
    c.set("user", authenticate(r, getCookie(c, "hrm_session") || ""));
    await next();
  });
  app.use("/api/companies/:company/*", async (c, next) => {
    c.set("auth", authorize(r, c.get("user"), c.req.param("company")));
    await next();
  });
  app.onError((err, c) => {
    if (err instanceof HTTPException)
      return c.json(
        { error: err.message, request_id: c.get("requestId") },
        err.status,
      );
    if (err instanceof ZodError)
      return c.json(
        {
          error: err.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          request_id: c.get("requestId"),
        },
        422,
      );
    if (/UNIQUE constraint/.test(err.message))
      return c.json(
        { error: "Duplicate record", request_id: c.get("requestId") },
        409,
      );
    console.error("Request failed", c.get("requestId"), err.name);
    return c.json(
      { error: "Unexpected server error", request_id: c.get("requestId") },
      500,
    );
  });
  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      database: r.one("PRAGMA quick_check")?.quick_check,
    }),
  );
  const attempts = new Map<string, { count: number; expires: number }>();
  app.post("/api/auth/login", async (c) => {
    const input = z
      .object({
        tenant_code: text.max(50),
        email: z.email(),
        password: z.string().min(1).max(128),
      })
      .parse(await c.req.json());
    const bucket = hash(`${input.tenant_code}:${input.email.toLowerCase()}`),
      at = attempts.get(bucket);
    if (at && at.expires > Date.now() && at.count >= 20)
      fail("Too many login attempts; try again later", 403);
    attempts.set(bucket, {
      count: at && at.expires > Date.now() ? at.count + 1 : 1,
      expires: Date.now() + 900000,
    });
    if (attempts.size > 10000)
      for (const [k, v] of attempts)
        if (v.expires < Date.now()) attempts.delete(k);
    const u = r.one(
      `SELECT u.* FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.code=? AND lower(u.email)=? AND t.status='ACTIVE'`,
      input.tenant_code,
      input.email.toLowerCase(),
    );
    if (
      !u ||
      u.status !== "ACTIVE" ||
      (u.locked_until && u.locked_until > now()) ||
      !u.password_hash ||
      !(await Bun.password.verify(input.password, u.password_hash))
    ) {
      if (u)
        r.update(
          "users",
          {
            failed_login_count: u.failed_login_count + 1,
            locked_until:
              u.failed_login_count >= 4
                ? new Date(Date.now() + 900000).toISOString()
                : u.locked_until,
            updated_at: now(),
          },
          "id",
          u.id,
        );
      fail("Invalid credentials or account temporarily locked", 401);
    }
    const raw = token();
    r.insert("user_sessions", {
      id: id(),
      user_id: u.id,
      session_token_hash: hash(raw),
      expires_at: new Date(Date.now() + 28800000).toISOString(),
      created_at: now(),
      last_seen_at: now(),
    });
    r.update(
      "users",
      {
        failed_login_count: 0,
        locked_until: null,
        last_login_at: now(),
        updated_at: now(),
      },
      "id",
      u.id,
    );
    setCookie(c, "hrm_session", raw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/",
      maxAge: 28800,
    });
    return c.json({
      user: { id: u.id, display_name: u.display_name, email: u.email },
    });
  });
  app.post("/api/auth/logout", (c) => {
    r.update(
      "user_sessions",
      { revoked_at: now(), revoked_reason: "Logout" },
      "id",
      c.get("user").session_id,
    );
    deleteCookie(c, "hrm_session", { path: "/" });
    return c.json({ ok: true });
  });
  app.post("/api/auth/password", async (c) => {
    const b = z
        .object({
          current_password: text,
          new_password: z.string().min(12).max(128),
        })
        .parse(await c.req.json()),
      u = c.get("user");
    if (!(await Bun.password.verify(b.current_password, u.password_hash)))
      fail("Current password is incorrect", 403);
    const ph = await Bun.password.hash(b.new_password, {
      algorithm: "argon2id",
    });
    r.tx(() => {
      r.update(
        "users",
        { password_hash: ph, password_changed_at: now(), updated_at: now() },
        "id",
        u.id,
      );
      r.run(
        "UPDATE user_sessions SET revoked_at=?,revoked_reason=? WHERE user_id=?",
        now(),
        "Password changed",
        u.id,
      );
    });
    deleteCookie(c, "hrm_session", { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/me", (c) => {
    const u = c.get("user");
    const companies = r.all(
      `SELECT o.id,o.code,o.display_name,a.is_default,a.employee_id FROM organizations o JOIN user_company_access a ON a.organization_id=o.id WHERE a.user_id=? AND o.tenant_id=? AND a.access_status='ACTIVE' AND o.status='ACTIVE' ORDER BY a.is_default DESC,o.display_name`,
      u.id,
      u.tenant_id,
    );
    return c.json({
      user: {
        id: u.id,
        display_name: u.display_name,
        email: u.email,
        tenant_id: u.tenant_id,
      },
      companies: companies.map((co) => ({
        ...co,
        permissions: [...authorize(r, u, co.id).permissionSet],
      })),
    });
  });
  app.post("/api/preferences", async (c) => {
    const b = z
      .object({
        company_id: text,
        language: z.enum(["th", "en"]),
        theme: z.enum(["LIGHT", "DARK", "SYSTEM"]),
        pinned: z.array(z.string()).max(50).default([]),
      })
      .parse(await c.req.json());
    const a = authorize(r, c.get("user"), b.company_id);
    r.tx(() => {
      r.run(
        "UPDATE user_company_access SET is_default=0 WHERE user_id=?",
        a.user.id,
      );
      r.run(
        "UPDATE user_company_access SET is_default=1 WHERE user_id=? AND organization_id=?",
        a.user.id,
        a.company.id,
      );
      r.update(
        "users",
        { default_organization_id: a.company.id, updated_at: now() },
        "id",
        a.user.id,
      );
      r.run(
        "INSERT INTO user_preferences(user_id,language,theme,accessibility_preferences_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET language=excluded.language,theme=excluded.theme,accessibility_preferences_json=excluded.accessibility_preferences_json,updated_at=excluded.updated_at",
        a.user.id,
        b.language,
        b.theme,
        JSON.stringify({ pinned: b.pinned }),
        now(),
      );
    });
    return c.json({ ok: true });
  });
  app.get("/api/preferences", (c) =>
    c.json(
      r.one(
        "SELECT * FROM user_preferences WHERE user_id=?",
        c.get("user").id,
      ) || {},
    ),
  );
  app.get("/api/companies/:company/dashboard", (c) => {
    const a = c.get("auth"),
      s = employeeScope(a, "employee");
    const summary = r.one(
      `SELECT COUNT(*) employees,SUM(employment_status='ACTIVE') active FROM employees e WHERE e.organization_id=? AND e.deleted_at IS NULL AND ${s.sql}`,
      a.company.id,
      ...s.params,
    );
    const day =
      c.req.query("date") ||
      new Intl.DateTimeFormat("en-CA", { timeZone: a.company.timezone }).format(
        new Date(),
      );
    date.parse(day);
    const attendance = r.one(
      `SELECT COUNT(*) total,SUM(ar.status='PRESENT') present,SUM(ar.late_minutes>0) late FROM attendance_records ar JOIN employees e ON e.id=ar.employee_id WHERE e.organization_id=? AND ar.work_date=? AND ${s.sql}`,
      a.company.id,
      day,
      ...s.params,
    );
    const leave = r.one(
      `SELECT COUNT(*) pending FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE e.organization_id=? AND l.status='PENDING' AND ${s.sql}`,
      a.company.id,
      ...s.params,
    );
    return c.json({
      summary,
      attendance,
      leave,
      date: day,
      payroll: a.permissionSet.has("payroll.prepare")
        ? r.all(
            "SELECT id,name,status FROM payroll_cycles WHERE organization_id=? ORDER BY created_at DESC LIMIT 5",
            a.company.id,
          )
        : [],
      activity: a.permissionSet.has("audit.read")
        ? r.all(
            "SELECT action,object_type,created_at FROM audit_logs WHERE organization_id=? ORDER BY created_at DESC LIMIT 6",
            a.company.id,
          )
        : [],
    });
  });
  app.get("/api/companies/:company/lookups", (c) => {
    const a = c.get("auth");
    return c.json(
      Object.fromEntries(
        [
          "branches",
          "departments",
          "positions",
          "job_levels",
          "leave_types",
          "work_schedules",
        ].map((t) => [
          t,
          r.all(`SELECT * FROM ${t} WHERE organization_id=?`, a.company.id),
        ]),
      ),
    );
  });
  app.get("/api/companies/:company/company", (c) => {
    const a = c.get("auth");
    requirePermission(a, "company.read");
    return c.json({
      ...a.company,
      tax_id: a.company.tax_id ? "••••••••" : null,
      settings: r.one(
        "SELECT * FROM organization_settings WHERE organization_id=?",
        a.company.id,
      ),
    });
  });
  app.put("/api/companies/:company/company", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "company.manage");
    const b = z
      .object({
        display_name: text,
        legal_name: text,
        locale: z.enum(["th-TH", "en-US"]),
        timezone: z.string().refine((v) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }),
        tax_id: z.string().max(40).optional(),
      })
      .parse(await c.req.json());
    r.tx(() => {
      r.update(
        "organizations",
        {
          ...b,
          tax_id: b.tax_id ? secret.encrypt(b.tax_id) : a.company.tax_id,
          updated_at: now(),
        },
        "id",
        a.company.id,
      );
      audit(
        r,
        a,
        c.get("requestId"),
        "UPDATE",
        "company",
        a.company.id,
        a.company,
        b,
      );
    });
    return c.json({ ok: true });
  });
  app.put("/api/companies/:company/payroll-rules", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "company.manage");
    const b = z
      .object({
        payroll_rules_verified: z.boolean(),
        social_security_rate_basis_points: z.number().int().min(0).max(10000),
        social_security_cap_satang: money,
        tax_personal_allowance_satang: money,
        tax_expense_cap_satang: money,
        annual_tax_bands: z
          .array(
            z.object({
              up_to_satang: money.nullable(),
              rate_basis_points: z.number().int().min(0).max(10000),
            }),
          )
          .max(20),
        reason: text,
      })
      .parse(await c.req.json());
    let last = 0;
    for (const [i, band] of b.annual_tax_bands.entries()) {
      if (band.up_to_satang === null && i !== b.annual_tax_bands.length - 1)
        fail("Unlimited tax band must be last", 422);
      if (band.up_to_satang !== null && band.up_to_satang <= last)
        fail("Tax bands must ascend", 422);
      last = band.up_to_satang || last;
    }
    r.tx(() => {
      r.update(
        "organization_settings",
        { settings_json: JSON.stringify(b), updated_at: now() },
        "organization_id",
        a.company.id,
      );
      audit(
        r,
        a,
        c.get("requestId"),
        "VERIFY_RULES",
        "payroll_rules",
        a.company.id,
        null,
        b,
        b.reason,
      );
    });
    return c.json({ ok: true });
  });
  app.post("/api/companies/:company/leave-policies", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "leave.manage");
    const b = z
      .object({
        leave_type_id: text,
        name: text,
        annual_entitlement_minutes: z.number().int().min(0),
        minimum_service_days: z.number().int().min(0).default(0),
        accrual_method: z
          .enum(["ANNUAL", "MONTHLY", "DAILY", "NONE"])
          .default("ANNUAL"),
        carry_forward_limit_minutes: z.number().int().min(0).default(0),
        effective_from: date,
        effective_to: date.nullable().default(null),
      })
      .parse(await c.req.json());
    companyObject(a, "leave_types", b.leave_type_id);
    const oid = id();
    r.tx(() => {
      if (
        r.one(
          "SELECT id FROM leave_policies WHERE leave_type_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
          b.leave_type_id,
          b.effective_to || "9999-12-31",
          b.effective_from,
        )
      )
        fail("Leave policies overlap", 409);
      r.insert("leave_policies", {
        id: oid,
        organization_id: a.company.id,
        ...b,
        created_at: now(),
        updated_at: now(),
      });
      audit(r, a, c.get("requestId"), "CREATE", "leave_policy", oid, null, b);
    });
    return c.json({ id: oid }, 201);
  });
  app.post(
    "/api/companies/:company/employees/:employee/bank-verify",
    async (c) => {
      const a = c.get("auth");
      requirePermission(a, "employee.manage");
      const e = employeeObject(r, a, c.req.param("employee"));
      const b = z
        .object({ bank_account_id: text, reason: text })
        .parse(await c.req.json());
      const bank = r.one(
        "SELECT * FROM employee_bank_accounts WHERE id=? AND employee_id=?",
        b.bank_account_id,
        e.id,
      );
      if (!bank) fail("Bank account access denied", 403);
      r.tx(() => {
        r.update(
          "employee_bank_accounts",
          { verified_at: now() },
          "id",
          bank.id,
        );
        audit(
          r,
          a,
          c.get("requestId"),
          "VERIFY",
          "bank",
          bank.id,
          null,
          { verified_at: now() },
          b.reason,
        );
      });
      return c.json({ ok: true });
    },
  );
  app.post("/api/companies", async (c) => {
    const u = c.get("user"),
      body = z
        .object({
          source_company: text,
          code: text,
          display_name: text,
          legal_name: text,
        })
        .parse(await c.req.json());
    const a = authorize(r, u, body.source_company);
    requirePermission(a, "tenant.manage");
    const cid = id();
    r.tx(() => {
      r.insert("organizations", {
        id: cid,
        tenant_id: u.tenant_id,
        code: body.code,
        display_name: body.display_name,
        legal_name: body.legal_name,
        created_at: now(),
        updated_at: now(),
      });
      r.insert("organization_settings", { organization_id: cid });
      r.insert("user_company_access", {
        id: id(),
        user_id: u.id,
        organization_id: cid,
        granted_by_user_id: u.id,
      });
      audit(r, a, c.get("requestId"), "CREATE", "company", cid, null, body);
    });
    return c.json({ id: cid }, 201);
  });
  const catalogSchemas: Record<string, z.ZodType> = {
    branches: z.object({
      code: text,
      name_th: text,
      name_en: z.string().optional(),
    }),
    departments: z.object({
      code: text,
      name_th: text,
      name_en: z.string().optional(),
    }),
    positions: z.object({
      code: text,
      name_th: text,
      name_en: z.string().optional(),
    }),
    job_levels: z.object({
      code: text,
      name: text,
      rank_order: z.number().int().default(0),
    }),
    holidays: z.object({
      holiday_date: date,
      name_th: text,
      name_en: z.string().optional(),
      branch_id: z.string().nullable().default(null),
      is_paid: z.number().int().min(0).max(1).default(1),
    }),
    leave_types: z.object({
      code: text,
      name_th: text,
      name_en: z.string().optional(),
      is_paid: z.number().int().min(0).max(1).default(1),
      privacy_level: z
        .enum(["PUBLIC", "TEAM_NAME_ONLY", "PRIVATE"])
        .default("TEAM_NAME_ONLY"),
    }),
    department_staffing_rules: z.object({
      department_id: text,
      minimum_staff_count: z.number().int().min(0),
      maximum_leave_count: z.number().int().min(0).nullable().default(null),
      effective_from: date,
      effective_to: date.nullable().default(null),
    }),
  };
  app.get("/api/companies/:company/catalog/:kind", (c) => {
    const a = c.get("auth"),
      kind = c.req.param("kind");
    if (!catalogSchemas[kind]) fail("Unknown catalog", 404);
    requirePermission(a, "company.read");
    return c.json({
      items: r.all(
        `SELECT * FROM ${kind} WHERE organization_id=?`,
        a.company.id,
      ),
    });
  });
  app.post("/api/companies/:company/catalog/:kind", async (c) => {
    const a = c.get("auth"),
      kind = c.req.param("kind");
    requirePermission(a, "company.manage");
    if (!catalogSchemas[kind]) fail("Unknown catalog", 404);
    const b = catalogSchemas[kind].parse(await c.req.json()) as Row;
    assertCompanyReferences(r, a, b);
    const oid = id();
    r.tx(() => {
      r.insert(kind, { id: oid, organization_id: a.company.id, ...b });
      audit(r, a, c.get("requestId"), "CREATE", kind, oid, null, b);
    });
    return c.json({ id: oid }, 201);
  });
  const presentEmployee = (a: Auth, e: Row) => {
    const copy = { ...e };
    delete copy.national_id_encrypted;
    delete copy.passport_no_encrypted;
    copy.national_id = e.national_id_encrypted ? "•••••••••••••" : null;
    copy.passport_no = e.passport_no_encrypted ? "••••••••" : null;
    if (!a.permissionSet.has("employee.sensitive") && e.id !== a.employee?.id)
      delete copy.salary_satang;
    return copy;
  };
  const employeeList = (a: Auth, limit: number, offset: number, q = "") => {
    const s = employeeScope(a, "employee");
    const sql = `FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.organization_id=? AND e.deleted_at IS NULL AND ${s.sql} AND (e.first_name_th||' '||e.last_name_th||' '||e.employee_no LIKE ?)`;
    const params = [a.company.id, ...s.params, `%${q}%`];
    const rows = r.all(
      `SELECT e.*,d.name_th department_name,p.name_th position_name,(SELECT base_salary_satang FROM compensation_history ch WHERE ch.employee_id=e.id AND ch.effective_from<=? AND (ch.effective_to IS NULL OR ch.effective_to>=?) ORDER BY ch.effective_from DESC LIMIT 1) salary_satang ${sql} ORDER BY e.employee_no LIMIT ? OFFSET ?`,
      now().slice(0, 10),
      now().slice(0, 10),
      ...params,
      limit,
      offset,
    );
    return {
      items: rows.map((e) => presentEmployee(a, e)),
      total: r.one(`SELECT COUNT(*) total ${sql}`, ...params)!.total,
    };
  };
  app.get("/api/companies/:company/employees", (c) => {
    const p = page(c);
    return c.json(
      employeeList(c.get("auth"), p.limit, p.offset, c.req.query("q")),
    );
  });
  const sensitive = (eid: string, b: Row, uid: string, effective: string) => {
    if (b.bank_account) {
      closePeriod(r, "employee_bank_accounts", eid, effective);
      r.run(
        "UPDATE employee_bank_accounts SET is_primary=0 WHERE employee_id=?",
        eid,
      );
      r.insert("employee_bank_accounts", {
        id: id(),
        employee_id: eid,
        bank_code: b.bank_code || "UNKNOWN",
        account_name: `${b.first_name_th || ""} ${b.last_name_th || ""}`.trim(),
        account_number_encrypted: secret.encrypt(b.bank_account),
        account_number_last4: b.bank_account.slice(-4),
        is_primary: 1,
        effective_from: effective,
        created_by_user_id: uid,
      });
    }
    if (b.tax_id)
      r.run(
        "INSERT INTO employee_tax_profiles(employee_id,tax_id_encrypted,effective_from) VALUES(?,?,?) ON CONFLICT(employee_id) DO UPDATE SET tax_id_encrypted=excluded.tax_id_encrypted,updated_at=?",
        eid,
        secret.encrypt(b.tax_id),
        effective,
        now(),
      );
    if (b.social_security_no)
      r.run(
        "INSERT INTO employee_social_security_profiles(employee_id,insured_no_encrypted,effective_from) VALUES(?,?,?) ON CONFLICT(employee_id) DO UPDATE SET insured_no_encrypted=excluded.insured_no_encrypted,updated_at=?",
        eid,
        secret.encrypt(b.social_security_no),
        effective,
        now(),
      );
    if (b.address) {
      r.run(
        "DELETE FROM employee_addresses WHERE employee_id=? AND address_type=?",
        eid,
        "CURRENT",
      );
      r.insert("employee_addresses", {
        id: id(),
        employee_id: eid,
        address_type: "CURRENT",
        address_line1: b.address,
        is_primary: 1,
      });
    }
    if (b.emergency_name && b.emergency_phone) {
      r.run("DELETE FROM employee_emergency_contacts WHERE employee_id=?", eid);
      r.insert("employee_emergency_contacts", {
        id: id(),
        employee_id: eid,
        full_name: b.emergency_name,
        phone: b.emergency_phone,
        relationship: b.emergency_relationship || "Other",
      });
    }
  };
  const insertEmployee = (
    a: Auth,
    b: Row,
    eid: string,
    uid: string | null,
    pid: string,
  ) => {
    const keys = [
      "employee_no",
      "first_name_th",
      "last_name_th",
      "first_name_en",
      "last_name_en",
      "mobile_phone",
      "personal_email",
      "hire_date",
      "department_id",
      "branch_id",
      "position_id",
      "job_level_id",
      "manager_employee_id",
      "employment_type",
      "employment_status",
      "termination_date",
      "termination_reason",
    ];
    const row: Row = {
      id: eid,
      organization_id: a.company.id,
      person_id: pid,
      user_id: uid,
      created_by_user_id: a.user.id,
      updated_by_user_id: a.user.id,
      created_at: now(),
      updated_at: now(),
    };
    for (const k of keys) if (b[k] !== undefined) row[k] = b[k];
    if (b.national_id)
      row.national_id_encrypted = secret.encrypt(b.national_id);
    if (b.passport_no)
      row.passport_no_encrypted = secret.encrypt(b.passport_no);
    r.insert("employees", row);
    r.insert("employment_history", {
      id: id(),
      employee_id: eid,
      event_type: "HIRED",
      effective_from: b.hire_date,
      department_id: b.department_id || null,
      branch_id: b.branch_id || null,
      position_id: b.position_id || null,
      employment_type: b.employment_type,
      employment_status: b.employment_status,
      created_by_user_id: a.user.id,
      reason: b.reason || "Initial employment",
    });
    r.insert("compensation_history", {
      id: id(),
      employee_id: eid,
      effective_from: b.hire_date,
      pay_type: b.pay_type,
      base_salary_satang: b.salary_satang,
      daily_rate_satang: b.pay_type === "DAILY" ? b.salary_satang : null,
      hourly_rate_satang: b.pay_type === "HOURLY" ? b.salary_satang : null,
      reason: "Initial compensation",
      created_by_user_id: a.user.id,
    });
    sensitive(eid, b, a.user.id, b.hire_date);
    return row;
  };
  app.post("/api/companies/:company/employees", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "employee.manage");
    const b = employeeInput.parse(await c.req.json());
    assertCompanyReferences(r, a, b);
    if (b.create_user && (!b.personal_email || !b.password))
      fail("Email and initial password are required", 422);
    if (
      b.employment_status === "TERMINATED" &&
      (!b.termination_date || !b.termination_reason)
    )
      fail("Termination date and reason required", 422);
    const ph = b.create_user
      ? await Bun.password.hash(b.password!, { algorithm: "argon2id" })
      : null;
    const eid = id();
    r.tx(() => {
      let person = b.person_id
        ? r.one("SELECT * FROM people WHERE id=?", b.person_id)
        : b.national_id
          ? r.one(
              "SELECT * FROM people WHERE tenant_id=? AND national_id_hash=?",
              a.user.tenant_id,
              hash(b.national_id),
            )
          : null;
      let uid = person?.user_id || null;
      if (b.create_user && !uid) {
        uid = id();
        r.insert("users", {
          id: uid,
          tenant_id: a.user.tenant_id,
          email: b.personal_email!.toLowerCase(),
          password_hash: ph,
          display_name: `${b.first_name_th} ${b.last_name_th}`,
          default_organization_id: a.company.id,
          created_at: now(),
          updated_at: now(),
        });
      }
      const pid = person?.id || id();
      if (!person)
        r.insert("people", {
          id: pid,
          tenant_id: a.user.tenant_id,
          user_id: uid,
          national_id_hash: b.national_id ? hash(b.national_id) : null,
          primary_email: b.personal_email || null,
          primary_phone: b.mobile_phone || null,
        });
      if (
        r.one(
          "SELECT id FROM employees WHERE person_id=? AND organization_id=? AND employment_status<>'TERMINATED' AND deleted_at IS NULL",
          pid,
          a.company.id,
        )
      )
        fail("Person already has active employment in this company", 409);
      const row = insertEmployee(a, b, eid, uid, pid);
      if (uid) {
        const role = r.one(
          "SELECT id FROM roles WHERE tenant_id=? AND code=?",
          a.user.tenant_id,
          "EMPLOYEE",
        )!;
        r.run(
          "INSERT INTO user_company_access(id,user_id,organization_id,employee_id,granted_by_user_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,organization_id) DO UPDATE SET employee_id=excluded.employee_id",
          id(),
          uid,
          a.company.id,
          eid,
          a.user.id,
        );
        r.insert("user_roles", {
          id: id(),
          user_id: uid,
          role_id: role.id,
          organization_id: a.company.id,
          scope_type: "SELF",
          scope_id: eid,
          assigned_by_user_id: a.user.id,
        });
      }
      audit(r, a, c.get("requestId"), "CREATE", "employee", eid, null, row);
    });
    return c.json({ id: eid }, 201);
  });
  app.get("/api/companies/:company/employees/:employee", (c) => {
    const a = c.get("auth"),
      e = employeeObject(r, a, c.req.param("employee"));
    const own = e.id === a.employee?.id,
      sensitiveAccess = own || a.permissionSet.has("employee.sensitive");
    return c.json({
      ...presentEmployee(a, e),
      employment_history: r.all(
        "SELECT * FROM employment_history WHERE employee_id=? ORDER BY effective_from DESC",
        e.id,
      ),
      compensation_history: sensitiveAccess
        ? r.all(
            "SELECT * FROM compensation_history WHERE employee_id=? ORDER BY effective_from DESC",
            e.id,
          )
        : [],
      work_experiences: r.all(
        "SELECT * FROM employee_work_experiences WHERE employee_id=? ORDER BY started_on DESC",
        e.id,
      ),
      addresses: r.all(
        "SELECT * FROM employee_addresses WHERE employee_id=?",
        e.id,
      ),
      emergency_contacts: sensitiveAccess
        ? r.all(
            "SELECT * FROM employee_emergency_contacts WHERE employee_id=?",
            e.id,
          )
        : [],
      bank_accounts: sensitiveAccess
        ? r.all(
            "SELECT id,bank_code,account_name,account_number_last4,verified_at,effective_from,effective_to FROM employee_bank_accounts WHERE employee_id=?",
            e.id,
          )
        : [],
      profile_requests: r.all(
        "SELECT * FROM employee_profile_change_requests WHERE employee_id=? ORDER BY created_at DESC",
        e.id,
      ),
    });
  });
  app.put("/api/companies/:company/employees/:employee", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "employee.manage");
    const e = employeeObject(r, a, c.req.param("employee")),
      b = employeeInput.parse(await c.req.json());
    assertCompanyReferences(r, a, b);
    if (b.person_id && b.person_id !== e.person_id)
      fail("Person link is immutable", 409);
    if (b.hire_date !== e.hire_date)
      fail("Hire date is immutable after hiring", 409);
    if (b.manager_employee_id) {
      let current: string | null = b.manager_employee_id;
      const seen = new Set<string>([e.id]);
      while (current) {
        if (seen.has(current)) fail("Manager hierarchy cycle", 422);
        seen.add(current);
        current =
          r.one("SELECT manager_employee_id FROM employees WHERE id=?", current)
            ?.manager_employee_id || null;
      }
    }
    if (
      b.employment_status === "TERMINATED" &&
      (!b.termination_date || !b.termination_reason)
    )
      fail("Termination date and reason required", 422);
    const effective = b.effective_from || now().slice(0, 10);
    if (effective > now().slice(0, 10))
      fail("Future employment changes require a scheduled workflow", 422);
    r.tx(() => {
      const historyKeys = [
        "department_id",
        "branch_id",
        "position_id",
        "job_level_id",
        "manager_employee_id",
        "employment_type",
        "employment_status",
      ];
      const changed = historyKeys.some(
        (k) => (b as Row)[k] !== undefined && (b as Row)[k] !== e[k],
      );
      if (changed) {
        if (!b.reason) fail("History change requires a reason", 422);
        closePeriod(r, "employment_history", e.id, effective);
        r.insert("employment_history", {
          id: id(),
          employee_id: e.id,
          event_type:
            b.employment_status === "TERMINATED"
              ? "TERMINATED"
              : "STATUS_CHANGED",
          effective_from: effective,
          ...Object.fromEntries(
            historyKeys.map((k) => [
              k,
              (b as Row)[k] === undefined ? e[k] : (b as Row)[k],
            ]),
          ),
          reason: b.reason,
          created_by_user_id: a.user.id,
        });
      }
      const comp = r.one(
        "SELECT * FROM compensation_history WHERE employee_id=? AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1",
        e.id,
      );
      if (
        comp?.base_salary_satang !== b.salary_satang ||
        comp?.pay_type !== b.pay_type
      ) {
        if (!b.reason) fail("Compensation change requires a reason", 422);
        closePeriod(r, "compensation_history", e.id, effective);
        r.insert("compensation_history", {
          id: id(),
          employee_id: e.id,
          effective_from: effective,
          pay_type: b.pay_type,
          base_salary_satang: b.salary_satang,
          daily_rate_satang: b.pay_type === "DAILY" ? b.salary_satang : null,
          hourly_rate_satang: b.pay_type === "HOURLY" ? b.salary_satang : null,
          reason: b.reason,
          created_by_user_id: a.user.id,
        });
      }
      const data: Row = { updated_at: now(), updated_by_user_id: a.user.id };
      for (const k of [
        "employee_no",
        "first_name_th",
        "last_name_th",
        "first_name_en",
        "last_name_en",
        "mobile_phone",
        "personal_email",
        "termination_date",
        "termination_reason",
        ...historyKeys,
      ])
        if (b[k as keyof typeof b] !== undefined)
          data[k] = b[k as keyof typeof b];
      if (b.national_id)
        data.national_id_encrypted = secret.encrypt(b.national_id);
      if (b.passport_no)
        data.passport_no_encrypted = secret.encrypt(b.passport_no);
      r.update("employees", data, "id", e.id);
      sensitive(e.id, b, a.user.id, effective);
      audit(
        r,
        a,
        c.get("requestId"),
        "UPDATE",
        "employee",
        e.id,
        e,
        data,
        b.reason,
      );
    });
    return c.json({ ok: true });
  });
  app.delete("/api/companies/:company/employees/:employee", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "employee.manage");
    const e = employeeObject(r, a, c.req.param("employee")),
      b = z.object({ reason: text }).parse(await c.req.json());
    if (e.employment_status !== "TERMINATED" && e.employment_status !== "DRAFT")
      fail("Terminate employment before archiving", 409);
    r.tx(() => {
      r.update(
        "employees",
        { deleted_at: now(), updated_at: now() },
        "id",
        e.id,
      );
      audit(
        r,
        a,
        c.get("requestId"),
        "ARCHIVE",
        "employee",
        e.id,
        e,
        null,
        b.reason,
      );
    });
    return c.json({ ok: true });
  });
  app.get("/api/companies/:company/profile", (c) => {
    const a = c.get("auth");
    if (!a.employee) fail("No employee profile is linked", 404);
    return c.json({ employee_id: a.employee.id });
  });
  app.patch("/api/companies/:company/profile", async (c) => {
    const a = c.get("auth");
    if (!a.employee) fail("No profile", 404);
    const b = z
      .object({
        mobile_phone: z.string().max(40),
        personal_email: z.email(),
        nickname: z.string().max(100).optional(),
      })
      .strict()
      .parse(await c.req.json());
    r.tx(() => {
      r.update("employees", { ...b, updated_at: now() }, "id", a.employee!.id);
      audit(
        r,
        a,
        c.get("requestId"),
        "UPDATE_SELF",
        "employee",
        a.employee!.id,
        a.employee,
        b,
      );
    });
    return c.json({ ok: true });
  });
  app.post(
    "/api/companies/:company/employees/:employee/experiences",
    async (c) => {
      const a = c.get("auth"),
        e = employeeObject(r, a, c.req.param("employee"));
      if (e.id !== a.employee?.id) requirePermission(a, "employee.manage");
      const b = z
        .object({
          company_name: text,
          position_name: text,
          started_on: date,
          ended_on: date.nullable().default(null),
          description: z.string().max(3000).default(""),
        })
        .parse(await c.req.json());
      if (b.ended_on && b.ended_on < b.started_on)
        fail("Invalid experience date range", 422);
      const oid = id();
      r.tx(() => {
        r.insert("employee_work_experiences", {
          id: oid,
          employee_id: e.id,
          ...b,
          submission_status: "SUBMITTED",
          submitted_by_user_id: a.user.id,
          submitted_at: now(),
          created_at: now(),
        });
        audit(r, a, c.get("requestId"), "SUBMIT", "experience", oid, null, b);
      });
      return c.json({ id: oid }, 201);
    },
  );
  app.post(
    "/api/companies/:company/employees/:employee/profile-requests",
    async (c) => {
      const a = c.get("auth"),
        e = employeeObject(r, a, c.req.param("employee"));
      if (e.id !== a.employee?.id)
        fail("Only own profile requests are permitted", 403);
      const b = z
        .object({ field: z.enum(profileFields), value: text, reason: text })
        .parse(await c.req.json());
      const oid = id();
      r.tx(() => {
        r.insert("employee_profile_change_requests", {
          id: oid,
          employee_id: e.id,
          request_type:
            b.field === "bank_account"
              ? "BANK_ACCOUNT"
              : ["first_name_th", "last_name_th"].includes(b.field)
                ? "NAME"
                : "IDENTITY",
          status: "PENDING",
          reason: b.reason,
          submitted_by_user_id: a.user.id,
          submitted_at: now(),
          created_at: now(),
          updated_at: now(),
        });
        r.insert("employee_profile_change_items", {
          id: id(),
          change_request_id: oid,
          field_path: b.field,
          new_value_encrypted: secret.encrypt(b.value),
          display_new_value_masked: "••••",
        });
        audit(
          r,
          a,
          c.get("requestId"),
          "SUBMIT",
          "profile_request",
          oid,
          null,
          { field: b.field },
          b.reason,
        );
      });
      return c.json({ id: oid }, 201);
    },
  );
  app.post(
    "/api/companies/:company/profile-requests/:request/decision",
    async (c) => {
      const a = c.get("auth");
      requirePermission(a, "employee.manage");
      const b = z
          .object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: text })
          .parse(await c.req.json()),
        req = r.one(
          "SELECT * FROM employee_profile_change_requests WHERE id=?",
          c.req.param("request"),
        );
      if (!req) fail("Request missing", 404);
      const e = employeeObject(r, a, req.employee_id);
      if (req.status !== "PENDING") fail("Request already processed", 409);
      if (req.submitted_by_user_id === a.user.id)
        fail("Cannot approve your own request", 403);
      r.tx(() => {
        if (b.decision === "APPROVED")
          for (const item of r.all(
            "SELECT * FROM employee_profile_change_items WHERE change_request_id=?",
            req.id,
          )) {
            const v = secret.decrypt(item.new_value_encrypted);
            if (["first_name_th", "last_name_th"].includes(item.field_path))
              r.update(
                "employees",
                { [item.field_path]: v, updated_at: now() },
                "id",
                e.id,
              );
            else if (item.field_path === "national_id")
              r.update(
                "employees",
                { national_id_encrypted: secret.encrypt(v), updated_at: now() },
                "id",
                e.id,
              );
            else
              sensitive(
                e.id,
                {
                  [item.field_path]: v,
                  first_name_th: e.first_name_th,
                  last_name_th: e.last_name_th,
                },
                a.user.id,
                now().slice(0, 10),
              );
          }
        r.update(
          "employee_profile_change_requests",
          {
            status: b.decision,
            reviewed_by_user_id: a.user.id,
            reviewed_at: now(),
            review_comment: b.comment,
            updated_at: now(),
          },
          "id",
          req.id,
        );
        audit(
          r,
          a,
          c.get("requestId"),
          b.decision,
          "profile_request",
          req.id,
          req,
          b,
        );
      });
      return c.json({ ok: true });
    },
  );
  app.get("/api/companies/:company/attendance", (c) => {
    const a = c.get("auth"),
      s = employeeScope(a, "attendance"),
      p = page(c);
    return c.json({
      items: r.all(
        `SELECT ar.*,e.first_name_th,e.last_name_th,e.employee_no FROM attendance_records ar JOIN employees e ON e.id=ar.employee_id WHERE e.organization_id=? AND ${s.sql} ORDER BY ar.work_date DESC LIMIT ? OFFSET ?`,
        a.company.id,
        ...s.params,
        p.limit,
        p.offset,
      ),
    });
  });
  const saveAttendance = (a: Auth, e: Row, b: Row, requestId: string) => {
    const prev = r.one(
      "SELECT * FROM attendance_records WHERE employee_id=? AND work_date=?",
      e.id,
      b.work_date,
    );
    const day = scheduleDay(r, e, b.work_date);
    const worked = Math.max(
      0,
      Math.round(
        (Date.parse(b.check_out_at) - Date.parse(b.check_in_at)) / 60000,
      ) - (day?.break_minutes || 0),
    );
    if (b.check_out_at < b.check_in_at)
      fail("Check-out must follow check-in", 422);
    const start = day?.start_time
      ? new Date(`${b.work_date}T${day.start_time}:00+07:00`).toISOString()
      : null;
    const end = day?.end_time
      ? new Date(`${b.work_date}T${day.end_time}:00+07:00`).toISOString()
      : null;
    const values = {
      check_in_at: b.check_in_at,
      check_out_at: b.check_out_at,
      worked_minutes: worked,
      late_minutes: start
        ? Math.max(
            0,
            Math.round((Date.parse(b.check_in_at) - Date.parse(start)) / 60000),
          )
        : 0,
      early_leave_minutes: end
        ? Math.max(
            0,
            Math.round((Date.parse(end) - Date.parse(b.check_out_at)) / 60000),
          )
        : 0,
      scheduled_start_at: start,
      scheduled_end_at: end,
      status: "PRESENT",
      source: "MANUAL",
      note: b.reason,
      approved_by_user_id: a.user.id,
      updated_at: now(),
    };
    if (prev) r.update("attendance_records", values, "id", prev.id);
    else
      r.insert("attendance_records", {
        id: id(),
        employee_id: e.id,
        work_date: b.work_date,
        ...values,
        created_at: now(),
      });
    audit(
      r,
      a,
      requestId,
      "CORRECT",
      "attendance",
      prev?.id || e.id,
      prev,
      values,
      b.reason,
    );
  };
  app.post("/api/companies/:company/attendance", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "attendance.manage");
    const b = z
      .object({
        employee_id: text,
        work_date: date,
        check_in_at: timestamp,
        check_out_at: timestamp,
        reason: text,
      })
      .parse(await c.req.json());
    const e = employeeObject(r, a, b.employee_id, "attendance");
    r.tx(() => saveAttendance(a, e, b, c.get("requestId")));
    return c.json({ ok: true }, 201);
  });
  app.post("/api/companies/:company/attendance/clock", async (c) => {
    const a = c.get("auth");
    if (!a.employee) fail("No employee linked", 403);
    const b = z
      .object({ action: z.enum(["IN", "OUT"]) })
      .parse(await c.req.json());
    const workDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: a.company.timezone,
    }).format(new Date());
    r.tx(() => {
      const prev = r.one(
        "SELECT * FROM attendance_records WHERE employee_id=? AND work_date=?",
        a.employee!.id,
        workDate,
      );
      if (b.action === "IN") {
        if (prev) fail("Already checked in for today", 409);
        r.insert("attendance_records", {
          id: id(),
          employee_id: a.employee!.id,
          work_date: workDate,
          check_in_at: now(),
          source: "WEB",
          status: "INCOMPLETE",
          created_at: now(),
          updated_at: now(),
        });
      } else {
        if (!prev?.check_in_at || prev.check_out_at)
          fail("Check-in required or already checked out", 409);
        saveAttendance(
          a,
          a.employee!,
          {
            work_date: workDate,
            check_in_at: prev.check_in_at,
            check_out_at: now(),
            reason: "Web check-out",
          },
          c.get("requestId"),
        );
        r.update("attendance_records", { source: "WEB" }, "id", prev.id);
      }
      audit(
        r,
        a,
        c.get("requestId"),
        `CLOCK_${b.action}`,
        "attendance",
        a.employee!.id,
      );
    });
    return c.json({ ok: true });
  });
  app.get("/api/companies/:company/attendance-requests", (c) => {
    const a = c.get("auth"),
      s = employeeScope(a, "attendance"),
      p = page(c);
    return c.json({
      items: r.all(
        `SELECT x.*,e.first_name_th,e.last_name_th FROM attendance_change_requests x JOIN employees e ON e.id=x.employee_id WHERE e.organization_id=? AND ${s.sql} ORDER BY x.created_at DESC LIMIT ? OFFSET ?`,
        a.company.id,
        ...s.params,
        p.limit,
        p.offset,
      ),
    });
  });
  app.post("/api/companies/:company/attendance-requests", async (c) => {
    const a = c.get("auth");
    if (!a.employee) fail("No employee profile", 403);
    const b = z
      .object({
        work_date: date,
        check_in_at: timestamp,
        check_out_at: timestamp,
        reason: text,
      })
      .parse(await c.req.json());
    if (b.check_out_at <= b.check_in_at)
      fail("Invalid correction time range", 422);
    const oid = id();
    r.tx(() => {
      r.insert("attendance_change_requests", {
        id: oid,
        employee_id: a.employee!.id,
        ...b,
        status: "PENDING",
        submitted_by: a.user.id,
        created_at: now(),
      });
      audit(
        r,
        a,
        c.get("requestId"),
        "SUBMIT",
        "attendance_request",
        oid,
        null,
        b,
      );
    });
    return c.json({ id: oid }, 201);
  });
  app.post(
    "/api/companies/:company/attendance-requests/:request/decision",
    async (c) => {
      const a = c.get("auth");
      requirePermission(a, "attendance.manage");
      const b = z
        .object({ decision: z.enum(["APPROVED", "REJECTED"]) })
        .parse(await c.req.json());
      const req = r.one(
        "SELECT * FROM attendance_change_requests WHERE id=?",
        c.req.param("request"),
      );
      if (!req) fail("Request missing", 404);
      const e = employeeObject(r, a, req.employee_id, "attendance");
      if (req.status !== "PENDING") fail("Already processed", 409);
      if (req.submitted_by === a.user.id)
        fail("Cannot approve own correction", 403);
      r.tx(() => {
        if (b.decision === "APPROVED")
          saveAttendance(a, e, req, c.get("requestId"));
        r.update(
          "attendance_change_requests",
          { status: b.decision, reviewed_by: a.user.id, reviewed_at: now() },
          "id",
          req.id,
        );
        audit(
          r,
          a,
          c.get("requestId"),
          b.decision,
          "attendance_request",
          req.id,
          req,
          b,
        );
      });
      return c.json({ ok: true });
    },
  );
  app.get("/api/companies/:company/schedules", (c) => {
    const a = c.get("auth");
    return c.json({
      items: r.all(
        "SELECT s.*,json_group_array(json_object('weekday',d.weekday,'is_workday',d.is_workday,'start_time',d.start_time,'end_time',d.end_time)) days_json FROM work_schedules s LEFT JOIN work_schedule_days d ON d.work_schedule_id=s.id WHERE s.organization_id=? GROUP BY s.id",
        a.company.id,
      ),
    });
  });
  app.post("/api/companies/:company/schedules", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "attendance.manage");
    const b = z
      .object({
        code: text,
        name: text,
        days: z
          .array(
            z.object({
              weekday: z.number().int().min(1).max(7),
              is_workday: z.number().int().min(0).max(1),
              start_time: z.string().regex(/^\d{2}:\d{2}$/),
              end_time: z.string().regex(/^\d{2}:\d{2}$/),
              break_minutes: z.number().int().min(0).max(480),
            }),
          )
          .length(7),
      })
      .parse(await c.req.json());
    if (new Set(b.days.map((x) => x.weekday)).size !== 7)
      fail("Duplicate weekdays", 422);
    const oid = id();
    r.tx(() => {
      r.insert("work_schedules", {
        id: oid,
        organization_id: a.company.id,
        code: b.code,
        name: b.name,
      });
      for (const d of b.days)
        r.insert("work_schedule_days", { work_schedule_id: oid, ...d });
      audit(r, a, c.get("requestId"), "CREATE", "schedule", oid, null, b);
    });
    return c.json({ id: oid }, 201);
  });
  app.post("/api/companies/:company/schedules/:schedule/assign", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "attendance.manage");
    const s = companyObject(a, "work_schedules", c.req.param("schedule"));
    const b = z
      .object({ employee_id: text, effective_from: date })
      .parse(await c.req.json());
    const e = employeeObject(r, a, b.employee_id, "attendance");
    r.tx(() => {
      closePeriod(r, "employee_schedule_assignments", e.id, b.effective_from);
      r.insert("employee_schedule_assignments", {
        id: id(),
        employee_id: e.id,
        work_schedule_id: s.id,
        effective_from: b.effective_from,
        created_by_user_id: a.user.id,
      });
      audit(r, a, c.get("requestId"), "ASSIGN", "schedule", s.id, null, b);
    });
    return c.json({ ok: true });
  });
  app.get("/api/companies/:company/overtime", (c) => {
    const a = c.get("auth"),
      s = employeeScope(a, "attendance"),
      p = page(c);
    return c.json({
      items: r.all(
        `SELECT o.*,e.first_name_th,e.last_name_th FROM overtime_requests o JOIN employees e ON e.id=o.employee_id WHERE e.organization_id=? AND ${s.sql} ORDER BY o.work_date DESC LIMIT ? OFFSET ?`,
        a.company.id,
        ...s.params,
        p.limit,
        p.offset,
      ),
    });
  });
  app.post("/api/companies/:company/overtime", async (c) => {
    const a = c.get("auth");
    const b = z
      .object({
        employee_id: text,
        work_date: date,
        start_at: timestamp,
        end_at: timestamp,
        reason: text,
      })
      .parse(await c.req.json());
    const e = employeeObject(r, a, b.employee_id, "attendance");
    const minutes = Math.round(
      (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000,
    );
    if (minutes <= 0 || minutes > 1440) fail("Invalid overtime duration", 422);
    const oid = id();
    r.tx(() => {
      r.insert("overtime_requests", {
        id: oid,
        employee_id: e.id,
        ...Object.fromEntries(
          Object.entries(b).filter(([k]) => k !== "employee_id"),
        ),
        requested_minutes: minutes,
        status: "PENDING",
        submitted_at: now(),
        updated_at: now(),
        created_at: now(),
      });
      audit(r, a, c.get("requestId"), "SUBMIT", "overtime", oid, null, b);
    });
    return c.json({ id: oid }, 201);
  });
  app.post("/api/companies/:company/overtime/:request/decision", async (c) => {
    const a = c.get("auth");
    if (!a.permissionSet.has("attendance.manage"))
      requirePermission(a, "ot.approve");
    const b = z
      .object({
        decision: z.enum(["APPROVED", "REJECTED"]),
        approved_minutes: z.number().int().min(0).optional(),
      })
      .parse(await c.req.json());
    const req = r.one(
      "SELECT * FROM overtime_requests WHERE id=?",
      c.req.param("request"),
    );
    if (!req) fail("OT request missing", 404);
    const e = employeeObject(r, a, req.employee_id, "attendance");
    if (e.id === a.employee?.id) fail("Cannot approve own overtime", 403);
    if (req.status !== "PENDING") fail("Already processed", 409);
    if ((b.approved_minutes || 0) > req.requested_minutes)
      fail("Approved minutes exceed request", 422);
    r.tx(() => {
      r.update(
        "overtime_requests",
        {
          status: b.decision,
          approved_minutes:
            b.decision === "APPROVED"
              ? (b.approved_minutes ?? req.requested_minutes)
              : 0,
          decided_by_user_id: a.user.id,
          decided_at: now(),
          updated_at: now(),
        },
        "id",
        req.id,
      );
      audit(r, a, c.get("requestId"), b.decision, "overtime", req.id, req, b);
    });
    return c.json({ ok: true });
  });
  app.get("/api/companies/:company/leave", (c) => {
    const a = c.get("auth"),
      s = employeeScope(a, "leave"),
      p = page(c);
    const items = r.all(
      `SELECT l.*,e.first_name_th,e.last_name_th,t.name_th leave_type_name,t.privacy_level FROM leave_requests l JOIN employees e ON e.id=l.employee_id JOIN leave_types t ON t.id=l.leave_type_id WHERE e.organization_id=? AND ${s.sql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      a.company.id,
      ...s.params,
      p.limit,
      p.offset,
    );
    for (const item of items)
      if (
        item.employee_id !== a.employee?.id &&
        !a.permissionSet.has("leave.manage") &&
        item.privacy_level !== "PUBLIC"
      ) {
        item.reason = "[PRIVATE]";
        item.attachment_url = null;
      }
    return c.json({ items });
  });
  app.get("/api/companies/:company/leave-balances", (c) => {
    const a = c.get("auth"),
      s = employeeScope(a, "leave");
    return c.json({
      items: r.all(
        `SELECT b.*,e.first_name_th,e.last_name_th,t.name_th,(SELECT COALESCE(SUM(minutes),0) FROM leave_balance_transactions WHERE employee_leave_balance_id=b.id) available_minutes FROM employee_leave_balances b JOIN employees e ON e.id=b.employee_id JOIN leave_types t ON t.id=b.leave_type_id WHERE e.organization_id=? AND ${s.sql} ORDER BY b.balance_year DESC`,
        a.company.id,
        ...s.params,
      ),
    });
  });
  app.post("/api/companies/:company/leave-balances", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "leave.manage");
    const b = z
      .object({
        employee_id: text,
        leave_type_id: text,
        balance_year: z.number().int().min(2000).max(2200),
        minutes: z.number().int().min(-525600).max(525600),
        reason: text,
      })
      .parse(await c.req.json());
    const e = employeeObject(r, a, b.employee_id, "leave");
    companyObject(a, "leave_types", b.leave_type_id);
    r.tx(() => {
      let bal = r.one(
        "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
        e.id,
        b.leave_type_id,
        b.balance_year,
      );
      if (!bal)
        bal = r.insert("employee_leave_balances", {
          id: id(),
          employee_id: e.id,
          leave_type_id: b.leave_type_id,
          balance_year: b.balance_year,
        });
      r.insert("leave_balance_transactions", {
        id: id(),
        employee_leave_balance_id: bal.id,
        transaction_type: "ADJUSTMENT",
        minutes: b.minutes,
        reason: b.reason,
        created_by_user_id: a.user.id,
        created_at: now(),
      });
      audit(
        r,
        a,
        c.get("requestId"),
        "ADJUST",
        "leave_balance",
        bal.id,
        null,
        b,
        b.reason,
      );
    });
    return c.json({ ok: true });
  });
  app.post("/api/companies/:company/leave", async (c) => {
    const a = c.get("auth"),
      b = z
        .object({
          employee_id: text,
          leave_type_id: text,
          start_date: date,
          end_date: date,
          unit: z.enum(["FULL", "HALF", "HOUR"]).default("FULL"),
          hours: z.number().min(0.5).max(8).optional(),
          reason: text,
        })
        .parse(await c.req.json());
    const e = employeeObject(r, a, b.employee_id, "leave"),
      t = companyObject(a, "leave_types", b.leave_type_id);
    if (t.status !== "ACTIVE") fail("Leave type inactive", 422);
    if (t.requires_attachment)
      fail("This leave type requires a protected attachment", 422);
    if (b.start_date.slice(0, 4) !== b.end_date.slice(0, 4))
      fail("Split leave requests by calendar year", 422);
    const oid = id();
    r.tx(() => {
      if (
        r.one(
          "SELECT id FROM leave_requests WHERE employee_id=? AND status IN ('PENDING','APPROVED') AND substr(start_at,1,10)<=? AND substr(end_at,1,10)>=?",
          e.id,
          b.end_date,
          b.start_date,
        )
      )
        fail("Leave dates overlap an existing request", 409);
      const policy = r.one(
        "SELECT * FROM leave_policies WHERE leave_type_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1",
        t.id,
        b.start_date,
        b.end_date,
      );
      if (!policy) fail("No effective leave policy", 422);
      if (
        (Date.parse(b.start_date) - Date.parse(e.hire_date)) / 86400000 <
        policy.minimum_service_days
      )
        fail("Minimum service not met", 422);
      const days: Row[] = [];
      for (const d of datesBetween(b.start_date, b.end_date)) {
        const day = scheduleDay(r, e, d);
        if (!day) fail("Employee schedule is missing", 422);
        if (
          !day.is_workday ||
          r.one(
            "SELECT id FROM holidays WHERE organization_id=? AND holiday_date=? AND (branch_id IS NULL OR branch_id=?)",
            a.company.id,
            d,
            e.branch_id,
          )
        )
          continue;
        const [sh, sm] = day.start_time.split(":").map(Number),
          [eh, em] = day.end_time.split(":").map(Number);
        const shiftMinutes =
          ((eh * 60 + em - sh * 60 - sm + 1440) % 1440) - day.break_minutes;
        const minutes =
          b.unit === "FULL"
            ? shiftMinutes
            : b.unit === "HALF"
              ? Math.floor(shiftMinutes / 2)
              : Math.round((b.hours || 1) * 60);
        if (minutes <= 0 || minutes > shiftMinutes)
          fail("Leave exceeds scheduled work time", 422);
        days.push({ date: d, minutes });
      }
      const minutes = days.reduce((s, d) => s + d.minutes, 0);
      if (!minutes) fail("No working time selected", 422);
      const bal = balance(r, e.id, t.id, Number(b.start_date.slice(0, 4)));
      const reserved = r.one(
        "SELECT COALESCE(SUM(requested_minutes),0) n FROM leave_requests WHERE employee_id=? AND leave_type_id=? AND status='PENDING' AND substr(start_at,1,4)=?",
        e.id,
        t.id,
        b.start_date.slice(0, 4),
      )!.n;
      if (
        !t.allow_negative_balance &&
        minutes > bal.available_minutes - reserved
      )
        fail("Insufficient leave balance", 422);
      staffing(
        r,
        e,
        days.map((d) => d.date),
      );
      r.insert("leave_requests", {
        id: oid,
        employee_id: e.id,
        leave_type_id: t.id,
        start_at: `${b.start_date}T00:00:00.000Z`,
        end_at: `${b.end_date}T23:59:59.000Z`,
        requested_minutes: minutes,
        reason: b.reason,
        status: "PENDING",
        submitted_at: now(),
        created_at: now(),
        updated_at: now(),
      });
      for (const d of days)
        r.insert("leave_request_days", {
          id: id(),
          leave_request_id: oid,
          leave_date: d.date,
          leave_minutes: d.minutes,
          is_paid: t.is_paid,
        });
      const manager = e.manager_employee_id
        ? r.one(
            "SELECT user_id FROM employees WHERE id=?",
            e.manager_employee_id,
          )
        : null;
      const hr = r.one(
        `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles ro ON ro.id=ur.role_id JOIN user_company_access ca ON ca.user_id=u.id AND ca.organization_id=? WHERE u.tenant_id=? AND u.status='ACTIVE' AND ca.access_status='ACTIVE' AND ro.code IN ('HR','COMPANY_ADMIN','TENANT_ADMIN') AND (ur.organization_id=? OR ur.scope_type='TENANT') AND u.id<>? AND u.id<>? ORDER BY CASE ro.code WHEN 'HR' THEN 0 ELSE 1 END LIMIT 1`,
        a.company.id,
        a.user.tenant_id,
        a.company.id,
        a.user.id,
        manager?.user_id || "",
      );
      const approvers = [manager?.user_id, hr?.id].filter(
        (x, i, arr) => x && x !== a.user.id && arr.indexOf(x) === i,
      );
      if (!approvers.length) fail("No eligible leave approver configured", 422);
      approvers.forEach((uid, i) =>
        r.insert("leave_approvals", {
          id: id(),
          leave_request_id: oid,
          step_no: i + 1,
          approver_user_id: uid,
        }),
      );
      audit(r, a, c.get("requestId"), "SUBMIT", "leave", oid, null, b);
    });
    return c.json({ id: oid }, 201);
  });
  app.get("/api/companies/:company/leave/:request/approvals", (c) => {
    const a = c.get("auth"),
      req = r.one(
        "SELECT * FROM leave_requests WHERE id=?",
        c.req.param("request"),
      );
    if (!req) fail("Leave request missing", 404);
    employeeObject(r, a, req.employee_id, "leave");
    return c.json({
      items: r.all(
        "SELECT la.*,u.display_name FROM leave_approvals la JOIN users u ON u.id=la.approver_user_id WHERE leave_request_id=? ORDER BY step_no",
        req.id,
      ),
    });
  });
  app.post("/api/companies/:company/leave/:request/decision", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "leave.approve");
    const b = z
        .object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: text })
        .parse(await c.req.json()),
      req = r.one(
        "SELECT * FROM leave_requests WHERE id=?",
        c.req.param("request"),
      );
    if (!req) fail("Leave request missing", 404);
    const e = employeeObject(r, a, req.employee_id, "leave");
    if (e.id === a.employee?.id) fail("Cannot approve own leave", 403);
    r.tx(() => {
      if (req.status !== "PENDING") fail("Request already decided", 409);
      const step = r.one(
        "SELECT * FROM leave_approvals WHERE leave_request_id=? AND decision='PENDING' ORDER BY step_no LIMIT 1",
        req.id,
      );
      if (!step || step.approver_user_id !== a.user.id)
        fail("You are not the next approver", 403);
      r.update(
        "leave_approvals",
        { decision: b.decision, comment: b.comment, decided_at: now() },
        "id",
        step.id,
      );
      if (b.decision === "REJECTED")
        r.update(
          "leave_requests",
          { status: "REJECTED", updated_at: now() },
          "id",
          req.id,
        );
      else if (
        !r.one(
          "SELECT id FROM leave_approvals WHERE leave_request_id=? AND decision='PENDING'",
          req.id,
        )
      ) {
        const t = companyObject(a, "leave_types", req.leave_type_id),
          bal = balance(r, e.id, t.id, Number(req.start_at.slice(0, 4)));
        if (
          !t.allow_negative_balance &&
          bal.available_minutes < req.requested_minutes
        )
          fail("Insufficient balance", 422);
        const days = r.all(
          "SELECT * FROM leave_request_days WHERE leave_request_id=?",
          req.id,
        );
        staffing(
          r,
          e,
          days.map((d) => d.leave_date),
        );
        r.insert("leave_balance_transactions", {
          id: id(),
          employee_leave_balance_id: bal.id,
          transaction_type: "USAGE",
          minutes: -req.requested_minutes,
          source_type: "leave",
          source_id: req.id,
          reason: b.comment,
          created_by_user_id: a.user.id,
          created_at: now(),
        });
        r.update(
          "employee_leave_balances",
          {
            used_minutes: bal.used_minutes + req.requested_minutes,
            updated_at: now(),
          },
          "id",
          bal.id,
        );
        r.update(
          "leave_requests",
          { status: "APPROVED", updated_at: now() },
          "id",
          req.id,
        );
        for (const day of days)
          r.run(
            "INSERT INTO attendance_records(id,employee_id,work_date,status,note,created_at,updated_at) VALUES(?,?,?,'LEAVE',?,?,?) ON CONFLICT(employee_id,work_date) DO UPDATE SET status=CASE WHEN attendance_records.status='PRESENT' THEN 'PRESENT' ELSE 'LEAVE' END,updated_at=excluded.updated_at",
            id(),
            e.id,
            day.leave_date,
            "Approved leave",
            now(),
            now(),
          );
        if (e.user_id)
          r.insert("notifications", {
            id: id(),
            tenant_id: a.user.tenant_id,
            organization_id: a.company.id,
            user_id: e.user_id,
            notification_type: "LEAVE",
            title: "Leave approved",
            source_type: "leave",
            source_id: req.id,
            created_at: now(),
          });
      }
      audit(r, a, c.get("requestId"), b.decision, "leave", req.id, req, b);
    });
    emit({
      tenant: a.user.tenant_id,
      company: a.company.id,
      user: e.user_id,
      type: "notification",
    });
    return c.json({ ok: true });
  });
  app.post("/api/companies/:company/leave/:request/cancel", async (c) => {
    const a = c.get("auth"),
      req = r.one(
        "SELECT * FROM leave_requests WHERE id=?",
        c.req.param("request"),
      );
    if (!req) fail("Request missing", 404);
    const e = employeeObject(r, a, req.employee_id, "leave");
    if (e.id !== a.employee?.id) requirePermission(a, "leave.manage");
    const b = z.object({ reason: text }).parse(await c.req.json());
    r.tx(() => {
      if (!["PENDING", "APPROVED"].includes(req.status))
        fail("Cannot cancel request", 409);
      if (req.status === "APPROVED") {
        const bal = balance(
          r,
          e.id,
          req.leave_type_id,
          Number(req.start_at.slice(0, 4)),
        );
        r.insert("leave_balance_transactions", {
          id: id(),
          employee_leave_balance_id: bal.id,
          transaction_type: "REVERSAL",
          minutes: req.requested_minutes,
          source_type: "leave",
          source_id: req.id,
          reason: b.reason,
          created_by_user_id: a.user.id,
          created_at: now(),
        });
        r.update(
          "employee_leave_balances",
          {
            used_minutes: Math.max(0, bal.used_minutes - req.requested_minutes),
            updated_at: now(),
          },
          "id",
          bal.id,
        );
        for (const d of r.all(
          "SELECT leave_date FROM leave_request_days WHERE leave_request_id=?",
          req.id,
        ))
          r.run(
            "UPDATE attendance_records SET status='PENDING',note=?,updated_at=? WHERE employee_id=? AND work_date=? AND status='LEAVE'",
            "Leave cancelled",
            now(),
            e.id,
            d.leave_date,
          );
      }
      r.update(
        "leave_requests",
        { status: "CANCELLED", cancelled_at: now(), updated_at: now() },
        "id",
        req.id,
      );
      audit(
        r,
        a,
        c.get("requestId"),
        "CANCEL",
        "leave",
        req.id,
        req,
        null,
        b.reason,
      );
    });
    return c.json({ ok: true });
  });
  app.get("/api/companies/:company/payroll", (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.prepare");
    const p = page(c);
    return c.json({
      items: r.all(
        "SELECT c.*,r.total_net_satang,r.employee_count,r.blocking_error_count,r.warning_count FROM payroll_cycles c LEFT JOIN payroll_calculation_runs r ON r.payroll_cycle_id=c.id AND r.version_no=c.current_calculation_version WHERE c.organization_id=? ORDER BY c.period_start DESC LIMIT ? OFFSET ?",
        a.company.id,
        p.limit,
        p.offset,
      ),
    });
  });
  app.post("/api/companies/:company/payroll", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.prepare");
    const b = z
      .object({
        code: text,
        name: text,
        cycle_type: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]),
        period_start: date,
        period_end: date,
        pay_date: date,
      })
      .parse(await c.req.json());
    const days = datesBetween(b.period_start, b.period_end);
    if (b.pay_date < b.period_end) fail("Pay date precedes period end", 422);
    if (
      (b.cycle_type === "DAILY" && days.length !== 1) ||
      (b.cycle_type === "WEEKLY" && days.length !== 7) ||
      (b.cycle_type === "BIWEEKLY" && days.length !== 14)
    )
      fail("Period does not match cycle type", 422);
    const oid = id();
    r.tx(() => {
      if (
        r.one(
          "SELECT id FROM payroll_cycles WHERE organization_id=? AND status<>'CANCELLED' AND period_start<=? AND period_end>=?",
          a.company.id,
          b.period_end,
          b.period_start,
        )
      )
        fail("Payroll period overlaps another cycle", 409);
      r.insert("payroll_cycles", {
        id: oid,
        organization_id: a.company.id,
        ...b,
        created_by_user_id: a.user.id,
        created_at: now(),
        updated_at: now(),
      });
      audit(r, a, c.get("requestId"), "CREATE", "payroll", oid, null, b);
    });
    return c.json({ id: oid }, 201);
  });
  app.get("/api/companies/:company/payroll/:cycle", (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.prepare");
    const cycle = companyObject(a, "payroll_cycles", c.req.param("cycle"));
    const version =
      Number(c.req.query("version")) || cycle.current_calculation_version;
    return c.json({
      ...cycle,
      run: r.one(
        "SELECT * FROM payroll_calculation_runs WHERE payroll_cycle_id=? AND version_no=?",
        cycle.id,
        version,
      ),
      runs: r.all(
        "SELECT * FROM payroll_calculation_runs WHERE payroll_cycle_id=? ORDER BY version_no DESC",
        cycle.id,
      ),
      results: r.all(
        "SELECT pr.*,e.first_name_th,e.last_name_th,e.employee_no FROM payroll_results pr JOIN payroll_calculation_runs run ON run.id=pr.calculation_run_id JOIN employees e ON e.id=pr.employee_id WHERE pr.payroll_cycle_id=? AND run.version_no=?",
        cycle.id,
        version,
      ),
      approvals: r.all(
        "SELECT pa.*,u.display_name FROM payroll_approvals pa JOIN users u ON u.id=pa.approver_user_id WHERE payroll_cycle_id=? ORDER BY step_no",
        cycle.id,
      ),
      history: r.all(
        "SELECT * FROM payroll_cycle_status_history WHERE payroll_cycle_id=? ORDER BY changed_at",
        cycle.id,
      ),
    });
  });
  app.post("/api/companies/:company/payroll/:cycle/calculate", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.prepare");
    const cycle = companyObject(a, "payroll_cycles", c.req.param("cycle"));
    const ik = c.req.header("Idempotency-Key");
    if (!ik || ik.length > 100) fail("Idempotency-Key header required", 422);
    const rh = hash(`calculate:${cycle.id}`);
    const old = r.one(
      "SELECT * FROM request_idempotency WHERE user_id=? AND organization_id=? AND key=?",
      a.user.id,
      a.company.id,
      ik,
    );
    if (old) {
      if (old.request_hash !== rh)
        fail("Idempotency key reused for another request", 409);
      return c.json(JSON.parse(old.response_json));
    }
    const result = r.tx(() => {
      const value = payrollCalculate(r, a, cycle, c.get("requestId"));
      r.insert("request_idempotency", {
        user_id: a.user.id,
        organization_id: a.company.id,
        key: ik,
        request_hash: rh,
        response_json: JSON.stringify(value),
        created_at: now(),
      });
      return value;
    });
    return c.json(result);
  });
  app.post("/api/companies/:company/payroll/:cycle/adjustments", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.prepare");
    const cycle = companyObject(a, "payroll_cycles", c.req.param("cycle"));
    if (!["DRAFT", "REVIEW"].includes(cycle.status)) fail("Cycle locked", 409);
    const b = z
      .object({
        employee_id: text,
        item_type: z.enum(["EARNING", "DEDUCTION"]),
        amount_satang: money,
        reason: text,
        description: text,
      })
      .parse(await c.req.json());
    employeeObject(r, a, b.employee_id);
    const oid = id();
    r.tx(() => {
      r.insert("payroll_adjustments", {
        id: oid,
        payroll_cycle_id: cycle.id,
        ...b,
        item_code: "MANUAL",
        created_by_user_id: a.user.id,
        created_at: now(),
      });
      r.update(
        "payroll_cycles",
        { status: "DRAFT", updated_at: now() },
        "id",
        cycle.id,
      );
      audit(
        r,
        a,
        c.get("requestId"),
        "ADJUST",
        "payroll",
        cycle.id,
        null,
        b,
        b.reason,
      );
    });
    return c.json({ id: oid }, 201);
  });
  app.post("/api/companies/:company/payroll/:cycle/submit", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.review");
    const cycle = companyObject(a, "payroll_cycles", c.req.param("cycle")),
      b = z
        .object({ approver_user_id: text, comment: text })
        .parse(await c.req.json());
    if (cycle.status !== "REVIEW") fail("Calculate before submitting", 409);
    const run = r.one(
      "SELECT * FROM payroll_calculation_runs WHERE payroll_cycle_id=? AND version_no=?",
      cycle.id,
      cycle.current_calculation_version,
    )!;
    if (run.blocking_error_count)
      fail("Resolve blocking payroll errors first", 422);
    if (
      run.triggered_by_user_id === a.user.id ||
      cycle.created_by_user_id === a.user.id
    )
      fail("Reviewer must differ from preparer", 403);
    const approver = authorize(
      r,
      r.one(
        "SELECT * FROM users WHERE id=? AND tenant_id=? AND status=?",
        b.approver_user_id,
        a.user.tenant_id,
        "ACTIVE",
      ) || fail("Invalid approver", 403),
      a.company.id,
    );
    requirePermission(approver, "payroll.approve");
    if (
      [a.user.id, run.triggered_by_user_id, cycle.created_by_user_id].includes(
        approver.user.id,
      )
    )
      fail("Approver must differ from preparer and reviewer", 403);
    r.tx(() => {
      r.insert("payroll_approvals", {
        id: id(),
        payroll_cycle_id: cycle.id,
        step_no: 1,
        approver_user_id: approver.user.id,
      });
      r.update(
        "payroll_cycles",
        {
          status: "PENDING_APPROVAL",
          submitted_by_user_id: a.user.id,
          submitted_at: now(),
          updated_at: now(),
        },
        "id",
        cycle.id,
      );
      r.insert("payroll_cycle_status_history", {
        id: id(),
        payroll_cycle_id: cycle.id,
        from_status: "REVIEW",
        to_status: "PENDING_APPROVAL",
        changed_by_user_id: a.user.id,
        comment: b.comment,
        changed_at: now(),
      });
      audit(r, a, c.get("requestId"), "SUBMIT", "payroll", cycle.id, cycle, b);
    });
    return c.json({ ok: true });
  });
  app.post("/api/companies/:company/payroll/:cycle/approve", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.approve");
    const cycle = companyObject(a, "payroll_cycles", c.req.param("cycle"));
    const b = z.object({ comment: text }).parse(await c.req.json());
    if (cycle.status !== "PENDING_APPROVAL")
      fail("Cycle not pending approval", 409);
    const approval = r.one(
      "SELECT * FROM payroll_approvals WHERE payroll_cycle_id=? AND decision='PENDING' ORDER BY step_no LIMIT 1",
      cycle.id,
    );
    if (
      !approval ||
      approval.approver_user_id !== a.user.id ||
      [cycle.created_by_user_id, cycle.submitted_by_user_id].includes(a.user.id)
    )
      fail("Ineligible approver", 403);
    r.tx(() => {
      r.update(
        "payroll_approvals",
        { decision: "APPROVED", comment: b.comment, decided_at: now() },
        "id",
        approval.id,
      );
      r.update(
        "payroll_cycles",
        {
          status: "APPROVED",
          approved_by_user_id: a.user.id,
          approved_at: now(),
          locked_at: now(),
          updated_at: now(),
        },
        "id",
        cycle.id,
      );
      const results = r.all(
        "SELECT pr.* FROM payroll_results pr JOIN payroll_calculation_runs run ON run.id=pr.calculation_run_id WHERE pr.payroll_cycle_id=? AND run.version_no=?",
        cycle.id,
        cycle.current_calculation_version,
      );
      for (const [i, result] of results.entries())
        r.insert("payslips", {
          id: id(),
          payroll_cycle_id: cycle.id,
          payroll_result_id: result.id,
          employee_id: result.employee_id,
          slip_no: `${cycle.code}-${i + 1}`,
          issued_at: now(),
          published_at: now(),
          delivery_status: "PUBLISHED",
          created_at: now(),
        });
      r.insert("payroll_cycle_status_history", {
        id: id(),
        payroll_cycle_id: cycle.id,
        from_status: cycle.status,
        to_status: "APPROVED",
        comment: b.comment,
        changed_by_user_id: a.user.id,
        changed_at: now(),
      });
      audit(r, a, c.get("requestId"), "APPROVE", "payroll", cycle.id, cycle, b);
    });
    return c.json({ ok: true });
  });
  app.post("/api/companies/:company/payroll/:cycle/transition", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.approve");
    const cycle = companyObject(a, "payroll_cycles", c.req.param("cycle")),
      b = z
        .object({ status: z.enum(["PAID", "CLOSED"]), reason: text })
        .parse(await c.req.json());
    if (
      (b.status === "PAID" && cycle.status !== "APPROVED") ||
      (b.status === "CLOSED" && cycle.status !== "PAID")
    )
      fail("Invalid payroll transition", 409);
    r.tx(() => {
      r.update(
        "payroll_cycles",
        {
          status: b.status,
          [b.status === "PAID" ? "paid_at" : "closed_at"]: now(),
          updated_at: now(),
        },
        "id",
        cycle.id,
      );
      r.insert("payroll_cycle_status_history", {
        id: id(),
        payroll_cycle_id: cycle.id,
        from_status: cycle.status,
        to_status: b.status,
        comment: b.reason,
        changed_by_user_id: a.user.id,
        changed_at: now(),
      });
      audit(r, a, c.get("requestId"), b.status, "payroll", cycle.id, cycle, b);
    });
    return c.json({ ok: true });
  });
  app.get("/api/companies/:company/payslips", (c) => {
    const a = c.get("auth"),
      p = page(c);
    if (!a.employee && !a.permissionSet.has("payroll.prepare"))
      return c.json({ items: [] });
    return c.json({
      items: r.all(
        `SELECT p.*,pr.net_pay_satang,pr.gross_income_satang,c.name,c.period_start,c.period_end FROM payslips p JOIN payroll_results pr ON pr.id=p.payroll_result_id JOIN payroll_cycles c ON c.id=p.payroll_cycle_id WHERE c.organization_id=? AND p.delivery_status<>'REVOKED' AND ${a.permissionSet.has("payroll.prepare") ? "1=1" : "p.employee_id=?"} ORDER BY c.period_end DESC LIMIT ? OFFSET ?`,
        a.company.id,
        ...(a.permissionSet.has("payroll.prepare") ? [] : [a.employee!.id]),
        p.limit,
        p.offset,
      ),
    });
  });
  app.get("/api/companies/:company/payslips/:slip", (c) => {
    const a = c.get("auth");
    const slip = r.one(
      "SELECT p.*,c.organization_id FROM payslips p JOIN payroll_cycles c ON c.id=p.payroll_cycle_id WHERE p.id=? AND c.organization_id=? AND p.delivery_status<>?",
      c.req.param("slip"),
      a.company.id,
      "REVOKED",
    );
    if (
      !slip ||
      (!a.permissionSet.has("payroll.prepare") &&
        slip.employee_id !== a.employee?.id)
    )
      fail("Payslip access denied", 403);
    r.update(
      "payslips",
      {
        first_viewed_at: slip.first_viewed_at || now(),
        last_viewed_at: now(),
        view_count: slip.view_count + 1,
        delivery_status: "VIEWED",
      },
      "id",
      slip.id,
    );
    return c.json({
      ...slip,
      employee: presentEmployee(
        a,
        r.one("SELECT * FROM employees WHERE id=?", slip.employee_id)!,
      ),
      result: r.one(
        "SELECT * FROM payroll_results WHERE id=?",
        slip.payroll_result_id,
      ),
      items: r.all(
        "SELECT * FROM payroll_result_items WHERE payroll_result_id=?",
        slip.payroll_result_id,
      ),
    });
  });
  app.post("/api/companies/:company/payslips/:slip/revoke", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "payroll.approve");
    const slip = r.one(
      "SELECT p.* FROM payslips p JOIN payroll_cycles c ON c.id=p.payroll_cycle_id WHERE p.id=? AND c.organization_id=?",
      c.req.param("slip"),
      a.company.id,
    );
    if (!slip) fail("Payslip access denied", 403);
    const b = z.object({ reason: text }).parse(await c.req.json());
    r.tx(() => {
      r.update(
        "payslips",
        {
          delivery_status: "REVOKED",
          revoked_at: now(),
          revoked_by_user_id: a.user.id,
          revoked_reason: b.reason,
        },
        "id",
        slip.id,
      );
      audit(
        r,
        a,
        c.get("requestId"),
        "REVOKE",
        "payslip",
        slip.id,
        slip,
        null,
        b.reason,
      );
    });
    return c.json({ ok: true });
  });
  const publish = (a: Auth, announcement: Row, requestId: string) => {
    if (announcement.status === "PUBLISHED") fail("Already published", 409);
    const targets = r.all(
      "SELECT * FROM announcement_targets WHERE announcement_id=?",
      announcement.id,
    );
    const users = r.all(
      `SELECT DISTINCT u.id FROM users u JOIN user_company_access ca ON ca.user_id=u.id WHERE u.tenant_id=? AND ca.organization_id=? AND ca.access_status='ACTIVE' AND u.status='ACTIVE'`,
      a.user.tenant_id,
      a.company.id,
    );
    for (const user of users) {
      const employee = r.one(
        "SELECT * FROM employees WHERE user_id=? AND organization_id=?",
        user.id,
        a.company.id,
      );
      const targeted = targets.some(
        (t) =>
          t.target_type === "ALL" ||
          (t.target_type === "USER" && t.target_id === user.id) ||
          (t.target_type === "DEPARTMENT" &&
            t.target_id === employee?.department_id) ||
          (t.target_type === "BRANCH" && t.target_id === employee?.branch_id) ||
          (t.target_type === "ROLE" &&
            r.one(
              "SELECT id FROM user_roles WHERE user_id=? AND role_id=? AND (organization_id=? OR scope_type=?)",
              user.id,
              t.target_id,
              a.company.id,
              "TENANT",
            )),
      );
      if (!targeted) continue;
      r.run(
        "INSERT OR IGNORE INTO announcement_user_activity(announcement_id,user_id) VALUES(?,?)",
        announcement.id,
        user.id,
      );
      if (
        user.id !== announcement.created_by_user_id &&
        !r.one(
          "SELECT id FROM notifications WHERE user_id=? AND source_id=?",
          user.id,
          announcement.id,
        )
      )
        r.insert("notifications", {
          id: id(),
          tenant_id: a.user.tenant_id,
          organization_id: a.company.id,
          user_id: user.id,
          notification_type: "ANNOUNCEMENT",
          title: announcement.title,
          body: announcement.body.slice(0, 200),
          source_type: "announcement",
          source_id: announcement.id,
          created_at: now(),
        });
    }
    r.update(
      "announcements",
      { status: "PUBLISHED", published_at: now(), updated_at: now() },
      "id",
      announcement.id,
    );
    audit(
      r,
      a,
      requestId,
      "PUBLISH",
      "announcement",
      announcement.id,
      announcement,
      { status: "PUBLISHED" },
    );
  };
  const annSchema = z.object({
    title: text.max(200),
    body: text.max(10000),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    requires_acknowledgement: z.number().int().min(0).max(1).default(0),
    status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED"]).default("DRAFT"),
    scheduled_at: timestamp.nullable().default(null),
    expires_at: timestamp.nullable().default(null),
    targets: z
      .array(
        z.object({
          target_type: z.enum(["ALL", "USER", "DEPARTMENT", "BRANCH", "ROLE"]),
          target_id: z.string().nullable().default(null),
        }),
      )
      .min(1)
      .default([{ target_type: "ALL", target_id: null }]),
  });
  const checkTargets = (a: Auth, targets: Row[]) => {
    for (const t of targets) {
      if (t.target_type === "ALL") {
        if (t.target_id) fail("ALL target must have no ID", 422);
        continue;
      }
      if (!t.target_id) fail("Target ID required", 422);
      if (["DEPARTMENT", "BRANCH"].includes(t.target_type))
        companyObject(
          a,
          t.target_type === "DEPARTMENT" ? "departments" : "branches",
          t.target_id,
        );
      if (
        t.target_type === "ROLE" &&
        !r.one(
          "SELECT id FROM roles WHERE id=? AND tenant_id=?",
          t.target_id,
          a.user.tenant_id,
        )
      )
        fail("Role tenant mismatch", 403);
      if (
        t.target_type === "USER" &&
        !r.one(
          "SELECT u.id FROM users u JOIN user_company_access ca ON ca.user_id=u.id WHERE u.id=? AND u.tenant_id=? AND ca.organization_id=? AND ca.access_status=?",
          t.target_id,
          a.user.tenant_id,
          a.company.id,
          "ACTIVE",
        )
      )
        fail("Target user company mismatch", 403);
    }
  };
  app.get("/api/companies/:company/announcements", (c) => {
    const a = c.get("auth"),
      p = page(c);
    requirePermission(a, "announcement.read");
    const admin = a.permissionSet.has("announcement.manage");
    const items = r.all(
      `SELECT a.*,COALESCE(me.view_count,0) my_views,me.acknowledged_at,COUNT(act.user_id) delivered_count,SUM(CASE WHEN act.view_count>0 THEN 1 ELSE 0 END) unique_viewer_count,COALESCE(SUM(act.view_count),0) total_view_count,COALESCE(json_group_array(CASE WHEN act.user_id IS NOT NULL THEN json_object('user_id',act.user_id,'name',u.display_name,'view_count',act.view_count,'last_viewed_at',act.last_viewed_at,'acknowledged_at',act.acknowledged_at) END),'[]') activity_json FROM announcements a LEFT JOIN announcement_user_activity me ON me.announcement_id=a.id AND me.user_id=? LEFT JOIN announcement_user_activity act ON act.announcement_id=a.id LEFT JOIN users u ON u.id=act.user_id WHERE a.tenant_id=? AND a.organization_id=? AND ${admin ? "1=1" : "a.status='PUBLISHED' AND me.user_id IS NOT NULL AND (a.expires_at IS NULL OR a.expires_at>?)"} GROUP BY a.id ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      a.user.id,
      a.user.tenant_id,
      a.company.id,
      ...(admin ? [] : [now()]),
      p.limit,
      p.offset,
    );
    if (!admin)
      for (const i of items) {
        delete i.activity_json;
        delete i.delivered_count;
        delete i.unique_viewer_count;
        delete i.total_view_count;
      }
    return c.json({ items });
  });
  app.post("/api/companies/:company/announcements", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "announcement.manage");
    const b = annSchema.parse(await c.req.json());
    checkTargets(a, b.targets);
    if (
      b.status === "SCHEDULED" &&
      (!b.scheduled_at || b.scheduled_at <= now())
    )
      fail("Future publish time required", 422);
    if (b.expires_at && b.expires_at <= (b.scheduled_at || now()))
      fail("Expiry must follow publication", 422);
    const oid = id();
    r.tx(() => {
      const row = r.insert("announcements", {
        id: oid,
        tenant_id: a.user.tenant_id,
        organization_id: a.company.id,
        title: b.title,
        body: b.body,
        priority: b.priority,
        requires_acknowledgement: b.requires_acknowledgement,
        status: b.status === "PUBLISHED" ? "DRAFT" : b.status,
        scheduled_at: b.scheduled_at,
        expires_at: b.expires_at,
        created_by_user_id: a.user.id,
        created_at: now(),
        updated_at: now(),
      });
      for (const t of b.targets)
        r.insert("announcement_targets", {
          id: id(),
          announcement_id: oid,
          ...t,
        });
      r.insert("announcement_revisions", {
        id: id(),
        announcement_id: oid,
        revision_no: 1,
        title: b.title,
        body: b.body,
        target_snapshot_json: JSON.stringify(b.targets),
        schedule_snapshot_json: JSON.stringify({
          scheduled_at: b.scheduled_at,
          expires_at: b.expires_at,
        }),
        created_by_user_id: a.user.id,
        created_at: now(),
      });
      if (b.status === "PUBLISHED") publish(a, row, c.get("requestId"));
      else
        audit(
          r,
          a,
          c.get("requestId"),
          "CREATE",
          "announcement",
          oid,
          null,
          row,
        );
    });
    emit({
      tenant: a.user.tenant_id,
      company: a.company.id,
      type: "announcement",
      id: oid,
    });
    return c.json({ id: oid }, 201);
  });
  app.put("/api/companies/:company/announcements/:announcement", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "announcement.manage");
    const ann = companyObject(a, "announcements", c.req.param("announcement")),
      b = annSchema.parse(await c.req.json());
    checkTargets(a, b.targets);
    if (ann.status === "PUBLISHED" && b.status !== "PUBLISHED")
      fail("Published announcements can only be revised or archived", 409);
    r.tx(() => {
      r.insert("announcement_revisions", {
        id: id(),
        announcement_id: ann.id,
        revision_no: ann.current_revision_no + 1,
        title: b.title,
        body: b.body,
        target_snapshot_json: JSON.stringify(b.targets),
        created_by_user_id: a.user.id,
        created_at: now(),
      });
      r.update(
        "announcements",
        {
          title: b.title,
          body: b.body,
          priority: b.priority,
          requires_acknowledgement: b.requires_acknowledgement,
          current_revision_no: ann.current_revision_no + 1,
          updated_by_user_id: a.user.id,
          updated_at: now(),
        },
        "id",
        ann.id,
      );
      audit(r, a, c.get("requestId"), "REVISE", "announcement", ann.id, ann, b);
    });
    emit({
      tenant: a.user.tenant_id,
      company: a.company.id,
      type: "announcement",
      id: ann.id,
    });
    return c.json({ ok: true });
  });
  app.post(
    "/api/companies/:company/announcements/:announcement/publish",
    (c) => {
      const a = c.get("auth");
      requirePermission(a, "announcement.manage");
      const ann = companyObject(
        a,
        "announcements",
        c.req.param("announcement"),
      );
      r.tx(() => publish(a, ann, c.get("requestId")));
      emit({
        tenant: a.user.tenant_id,
        company: a.company.id,
        type: "announcement",
        id: ann.id,
      });
      return c.json({ ok: true });
    },
  );
  app.post(
    "/api/companies/:company/announcements/:announcement/read",
    async (c) => {
      const a = c.get("auth"),
        ann = companyObject(a, "announcements", c.req.param("announcement"));
      requirePermission(a, "announcement.read");
      if (
        ann.status !== "PUBLISHED" ||
        (ann.expires_at && ann.expires_at <= now())
      )
        fail("Announcement unavailable", 403);
      const activity = r.one(
        "SELECT * FROM announcement_user_activity WHERE announcement_id=? AND user_id=?",
        ann.id,
        a.user.id,
      );
      if (!activity) fail("Not an announcement recipient", 403);
      const b = z
        .object({ acknowledge: z.boolean().default(false) })
        .parse(await c.req.json());
      r.tx(() => {
        r.run(
          "UPDATE announcement_user_activity SET view_count=view_count+1,first_viewed_at=COALESCE(first_viewed_at,?),last_viewed_at=?,acknowledged_at=CASE WHEN ? THEN ? ELSE acknowledged_at END WHERE announcement_id=? AND user_id=?",
          now(),
          now(),
          b.acknowledge ? 1 : 0,
          now(),
          ann.id,
          a.user.id,
        );
        r.run(
          "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND organization_id=? AND source_id=?",
          now(),
          a.user.id,
          a.company.id,
          ann.id,
        );
      });
      emit({
        tenant: a.user.tenant_id,
        company: a.company.id,
        user: a.user.id,
        type: "notification",
      });
      return c.json({ ok: true });
    },
  );
  app.get("/api/companies/:company/notifications", (c) => {
    const a = c.get("auth");
    return c.json({
      items: r.all(
        "SELECT * FROM notifications WHERE user_id=? AND tenant_id=? AND organization_id=? ORDER BY created_at DESC LIMIT 100",
        a.user.id,
        a.user.tenant_id,
        a.company.id,
      ),
      unread: r.one(
        "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND tenant_id=? AND organization_id=? AND read_at IS NULL",
        a.user.id,
        a.user.tenant_id,
        a.company.id,
      )!.n,
    });
  });
  app.post("/api/companies/:company/notifications/:notification/read", (c) => {
    const a = c.get("auth"),
      n = r.one(
        "SELECT * FROM notifications WHERE id=? AND user_id=? AND tenant_id=? AND organization_id=?",
        c.req.param("notification"),
        a.user.id,
        a.user.tenant_id,
        a.company.id,
      );
    if (!n) fail("Notification access denied", 403);
    if (n.source_type === "announcement")
      fail("Open the announcement to mark it read", 409);
    r.update("notifications", { read_at: n.read_at || now() }, "id", n.id);
    return c.json({ ok: true });
  });
  app.get("/api/companies/:company/users", (c) => {
    const a = c.get("auth");
    requirePermission(a, "user.manage");
    const p = page(c);
    return c.json({
      items: r.all(
        `SELECT u.id,u.email,u.display_name,u.status,u.locked_until,u.failed_login_count,group_concat(DISTINCT ro.code) roles FROM users u JOIN user_company_access ca ON ca.user_id=u.id LEFT JOIN user_roles ur ON ur.user_id=u.id AND (ur.organization_id=? OR ur.scope_type='TENANT') LEFT JOIN roles ro ON ro.id=ur.role_id WHERE u.tenant_id=? AND ca.organization_id=? GROUP BY u.id ORDER BY u.display_name LIMIT ? OFFSET ?`,
        a.company.id,
        a.user.tenant_id,
        a.company.id,
        p.limit,
        p.offset,
      ),
      roles: r.all("SELECT * FROM roles WHERE tenant_id=?", a.user.tenant_id),
    });
  });
  app.get("/api/companies/:company/users/:user/permissions", (c) => {
    const a = c.get("auth");
    requirePermission(a, "user.manage");
    const user = r.one(
      "SELECT * FROM users WHERE id=? AND tenant_id=?",
      c.req.param("user"),
      a.user.tenant_id,
    );
    if (!user) fail("User access denied", 403);
    const target = authorize(r, user, a.company.id);
    return c.json({
      permissions: [...target.permissionSet],
      grants: target.grants,
    });
  });
  app.post("/api/companies/:company/users/invite", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "user.manage");
    const b = z
      .object({
        email: z.email(),
        display_name: text,
        role_code: z.enum(roles),
        company_ids: z.array(z.string()).min(1).max(50),
      })
      .parse(await c.req.json());
    const myRank = Math.max(...a.grants.map((g) => roles.indexOf(g.role_code)));
    if (roles.indexOf(b.role_code) > myRank)
      fail("Cannot grant a role higher than your own", 403);
    if (b.role_code === "TENANT_ADMIN") requirePermission(a, "tenant.manage");
    const raw = token(),
      oid = id();
    r.tx(() => {
      const role = r.one(
        "SELECT * FROM roles WHERE tenant_id=? AND code=?",
        a.user.tenant_id,
        b.role_code,
      )!;
      for (const cid of b.company_ids) authorize(r, a.user, cid);
      r.insert("user_invitations", {
        id: oid,
        tenant_id: a.user.tenant_id,
        default_organization_id: b.company_ids[0],
        email: b.email,
        token_hash: hash(raw),
        invited_by_user_id: a.user.id,
        expires_at: new Date(Date.now() + 172800000).toISOString(),
        created_at: now(),
      });
      for (const cid of b.company_ids)
        r.insert("invitation_company_access", {
          invitation_id: oid,
          organization_id: cid,
          role_id: role.id,
        });
      audit(r, a, c.get("requestId"), "INVITE", "user", oid, null, {
        email: b.email,
        role: b.role_code,
      });
    });
    return c.json(
      { id: oid, invitation_token: raw, expires_in_hours: 48 },
      201,
    );
  });
  app.post("/api/auth/accept-invitation", async (c) => {
    const b = z
      .object({
        token: text,
        display_name: text,
        password: z.string().min(12).max(128),
      })
      .parse(await c.req.json());
    const inv = r.one(
      "SELECT * FROM user_invitations WHERE token_hash=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>?",
      hash(b.token),
      now(),
    );
    if (!inv) fail("Invitation expired or invalid", 403);
    const ph = await Bun.password.hash(b.password, { algorithm: "argon2id" });
    const uid = id();
    r.tx(() => {
      r.insert("users", {
        id: uid,
        tenant_id: inv.tenant_id,
        email: inv.email,
        password_hash: ph,
        display_name: b.display_name,
        default_organization_id: inv.default_organization_id,
        created_at: now(),
        updated_at: now(),
      });
      for (const access of r.all(
        "SELECT * FROM invitation_company_access WHERE invitation_id=?",
        inv.id,
      )) {
        r.insert("user_company_access", {
          id: id(),
          user_id: uid,
          organization_id: access.organization_id,
          is_default:
            access.organization_id === inv.default_organization_id ? 1 : 0,
          granted_by_user_id: inv.invited_by_user_id,
        });
        r.insert("user_roles", {
          id: id(),
          user_id: uid,
          role_id: access.role_id,
          organization_id: access.organization_id,
          scope_type: "COMPANY",
          assigned_by_user_id: inv.invited_by_user_id,
        });
      }
      r.update("user_invitations", { accepted_at: now() }, "id", inv.id);
    });
    return c.json({ ok: true }, 201);
  });
  app.post("/api/companies/:company/users/:user/action", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "user.manage");
    const b = z
      .object({
        action: z.enum([
          "UNLOCK",
          "SUSPEND",
          "ACTIVATE",
          "REVOKE_SESSIONS",
          "RESET_PASSWORD",
        ]),
        password: z.string().min(12).max(128).optional(),
        reason: text,
      })
      .parse(await c.req.json());
    const target = r.one(
      "SELECT u.* FROM users u JOIN user_company_access ca ON ca.user_id=u.id WHERE u.id=? AND u.tenant_id=? AND ca.organization_id=?",
      c.req.param("user"),
      a.user.tenant_id,
      a.company.id,
    );
    if (!target) fail("User access denied", 403);
    const targetRoles = r.all(
      "SELECT ro.code FROM user_roles ur JOIN roles ro ON ro.id=ur.role_id WHERE ur.user_id=?",
      target.id,
    );
    const myRank = Math.max(...a.grants.map((g) => roles.indexOf(g.role_code)));
    if (targetRoles.some((g) => roles.indexOf(g.code) > myRank))
      fail("Cannot manage a higher role", 403);
    if (target.id === a.user.id && b.action === "SUSPEND")
      fail("Cannot suspend your own account", 409);
    if (
      b.action === "SUSPEND" &&
      targetRoles.some((g) => g.code === "TENANT_ADMIN") &&
      r.one(
        "SELECT COUNT(DISTINCT u.id) n FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles ro ON ro.id=ur.role_id WHERE u.tenant_id=? AND u.status='ACTIVE' AND ro.code='TENANT_ADMIN'",
        a.user.tenant_id,
      )!.n <= 1
    )
      fail("Cannot suspend the last tenant administrator", 409);
    if (
      !a.permissionSet.has("tenant.manage") &&
      r.one(
        "SELECT COUNT(*) n FROM user_company_access WHERE user_id=? AND access_status=?",
        target.id,
        "ACTIVE",
      )!.n > 1
    )
      fail("Tenant administrator required for a shared account action", 403);
    if (b.action === "RESET_PASSWORD" && !b.password)
      fail("New password required", 422);
    const ph = b.password
      ? await Bun.password.hash(b.password, { algorithm: "argon2id" })
      : null;
    r.tx(() => {
      if (b.action === "UNLOCK")
        r.update(
          "users",
          { locked_until: null, failed_login_count: 0, updated_at: now() },
          "id",
          target.id,
        );
      if (["SUSPEND", "ACTIVATE"].includes(b.action))
        r.update(
          "users",
          {
            status: b.action === "SUSPEND" ? "SUSPENDED" : "ACTIVE",
            updated_at: now(),
          },
          "id",
          target.id,
        );
      if (b.action === "RESET_PASSWORD")
        r.update(
          "users",
          { password_hash: ph, password_changed_at: now(), updated_at: now() },
          "id",
          target.id,
        );
      if (["SUSPEND", "RESET_PASSWORD", "REVOKE_SESSIONS"].includes(b.action))
        r.run(
          "UPDATE user_sessions SET revoked_at=?,revoked_reason=? WHERE user_id=?",
          now(),
          b.reason,
          target.id,
        );
      audit(
        r,
        a,
        c.get("requestId"),
        b.action,
        "user",
        target.id,
        null,
        { action: b.action },
        b.reason,
      );
    });
    return c.json({ ok: true });
  });
  app.get("/api/companies/:company/audit", (c) => {
    const a = c.get("auth");
    requirePermission(a, "audit.read");
    const p = page(c),
      q = c.req.query("q") || "";
    return c.json({
      items: r.all(
        "SELECT l.*,u.display_name actor_name FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_user_id WHERE l.tenant_id=? AND l.organization_id=? AND (l.action||' '||l.object_type||' '||COALESCE(l.request_id,'') LIKE ?) ORDER BY l.created_at DESC LIMIT ? OFFSET ?",
        a.user.tenant_id,
        a.company.id,
        `%${q}%`,
        p.limit,
        p.offset,
      ),
    });
  });
  app.post("/api/companies/:company/exports", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "export.create");
    const b = z
      .object({
        type: z.enum(["employees", "attendance", "audit", "payroll"]),
        reason: text,
        q: z.string().max(200).default(""),
      })
      .parse(await c.req.json());
    if (b.type === "payroll") requirePermission(a, "payroll.prepare");
    const oid = id();
    r.tx(() => {
      r.insert("data_exports", {
        id: oid,
        tenant_id: a.user.tenant_id,
        organization_id: a.company.id,
        requested_by_user_id: a.user.id,
        export_type: b.type,
        reason: b.reason,
        filter_snapshot_json: JSON.stringify({ q: b.q }),
        status: "COMPLETED",
        file_url: `/api/companies/${a.company.id}/exports/${oid}`,
        file_expires_at: new Date(Date.now() + 3600000).toISOString(),
        requested_at: now(),
        completed_at: now(),
      });
      audit(
        r,
        a,
        c.get("requestId"),
        "EXPORT",
        "export",
        oid,
        null,
        b,
        b.reason,
      );
    });
    return c.json(
      { id: oid, url: `/api/companies/${a.company.id}/exports/${oid}` },
      201,
    );
  });
  app.get("/api/companies/:company/exports/:export", (c) => {
    const a = c.get("auth");
    requirePermission(a, "export.create");
    const exp = r.one(
      "SELECT * FROM data_exports WHERE id=? AND tenant_id=? AND organization_id=? AND requested_by_user_id=? AND file_expires_at>?",
      c.req.param("export"),
      a.user.tenant_id,
      a.company.id,
      a.user.id,
      now(),
    );
    if (!exp) fail("Export expired or access denied", 403);
    if (exp.export_type === "payroll") requirePermission(a, "payroll.prepare");
    let rows: Row[] = [];
    if (exp.export_type === "employees") {
      const s = employeeScope(a, "employee");
      rows = r.all(
        `SELECT e.employee_no,e.first_name_th,e.last_name_th,e.employment_status,e.hire_date FROM employees e WHERE e.organization_id=? AND e.deleted_at IS NULL AND ${s.sql} AND e.first_name_th||' '||e.last_name_th||' '||e.employee_no LIKE ?`,
        a.company.id,
        ...s.params,
        `%${JSON.parse(exp.filter_snapshot_json).q}%`,
      );
    }
    if (exp.export_type === "attendance") {
      const s = employeeScope(a, "attendance");
      rows = r.all(
        `SELECT e.employee_no,ar.work_date,ar.check_in_at,ar.check_out_at,ar.worked_minutes,ar.status FROM attendance_records ar JOIN employees e ON e.id=ar.employee_id WHERE e.organization_id=? AND ${s.sql}`,
        a.company.id,
        ...s.params,
      );
    }
    if (exp.export_type === "audit") {
      requirePermission(a, "audit.read");
      rows = r.all(
        "SELECT action,object_type,object_id,reason,request_id,created_at FROM audit_logs WHERE tenant_id=? AND organization_id=?",
        a.user.tenant_id,
        a.company.id,
      );
    }
    if (exp.export_type === "payroll")
      rows = r.all(
        "SELECT c.code,e.employee_no,pr.gross_income_satang,pr.tax_satang,pr.social_security_satang,pr.net_pay_satang FROM payroll_results pr JOIN payslips p ON p.payroll_result_id=pr.id JOIN payroll_cycles c ON c.id=pr.payroll_cycle_id JOIN employees e ON e.id=pr.employee_id WHERE c.organization_id=?",
        a.company.id,
      );
    const csvCell = (v: any) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@\-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const headers = Object.keys(rows[0] || {}),
      csv =
        "\uFEFF" +
        [
          headers.map(csvCell).join(","),
          ...rows.map((row) => headers.map((k) => csvCell(row[k])).join(",")),
        ].join("\r\n");
    r.tx(() => {
      r.insert("export_downloads", {
        id: id(),
        export_id: exp.id,
        user_id: a.user.id,
        downloaded_at: now(),
      });
      r.update("data_exports", { row_count: rows.length }, "id", exp.id);
      audit(r, a, c.get("requestId"), "DOWNLOAD", "export", exp.id, null, {
        row_count: rows.length,
      });
    });
    c.header("Content-Type", "text/csv;charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="${exp.export_type}.csv"`,
    );
    return c.body(csv);
  });
  app.post("/api/companies/:company/employees/:employee/files", async (c) => {
    const a = c.get("auth"),
      e = employeeObject(r, a, c.req.param("employee"));
    if (e.id !== a.employee?.id) requirePermission(a, "employee.manage");
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
      fail("File required; maximum 5 MB", 422);
    if (
      !["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(
        file.type,
      )
    )
      fail("Unsupported file type", 422);
    const data = Buffer.from(await file.arrayBuffer()),
      oid = id();
    const { mkdirSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const root = resolve(process.env.FILE_STORAGE_PATH || "./data/files");
    mkdirSync(root, { recursive: true });
    await Bun.write(`${root}/${oid}`, secret.encrypt(data.toString("base64")));
    r.tx(() => {
      r.insert("file_attachments", {
        id: oid,
        tenant_id: a.user.tenant_id,
        organization_id: a.company.id,
        object_type: "employee",
        object_id: e.id,
        file_name: file.name,
        file_url: oid,
        mime_type: file.type,
        file_size_bytes: file.size,
        checksum_sha256: hash(data.toString("base64")),
        uploaded_by_user_id: a.user.id,
        created_at: now(),
      });
      audit(r, a, c.get("requestId"), "UPLOAD", "file", oid, null, {
        employee_id: e.id,
        file_name: file.name,
      });
    });
    return c.json({ id: oid }, 201);
  });
  app.get("/api/companies/:company/employees/:employee/files", (c) => {
    const a = c.get("auth"),
      e = employeeObject(r, a, c.req.param("employee"));
    return c.json({
      items: r.all(
        "SELECT id,file_name,mime_type,file_size_bytes,created_at FROM file_attachments WHERE tenant_id=? AND organization_id=? AND object_type=? AND object_id=?",
        a.user.tenant_id,
        a.company.id,
        "employee",
        e.id,
      ),
    });
  });
  app.get("/api/companies/:company/files/:file", async (c) => {
    const a = c.get("auth"),
      f = r.one(
        "SELECT * FROM file_attachments WHERE id=? AND tenant_id=? AND organization_id=?",
        c.req.param("file"),
        a.user.tenant_id,
        a.company.id,
      );
    if (!f) fail("File access denied", 403);
    employeeObject(r, a, f.object_id);
    const { resolve } = await import("node:path");
    const storage = Bun.file(
      resolve(process.env.FILE_STORAGE_PATH || "./data/files", f.id),
    );
    if (!(await storage.exists())) fail("File missing", 404);
    c.header("Content-Type", f.mime_type);
    c.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
    );
    return c.body(Buffer.from(secret.decrypt(await storage.text()), "base64"));
  });
  app.post("/api/companies/:company/transfers", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "employee.manage");
    const b = z
      .object({
        employee_id: text,
        destination_company_id: text,
        effective_date: date,
        transfer_type: z.enum(["TRANSFER", "SECONDMENT", "DUAL_EMPLOYMENT"]),
        reason: text,
        employee_no: text,
        salary_satang: money,
      })
      .parse(await c.req.json());
    const e = employeeObject(r, a, b.employee_id),
      dest = authorize(r, a.user, b.destination_company_id);
    requirePermission(dest, "employee.manage");
    if (dest.company.id === a.company.id)
      fail("Destination must be another company", 422);
    const oid = id();
    r.tx(() => {
      r.insert("intercompany_employee_transfers", {
        id: oid,
        tenant_id: a.user.tenant_id,
        person_id: e.person_id,
        source_employee_id: e.id,
        source_organization_id: a.company.id,
        destination_organization_id: dest.company.id,
        effective_date: b.effective_date,
        transfer_type: b.transfer_type,
        status: "PENDING",
        reason: b.reason,
        requested_by_user_id: a.user.id,
        requested_at: now(),
      });
      r.insert("request_idempotency", {
        user_id: a.user.id,
        organization_id: a.company.id,
        key: `transfer:${oid}`,
        request_hash: hash(oid),
        response_json: JSON.stringify(b),
        created_at: now(),
      });
      audit(
        r,
        a,
        c.get("requestId"),
        "REQUEST_TRANSFER",
        "transfer",
        oid,
        null,
        b,
        b.reason,
      );
    });
    return c.json({ id: oid }, 201);
  });
  app.get("/api/companies/:company/transfers", (c) => {
    const a = c.get("auth");
    requirePermission(a, "employee.manage");
    return c.json({
      items: r.all(
        "SELECT * FROM intercompany_employee_transfers WHERE tenant_id=? AND (source_organization_id=? OR destination_organization_id=?) ORDER BY requested_at DESC LIMIT 100",
        a.user.tenant_id,
        a.company.id,
        a.company.id,
      ),
    });
  });
  app.post("/api/companies/:company/transfers/:transfer/approve", (c) => {
    const a = c.get("auth");
    requirePermission(a, "employee.manage");
    const transfer = r.one(
      "SELECT * FROM intercompany_employee_transfers WHERE id=? AND tenant_id=? AND (source_organization_id=? OR destination_organization_id=?)",
      c.req.param("transfer"),
      a.user.tenant_id,
      a.company.id,
      a.company.id,
    );
    if (!transfer) fail("Transfer access denied", 403);
    if (transfer.requested_by_user_id === a.user.id)
      fail("Transfer approver must differ from requester", 403);
    if (transfer.status !== "PENDING") fail("Transfer already processed", 409);
    if (transfer.effective_date > now().slice(0, 10))
      fail("Approve on or after the effective date", 422);
    const source = authorize(r, a.user, transfer.source_organization_id),
      dest = authorize(r, a.user, transfer.destination_organization_id);
    requirePermission(source, "employee.manage");
    requirePermission(dest, "employee.manage");
    const e = employeeObject(r, source, transfer.source_employee_id),
      b = JSON.parse(
        r.one(
          "SELECT response_json FROM request_idempotency WHERE user_id=? AND organization_id=? AND key=?",
          transfer.requested_by_user_id,
          source.company.id,
          `transfer:${transfer.id}`,
        )!.response_json,
      );
    const eid = id();
    r.tx(() => {
      insertEmployee(
        dest,
        {
          ...e,
          employee_no: b.employee_no,
          hire_date: transfer.effective_date,
          department_id: null,
          branch_id: null,
          position_id: null,
          job_level_id: null,
          manager_employee_id: null,
          employment_status: "ACTIVE",
          salary_satang: b.salary_satang,
          pay_type: "MONTHLY",
        },
        eid,
        e.user_id,
        e.person_id,
      );
      if (transfer.transfer_type === "TRANSFER") {
        closePeriod(r, "employment_history", e.id, transfer.effective_date);
        r.update(
          "employees",
          {
            employment_status: "TERMINATED",
            termination_date: transfer.effective_date,
            termination_reason: transfer.reason,
            updated_at: now(),
          },
          "id",
          e.id,
        );
        r.insert("employment_history", {
          id: id(),
          employee_id: e.id,
          event_type: "TRANSFERRED",
          effective_from: transfer.effective_date,
          employment_status: "TERMINATED",
          reason: transfer.reason,
          created_by_user_id: a.user.id,
        });
      }
      if (e.user_id) {
        r.run(
          "INSERT INTO user_company_access(id,user_id,organization_id,employee_id,granted_by_user_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,organization_id) DO UPDATE SET employee_id=excluded.employee_id,access_status='ACTIVE'",
          id(),
          e.user_id,
          dest.company.id,
          eid,
          a.user.id,
        );
        const role = r.one(
          "SELECT id FROM roles WHERE tenant_id=? AND code=?",
          a.user.tenant_id,
          "EMPLOYEE",
        )!;
        r.insert("user_roles", {
          id: id(),
          user_id: e.user_id,
          role_id: role.id,
          organization_id: dest.company.id,
          scope_type: "SELF",
          scope_id: eid,
        });
      }
      r.update(
        "intercompany_employee_transfers",
        {
          status: "COMPLETED",
          destination_employee_id: eid,
          approved_by_user_id: a.user.id,
          approved_at: now(),
          completed_at: now(),
        },
        "id",
        transfer.id,
      );
      audit(
        r,
        source,
        c.get("requestId"),
        "TRANSFER_OUT",
        "employee",
        e.id,
        e,
        { destination_employee_id: eid },
        transfer.reason,
      );
      audit(
        r,
        dest,
        c.get("requestId"),
        "TRANSFER_IN",
        "employee",
        eid,
        null,
        { source_employee_id: e.id },
        transfer.reason,
      );
    });
    return c.json({ id: eid });
  });
  app.get("/api/consolidated", (c) => {
    const u = c.get("user");
    const companies = r.all(
      `SELECT o.* FROM organizations o JOIN user_company_access ca ON ca.organization_id=o.id WHERE ca.user_id=? AND ca.access_status='ACTIVE' AND o.tenant_id=? AND o.status='ACTIVE'`,
      u.id,
      u.tenant_id,
    );
    return c.json({
      items: companies
        .filter((co) =>
          authorize(r, u, co.id).permissionSet.has("report.consolidated"),
        )
        .map((co) => ({
          company_id: co.id,
          display_name: co.display_name,
          employees: r.one(
            "SELECT COUNT(*) n FROM employees WHERE organization_id=? AND deleted_at IS NULL",
            co.id,
          )!.n,
        })),
    });
  });
  // Called by a server-side timer; always re-authorize creator and preserve company context.
  function scheduledJobs() {
    for (const ann of r.all(
      "SELECT * FROM announcements WHERE status='SCHEDULED' AND scheduled_at<=?",
      now(),
    )) {
      try {
        const user = r.one(
          "SELECT * FROM users WHERE id=? AND status='ACTIVE'",
          ann.created_by_user_id,
        );
        if (!user) continue;
        const a = authorize(r, user, ann.organization_id);
        requirePermission(a, "announcement.manage");
        r.tx(() => publish(a, ann, id()));
        emit({
          tenant: a.user.tenant_id,
          company: a.company.id,
          type: "announcement",
          id: ann.id,
        });
      } catch {
        console.error("Scheduled announcement failed", ann.id);
      }
    }
    r.run(
      "UPDATE announcements SET status='ARCHIVED',updated_at=? WHERE status='PUBLISHED' AND expires_at IS NOT NULL AND expires_at<=?",
      now(),
      now(),
    );
  }
  app.put(
    "/api/companies/:company/employees/:employee/payroll-profile",
    async (c) => {
      const a = c.get("auth");
      requirePermission(a, "employee.manage");
      const e = employeeObject(r, a, c.req.param("employee"));
      const b = z
        .object({
          tax_method: z.enum(["PROGRESSIVE", "FIXED", "EXEMPT"]),
          fixed_tax_rate_basis_points: z
            .number()
            .int()
            .min(0)
            .max(10000)
            .default(0),
          contribution_enabled: z.number().int().min(0).max(1),
          effective_from: date,
          reason: text,
        })
        .parse(await c.req.json());
      r.tx(() => {
        r.run(
          "INSERT INTO employee_tax_profiles(employee_id,tax_method,fixed_tax_rate_basis_points,effective_from) VALUES(?,?,?,?) ON CONFLICT(employee_id) DO UPDATE SET tax_method=excluded.tax_method,fixed_tax_rate_basis_points=excluded.fixed_tax_rate_basis_points,effective_from=excluded.effective_from,updated_at=?",
          e.id,
          b.tax_method,
          b.fixed_tax_rate_basis_points,
          b.effective_from,
          now(),
        );
        r.run(
          "INSERT INTO employee_social_security_profiles(employee_id,contribution_enabled,effective_from) VALUES(?,?,?) ON CONFLICT(employee_id) DO UPDATE SET contribution_enabled=excluded.contribution_enabled,effective_from=excluded.effective_from,updated_at=?",
          e.id,
          b.contribution_enabled,
          b.effective_from,
          now(),
        );
        audit(
          r,
          a,
          c.get("requestId"),
          "CONFIGURE",
          "payroll_profile",
          e.id,
          null,
          b,
          b.reason,
        );
      });
      return c.json({ ok: true });
    },
  );
  app.get("/api/companies/:company/leave-policies", (c) => {
    const a = c.get("auth");
    requirePermission(a, "leave.manage");
    return c.json({
      items: r.all(
        "SELECT p.*,t.name_th FROM leave_policies p JOIN leave_types t ON t.id=p.leave_type_id WHERE p.organization_id=?",
        a.company.id,
      ),
    });
  });
  app.post(
    "/api/companies/:company/leave-policies/:policy/allocate",
    async (c) => {
      const a = c.get("auth");
      requirePermission(a, "leave.manage");
      const policy = companyObject(a, "leave_policies", c.req.param("policy"));
      const b = z
        .object({
          employee_id: text,
          year: z.number().int().min(2000).max(2200),
          reason: text,
        })
        .parse(await c.req.json());
      const e = employeeObject(r, a, b.employee_id, "leave");
      if (policy.accrual_method !== "ANNUAL")
        fail(
          "This action is for annual allocation; periodic accrual uses the accrual job",
          422,
        );
      r.tx(() => {
        let bal = r.one(
          "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
          e.id,
          policy.leave_type_id,
          b.year,
        );
        if (!bal)
          bal = r.insert("employee_leave_balances", {
            id: id(),
            employee_id: e.id,
            leave_type_id: policy.leave_type_id,
            balance_year: b.year,
          });
        if (
          r.one(
            "SELECT id FROM leave_balance_transactions WHERE employee_leave_balance_id=? AND source_type=? AND source_id=?",
            bal.id,
            "annual_policy",
            policy.id,
          )
        )
          fail("Year already allocated for this policy", 409);
        r.insert("leave_balance_transactions", {
          id: id(),
          employee_leave_balance_id: bal.id,
          transaction_type: "ACCRUAL",
          minutes: policy.annual_entitlement_minutes,
          source_type: "annual_policy",
          source_id: policy.id,
          reason: b.reason,
          created_by_user_id: a.user.id,
          created_at: now(),
        });
        audit(
          r,
          a,
          c.get("requestId"),
          "ALLOCATE",
          "leave_balance",
          bal.id,
          null,
          b,
          b.reason,
        );
      });
      return c.json({ ok: true });
    },
  );
  app.post("/api/companies/:company/leave-accrual", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "leave.manage");
    const b = z
      .object({ through_date: date, reason: text })
      .parse(await c.req.json());
    if (b.through_date > now().slice(0, 10))
      fail("Cannot accrue future entitlement", 422);
    let count = 0;
    r.tx(() => {
      const policies = r.all(
        "SELECT * FROM leave_policies WHERE organization_id=? AND accrual_method IN ('MONTHLY','DAILY') AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
        a.company.id,
        b.through_date,
        b.through_date,
      );
      for (const policy of policies) {
        const s = employeeScope(a, "leave");
        for (const e of r.all(
          `SELECT e.* FROM employees e WHERE e.organization_id=? AND e.employment_status='ACTIVE' AND e.deleted_at IS NULL AND ${s.sql}`,
          a.company.id,
          ...s.params,
        )) {
          const year = Number(b.through_date.slice(0, 4));
          let bal = r.one(
            "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
            e.id,
            policy.leave_type_id,
            year,
          );
          if (!bal)
            bal = r.insert("employee_leave_balances", {
              id: id(),
              employee_id: e.id,
              leave_type_id: policy.leave_type_id,
              balance_year: year,
            });
          const start = [`${year}-01-01`, e.hire_date, policy.effective_from]
            .sort()
            .at(-1)!;
          const periods =
            policy.accrual_method === "DAILY"
              ? datesBetween(start, b.through_date)
              : Array.from(
                  { length: Number(b.through_date.slice(5, 7)) },
                  (_, i) => `${year}-${String(i + 1).padStart(2, "0")}-01`,
                ).filter((d) => d >= start);
          const parts =
            policy.accrual_method === "MONTHLY"
              ? 12
              : (Date.parse(`${year + 1}-01-01`) -
                  Date.parse(`${year}-01-01`)) /
                86400000;
          for (const d of periods) {
            const source = `${policy.id}:${d}`;
            if (
              r.one(
                "SELECT id FROM leave_balance_transactions WHERE employee_leave_balance_id=? AND source_type=? AND source_id=?",
                bal.id,
                "periodic_policy",
                source,
              )
            )
              continue;
            const index =
              policy.accrual_method === "MONTHLY"
                ? Number(d.slice(5, 7))
                : (Date.parse(d) - Date.parse(`${year}-01-01`)) / 86400000 + 1;
            const minutes =
              Math.floor((policy.annual_entitlement_minutes * index) / parts) -
              Math.floor(
                (policy.annual_entitlement_minutes * (index - 1)) / parts,
              );
            r.insert("leave_balance_transactions", {
              id: id(),
              employee_leave_balance_id: bal.id,
              transaction_type: "ACCRUAL",
              minutes,
              source_type: "periodic_policy",
              source_id: source,
              reason: b.reason,
              created_by_user_id: a.user.id,
              created_at: now(),
            });
            count++;
          }
        }
      }
      audit(
        r,
        a,
        c.get("requestId"),
        "ACCRUE",
        "leave_policy",
        a.company.id,
        null,
        { through_date: b.through_date, count },
        b.reason,
      );
    });
    return c.json({ transactions: count });
  });
  app.post("/api/companies/:company/company/deactivate", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "tenant.manage");
    const b = z
      .object({ reason: text, confirmed: z.literal(true) })
      .parse(await c.req.json());
    const impact = {
      employees: r.one(
        "SELECT COUNT(*) n FROM employees WHERE organization_id=?",
        a.company.id,
      )!.n,
      payroll_cycles: r.one(
        "SELECT COUNT(*) n FROM payroll_cycles WHERE organization_id=?",
        a.company.id,
      )!.n,
    };
    r.tx(() => {
      r.update(
        "organizations",
        { status: "INACTIVE", updated_at: now() },
        "id",
        a.company.id,
      );
      audit(
        r,
        a,
        c.get("requestId"),
        "DEACTIVATE",
        "company",
        a.company.id,
        a.company,
        impact,
        b.reason,
      );
    });
    return c.json({ ok: true, impact });
  });
  app.post("/api/companies/:company/relationships", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "tenant.manage");
    const b = z
      .object({
        child_organization_id: text,
        relationship_type: z.enum(["SUBSIDIARY", "AFFILIATE", "MANAGED_BY"]),
        effective_from: date,
        reason: text,
      })
      .parse(await c.req.json());
    authorize(r, a.user, b.child_organization_id);
    if (b.child_organization_id === a.company.id)
      fail("Company cannot relate to itself", 422);
    const oid = id();
    r.tx(() => {
      r.insert("organization_relationships", {
        id: oid,
        tenant_id: a.user.tenant_id,
        parent_organization_id: a.company.id,
        child_organization_id: b.child_organization_id,
        relationship_type: b.relationship_type,
        effective_from: b.effective_from,
        created_at: now(),
      });
      audit(
        r,
        a,
        c.get("requestId"),
        "RELATE",
        "company",
        a.company.id,
        null,
        b,
        b.reason,
      );
    });
    return c.json({ id: oid }, 201);
  });
  app.put("/api/companies/:company/users/:user/role", async (c) => {
    const a = c.get("auth");
    requirePermission(a, "user.manage");
    const b = z
      .object({
        role_code: z.enum(roles),
        scope_type: z.enum(["COMPANY", "BRANCH", "DEPARTMENT", "SELF"]),
        scope_id: z.string().nullable().default(null),
        reason: text,
      })
      .parse(await c.req.json());
    if (
      roles.indexOf(b.role_code) >
      Math.max(...a.grants.map((g) => roles.indexOf(g.role_code)))
    )
      fail("Cannot grant higher role", 403);
    if (["TENANT_ADMIN", "GROUP_HR"].includes(b.role_code))
      requirePermission(a, "tenant.manage");
    if (
      ["COMPANY_ADMIN", "HR", "GROUP_HR", "TENANT_ADMIN"].includes(
        b.role_code,
      ) &&
      b.scope_type !== "COMPANY"
    )
      fail("Administrative roles require company scope", 422);
    const user = r.one(
      "SELECT u.* FROM users u JOIN user_company_access ca ON ca.user_id=u.id WHERE u.id=? AND u.tenant_id=? AND ca.organization_id=?",
      c.req.param("user"),
      a.user.tenant_id,
      a.company.id,
    );
    if (!user) fail("User access denied", 403);
    if (b.scope_type === "BRANCH")
      companyObject(a, "branches", b.scope_id || "");
    if (b.scope_type === "DEPARTMENT")
      companyObject(a, "departments", b.scope_id || "");
    if (b.scope_type === "SELF") {
      const e = employeeObject(r, a, b.scope_id || "");
      if (e.user_id !== user.id) fail("Self scope must belong to user", 403);
    }
    const old = r.all(
      "SELECT ur.*,ro.code FROM user_roles ur JOIN roles ro ON ro.id=ur.role_id WHERE ur.user_id=? AND ur.organization_id=?",
      user.id,
      a.company.id,
    );
    if (
      old.some(
        (g) =>
          roles.indexOf(g.code) >
          Math.max(...a.grants.map((g) => roles.indexOf(g.role_code))),
      )
    )
      fail("Cannot manage higher role", 403);
    r.tx(() => {
      r.run(
        "DELETE FROM user_roles WHERE user_id=? AND organization_id=?",
        user.id,
        a.company.id,
      );
      const role = r.one(
        "SELECT id FROM roles WHERE tenant_id=? AND code=?",
        a.user.tenant_id,
        b.role_code,
      )!;
      r.insert("user_roles", {
        id: id(),
        user_id: user.id,
        role_id: role.id,
        organization_id: a.company.id,
        scope_type: b.scope_type,
        scope_id: b.scope_id,
        assigned_by_user_id: a.user.id,
        assigned_at: now(),
      });
      audit(
        r,
        a,
        c.get("requestId"),
        "ROLE_CHANGE",
        "user",
        user.id,
        old,
        b,
        b.reason,
      );
    });
    return c.json({ ok: true });
  });

  return { app, r, scheduledJobs };
}
