import { z } from "zod";
export const date = z.iso.date();
export const timestamp = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
export const money = z.number().int().min(0).max(1_000_000_000_000);
export const text = z.string().trim().min(1).max(1000);
export const employeeInput = z
  .object({
    employee_no: text.max(40),
    first_name_th: text.max(100),
    last_name_th: text.max(100),
    first_name_en: z.string().max(100).optional(),
    last_name_en: z.string().max(100).optional(),
    mobile_phone: z.string().max(40).optional(),
    personal_email: z.email().optional(),
    hire_date: date,
    department_id: z.string().nullable().optional(),
    branch_id: z.string().nullable().optional(),
    position_id: z.string().nullable().optional(),
    job_level_id: z.string().nullable().optional(),
    manager_employee_id: z.string().nullable().optional(),
    employment_type: z
      .enum([
        "FULL_TIME",
        "PART_TIME",
        "CONTRACT",
        "PROBATION",
        "INTERN",
        "DAILY",
      ])
      .default("FULL_TIME"),
    employment_status: z
      .enum(["DRAFT", "ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"])
      .default("ACTIVE"),
    termination_date: date.optional(),
    termination_reason: text.optional(),
    salary_satang: money,
    pay_type: z.enum(["MONTHLY", "DAILY", "HOURLY"]).default("MONTHLY"),
    national_id: z.string().max(30).optional(),
    passport_no: z.string().max(40).optional(),
    bank_code: z.string().max(20).optional(),
    bank_account: z.string().min(4).max(40).optional(),
    tax_id: z.string().max(40).optional(),
    social_security_no: z.string().max(40).optional(),
    address: z.string().max(1000).optional(),
    emergency_name: z.string().max(100).optional(),
    emergency_phone: z.string().max(40).optional(),
    emergency_relationship: z.string().max(100).optional(),
    person_id: z.string().optional(),
    create_user: z.boolean().default(false),
    password: z.string().min(12).max(128).optional(),
    reason: text.optional(),
    effective_from: date.optional(),
  })
  .strict();
export const profileFields = [
  "first_name_th",
  "last_name_th",
  "national_id",
  "bank_account",
  "tax_id",
  "social_security_no",
] as const;
