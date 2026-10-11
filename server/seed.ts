import type { Database } from "bun:sqlite";
import { repository, id, now } from "./db";
import { permissions } from "./security";
export async function seed(db: Database, password: string) {
  if (password.length < 12)
    throw Error("Seed password requires at least 12 characters");
  const r = repository(db);
  if (r.one("SELECT id FROM tenants LIMIT 1"))
    throw Error("Database already has tenants; seed refused");
  const password_hash = await Bun.password.hash(password, {
    algorithm: "argon2id",
  });
  const tenantId = id(),
    companyA = id(),
    companyB = id();
  const users: Record<string, string> = {},
    employeeIds: Record<string, string> = {};
  r.tx(() => {
    r.insert("tenants", {
      id: tenantId,
      code: "demo",
      name: "NextHRM Workspace",
      created_at: now(),
      updated_at: now(),
    });
    for (const [code, display_name, company] of [
      ["NEXT", "Next Company", companyA],
      ["NORTH", "North Company", companyB],
    ]) {
      r.insert("organizations", {
        id: company,
        tenant_id: tenantId,
        code,
        legal_name: display_name,
        display_name,
        created_at: now(),
        updated_at: now(),
      });
      r.insert("organization_settings", {
        organization_id: company,
        settings_json: JSON.stringify({
          payroll_rules_verified: false,
          social_security_rate_basis_points: 500,
          social_security_cap_satang: 87500,
          annual_tax_bands: [],
          tax_personal_allowance_satang: 6000000,
          tax_expense_cap_satang: 10000000,
        }),
      });
    }
    const department = id(),
      position = id(),
      branch = id();
    r.insert("departments", {
      id: department,
      organization_id: companyA,
      code: "ENG",
      name_th: "เทคโนโลยี",
      name_en: "Engineering",
    });
    r.insert("positions", {
      id: position,
      organization_id: companyA,
      code: "DEV",
      name_th: "นักพัฒนาระบบ",
      name_en: "Software developer",
    });
    r.insert("branches", {
      id: branch,
      organization_id: companyA,
      code: "HQ",
      name_th: "สำนักงานใหญ่",
      name_en: "Head office",
    });
    const roleIds: Record<string, string> = {};
    for (const [code, perms] of Object.entries(permissions)) {
      const roleId = id();
      roleIds[code] = roleId;
      r.insert("roles", {
        id: roleId,
        tenant_id: tenantId,
        code,
        name: code,
        is_system_role: 1,
      });
      for (const permission of perms) {
        let p = r.one("SELECT id FROM permissions WHERE code=?", permission);
        if (!p)
          p = r.insert("permissions", {
            id: id(),
            code: permission,
            module: permission.split(".")[0],
          });
        r.insert("role_permissions", { role_id: roleId, permission_id: p.id });
      }
    }
    for (const [name, role, salary] of [
      ["admin", "TENANT_ADMIN", 6000000],
      ["hr", "HR", 4500000],
      ["reviewer", "COMPANY_ADMIN", 4500000],
      ["approver", "COMPANY_ADMIN", 4500000],
      ["manager", "MANAGER", 4000000],
      ["employee", "EMPLOYEE", 3000000],
    ]) {
      const uid = id(),
        pid = id(),
        eid = id();
      users[name] = uid;
      employeeIds[name] = eid;
      r.insert("users", {
        id: uid,
        tenant_id: tenantId,
        default_organization_id: companyA,
        email: `${name}@test.com`,
        password_hash,
        display_name: name,
        created_at: now(),
        updated_at: now(),
      });
      r.insert("people", {
        id: pid,
        tenant_id: tenantId,
        user_id: uid,
        primary_email: `${name}@test.com`,
      });
      r.insert("employees", {
        id: eid,
        organization_id: companyA,
        person_id: pid,
        user_id: uid,
        employee_no: `NEXT-${Object.keys(users).length.toString().padStart(3, "0")}`,
        first_name_th: name === "employee" ? "สมชาย" : name,
        last_name_th: "ใจดี",
        hire_date: "2026-01-01",
        department_id: department,
        position_id: position,
        branch_id: branch,
        created_at: now(),
        updated_at: now(),
      });
      r.insert("compensation_history", {
        id: id(),
        employee_id: eid,
        effective_from: "2026-01-01",
        pay_type: "MONTHLY",
        base_salary_satang: salary,
        reason: "Initial employment",
      });
      r.insert("employment_history", {
        id: id(),
        employee_id: eid,
        event_type: "HIRED",
        effective_from: "2026-01-01",
        department_id: department,
        position_id: position,
        branch_id: branch,
        employment_type: "FULL_TIME",
        employment_status: "ACTIVE",
      });
      r.insert("employee_tax_profiles", {
        employee_id: eid,
        tax_method: "EXEMPT",
        effective_from: "2026-01-01",
      });
      r.insert("employee_social_security_profiles", {
        employee_id: eid,
        contribution_enabled: 0,
        effective_from: "2026-01-01",
      });
      r.insert("user_company_access", {
        id: id(),
        user_id: uid,
        organization_id: companyA,
        employee_id: eid,
        is_default: 1,
      });
      r.insert("user_roles", {
        id: id(),
        user_id: uid,
        role_id: roleIds[role],
        organization_id: role === "TENANT_ADMIN" ? null : companyA,
        scope_type:
          role === "TENANT_ADMIN"
            ? "TENANT"
            : role === "MANAGER"
              ? "DEPARTMENT"
              : role === "EMPLOYEE"
                ? "SELF"
                : "COMPANY",
        scope_id:
          role === "MANAGER" ? department : role === "EMPLOYEE" ? eid : null,
      });
      if (name === "admin")
        r.insert("user_company_access", {
          id: id(),
          user_id: uid,
          organization_id: companyB,
        });
    }
    r.update(
      "employees",
      { manager_employee_id: employeeIds.manager },
      "id",
      employeeIds.employee,
    );
    const schedule = id();
    r.insert("work_schedules", {
      id: schedule,
      organization_id: companyA,
      code: "OFFICE",
      name: "จันทร์–ศุกร์ 09:00–18:00",
    });
    for (let weekday = 1; weekday <= 7; weekday++)
      r.insert("work_schedule_days", {
        work_schedule_id: schedule,
        weekday,
        is_workday: weekday <= 5 ? 1 : 0,
        start_time: "09:00",
        end_time: "18:00",
        break_minutes: 60,
      });
    for (const eid of Object.values(employeeIds))
      r.insert("employee_schedule_assignments", {
        id: id(),
        employee_id: eid,
        work_schedule_id: schedule,
        effective_from: "2026-01-01",
      });
    for (const [code, name_th, name_en, days] of [
      ["ANNUAL", "ลาพักร้อน", "Annual leave", 10],
      ["SICK", "ลาป่วย", "Sick leave", 30],
      ["PERSONAL", "ลากิจ", "Personal leave", 6],
    ]) {
      const lid = id();
      r.insert("leave_types", {
        id: lid,
        organization_id: companyA,
        code,
        name_th,
        name_en,
      });
      r.insert("leave_policies", {
        id: id(),
        organization_id: companyA,
        leave_type_id: lid,
        name: name_th,
        annual_entitlement_minutes: Number(days) * 480,
        effective_from: "2026-01-01",
      });
      for (const eid of Object.values(employeeIds)) {
        const bid = id();
        r.insert("employee_leave_balances", {
          id: bid,
          employee_id: eid,
          leave_type_id: lid,
          balance_year: 2026,
          opening_minutes: Number(days) * 480,
        });
        r.insert("leave_balance_transactions", {
          id: id(),
          employee_leave_balance_id: bid,
          transaction_type: "OPENING",
          minutes: Number(days) * 480,
          reason: "Demo annual entitlement",
          created_by_user_id: users.admin,
        });
      }
    }
    const aid = id();
    r.insert("announcements", {
      id: aid,
      tenant_id: tenantId,
      organization_id: companyA,
      title: "ยินดีต้อนรับสู่ NextHRM",
      body: "จัดการข้อมูลพนักงาน เวลา การลา และค่าตอบแทนได้ในพื้นที่เดียว",
      status: "PUBLISHED",
      published_at: now(),
      created_by_user_id: users.admin,
    });
    r.insert("announcement_targets", {
      id: id(),
      announcement_id: aid,
      target_type: "ALL",
    });
    for (const uid of Object.values(users)) {
      r.insert("announcement_user_activity", {
        announcement_id: aid,
        user_id: uid,
      });
      if (uid !== users.admin)
        r.insert("notifications", {
          id: id(),
          tenant_id: tenantId,
          organization_id: companyA,
          user_id: uid,
          notification_type: "ANNOUNCEMENT",
          title: "ยินดีต้อนรับสู่ NextHRM",
          source_type: "announcement",
          source_id: aid,
        });
    }
  });
  return { tenantId, companyA, companyB, users, employeeIds };
}
