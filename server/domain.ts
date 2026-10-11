import { id, now, type Repo, type Row } from "./db";
import { fail, redact, type Auth } from "./security";
export function audit(
  r: Repo,
  a: Auth,
  requestId: string,
  action: string,
  objectType: string,
  objectId: string,
  before: any = null,
  after: any = null,
  reason?: string,
) {
  r.insert("audit_logs", {
    id: id(),
    tenant_id: a.user.tenant_id,
    organization_id: a.company.id,
    actor_user_id: a.user.id,
    action,
    object_type: objectType,
    object_id: objectId,
    before_json: JSON.stringify(redact(before)),
    after_json: JSON.stringify(redact(after)),
    reason: reason || null,
    request_id: requestId,
    created_at: now(),
  });
}
export function datesBetween(start: string, end: string) {
  if (end < start) fail("End date must follow start date", 422);
  const count = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (count > 366) fail("Date range exceeds one year", 422);
  return Array.from({ length: count + 1 }, (_, i) =>
    new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10),
  );
}
export function scheduleDay(r: Repo, e: Row, date: string) {
  const weekday = new Date(date).getUTCDay() || 7;
  return r.one(
    `SELECT d.*,s.timezone FROM employee_schedule_assignments a JOIN work_schedules s ON s.id=a.work_schedule_id JOIN work_schedule_days d ON d.work_schedule_id=s.id AND d.weekday=? WHERE a.employee_id=? AND a.effective_from<=? AND (a.effective_to IS NULL OR a.effective_to>=?) ORDER BY a.effective_from DESC LIMIT 1`,
    weekday,
    e.id,
    date,
    date,
  );
}
export function balance(
  r: Repo,
  employeeId: string,
  typeId: string,
  year: number,
): Row {
  const b = r.one(
    "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
    employeeId,
    typeId,
    year,
  );
  if (!b) fail("Leave balance not allocated", 422);
  return {
    ...b,
    available_minutes: r.one(
      "SELECT COALESCE(SUM(minutes),0) amount FROM leave_balance_transactions WHERE employee_leave_balance_id=?",
      b.id,
    )!.amount,
  };
}
export function staffing(r: Repo, e: Row, dates: string[]) {
  if (!e.department_id) return;
  for (const date of dates) {
    const rule = r.one(
      "SELECT * FROM department_staffing_rules WHERE department_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1",
      e.department_id,
      date,
      date,
    );
    if (!rule) continue;
    const total = r.one(
      "SELECT COUNT(*) n FROM employees WHERE department_id=? AND employment_status='ACTIVE' AND deleted_at IS NULL",
      e.department_id,
    )!.n;
    const off = r.one(
      `SELECT COUNT(DISTINCT e.id) n FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE e.department_id=? AND e.id<>? AND l.status IN ('PENDING','APPROVED') AND substr(l.start_at,1,10)<=? AND substr(l.end_at,1,10)>=?`,
      e.department_id,
      e.id,
      date,
      date,
    )!.n;
    if (
      total - off - 1 < rule.minimum_staff_count ||
      (rule.maximum_leave_count !== null && off + 1 > rule.maximum_leave_count)
    )
      fail("Department minimum staffing rule would be exceeded", 422);
  }
}
export function assertCompanyReferences(r: Repo, a: Auth, values: Row) {
  for (const [field, table] of [
    ["department_id", "departments"],
    ["branch_id", "branches"],
    ["position_id", "positions"],
    ["job_level_id", "job_levels"],
    ["manager_employee_id", "employees"],
  ] as const) {
    if (
      values[field] &&
      !r.one(
        `SELECT id FROM ${table} WHERE id=? AND organization_id=?`,
        values[field],
        a.company.id,
      )
    )
      fail(`${field}: company mismatch`, 403);
  }
  if (
    values.person_id &&
    !r.one(
      "SELECT id FROM people WHERE id=? AND tenant_id=?",
      values.person_id,
      a.user.tenant_id,
    )
  )
    fail("Person tenant mismatch", 403);
}
export function closePeriod(
  r: Repo,
  table: string,
  employeeId: string,
  effective: string,
) {
  const existing = r.one(
    `SELECT * FROM ${table} WHERE employee_id=? AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`,
    employeeId,
  );
  if (existing) {
    if (effective <= existing.effective_from)
      fail("Effective date must follow the current history period", 409);
    r.update(
      table,
      {
        effective_to: new Date(Date.parse(effective) - 86400000)
          .toISOString()
          .slice(0, 10),
      },
      "id",
      existing.id,
    );
  }
}
export function payrollCalculate(
  r: Repo,
  a: Auth,
  cycle: Row,
  requestId: string,
) {
  if (!["DRAFT", "REVIEW"].includes(cycle.status))
    fail("Payroll is locked or pending approval", 409);
  return r.tx(() => {
    const runId = id(),
      version = cycle.current_calculation_version + 1;
    r.run(
      "UPDATE payroll_calculation_runs SET status='SUPERSEDED' WHERE payroll_cycle_id=? AND status='COMPLETED'",
      cycle.id,
    );
    r.insert("payroll_calculation_runs", {
      id: runId,
      payroll_cycle_id: cycle.id,
      version_no: version,
      triggered_by_user_id: a.user.id,
      started_at: now(),
    });
    const settings = r.one(
      "SELECT * FROM organization_settings WHERE organization_id=?",
      a.company.id,
    );
    const rules = JSON.parse(settings?.settings_json || "{}");
    const employees = r.all(
      `SELECT * FROM employees WHERE organization_id=? AND deleted_at IS NULL AND hire_date<=? AND (termination_date IS NULL OR termination_date>=?) AND employment_status<>'DRAFT'`,
      a.company.id,
      cycle.period_end,
      cycle.period_start,
    );
    let income = 0,
      deduction = 0,
      netTotal = 0,
      errors = 0,
      warnings = 0;
    for (const e of employees) {
      const issues: string[] = [],
        blocks: string[] = [],
        items: Row[] = [];
      const comp = r.all(
        `SELECT * FROM compensation_history WHERE employee_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from`,
        e.id,
        cycle.period_end,
        cycle.period_start,
      );
      let base = 0,
        ot = 0,
        unpaid = 0;
      for (const date of datesBetween(cycle.period_start, cycle.period_end)) {
        if (
          date < e.hire_date ||
          (e.termination_date && date > e.termination_date)
        )
          continue;
        const history = comp.find(
          (c) =>
            c.effective_from <= date &&
            (!c.effective_to || c.effective_to >= date),
        );
        if (!history) {
          blocks.push(`Missing compensation ${date}`);
          continue;
        }
        const day = scheduleDay(r, e, date);
        if (!day) blocks.push(`Missing schedule ${date}`);
        const attendance = r.one(
          "SELECT * FROM attendance_records WHERE employee_id=? AND work_date=?",
          e.id,
          date,
        );
        const monthDays = new Date(
          Number(date.slice(0, 4)),
          Number(date.slice(5, 7)),
          0,
        ).getDate();
        if (history.pay_type === "MONTHLY")
          base += history.base_salary_satang / monthDays;
        else if (attendance?.status === "PRESENT")
          base +=
            history.pay_type === "DAILY"
              ? history.daily_rate_satang || history.base_salary_satang
              : ((history.hourly_rate_satang || history.base_salary_satang) *
                  attendance.worked_minutes) /
                60;
        if (
          day?.is_workday &&
          (!attendance || ["PENDING", "INCOMPLETE"].includes(attendance.status))
        )
          blocks.push(`Incomplete attendance ${date}`);
        const leave = r.one(
          `SELECT SUM(d.leave_minutes) minutes FROM leave_request_days d JOIN leave_requests l ON l.id=d.leave_request_id WHERE l.employee_id=? AND d.leave_date=? AND l.status='APPROVED' AND d.is_paid=0`,
          e.id,
          date,
        );
        const daily =
          history.pay_type === "MONTHLY"
            ? history.base_salary_satang / monthDays
            : history.daily_rate_satang || history.base_salary_satang;
        unpaid += Math.round((daily * (leave?.minutes || 0)) / 480);
        for (const o of r.all(
          "SELECT * FROM overtime_requests WHERE employee_id=? AND work_date=? AND status='APPROVED'",
          e.id,
          date,
        ))
          ot += Math.round(
            (((history.pay_type === "HOURLY"
              ? history.hourly_rate_satang || history.base_salary_satang
              : daily / 8) *
              o.approved_minutes) /
              60) *
              o.rate_multiplier,
          );
      }
      base = Math.round(base);
      if (
        r.one(
          "SELECT id FROM leave_requests WHERE employee_id=? AND status='PENDING' AND substr(start_at,1,10)<=? AND substr(end_at,1,10)>=?",
          e.id,
          cycle.period_end,
          cycle.period_start,
        )
      )
        issues.push("Pending leave request");
      const adj = r.all(
        "SELECT * FROM payroll_adjustments WHERE payroll_cycle_id=? AND employee_id=? AND status='ACTIVE'",
        cycle.id,
        e.id,
      );
      const extra = adj
        .filter((x) => x.item_type === "EARNING")
        .reduce((s, x) => s + x.amount_satang, 0);
      const other = adj
        .filter((x) => x.item_type === "DEDUCTION")
        .reduce((s, x) => s + x.amount_satang, 0);
      const gross = base + ot + extra;
      const taxProfile = r.one(
        "SELECT * FROM employee_tax_profiles WHERE employee_id=?",
        e.id,
      );
      const social = r.one(
        "SELECT * FROM employee_social_security_profiles WHERE employee_id=?",
        e.id,
      );
      let ss = 0,
        tax = 0;
      if (!taxProfile) blocks.push("Tax profile missing");
      if (!social) blocks.push("Social security profile missing");
      if (
        (social?.contribution_enabled ||
          taxProfile?.tax_method === "PROGRESSIVE") &&
        !rules.payroll_rules_verified
      )
        blocks.push("Company statutory payroll rules must be verified");
      if (social?.contribution_enabled) {
        const prior = r.one(
          `SELECT COALESCE(SUM(r.social_security_satang),0) n FROM payroll_results r JOIN payslips p ON p.payroll_result_id=r.id JOIN payroll_cycles c ON c.id=r.payroll_cycle_id WHERE r.employee_id=? AND substr(c.period_end,1,7)=? AND c.status IN ('APPROVED','PAID','CLOSED')`,
          e.id,
          cycle.period_end.slice(0, 7),
        )!.n;
        ss = Math.max(
          0,
          Math.min(
            Math.round(
              (gross * (rules.social_security_rate_basis_points || 0)) / 10000,
            ),
            (rules.social_security_cap_satang || 0) - prior,
          ),
        );
      }
      if (taxProfile?.tax_method === "FIXED")
        tax = Math.round(
          (Math.max(0, gross - unpaid - ss) *
            taxProfile.fixed_tax_rate_basis_points) /
            10000,
        );
      if (taxProfile?.tax_method === "PROGRESSIVE") {
        if (cycle.cycle_type !== "MONTHLY")
          blocks.push(
            "Progressive withholding for non-monthly cycles requires an approved company formula",
          );
        if (
          !Array.isArray(rules.annual_tax_bands) ||
          !rules.annual_tax_bands.length
        )
          blocks.push("Annual tax bands missing");
        const annual = Math.max(
          0,
          (gross - unpaid) * 12 -
            Math.min((gross - unpaid) * 6, rules.tax_expense_cap_satang || 0) -
            (rules.tax_personal_allowance_satang || 0) -
            ss * 12,
        );
        let previous = 0,
          annualTax = 0;
        for (const band of rules.annual_tax_bands || []) {
          annualTax +=
            (Math.max(
              0,
              Math.min(annual, band.up_to_satang ?? Number.MAX_SAFE_INTEGER) -
                previous,
            ) *
              band.rate_basis_points) /
            10000;
          previous = band.up_to_satang ?? Number.MAX_SAFE_INTEGER;
        }
        tax = Math.round(annualTax / 12);
      }
      const net = gross - unpaid - other - tax - ss;
      if (net < 0) blocks.push("Negative net pay");
      const prior = r.one(
        `SELECT r.* FROM payroll_results r JOIN payslips p ON p.payroll_result_id=r.id JOIN payroll_cycles c ON c.id=r.payroll_cycle_id WHERE r.employee_id=? AND c.period_end<? AND c.status IN ('APPROVED','PAID','CLOSED') ORDER BY c.period_end DESC LIMIT 1`,
        e.id,
        cycle.period_start,
      );
      const ytd = r.one(
        `SELECT COALESCE(SUM(r.gross_income_satang),0) gross,COALESCE(SUM(r.tax_satang),0) tax,COALESCE(SUM(r.social_security_satang),0) ss,COALESCE(SUM(r.net_pay_satang),0) net FROM payroll_results r JOIN payslips p ON p.payroll_result_id=r.id JOIN payroll_cycles c ON c.id=r.payroll_cycle_id WHERE r.employee_id=? AND substr(c.period_end,1,4)=? AND c.status IN ('APPROVED','PAID','CLOSED')`,
        e.id,
        cycle.period_end.slice(0, 4),
      )!;
      const resultId = id();
      r.insert("payroll_results", {
        id: resultId,
        calculation_run_id: runId,
        payroll_cycle_id: cycle.id,
        employee_id: e.id,
        base_salary_satang: base,
        additional_income_satang: extra,
        overtime_satang: ot,
        gross_income_satang: gross,
        pre_tax_deduction_satang: unpaid,
        tax_satang: tax,
        social_security_satang: ss,
        other_deduction_satang: other,
        net_pay_satang: net,
        previous_net_pay_satang: prior?.net_pay_satang || null,
        variance_satang: prior ? net - prior.net_pay_satang : null,
        ytd_gross_income_satang: ytd.gross + gross,
        ytd_tax_satang: ytd.tax + tax,
        ytd_social_security_satang: ytd.ss + ss,
        ytd_net_pay_satang: ytd.net + net,
        review_status: blocks.length
          ? "BLOCKED"
          : issues.length
            ? "WARNING"
            : "NORMAL",
        warning_json: JSON.stringify([...blocks, ...issues]),
        formula_snapshot_json: JSON.stringify({
          compensation: comp,
          adjustments: adj,
          rules,
          unpaid,
          base,
          ot,
          request_id: requestId,
        }),
        calculated_at: now(),
      });
      r.run(
        "INSERT OR REPLACE INTO payroll_cycle_employees(payroll_cycle_id,employee_id,compensation_history_id) VALUES(?,?,?)",
        cycle.id,
        e.id,
        comp[0]?.id || null,
      );
      items.push(
        {
          item_type: "EARNING",
          item_code: "BASE",
          item_name: "Base compensation",
          amount_satang: base,
        },
        {
          item_type: "EARNING",
          item_code: "OT",
          item_name: "Overtime",
          amount_satang: ot,
        },
        {
          item_type: "DEDUCTION",
          item_code: "UNPAID",
          item_name: "Unpaid leave",
          amount_satang: unpaid,
        },
        {
          item_type: "TAX",
          item_code: "TAX",
          item_name: "Withholding tax",
          amount_satang: tax,
        },
        {
          item_type: "SOCIAL_SECURITY",
          item_code: "SS",
          item_name: "Social security",
          amount_satang: ss,
        },
        ...adj.map((x) => ({
          item_type: x.item_type,
          item_code: x.item_code,
          item_name: x.description,
          amount_satang: x.amount_satang,
          source_type: "adjustment",
          source_id: x.id,
        })),
      );
      for (const item of items)
        r.insert("payroll_result_items", {
          id: id(),
          payroll_result_id: resultId,
          ...item,
        });
      income += gross;
      deduction += unpaid + other + tax + ss;
      netTotal += net;
      errors += blocks.length;
      warnings += issues.length;
    }
    if (!employees.length) errors++;
    r.update(
      "payroll_calculation_runs",
      {
        status: "COMPLETED",
        employee_count: employees.length,
        total_income_satang: income,
        total_deduction_satang: deduction,
        total_net_satang: netTotal,
        blocking_error_count: errors,
        warning_count: warnings,
        completed_at: now(),
      },
      "id",
      runId,
    );
    r.update(
      "payroll_cycles",
      {
        status: "REVIEW",
        current_calculation_version: version,
        updated_at: now(),
      },
      "id",
      cycle.id,
    );
    r.insert("payroll_cycle_status_history", {
      id: id(),
      payroll_cycle_id: cycle.id,
      from_status: cycle.status,
      to_status: "REVIEW",
      changed_by_user_id: a.user.id,
      changed_at: now(),
    });
    audit(r, a, requestId, "CALCULATE", "payroll", cycle.id, null, {
      version,
      errors,
      income,
      deduction,
      netTotal,
    });
    return r.one("SELECT * FROM payroll_calculation_runs WHERE id=?", runId);
  });
}
