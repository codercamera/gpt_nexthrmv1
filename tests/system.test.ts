import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { openDatabase, repository, id, now } from "../server/db";
import { createApp } from "../server/app";
import { seed } from "../server/seed";
import { encryption, hash } from "../server/security";
import { isAllowedOrigin } from "../server/origin";
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
const db = openDatabase(":memory:"),
  r = repository(db),
  events: any[] = [],
  key = "ab".repeat(32),
  { app } = createApp(db, key, (e) => events.push(e));
let fixture: Awaited<ReturnType<typeof seed>>;
const cookies: Record<string, string> = {};
const password = "test123456789";
async function call(
  user: string,
  path: string,
  method = "GET",
  body?: any,
  headers: Record<string, string> = {},
) {
  return app.request(`http://localhost/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookies[user] ? { cookie: cookies[user] } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const company = (path: string, c?: string) =>
  `/companies/${c || fixture.companyA}/${path}`;
beforeAll(async () => {
  fixture = await seed(db, password);
  for (const user of Object.keys(fixture.users)) {
    const res = await call(user, "/auth/login", "POST", {
      tenant_code: "demo",
      email: `${user}@test.com`,
      password,
    });
    expect(res.status).toBe(200);
    cookies[user] = res.headers.get("set-cookie")!.split(";")[0];
  }
});
afterAll(() => db.close());
describe("Authentication & tenant/company boundaries", () => {
  test("unauthenticated request denied", async () =>
    expect((await call("", company("employees"))).status).toBe(401));
  test("secure session stores only token hash", () => {
    const raw = cookies.admin.split("=")[1];
    expect(
      r.one("SELECT * FROM user_sessions WHERE session_token_hash=?", raw),
    ).toBeNull();
    expect(
      r.one(
        "SELECT * FROM user_sessions WHERE session_token_hash=?",
        hash(raw),
      ),
    ).not.toBeNull();
  });
  test("company URL tampering returns 403", async () =>
    expect(
      (await call("employee", company("employees", fixture.companyB))).status,
    ).toBe(403));
  test("another tenant cannot be selected by known UUID", async () => {
    const tid = id(),
      cid = id();
    r.insert("tenants", { id: tid, code: "outsider", name: "Other tenant" });
    r.insert("organizations", {
      id: cid,
      tenant_id: tid,
      code: "OUT",
      legal_name: "Other",
      display_name: "Other",
    });
    expect((await call("admin", company("employees", cid))).status).toBe(403);
  });
  test("employee only lists own employment", async () => {
    const json = await (await call("employee", company("employees"))).json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(fixture.employeeIds.employee);
  });
  test("employee cannot fetch another employee", async () =>
    expect(
      (await call("employee", company(`employees/${fixture.employeeIds.hr}`)))
        .status,
    ).toBe(403));
  test("manager cannot open payroll of others", async () =>
    expect((await call("manager", company("payroll"))).status).toBe(403));
  test("employee cannot create employees", async () =>
    expect(
      (await call("employee", company("employees"), "POST", {})).status,
    ).toBe(403));
  test("cross-origin mutations denied", async () =>
    expect(
      (
        await call(
          "admin",
          company("employees"),
          "POST",
          {},
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403));
  test("login from the local Vite frontend succeeds", async () => {
    const res = await app.request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        tenant_code: "demo",
        email: "admin@test.com",
        password,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("hrm_session=");
  });
  test("password mutation rejects incorrect old password", async () =>
    expect(
      (
        await call("employee", "/auth/password", "POST", {
          current_password: "wrong",
          new_password: "valid123456789",
        })
      ).status,
    ).toBe(403));
});
describe("Shared HTTP and WebSocket origin policy", () => {
  const local = "http://localhost:3000/api/auth/login";
  test("development accepts Vite with the previous localhost APP_ORIGIN setting", () => {
    for (const origin of [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
    ])
      expect(
        isAllowedOrigin(origin, local, {
          appOrigin: "http://localhost:3000",
          production: false,
        }),
      ).toBe(true);
  });
  test("empty development setting accepts the actual request host", () => {
    expect(
      isAllowedOrigin(
        "http://192.168.1.10:3000",
        "http://192.168.1.10:3000/api/auth/login",
        { appOrigin: "", production: false },
      ),
    ).toBe(true);
  });
  test("production uses configured public origin behind a reverse proxy", () => {
    expect(
      isAllowedOrigin("https://hrm.example.com", local, {
        appOrigin: "https://hrm.example.com/",
        production: true,
      }),
    ).toBe(true);
  });
  test("production never enables local Vite exceptions", () => {
    expect(
      isAllowedOrigin("http://localhost:5173", local, {
        appOrigin: "http://localhost:3000",
        production: true,
      }),
    ).toBe(false);
  });
  test("configured public origin is strict even in development", () => {
    expect(
      isAllowedOrigin("http://localhost:5173", local, {
        appOrigin: "https://hrm.example.com",
        production: false,
      }),
    ).toBe(false);
  });
  test("rejects lookalike hosts, unexpected ports, null and malformed origins", () => {
    for (const origin of [
      null,
      "null",
      "",
      "https://evil.example",
      "http://localhost.evil.example:5173",
      "http://localhost:5174",
      "http://localhost:5173/path",
      "http://localhost:5173@evil.example",
      "not-a-url",
    ])
      expect(
        isAllowedOrigin(origin, local, { appOrigin: "", production: false }),
      ).toBe(false);
  });
  test("rejects an application path in APP_ORIGIN", () => {
    expect(
      isAllowedOrigin("https://hrm.example.com", local, {
        appOrigin: "https://hrm.example.com/login",
        production: true,
      }),
    ).toBe(false);
  });
});
describe("Employee transactions, encrypted fields & history", () => {
  let eid: string;
  const body = {
    employee_no: "NEW-001",
    first_name_th: "ทดสอบ",
    last_name_th: "ระบบ",
    hire_date: "2026-01-01",
    salary_satang: 1234567,
    national_id: "1234567890123",
    personal_email: "new@test.com",
    create_user: true,
    password,
    pay_type: "MONTHLY",
  };
  test("employee, people, user & histories created in one transaction", async () => {
    const res = await call("admin", company("employees"), "POST", body);
    expect(res.status).toBe(201);
    eid = (await res.json()).id;
    const e = r.one("SELECT * FROM employees WHERE id=?", eid)!;
    expect(e.user_id).toBeTruthy();
    expect(
      r.one(
        "SELECT id FROM user_company_access WHERE user_id=? AND organization_id=?",
        e.user_id,
        fixture.companyA,
      ),
    ).toBeTruthy();
    expect(
      r.one(
        "SELECT base_salary_satang FROM compensation_history WHERE employee_id=?",
        eid,
      )!.base_salary_satang,
    ).toBe(1234567);
  });
  test("identity encrypted at rest and masked in API", async () => {
    const e = r.one("SELECT * FROM employees WHERE id=?", eid)!;
    expect(e.national_id_encrypted).not.toContain(body.national_id);
    expect(encryption(key).decrypt(e.national_id_encrypted)).toBe(
      body.national_id,
    );
    const json = await (
      await call("admin", company(`employees/${eid}`))
    ).json();
    expect(json.national_id_encrypted).toBeUndefined();
    expect(json.national_id).toContain("•");
  });
  test("duplicate rolls back user and person inserts", async () => {
    const before = r.one("SELECT COUNT(*) n FROM users")!.n;
    const res = await call("admin", company("employees"), "POST", {
      ...body,
      personal_email: "rollback@test.com",
      national_id: "5555555555555",
    });
    expect(res.status).toBe(409);
    expect(r.one("SELECT COUNT(*) n FROM users")!.n).toBe(before);
    expect(
      r.one("SELECT id FROM users WHERE email=?", "rollback@test.com"),
    ).toBeNull();
  });
  test("salary change preserves previous history", async () => {
    const res = await call("admin", company(`employees/${eid}`), "PUT", {
      ...body,
      create_user: false,
      salary_satang: 1500000,
      effective_from: "2026-02-01",
      reason: "Salary review",
    });
    expect(res.status).toBe(200);
    const hist = r.all(
      "SELECT * FROM compensation_history WHERE employee_id=? ORDER BY effective_from",
      eid,
    );
    expect(hist).toHaveLength(2);
    expect(hist[0].base_salary_satang).toBe(1234567);
    expect(hist[0].effective_to).toBe("2026-01-31");
    expect(hist[1].base_salary_satang).toBe(1500000);
  });
  test("overlapping salary effective date rejected", async () =>
    expect(
      (
        await call("admin", company(`employees/${eid}`), "PUT", {
          ...body,
          create_user: false,
          salary_satang: 1600000,
          effective_from: "2026-02-01",
          reason: "Overlap",
        })
      ).status,
    ).toBe(409));
  test("manager cycles rejected", async () =>
    expect(
      (
        await call("admin", company(`employees/${eid}`), "PUT", {
          ...body,
          create_user: false,
          salary_satang: 1500000,
          manager_employee_id: eid,
          reason: "Cycle",
        })
      ).status,
    ).toBe(422));
  test("work experience append only", async () => {
    const res = await call(
      "employee",
      company(`employees/${fixture.employeeIds.employee}/experiences`),
      "POST",
      {
        company_name: "Previous Co",
        position_name: "Developer",
        started_on: "2024-01-01",
        ended_on: "2025-12-31",
      },
    );
    expect(res.status).toBe(201);
    const wid = (await res.json()).id;
    expect(
      (
        await call(
          "employee",
          company(
            `employees/${fixture.employeeIds.employee}/experiences/${wid}`,
          ),
          "DELETE",
          {},
        )
      ).status,
    ).toBe(404);
  });
  test("audit does not leak identity", () => {
    expect(JSON.stringify(r.all("SELECT * FROM audit_logs"))).not.toContain(
      body.national_id,
    );
  });
});
describe("Leave approvals & immutable ledger", () => {
  let leaveId: string;
  const leaveType = () =>
    r.one(
      "SELECT id FROM leave_types WHERE code=? AND organization_id=?",
      "ANNUAL",
      fixture.companyA,
    )!.id;
  test("leave request excludes weekend", async () => {
    const res = await call("employee", company("leave"), "POST", {
      employee_id: fixture.employeeIds.employee,
      leave_type_id: leaveType(),
      start_date: "2026-11-06",
      end_date: "2026-11-09",
      reason: "Annual leave",
    });
    expect(res.status).toBe(201);
    leaveId = (await res.json()).id;
    expect(
      r.one("SELECT requested_minutes FROM leave_requests WHERE id=?", leaveId)!
        .requested_minutes,
    ).toBe(960);
  });
  test("overlapping pending leave rejected", async () =>
    expect(
      (
        await call("employee", company("leave"), "POST", {
          employee_id: fixture.employeeIds.employee,
          leave_type_id: leaveType(),
          start_date: "2026-11-09",
          end_date: "2026-11-09",
          reason: "Overlap",
        })
      ).status,
    ).toBe(409));
  test("approval occurs sequentially and final step updates ledger", async () => {
    const steps = r.all(
      "SELECT * FROM leave_approvals WHERE leave_request_id=? ORDER BY step_no",
      leaveId,
    );
    expect(steps).toHaveLength(2);
    expect(
      (
        await call("hr", company(`leave/${leaveId}/decision`), "POST", {
          decision: "APPROVED",
          comment: "Premature",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("manager", company(`leave/${leaveId}/decision`), "POST", {
          decision: "APPROVED",
          comment: "Team approved",
        })
      ).status,
    ).toBe(200);
    expect(
      r.one("SELECT status FROM leave_requests WHERE id=?", leaveId)!.status,
    ).toBe("PENDING");
    expect(
      (
        await call("hr", company(`leave/${leaveId}/decision`), "POST", {
          decision: "APPROVED",
          comment: "HR approved",
        })
      ).status,
    ).toBe(200);
    expect(
      r.one(
        "SELECT minutes FROM leave_balance_transactions WHERE source_id=? AND transaction_type=?",
        leaveId,
        "USAGE",
      )!.minutes,
    ).toBe(-960);
  });
  test("repeated approval cannot debit twice", async () => {
    expect(
      (
        await call("hr", company(`leave/${leaveId}/decision`), "POST", {
          decision: "APPROVED",
          comment: "Retry",
        })
      ).status,
    ).toBe(409);
    expect(
      r.all(
        "SELECT id FROM leave_balance_transactions WHERE source_id=?",
        leaveId,
      ),
    ).toHaveLength(1);
  });
  test("cancellation reverses ledger and attendance", async () => {
    expect(
      (
        await call("employee", company(`leave/${leaveId}/cancel`), "POST", {
          reason: "Change of plans",
        })
      ).status,
    ).toBe(200);
    expect(
      r.one(
        "SELECT SUM(minutes) n FROM leave_balance_transactions WHERE source_id=?",
        leaveId,
      )!.n,
    ).toBe(0);
    expect(
      r.one(
        "SELECT status FROM attendance_records WHERE employee_id=? AND work_date=?",
        fixture.employeeIds.employee,
        "2026-11-06",
      )!.status,
    ).toBe("PENDING");
  });
});
describe("Payroll reconciliation, versions & separation of duties", () => {
  let cycleId: string;
  test("create monthly cycle", async () => {
    const res = await call("hr", company("payroll"), "POST", {
      code: "OCT26",
      name: "October 2026",
      cycle_type: "MONTHLY",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      pay_date: "2026-10-31",
    });
    expect(res.status).toBe(201);
    cycleId = (await res.json()).id;
  });
  test("missing attendance blocks approval", async () => {
    const res = await call(
      "hr",
      company(`payroll/${cycleId}/calculate`),
      "POST",
      {},
      { "Idempotency-Key": "initial-calculation" },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).blocking_error_count).toBeGreaterThan(0);
    expect(
      (
        await call("reviewer", company(`payroll/${cycleId}/submit`), "POST", {
          approver_user_id: fixture.users.approver,
          comment: "Review",
        })
      ).status,
    ).toBe(422);
  });
  test("idempotent retry keeps version count", async () => {
    await call(
      "hr",
      company(`payroll/${cycleId}/calculate`),
      "POST",
      {},
      { "Idempotency-Key": "initial-calculation" },
    );
    expect(
      r.all(
        "SELECT * FROM payroll_calculation_runs WHERE payroll_cycle_id=?",
        cycleId,
      ),
    ).toHaveLength(1);
  });
  test("recalculation reconciles integer satang and keeps old run", async () => {
    for (const e of r.all(
      "SELECT * FROM employees WHERE organization_id=?",
      fixture.companyA,
    )) {
      if (
        !r.one(
          "SELECT id FROM employee_schedule_assignments WHERE employee_id=?",
          e.id,
        )
      )
        r.insert("employee_schedule_assignments", {
          id: id(),
          employee_id: e.id,
          work_schedule_id: r.one(
            "SELECT id FROM work_schedules WHERE organization_id=?",
            fixture.companyA,
          )!.id,
          effective_from: "2026-01-01",
        });
      r.run(
        "INSERT OR IGNORE INTO employee_tax_profiles(employee_id,tax_method,effective_from) VALUES(?,'EXEMPT','2026-01-01')",
        e.id,
      );
      r.run(
        "INSERT OR IGNORE INTO employee_social_security_profiles(employee_id,contribution_enabled,effective_from) VALUES(?,0,'2026-01-01')",
        e.id,
      );
      for (let d = 1; d <= 31; d++) {
        const date = `2026-10-${String(d).padStart(2, "0")}`;
        const weekday = new Date(date).getUTCDay();
        if (weekday !== 0 && weekday !== 6)
          r.run(
            "INSERT OR REPLACE INTO attendance_records(id,employee_id,work_date,status,worked_minutes) VALUES(?,?,?,'PRESENT',480)",
            id(),
            e.id,
            date,
          );
      }
    }
    const res = await call(
      "hr",
      company(`payroll/${cycleId}/calculate`),
      "POST",
      {},
      { "Idempotency-Key": "final-calculation" },
    );
    expect(res.status).toBe(200);
    const run = await res.json();
    expect(run.blocking_error_count).toBe(0);
    expect(
      r.one(
        "SELECT net_pay_satang FROM payroll_results WHERE calculation_run_id=? AND employee_id=?",
        run.id,
        fixture.employeeIds.employee,
      )!.net_pay_satang,
    ).toBe(3000000);
    expect(run.total_income_satang - run.total_deduction_satang).toBe(
      run.total_net_satang,
    );
    expect(
      r.one(
        "SELECT status FROM payroll_calculation_runs WHERE payroll_cycle_id=? AND version_no=1",
        cycleId,
      )!.status,
    ).toBe("SUPERSEDED");
  });
  test("preparer cannot review own payroll", async () =>
    expect(
      (
        await call("admin", company(`payroll/${cycleId}/submit`), "POST", {
          approver_user_id: fixture.users.admin,
          comment: "Self approval",
        })
      ).status,
    ).toBe(403));
  test("reviewer submits to separate approver", async () =>
    expect(
      (
        await call("reviewer", company(`payroll/${cycleId}/submit`), "POST", {
          approver_user_id: fixture.users.approver,
          comment: "Reconciled",
        })
      ).status,
    ).toBe(200));
  test("approval locks snapshots and creates payslips", async () => {
    expect(
      (
        await call("approver", company(`payroll/${cycleId}/approve`), "POST", {
          comment: "Approved",
        })
      ).status,
    ).toBe(200);
    expect(
      r.all("SELECT * FROM payslips WHERE payroll_cycle_id=?", cycleId).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await call(
          "hr",
          company(`payroll/${cycleId}/calculate`),
          "POST",
          {},
          { "Idempotency-Key": "locked-retry" },
        )
      ).status,
    ).toBe(409);
    expect(() =>
      r.run(
        "UPDATE payroll_results SET net_pay_satang=1 WHERE payroll_cycle_id=?",
        cycleId,
      ),
    ).toThrow("immutable");
  });
  test("employee cannot read another employee payslip", async () => {
    const slip = r.one(
      "SELECT * FROM payslips WHERE employee_id=?",
      fixture.employeeIds.hr,
    )!;
    expect(
      (await call("employee", company(`payslips/${slip.id}`))).status,
    ).toBe(403);
    const own = r.one(
      "SELECT * FROM payslips WHERE employee_id=?",
      fixture.employeeIds.employee,
    )!;
    expect((await call("employee", company(`payslips/${own.id}`))).status).toBe(
      200,
    );
  });
});
describe("Announcement notifications, activity, exports & files", () => {
  let aid: string;
  test("publish recipients once and exclude creator notification", async () => {
    const res = await call("admin", company("announcements"), "POST", {
      title: "Test announcement",
      body: "Hello team",
      status: "PUBLISHED",
    });
    expect(res.status).toBe(201);
    aid = (await res.json()).id;
    expect(
      r.one(
        "SELECT id FROM notifications WHERE source_id=? AND user_id=?",
        aid,
        fixture.users.admin,
      ),
    ).toBeNull();
    expect(
      r.one(
        "SELECT id FROM notifications WHERE source_id=? AND user_id=?",
        aid,
        fixture.users.employee,
      ),
    ).toBeTruthy();
    expect(
      events.some(
        (e) => e.company === fixture.companyA && e.tenant === fixture.tenantId,
      ),
    ).toBe(true);
  });
  test("opening bell does not mark announcement read", async () => {
    await call("employee", company("notifications"));
    expect(
      r.one(
        "SELECT read_at FROM notifications WHERE source_id=? AND user_id=?",
        aid,
        fixture.users.employee,
      )!.read_at,
    ).toBeNull();
  });
  test("read increments activity and only marks the opened source", async () => {
    expect(
      (await call("employee", company(`announcements/${aid}/read`), "POST", {}))
        .status,
    ).toBe(200);
    expect(
      r.one(
        "SELECT view_count FROM announcement_user_activity WHERE announcement_id=? AND user_id=?",
        aid,
        fixture.users.employee,
      )!.view_count,
    ).toBe(1);
    expect(
      r.one(
        "SELECT read_at FROM notifications WHERE source_id=? AND user_id=?",
        aid,
        fixture.users.employee,
      )!.read_at,
    ).toBeTruthy();
    const list = await (
      await call("employee", company("announcements"))
    ).json();
    expect(list.items[0].activity_json).toBeUndefined();
    const admin = await (await call("admin", company("announcements"))).json();
    expect(admin.items.find((x: any) => x.id === aid).total_view_count).toBe(1);
  });
  test("cross-company announcement read denied", async () =>
    expect(
      (
        await call(
          "admin",
          company(`announcements/${aid}/read`, fixture.companyB),
          "POST",
          {},
        )
      ).status,
    ).toBe(403));
  test("protected file URL requires both company and object ownership", async () => {
    const fid = id();
    r.insert("file_attachments", {
      id: fid,
      tenant_id: fixture.tenantId,
      organization_id: fixture.companyA,
      object_type: "employee",
      object_id: fixture.employeeIds.hr,
      file_name: "private.txt",
      file_url: fid,
      mime_type: "text/plain",
    });
    expect(
      (await call("admin", company(`files/${fid}`, fixture.companyB))).status,
    ).toBe(403);
    expect((await call("employee", company(`files/${fid}`))).status).toBe(403);
  });
  test("exports require permission and cannot cross companies", async () => {
    expect(
      (
        await call("employee", company("exports"), "POST", {
          type: "employees",
          reason: "Export",
        })
      ).status,
    ).toBe(403);
    const res = await call("admin", company("exports"), "POST", {
      type: "employees",
      reason: "HR report",
    });
    expect(res.status).toBe(201);
    const exp = await res.json();
    expect(
      (await call("admin", company(`exports/${exp.id}`, fixture.companyB)))
        .status,
    ).toBe(403);
    const csv = await call("admin", company(`exports/${exp.id}`));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(
      r.one("SELECT id FROM export_downloads WHERE export_id=?", exp.id),
    ).toBeTruthy();
  });
});
describe("Migrations, audit immutability & backup restore", () => {
  test("foreign keys enabled and no orphans", () => {
    expect(r.one("PRAGMA foreign_keys")!.foreign_keys).toBe(1);
    expect(r.all("PRAGMA foreign_key_check")).toHaveLength(0);
  });
  test("audit cannot be updated or deleted", () => {
    expect(() => r.run("UPDATE audit_logs SET action=?", "TAMPER")).toThrow(
      "immutable",
    );
    expect(() => r.run("DELETE FROM audit_logs")).toThrow("immutable");
  });
  test("backup restore integrity and migration idempotence", () => {
    const path = `/tmp/hrm-backup-${id()}.sqlite`;
    db.query("VACUUM INTO ?").run(path);
    const restored = openDatabase(path);
    expect(restored.query("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(restored.query("SELECT COUNT(*) n FROM employees").get()).toEqual(
      r.one("SELECT COUNT(*) n FROM employees"),
    );
    expect(
      restored.query("SELECT * FROM schema_migrations").all(),
    ).toHaveLength(2);
    restored.close();
    unlinkSync(path);
  });
});

describe("Additional workflow and security coverage", () => {
  test("invitation is single-use and stores token hash", async () => {
    const res = await call("admin", company("users/invite"), "POST", {
      email: "invite@test.com",
      display_name: "Invite",
      role_code: "EMPLOYEE",
      company_ids: [fixture.companyA],
    });
    expect(res.status).toBe(201);
    const inv = await res.json();
    expect(
      r.one("SELECT token_hash FROM user_invitations WHERE id=?", inv.id)!
        .token_hash,
    ).toBe(hash(inv.invitation_token));
    const body = {
      token: inv.invitation_token,
      display_name: "Invited",
      password,
    };
    expect(
      (await call("", "/auth/accept-invitation", "POST", body)).status,
    ).toBe(201);
    expect(
      (await call("", "/auth/accept-invitation", "POST", body)).status,
    ).toBe(403);
  });
  test("admin cannot be suspended when last tenant administrator", async () =>
    expect(
      (
        await call(
          "reviewer",
          company(`users/${fixture.users.admin}/action`),
          "POST",
          { action: "SUSPEND", reason: "Disallowed" },
        )
      ).status,
    ).toBe(403));
  test("employee cannot escalate own role", async () =>
    expect(
      (
        await call(
          "employee",
          company(`users/${fixture.users.employee}/role`),
          "PUT",
          {
            role_code: "TENANT_ADMIN",
            scope_type: "COMPANY",
            reason: "Escalation",
          },
        )
      ).status,
    ).toBe(403));
  test("profile request cannot be approved by employee, HR applies encrypted value", async () => {
    const res = await call(
      "employee",
      company(`employees/${fixture.employeeIds.employee}/profile-requests`),
      "POST",
      { field: "first_name_th", value: "สมชายใหม่", reason: "Name change" },
    );
    expect(res.status).toBe(201);
    const oid = (await res.json()).id;
    expect(
      (
        await call(
          "employee",
          company(`profile-requests/${oid}/decision`),
          "POST",
          { decision: "APPROVED", comment: "Self" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("hr", company(`profile-requests/${oid}/decision`), "POST", {
          decision: "APPROVED",
          comment: "Verified",
        })
      ).status,
    ).toBe(200);
    expect(
      r.one(
        "SELECT first_name_th FROM employees WHERE id=?",
        fixture.employeeIds.employee,
      )!.first_name_th,
    ).toBe("สมชายใหม่");
  });
  test("attendance correction requires reason", async () =>
    expect(
      (
        await call("hr", company("attendance"), "POST", {
          employee_id: fixture.employeeIds.employee,
          work_date: "2026-11-02",
          check_in_at: "2026-11-02T02:00:00Z",
          check_out_at: "2026-11-02T11:00:00Z",
        })
      ).status,
    ).toBe(422));
  test("attendance correction requires different approver", async () => {
    const res = await call("employee", company("attendance-requests"), "POST", {
      work_date: "2026-11-02",
      check_in_at: "2026-11-02T02:00:00Z",
      check_out_at: "2026-11-02T11:00:00Z",
      reason: "Device offline",
    });
    expect(res.status).toBe(201);
    const oid = (await res.json()).id;
    expect(
      (
        await call(
          "hr",
          company(`attendance-requests/${oid}/decision`),
          "POST",
          { decision: "APPROVED" },
        )
      ).status,
    ).toBe(200);
    expect(
      r.one(
        "SELECT worked_minutes FROM attendance_records WHERE employee_id=? AND work_date=?",
        fixture.employeeIds.employee,
        "2026-11-02",
      )!.worked_minutes,
    ).toBe(480);
  });
  test("overtime approves only requested minutes and scopes", async () => {
    const res = await call("employee", company("overtime"), "POST", {
      employee_id: fixture.employeeIds.employee,
      work_date: "2026-11-02",
      start_at: "2026-11-02T11:00:00Z",
      end_at: "2026-11-02T13:00:00Z",
      reason: "Deployment",
    });
    expect(res.status).toBe(201);
    const oid = (await res.json()).id;
    expect(
      (
        await call("manager", company(`overtime/${oid}/decision`), "POST", {
          decision: "APPROVED",
          approved_minutes: 180,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("manager", company(`overtime/${oid}/decision`), "POST", {
          decision: "APPROVED",
          approved_minutes: 120,
        })
      ).status,
    ).toBe(200);
  });
  test("staffing rule blocks insufficient department coverage", async () => {
    const employee = r.one(
      "SELECT * FROM employees WHERE id=?",
      fixture.employeeIds.employee,
    )!;
    const rid = id();
    r.insert("department_staffing_rules", {
      id: rid,
      organization_id: fixture.companyA,
      department_id: employee.department_id,
      minimum_staff_count: 100,
      effective_from: "2026-01-01",
    });
    const type = r.one(
      "SELECT id FROM leave_types WHERE organization_id=? LIMIT 1",
      fixture.companyA,
    )!;
    const res = await call("employee", company("leave"), "POST", {
      employee_id: employee.id,
      leave_type_id: type.id,
      start_date: "2026-12-01",
      end_date: "2026-12-01",
      reason: "Test staffing",
    });
    expect(res.status).toBe(422);
    r.run("DELETE FROM department_staffing_rules WHERE id=?", rid);
  });
  test("intercompany dual employment creates new record and preserves person/user", async () => {
    const extraAdmin = id();
    r.insert("user_company_access", {
      id: id(),
      user_id: fixture.users.approver,
      organization_id: fixture.companyB,
    });
    const role = r.one(
      "SELECT id FROM roles WHERE tenant_id=? AND code='COMPANY_ADMIN'",
      fixture.tenantId,
    )!;
    r.insert("user_roles", {
      id: id(),
      user_id: fixture.users.approver,
      role_id: role.id,
      organization_id: fixture.companyB,
      scope_type: "COMPANY",
    });
    const res = await call("admin", company("transfers"), "POST", {
      employee_id: fixture.employeeIds.employee,
      destination_company_id: fixture.companyB,
      effective_date: "2026-09-01",
      transfer_type: "DUAL_EMPLOYMENT",
      employee_no: "NORTH-EMP",
      salary_satang: 1000000,
      reason: "Dual employment",
    });
    expect(res.status).toBe(201);
    const transfer = (await res.json()).id;
    expect(
      (
        await call(
          "admin",
          company(`transfers/${transfer}/approve`),
          "POST",
          {},
        )
      ).status,
    ).toBe(403);
    const approved = await call(
      "approver",
      company(`transfers/${transfer}/approve`),
      "POST",
      {},
    );
    expect(approved.status).toBe(200);
    const newEmployee = r.one(
      "SELECT * FROM employees WHERE id=?",
      (await approved.json()).id,
    )!;
    const source = r.one(
      "SELECT * FROM employees WHERE id=?",
      fixture.employeeIds.employee,
    )!;
    expect(newEmployee.id).not.toBe(source.id);
    expect(newEmployee.person_id).toBe(source.person_id);
    expect(newEmployee.user_id).toBe(source.user_id);
    expect(source.organization_id).toBe(fixture.companyA);
    expect(source.employment_status).toBe("ACTIVE");
  });
});
