import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarDays,
  Wallet,
  Megaphone,
  Settings,
  ShieldCheck,
  LogOut,
  Bell,
  Search,
  Plus,
  ChevronRight,
  ArrowUpRight,
  Sun,
  Moon,
  Globe,
  Building2,
  X,
  CheckCircle2,
  AlertCircle,
  Download,
  Printer,
  Trash2,
  FileText,
  MoreHorizontal,
  RefreshCw,
  Check,
  Eye,
  UserRound,
  ArrowLeftRight,
} from "lucide-react";
type Row = Record<string, any>;
type Field = {
  key: string;
  th: string;
  en: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  value?: any;
};
type FormDef = {
  title: string;
  fields: Field[];
  submit: (values: Row) => Promise<any>;
  initial?: Row;
  id: string;
};
const pages = [
  {
    key: "dashboard",
    th: "หน้าหลัก",
    en: "Overview",
    icon: LayoutDashboard,
    id: "10001",
  },
  { key: "employees", th: "บุคลากร", en: "People", icon: Users, id: "10002" },
  {
    key: "attendance",
    th: "เวลาทำงาน",
    en: "Attendance",
    icon: Clock,
    id: "10003",
  },
  { key: "leave", th: "การลา", en: "Leave", icon: CalendarDays, id: "10004" },
  {
    key: "payroll",
    th: "ค่าตอบแทน",
    en: "Payroll",
    icon: Wallet,
    id: "10005",
    permission: "payroll.prepare",
  },
  {
    key: "announcements",
    th: "ประกาศ",
    en: "Announcements",
    icon: Megaphone,
    id: "10006",
  },
  {
    key: "profile",
    th: "ข้อมูลของฉัน",
    en: "My profile",
    icon: UserRound,
    id: "10007",
  },
  {
    key: "settings",
    th: "ตั้งค่า",
    en: "Settings",
    icon: Settings,
    id: "10008",
  },
  {
    key: "users",
    th: "ผู้ใช้และสิทธิ์",
    en: "Users & access",
    icon: ShieldCheck,
    id: "10009",
    permission: "user.manage",
  },
  {
    key: "audit",
    th: "Audit Log",
    en: "Audit log",
    icon: FileText,
    id: "10010",
    permission: "audit.read",
  },
];
const money = (v: any) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(
    (Number(v) || 0) / 100,
  );
const datetime = (v: any) =>
  v ? new Date(v).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "—";
const day = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
    new Date(),
  );
async function request(
  path: string,
  method = "GET",
  body?: any,
  headers?: Record<string, string>,
) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (res.status === 401) window.dispatchEvent(new Event("session-expired"));
  const result = await res
    .json()
    .catch(() => ({ error: "Unexpected response" }));
  if (!res.ok) throw Error(result.error || "Request failed");
  return result;
}
function Badge({ value }: { value: any }) {
  const good = [
      "ACTIVE",
      "PRESENT",
      "APPROVED",
      "COMPLETED",
      "PUBLISHED",
      "PAID",
      "CLOSED",
      "NORMAL",
      "VIEWED",
    ].includes(value),
    bad = [
      "REJECTED",
      "TERMINATED",
      "SUSPENDED",
      "BLOCKED",
      "INCOMPLETE",
    ].includes(value);
  return (
    <span
      className={`badge ${good ? "badge-good" : bad ? "badge-bad" : "badge-warn"}`}
    >
      {good ? (
        <CheckCircle2 size={12} />
      ) : bad ? (
        <AlertCircle size={12} />
      ) : (
        <Clock size={12} />
      )}{" "}
      {value || "—"}
    </span>
  );
}
function FormModal({
  form,
  close,
  lang,
  onError,
  onDone,
}: {
  form: FormDef;
  close: () => void;
  lang: string;
  onError: (s: string) => void;
  onDone: (result: any) => void;
}) {
  const initial = Object.fromEntries(
    form.fields.map((f) => [
      f.key,
      form.initial?.[f.key] ??
        f.value ??
        (f.type === "checkbox"
          ? false
          : f.type === "select"
            ? f.options?.[0]?.value || ""
            : ""),
    ]),
  );
  const [values, setValues] = useState<Row>(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const dismiss = () => {
    if (
      !dirty ||
      window.confirm(
        lang === "th"
          ? "มีข้อมูลยังไม่บันทึก ต้องการปิดหรือไม่?"
          : "Discard unsaved changes?",
      )
    )
      close();
  };
  return (
    <div
      className="fixed inset-0 bg-slate-950/40 z-50 flex items-center justify-center md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-title"
        className="sheet card w-full md:max-w-3xl shadow-xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") dismiss();
          if (e.key === "Tab") {
            const elements = dialog.current?.querySelectorAll<HTMLElement>(
              "button,input,select,textarea",
            );
            if (elements?.length) {
              const first = elements[0],
                last = elements[elements.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              }
              if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }
        }}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 p-5 flex justify-between items-center z-10">
          <div>
            <span className="page-number">{form.id}</span>
            <h2 id="form-title" className="text-xl font-bold">
              {form.title}
            </h2>
          </div>
          <button className="btn" onClick={dismiss} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const result = await form.submit(values);
              onDone(result);
              close();
            } catch (e) {
              const msg = (e as Error).message;
              setError(msg);
              onError(msg);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="p-6 grid md:grid-cols-2 gap-5">
            {form.fields.map((f) => (
              <div
                key={f.key}
                className={f.type === "textarea" ? "md:col-span-2" : ""}
              >
                <label htmlFor={`field-${f.key}`}>
                  {lang === "th" ? f.th : f.en}
                  {f.required ? " *" : ""}
                </label>
                {f.type === "select" ? (
                  <select
                    id={`field-${f.key}`}
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                    required={f.required}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    id={`field-${f.key}`}
                    rows={4}
                    value={values[f.key]}
                    required={f.required}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                ) : f.type === "checkbox" ? (
                  <input
                    id={`field-${f.key}`}
                    type="checkbox"
                    className="w-5 h-5"
                    checked={values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.checked })
                    }
                  />
                ) : (
                  <input
                    id={`field-${f.key}`}
                    type={f.type || "text"}
                    value={values[f.key]}
                    required={f.required}
                    min={f.type === "number" ? 0 : undefined}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f.key]:
                          f.type === "number"
                            ? e.target.value === ""
                              ? ""
                              : Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </div>
            ))}
          </div>
          {error && (
            <p className="mx-6 mb-4 text-rose-700" role="alert">
              {error}
            </p>
          )}
          <div className="sticky bottom-0 bg-white p-5 border-t border-slate-200 flex justify-end gap-3">
            <button type="button" className="btn" onClick={dismiss}>
              {lang === "th" ? "ยกเลิก" : "Cancel"}
            </button>
            <button disabled={busy} className="btn btn-primary">
              {busy ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <Check size={16} />
              )}{" "}
              {lang === "th" ? "บันทึก" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Invitation() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        className="card p-8 max-w-md w-full space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await request(
              "/api/auth/accept-invitation",
              "POST",
              Object.fromEntries(new FormData(e.currentTarget)),
            );
            setMessage(
              "รับคำเชิญแล้ว กรุณาเข้าสู่ระบบ / Invitation accepted. Please sign in.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-2xl font-bold">NextHRM · รับคำเชิญ</h1>
        <div>
          <label htmlFor="invite-token">Invitation token</label>
          <input id="invite-token" name="token" required />
        </div>
        <div>
          <label htmlFor="invite-name">ชื่อ / Name</label>
          <input id="invite-name" name="display_name" required />
        </div>
        <div>
          <label htmlFor="invite-password">รหัสผ่าน / Password (12+)</label>
          <input
            id="invite-password"
            name="password"
            type="password"
            required
            minLength={12}
          />
        </div>
        <button disabled={busy} className="btn btn-primary">
          Accept invitation
        </button>
        <p role="status">{message}</p>
        <a href="/" className="btn">
          Sign in
        </a>
      </form>
    </main>
  );
}
export default function App() {
  const [companySearch, setCompanySearch] = useState(""),
    [pinned, setPinned] = useState<string[]>([]);
  const [lang, setLang] = useState(localStorage.getItem("language") || "th"),
    [dark, setDark] = useState(localStorage.getItem("theme") === "dark");
  const t = (th: string, en: string) => (lang === "th" ? th : en);
  const [me, setMe] = useState<Row | null>(null),
    [company, setCompany] = useState(""),
    [page, setPage] = useState("dashboard"),
    [data, setData] = useState<Row>({}),
    [lookups, setLookups] = useState<Row>({}),
    [employees, setEmployees] = useState<Row[]>([]),
    [notifications, setNotifications] = useState<Row>({ items: [], unread: 0 }),
    [showBell, setShowBell] = useState(false),
    [more, setMore] = useState(false),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [form, setForm] = useState<FormDef | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [detailKind, setDetailKind] = useState(""),
    [sub, setSub] = useState("company"),
    [calendar, setCalendar] = useState(false),
    [loginError, setLoginError] = useState("");
  const activeCompany = me?.companies?.find((c: Row) => c.id === company),
    can = (p: string) => activeCompany?.permissions?.includes(p),
    url = (path: string) => `/api/companies/${company}/${path}`;
  const generation = useRef(0);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem("language", lang);
  }, [lang]);
  async function identify() {
    try {
      const value = await request("/api/me");
      setMe(value);
      try {
        const preferences = await request("/api/preferences");
        setPinned(
          JSON.parse(preferences.accessibility_preferences_json || "{}")
            .pinned || [],
        );
      } catch {}
      setCompany((current) =>
        value.companies.some((c: Row) => c.id === current)
          ? current
          : value.companies[0]?.id || "",
      );
    } catch {
      setMe(null);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    identify();
    const expired = () => {
      setMe(null);
      setDetail(null);
      setForm(null);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  };
  async function load() {
    if (!me || !company) return;
    const n = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const [lk, ep, ns] = await Promise.all([
        request(url("lookups")),
        request(url("employees?limit=100")),
        request(url("notifications")),
      ]);
      let next: Row = {};
      if (page === "profile") {
        const p = await request(url("profile"));
        next = await request(url(`employees/${p.employee_id}`));
        next.slips = (await request(url("payslips"))).items;
      } else if (page === "settings")
        next = await request(
          url(
            sub === "company"
              ? "company"
              : sub === "schedules"
                ? "schedules"
                : sub === "transfers"
                  ? "transfers"
                  : `catalog/${sub}`,
          ),
        );
      else
        next = await request(
          url(
            `${page}?limit=25&offset=${offset}&q=${encodeURIComponent(query)}`,
          ),
        );
      if (n !== generation.current) return;
      setLookups(lk);
      setEmployees(ep.items);
      setNotifications(ns);
      setData(next);
    } catch (e) {
      if (n === generation.current) setError((e as Error).message);
    } finally {
      if (n === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setDetail(null);
    load();
  }, [me, company, page, offset, query, sub]);
  useEffect(() => {
    if (!me || !company) return;
    let ws: WebSocket | undefined,
      reconnect: ReturnType<typeof setTimeout>,
      stopped = false;
    const connect = () => {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?company=${company}`,
      );
      ws.onmessage = (e) => {
        const event = JSON.parse(e.data);
        if (event.type !== "pong") {
          request(url("notifications"))
            .then(setNotifications)
            .catch(() => {});
          if (event.type === "announcement" && page === "announcements") load();
        }
      };
      ws.onclose = () => {
        if (!stopped) reconnect = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      ws?.close();
    };
  }, [me, company, page]);
  const act = async (fn: () => Promise<any>) => {
    try {
      await fn();
      notify(t("บันทึกสำเร็จ", "Saved successfully"));
      await load();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const navigate = (key: string) => {
    if (
      form &&
      !window.confirm(
        t(
          "มีข้อมูลยังไม่บันทึก ต้องการเปลี่ยนหน้าหรือไม่?",
          "Discard unsaved form?",
        ),
      )
    )
      return;
    setForm(null);
    setPage(key);
    setOffset(0);
    setQuery("");
    setMore(false);
    setSub("company");
  };
  const selectOptions = (items: Row[], label = "name_th") => [
    { value: "", label: t("ไม่ระบุ", "Not assigned") },
    ...items.map((i) => ({ value: i.id, label: i[label] || i.name || i.code })),
  ];
  const employeeOptions = () =>
    employees.map((e) => ({
      value: e.id,
      label: `${e.first_name_th} ${e.last_name_th} · ${e.employee_no}`,
    }));
  function openForm(
    title: string,
    fields: Field[],
    path: string,
    transform: (v: Row) => Row = (v) => v,
    method = "POST",
    initial?: Row,
    id = "20001",
  ) {
    setForm({
      title,
      fields,
      initial,
      id,
      submit: (v) => request(url(path), method, transform(v)),
    });
  }
  function employeeForm(e?: Row) {
    const fields: Field[] = [
      {
        key: "employee_no",
        th: "รหัสพนักงาน",
        en: "Employee number",
        required: true,
      },
      { key: "first_name_th", th: "ชื่อ", en: "First name", required: true },
      { key: "last_name_th", th: "นามสกุล", en: "Last name", required: true },
      {
        key: "personal_email",
        th: "อีเมลส่วนตัว",
        en: "Personal email",
        type: "email",
      },
      { key: "mobile_phone", th: "โทรศัพท์", en: "Phone" },
      {
        key: "hire_date",
        th: "วันที่เริ่มงาน",
        en: "Hire date",
        type: "date",
        required: true,
        value: day(),
      },
      ...["department", "branch", "position", "job_level"].map((key) => ({
        key: `${key}_id`,
        th: (
          {
            department: "แผนก",
            branch: "สาขา",
            position: "ตำแหน่ง",
            job_level: "ระดับงาน",
          } as Row
        )[key],
        en: key.replace("_", " "),
        type: "select",
        options: selectOptions(
          lookups[`${key}s`] || [],
          key === "job_level" ? "name" : "name_th",
        ),
      })),
      {
        key: "manager_employee_id",
        th: "หัวหน้างาน",
        en: "Manager",
        type: "select",
        options: [
          { value: "", label: "—" },
          ...employeeOptions().filter((o) => o.value !== e?.id),
        ],
      },
      {
        key: "salary",
        th: "ค่าตอบแทน (บาท)",
        en: "Compensation (THB)",
        type: "number",
        required: true,
      },
      {
        key: "pay_type",
        th: "ประเภทค่าจ้าง",
        en: "Pay basis",
        type: "select",
        options: ["MONTHLY", "DAILY", "HOURLY"].map((value) => ({
          value,
          label: value,
        })),
      },
      {
        key: "employment_type",
        th: "ประเภทการจ้าง",
        en: "Employment type",
        type: "select",
        options: [
          "FULL_TIME",
          "PART_TIME",
          "CONTRACT",
          "PROBATION",
          "INTERN",
          "DAILY",
        ].map((value) => ({ value, label: value })),
      },
      {
        key: "employment_status",
        th: "สถานะ",
        en: "Employment status",
        type: "select",
        options: ["ACTIVE", "DRAFT", "ON_LEAVE", "SUSPENDED", "TERMINATED"].map(
          (value) => ({ value, label: value }),
        ),
      },
      {
        key: "termination_date",
        th: "วันที่ยุติการจ้าง",
        en: "Termination date",
        type: "date",
      },
      {
        key: "termination_reason",
        th: "เหตุผลยุติการจ้าง",
        en: "Termination reason",
      },
      { key: "address", th: "ที่อยู่", en: "Address", type: "textarea" },
      {
        key: "emergency_name",
        th: "ผู้ติดต่อฉุกเฉิน",
        en: "Emergency contact",
      },
      { key: "emergency_phone", th: "โทรศัพท์ฉุกเฉิน", en: "Emergency phone" },
      { key: "emergency_relationship", th: "ความสัมพันธ์", en: "Relationship" },
      { key: "national_id", th: "เลขบัตรประชาชน", en: "National ID" },
      { key: "passport_no", th: "เลขหนังสือเดินทาง", en: "Passport number" },
      { key: "bank_code", th: "รหัสธนาคาร", en: "Bank code" },
      { key: "bank_account", th: "เลขบัญชีธนาคาร", en: "Bank account" },
      { key: "tax_id", th: "เลขผู้เสียภาษี", en: "Tax ID" },
      {
        key: "social_security_no",
        th: "เลขประกันสังคม",
        en: "Social security number",
      },
    ];
    if (e)
      fields.push(
        {
          key: "effective_from",
          th: "วันที่มีผล",
          en: "Effective date",
          type: "date",
          value: day(),
        },
        {
          key: "reason",
          th: "เหตุผลการเปลี่ยนแปลง",
          en: "Change reason",
          required: true,
        },
      );
    else
      fields.push(
        {
          key: "create_user",
          th: "สร้างบัญชีเข้าสู่ระบบ",
          en: "Create login account",
          type: "checkbox",
        },
        {
          key: "password",
          th: "รหัสผ่านเริ่มต้น (12 ตัวขึ้นไป)",
          en: "Initial password (12+ characters)",
          type: "password",
        },
      );
    const current = e?.compensation_history?.[0];
    const initial = e
      ? {
          ...e,
          salary: (current?.base_salary_satang || 0) / 100,
          pay_type: current?.pay_type || "MONTHLY",
          address: e.addresses?.[0]?.address_line1 || "",
          emergency_name: e.emergency_contacts?.[0]?.full_name || "",
          emergency_phone: e.emergency_contacts?.[0]?.phone || "",
          national_id: "",
          passport_no: "",
          bank_account: "",
          termination_date: e.termination_date || "",
          termination_reason: e.termination_reason || "",
        }
      : undefined;
    openForm(
      e
        ? t("แก้ไขพนักงาน", "Edit employee")
        : t("เพิ่มพนักงาน", "Add employee"),
      fields,
      e ? `employees/${e.id}` : "employees",
      (v) => {
        const b: Row = {
          ...v,
          salary_satang: Math.round(Number(v.salary) * 100),
        };
        delete b.salary;
        for (const k of [
          "department_id",
          "branch_id",
          "position_id",
          "job_level_id",
          "manager_employee_id",
        ])
          b[k] = b[k] || null;
        for (const k of Object.keys(b)) if (b[k] === "") delete b[k];
        return b;
      },
      e ? "PUT" : "POST",
      initial,
      e ? "20003" : "20002",
    );
  }
  const personField: Field = {
    key: "employee_id",
    th: "พนักงาน",
    en: "Employee",
    type: "select",
    options: employeeOptions(),
    required: true,
  };
  function add() {
    if (page === "employees") employeeForm();
    else if (page === "attendance")
      openForm(
        t("แก้ไขเวลาทำงาน", "Correct attendance"),
        [
          personField,
          {
            key: "work_date",
            th: "วันที่",
            en: "Work date",
            type: "date",
            required: true,
            value: day(),
          },
          {
            key: "check_in_at",
            th: "เวลาเข้า",
            en: "Check-in",
            type: "datetime-local",
            required: true,
          },
          {
            key: "check_out_at",
            th: "เวลาออก",
            en: "Check-out",
            type: "datetime-local",
            required: true,
          },
          { key: "reason", th: "เหตุผล", en: "Reason", required: true },
        ],
        "attendance",
        (v) => ({
          ...v,
          check_in_at: new Date(v.check_in_at).toISOString(),
          check_out_at: new Date(v.check_out_at).toISOString(),
        }),
        "POST",
        undefined,
        "20004",
      );
    else if (page === "leave")
      openForm(
        t("ขอลา", "Request leave"),
        [
          personField,
          {
            key: "leave_type_id",
            th: "ประเภทลา",
            en: "Leave type",
            type: "select",
            options: (lookups.leave_types || []).map((x: Row) => ({
              value: x.id,
              label: lang === "th" ? x.name_th : x.name_en,
            })),
            required: true,
          },
          {
            key: "start_date",
            th: "วันที่เริ่ม",
            en: "Start date",
            type: "date",
            required: true,
            value: day(),
          },
          {
            key: "end_date",
            th: "วันที่สิ้นสุด",
            en: "End date",
            type: "date",
            required: true,
            value: day(),
          },
          {
            key: "unit",
            th: "หน่วย",
            en: "Unit",
            type: "select",
            options: [
              { value: "FULL", label: t("เต็มวัน", "Full day") },
              { value: "HALF", label: t("ครึ่งวัน", "Half day") },
              { value: "HOUR", label: t("รายชั่วโมง", "Hourly") },
            ],
          },
          {
            key: "hours",
            th: "จำนวนชั่วโมง",
            en: "Hours",
            type: "number",
            value: 1,
          },
          {
            key: "reason",
            th: "เหตุผล",
            en: "Reason",
            type: "textarea",
            required: true,
          },
        ],
        "leave",
        (v) => v,
        "POST",
        undefined,
        "20005",
      );
    else if (page === "payroll")
      openForm(
        t("สร้างรอบค่าตอบแทน", "Create payroll cycle"),
        [
          { key: "code", th: "รหัสรอบ", en: "Cycle code", required: true },
          { key: "name", th: "ชื่อรอบ", en: "Cycle name", required: true },
          {
            key: "cycle_type",
            th: "ประเภท",
            en: "Frequency",
            type: "select",
            options: ["MONTHLY", "DAILY", "WEEKLY", "BIWEEKLY"].map(
              (value) => ({ value, label: value }),
            ),
          },
          {
            key: "period_start",
            th: "วันเริ่มงวด",
            en: "Period start",
            type: "date",
            required: true,
          },
          {
            key: "period_end",
            th: "วันสิ้นงวด",
            en: "Period end",
            type: "date",
            required: true,
          },
          {
            key: "pay_date",
            th: "วันจ่าย",
            en: "Pay date",
            type: "date",
            required: true,
          },
        ],
        "payroll",
        (v) => v,
        "POST",
        undefined,
        "20006",
      );
    else if (page === "announcements")
      openForm(
        t("สร้างประกาศ", "Create announcement"),
        [
          { key: "title", th: "หัวข้อ", en: "Title", required: true },
          {
            key: "body",
            th: "เนื้อหา",
            en: "Content",
            type: "textarea",
            required: true,
          },
          {
            key: "priority",
            th: "ความสำคัญ",
            en: "Priority",
            type: "select",
            options: ["NORMAL", "HIGH", "URGENT", "LOW"].map((value) => ({
              value,
              label: value,
            })),
          },
          {
            key: "status",
            th: "การเผยแพร่",
            en: "Publication",
            type: "select",
            options: ["DRAFT", "PUBLISHED", "SCHEDULED"].map((value) => ({
              value,
              label: value,
            })),
          },
          {
            key: "scheduled_at",
            th: "ตั้งเวลาเผยแพร่",
            en: "Schedule publication",
            type: "datetime-local",
          },
          {
            key: "expires_at",
            th: "หมดอายุ",
            en: "Expires at",
            type: "datetime-local",
          },
          {
            key: "requires_acknowledgement",
            th: "ต้องรับทราบ",
            en: "Require acknowledgement",
            type: "checkbox",
          },
        ],
        "announcements",
        (v) => ({
          ...v,
          requires_acknowledgement: v.requires_acknowledgement ? 1 : 0,
          scheduled_at: v.scheduled_at
            ? new Date(v.scheduled_at).toISOString()
            : null,
          expires_at: v.expires_at
            ? new Date(v.expires_at).toISOString()
            : null,
        }),
        "POST",
        undefined,
        "20007",
      );
    else if (page === "users")
      openForm(
        t("เชิญผู้ใช้", "Invite user"),
        [
          {
            key: "email",
            th: "อีเมล",
            en: "Email",
            type: "email",
            required: true,
          },
          { key: "display_name", th: "ชื่อ", en: "Name", required: true },
          {
            key: "role_code",
            th: "บทบาท",
            en: "Role",
            type: "select",
            options: (data.roles || []).map((x: Row) => ({
              value: x.code,
              label: x.name,
            })),
          },
        ],
        "users/invite",
        (v) => ({ ...v, company_ids: [company] }),
        "POST",
        undefined,
        "20008",
      );
    else if (
      page === "settings" &&
      [
        "branches",
        "departments",
        "positions",
        "job_levels",
        "holidays",
        "leave_types",
      ].includes(sub)
    )
      openForm(
        t("เพิ่มรายการ", "Add record"),
        sub === "holidays"
          ? [
              {
                key: "holiday_date",
                th: "วันที่",
                en: "Date",
                type: "date",
                required: true,
              },
              {
                key: "name_th",
                th: "ชื่อภาษาไทย",
                en: "Thai name",
                required: true,
              },
            ]
          : [
              { key: "code", th: "รหัส", en: "Code", required: true },
              {
                key: sub === "job_levels" ? "name" : "name_th",
                th: "ชื่อภาษาไทย",
                en: "Thai name",
                required: true,
              },
              ...(sub === "job_levels"
                ? []
                : [
                    {
                      key: "name_en",
                      th: "ชื่อภาษาอังกฤษ",
                      en: "English name",
                    },
                  ]),
            ],
        `catalog/${sub}`,
      );
  }
  async function openDetail(kind: string, row: Row) {
    try {
      setDetailKind(kind);
      if (kind === "employee")
        setDetail(await request(url(`employees/${row.id}`)));
      else if (kind === "payroll")
        setDetail(await request(url(`payroll/${row.id}`)));
      else if (kind === "payslip")
        setDetail(await request(url(`payslips/${row.id}`)));
      else {
        if (kind === "announcement" && row.status === "PUBLISHED") {
          await request(url(`announcements/${row.id}/read`), "POST", {});
          setNotifications(await request(url("notifications")));
          load();
        }
        setDetail(row);
      }
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function decision(path: string, decision: string) {
    openForm(
      t("บันทึกผลพิจารณา", "Record decision"),
      [
        {
          key: "comment",
          th: "ความคิดเห็น / เหตุผล",
          en: "Comment / reason",
          required: true,
        },
      ],
      path,
      (v) => ({ ...v, decision }),
      "POST",
      undefined,
      "20009",
    );
  }
  function exportData() {
    openForm(
      t("ส่งออกข้อมูล", "Export data"),
      [
        {
          key: "reason",
          th: "เหตุผลการส่งออก",
          en: "Export reason",
          required: true,
        },
      ],
      "exports",
    );
    setForm({
      title: t("ส่งออกข้อมูล", "Export data"),
      id: "20010",
      fields: [
        {
          key: "reason",
          th: "เหตุผลการส่งออก",
          en: "Export reason",
          required: true,
        },
      ],
      submit: async (v) => {
        const exp = await request(url("exports"), "POST", {
          type: page,
          reason: v.reason,
          q: query,
        });
        const a = document.createElement("a");
        a.href = exp.url;
        a.download = `${page}.csv`;
        a.click();
      },
    });
  }
  function table(
    rows: Row[],
    columns: { label: string; render: (r: Row) => ReactNode }[],
    actions?: (r: Row) => ReactNode,
  ) {
    return (
      <>
        {rows.length === 0 ? (
          <div className="card p-14 text-center muted">
            <FileText className="mx-auto mb-3 text-slate-300" size={36} />
            <h3 className="font-semibold">
              {t("ยังไม่มีรายการ", "No records yet")}
            </h3>
            <p className="text-sm mt-1">
              {t("รายการใหม่จะแสดงที่นี่", "New records will appear here")}
            </p>
          </div>
        ) : (
          <>
            <div className="card overflow-x-auto hidden md:block">
              <table className="w-full">
                <thead className="table-head">
                  <tr>
                    {columns.map((col, i) => (
                      <th key={i}>{col.label}</th>
                    ))}
                    {actions && <th>{t("ดำเนินการ", "Actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id || i} className="hover:bg-slate-50">
                      {columns.map((col, j) => (
                        <td key={j}>{col.render(r)}</td>
                      ))}
                      {actions && (
                        <td>
                          <div className="flex flex-wrap gap-2">
                            {actions(r)}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden grid gap-3">
              {rows.map((r, i) => (
                <div key={r.id || i} className="mobile-card">
                  {columns.map((col, j) => (
                    <div
                      key={j}
                      className="flex items-start justify-between gap-4 py-2"
                    >
                      <span className="muted text-xs">{col.label}</span>
                      <div className="text-right">{col.render(r)}</div>
                    </div>
                  ))}
                  {actions && (
                    <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 mt-2">
                      {actions(r)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="btn"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            {t("ก่อนหน้า", "Previous")}
          </button>
          <span className="self-center muted">
            {offset + 1}–{offset + rows.length}
          </span>
          <button
            className="btn"
            disabled={rows.length < 25}
            onClick={() => setOffset(offset + 25)}
          >
            {t("ถัดไป", "Next")}
          </button>
        </div>
      </>
    );
  }
  const name = (r: Row) => (
    <div className="flex items-center gap-3">
      <span className="h-9 w-9 rounded-full bg-blue-50 text-blue-600 inline-flex items-center justify-center font-bold shrink-0">
        {r.first_name_th?.slice(0, 1) || r.display_name?.slice(0, 1) || "N"}
      </span>
      <div>
        <div className="font-semibold">
          {r.first_name_th} {r.last_name_th}
        </div>
        <div className="text-xs muted">{r.employee_no}</div>
      </div>
    </div>
  );
  function content() {
    if (page === "dashboard")
      return (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {[
              {
                label: t("พนักงานทั้งหมด", "Total people"),
                value: data.summary?.employees || 0,
                caption: t("ในบริษัทที่เลือก", "In this company"),
                icon: Users,
                color: "blue",
              },
              {
                label: t("มาทำงานวันนี้", "Present today"),
                value: data.attendance?.present || 0,
                caption: data.date,
                icon: Clock,
                color: "emerald",
              },
              {
                label: t("คำขอลารออนุมัติ", "Pending leave"),
                value: data.leave?.pending || 0,
                caption: t("ติดตามและพิจารณา", "Review your queue"),
                icon: CalendarDays,
                color: "amber",
              },
              {
                label: t("รอบค่าตอบแทน", "Payroll cycles"),
                value: data.payroll?.length || 0,
                caption: t("รอบล่าสุด", "Recent cycles"),
                icon: Wallet,
                color: "violet",
              },
            ].map((k, i) => (
              <button
                key={k.label}
                className="card p-5 text-left"
                onClick={() =>
                  navigate(
                    [
                      "employees",
                      "attendance",
                      "leave",
                      can("payroll.prepare") ? "payroll" : "profile",
                    ][i],
                  )
                }
              >
                <div className="flex justify-between items-center">
                  <span className="muted text-xs">{k.label}</span>
                  <k.icon size={18} className="text-blue-500" />
                </div>
                <div className="text-3xl font-bold my-3">{k.value}</div>
                <div className="text-xs muted">{k.caption}</div>
              </button>
            ))}
          </div>
          <div className="grid xl:grid-cols-[1.6fr_1fr] gap-5">
            <div className="card">
              <div className="p-5 flex justify-between border-b border-slate-100">
                <h2 className="font-bold text-lg">
                  {t("ทีมของคุณ", "Your team")}
                </h2>
                <button
                  className="text-blue-600 flex gap-1 items-center"
                  onClick={() => navigate("employees")}
                >
                  {t("ดูทั้งหมด", "View all")}
                  <ArrowUpRight size={15} />
                </button>
              </div>
              {employees.slice(0, 6).map((e) => (
                <button
                  onClick={() => openDetail("employee", e)}
                  key={e.id}
                  className="w-full flex justify-between p-4 border-b border-slate-100 items-center hover:bg-slate-50"
                >
                  {name(e)}
                  <span className="hidden sm:block muted text-xs">
                    {e.department_name || "—"}
                  </span>
                  <Badge value={e.employment_status} />
                </button>
              ))}
              {!employees.length && (
                <p className="p-8 muted">
                  {t("ยังไม่มีพนักงาน", "No people yet")}
                </p>
              )}
            </div>
            <div className="grid gap-5">
              <div className="card p-5">
                <h2 className="font-bold text-lg mb-3">
                  {t("งานที่ต้องทำ", "Your work queue")}
                </h2>
                <button
                  className="w-full flex items-center justify-between py-3"
                  onClick={() => navigate("leave")}
                >
                  <span className="flex gap-3 items-center">
                    <CalendarDays size={19} className="text-blue-500" />
                    {t("คำขอลา", "Leave requests")}
                  </span>
                  <span className="badge">{data.leave?.pending || 0}</span>
                </button>
                {data.payroll?.map((p: Row) => (
                  <button
                    key={p.id}
                    className="w-full flex items-center justify-between py-3 border-t border-slate-100"
                    onClick={() => {
                      navigate("payroll");
                      openDetail("payroll", p);
                    }}
                  >
                    <span>{p.name}</span>
                    <Badge value={p.status} />
                  </button>
                ))}
              </div>
              <div className="card p-5">
                <h2 className="font-bold text-lg mb-4">
                  {t("กิจกรรมล่าสุด", "Recent activity")}
                </h2>
                {data.activity?.map((a: Row, i: number) => (
                  <div key={i} className="flex gap-3 pb-4">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">
                        {a.action} · {a.object_type}
                      </p>
                      <p className="muted text-xs mt-1">
                        {datetime(a.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
                {!data.activity?.length && (
                  <p className="muted text-sm">
                    {t("ยังไม่มีกิจกรรม", "No activity yet")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      );
    if (page === "employees")
      return table(
        data.items || [],
        [
          {
            label: t("ชื่อ / รหัสพนักงาน", "Name / employee number"),
            render: name,
          },
          {
            label: t("ตำแหน่ง", "Position"),
            render: (r) => r.position_name || "—",
          },
          {
            label: t("แผนก", "Department"),
            render: (r) => r.department_name || "—",
          },
          { label: t("วันเริ่มงาน", "Hire date"), render: (r) => r.hire_date },
          {
            label: t("สถานะ", "Status"),
            render: (r) => <Badge value={r.employment_status} />,
          },
        ],
        (r) => (
          <>
            <button className="btn" onClick={() => openDetail("employee", r)}>
              {t("รายละเอียด", "Details")}
              <ChevronRight size={14} />
            </button>
            {can("employee.manage") && (
              <button
                className="btn"
                onClick={async () =>
                  employeeForm(await request(url(`employees/${r.id}`)))
                }
              >
                {t("แก้ไข", "Edit")}
              </button>
            )}
          </>
        ),
      );
    if (page === "attendance")
      return (
        <>
          <div className="flex flex-wrap gap-3 mb-5">
            <button
              className="btn"
              onClick={() =>
                act(() =>
                  request(url("attendance/clock"), "POST", { action: "IN" }),
                )
              }
            >
              <Clock size={16} />
              {t("เข้างาน", "Clock in")}
            </button>
            <button
              className="btn"
              onClick={() =>
                act(() =>
                  request(url("attendance/clock"), "POST", { action: "OUT" }),
                )
              }
            >
              {t("ออกงาน", "Clock out")}
            </button>
            <button
              className="btn"
              onClick={() => {
                setDetailKind("attendance-requests");
                request(url("attendance-requests")).then(setDetail);
              }}
            >
              {t("คำขอแก้เวลา", "Correction requests")}
            </button>
            <button
              className="btn"
              onClick={() => {
                setDetailKind("overtime");
                request(url("overtime")).then(setDetail);
              }}
            >
              {t("คำขอ OT", "Overtime")}
            </button>
            <button
              className="btn"
              onClick={() =>
                openForm(
                  t("ส่งคำขอแก้เวลา", "Request correction"),
                  [
                    {
                      key: "work_date",
                      th: "วันที่",
                      en: "Date",
                      type: "date",
                      required: true,
                    },
                    {
                      key: "check_in_at",
                      th: "เวลาเข้า",
                      en: "Check-in",
                      type: "datetime-local",
                      required: true,
                    },
                    {
                      key: "check_out_at",
                      th: "เวลาออก",
                      en: "Check-out",
                      type: "datetime-local",
                      required: true,
                    },
                    {
                      key: "reason",
                      th: "เหตุผล",
                      en: "Reason",
                      required: true,
                    },
                  ],
                  "attendance-requests",
                  (v) => ({
                    ...v,
                    check_in_at: new Date(v.check_in_at).toISOString(),
                    check_out_at: new Date(v.check_out_at).toISOString(),
                  }),
                )
              }
            >
              {t("ขอแก้เวลา", "Request correction")}
            </button>
            <button
              className="btn"
              onClick={() =>
                openForm(
                  t("ขอ OT", "Request overtime"),
                  [
                    personField,
                    {
                      key: "work_date",
                      th: "วันที่",
                      en: "Date",
                      type: "date",
                      required: true,
                    },
                    {
                      key: "start_at",
                      th: "เริ่ม",
                      en: "Start",
                      type: "datetime-local",
                      required: true,
                    },
                    {
                      key: "end_at",
                      th: "สิ้นสุด",
                      en: "End",
                      type: "datetime-local",
                      required: true,
                    },
                    {
                      key: "reason",
                      th: "เหตุผล",
                      en: "Reason",
                      required: true,
                    },
                  ],
                  "overtime",
                  (v) => ({
                    ...v,
                    start_at: new Date(v.start_at).toISOString(),
                    end_at: new Date(v.end_at).toISOString(),
                  }),
                )
              }
            >
              <Plus size={15} />
              OT
            </button>
          </div>
          {table(data.items || [], [
            { label: t("พนักงาน", "Employee"), render: name },
            { label: t("วันที่", "Date"), render: (r) => r.work_date },
            {
              label: t("เข้า / ออก", "In / out"),
              render: (r) => (
                <div className="text-xs">
                  {datetime(r.check_in_at)}
                  <br />
                  {datetime(r.check_out_at)}
                </div>
              ),
            },
            {
              label: t("นาทีทำงาน", "Worked minutes"),
              render: (r) => r.worked_minutes,
            },
            {
              label: t("มาสาย (นาที)", "Late minutes"),
              render: (r) => r.late_minutes,
            },
            {
              label: t("สถานะ", "Status"),
              render: (r) => <Badge value={r.status} />,
            },
          ])}
        </>
      );
    if (page === "leave")
      return (
        <>
          <div className="flex flex-wrap gap-3 mb-5">
            <button className="btn" onClick={() => setCalendar(!calendar)}>
              <CalendarDays size={16} />
              {calendar
                ? t("รายการ", "List")
                : t("ปฏิทินเดือน", "Month calendar")}
            </button>
            <button
              className="btn"
              onClick={() => {
                setDetailKind("balances");
                request(url("leave-balances")).then(setDetail);
              }}
            >
              {t("ยอดคงเหลือ", "Balances")}
            </button>
            {can("leave.manage") && (
              <button
                className="btn"
                onClick={() =>
                  openForm(
                    t("ปรับยอดสิทธิ์การลา", "Allocate leave balance"),
                    [
                      personField,
                      {
                        key: "leave_type_id",
                        th: "ประเภทลา",
                        en: "Leave type",
                        type: "select",
                        options: (lookups.leave_types || []).map((x: Row) => ({
                          value: x.id,
                          label: x.name_th,
                        })),
                      },
                      {
                        key: "balance_year",
                        th: "ปี",
                        en: "Year",
                        type: "number",
                        value: new Date().getFullYear(),
                      },
                      {
                        key: "minutes",
                        th: "เพิ่มนาที",
                        en: "Minutes to add",
                        type: "number",
                        required: true,
                      },
                      {
                        key: "reason",
                        th: "เหตุผล",
                        en: "Reason",
                        required: true,
                      },
                    ],
                    "leave-balances",
                  )
                }
              >
                {t("ปรับยอด", "Adjust balance")}
              </button>
            )}
          </div>
          {calendar ? (
            <div className="card p-5">
              <h3 className="font-bold mb-4">
                {new Date().toLocaleDateString(
                  lang === "th" ? "th-TH" : "en-US",
                  { month: "long", year: "numeric" },
                )}
              </h3>
              <div className="grid grid-cols-7 gap-2">
                {Array.from(
                  {
                    length: new Date(
                      new Date().getFullYear(),
                      new Date().getMonth() + 1,
                      0,
                    ).getDate(),
                  },
                  (_, i) => {
                    const d = `${day().slice(0, 7)}-${String(i + 1).padStart(2, "0")}`;
                    return (
                      <div
                        key={d}
                        className="border border-slate-200 rounded-lg p-2 min-h-24"
                      >
                        <span className="muted text-xs">{i + 1}</span>
                        {(data.items || [])
                          .filter(
                            (x: Row) =>
                              x.start_at.slice(0, 10) <= d &&
                              x.end_at.slice(0, 10) >= d &&
                              ["APPROVED", "PENDING"].includes(x.status),
                          )
                          .map((x: Row) => (
                            <p
                              key={x.id}
                              className="text-[10px] mt-1 bg-blue-50 text-blue-700 rounded p-1"
                            >
                              {x.first_name_th}
                            </p>
                          ))}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          ) : (
            table(
              data.items || [],
              [
                { label: t("พนักงาน", "Employee"), render: name },
                {
                  label: t("ประเภทลา", "Leave type"),
                  render: (r) => r.leave_type_name,
                },
                {
                  label: t("ช่วงวันที่", "Dates"),
                  render: (r) => (
                    <span className="text-xs">
                      {r.start_at.slice(0, 10)} — {r.end_at.slice(0, 10)}
                    </span>
                  ),
                },
                {
                  label: t("นาที", "Minutes"),
                  render: (r) => r.requested_minutes,
                },
                {
                  label: t("สถานะ", "Status"),
                  render: (r) => <Badge value={r.status} />,
                },
              ],
              (r) => (
                <>
                  <button
                    className="btn"
                    onClick={() => {
                      setDetailKind("leave");
                      setDetail(r);
                    }}
                  >
                    {t("รายละเอียด", "Details")}
                  </button>
                  {r.status === "PENDING" && can("leave.approve") && (
                    <>
                      <button
                        className="btn btn-primary"
                        onClick={() =>
                          decision(`leave/${r.id}/decision`, "APPROVED")
                        }
                      >
                        {t("อนุมัติ", "Approve")}
                      </button>
                      <button
                        className="btn"
                        onClick={() =>
                          decision(`leave/${r.id}/decision`, "REJECTED")
                        }
                      >
                        {t("ปฏิเสธ", "Reject")}
                      </button>
                    </>
                  )}
                </>
              ),
            )
          )}
        </>
      );
    if (page === "payroll")
      return table(
        data.items || [],
        [
          {
            label: t("รอบค่าตอบแทน", "Payroll cycle"),
            render: (r) => (
              <div>
                <b>{r.name}</b>
                <p className="text-xs muted">
                  {r.code} · {r.cycle_type}
                </p>
              </div>
            ),
          },
          {
            label: t("ช่วงงวด", "Period"),
            render: (r) => (
              <span className="text-xs">
                {r.period_start} — {r.period_end}
              </span>
            ),
          },
          {
            label: t("พนักงาน", "Employees"),
            render: (r) => r.employee_count || 0,
          },
          {
            label: t("สุทธิ", "Net pay"),
            render: (r) => money(r.total_net_satang),
          },
          {
            label: t("สถานะ", "Status"),
            render: (r) => <Badge value={r.status} />,
          },
        ],
        (r) => (
          <button className="btn" onClick={() => openDetail("payroll", r)}>
            {t("ตรวจสอบ", "Review")}
            <ChevronRight size={15} />
          </button>
        ),
      );
    if (page === "announcements")
      return (
        <div className="grid lg:grid-cols-2 gap-5">
          {(data.items || []).map((r: Row) => (
            <div className="card p-6" key={r.id}>
              <div className="flex items-center justify-between mb-4">
                <Badge value={r.status} />
                <span className="muted text-xs">{datetime(r.created_at)}</span>
              </div>
              <button
                className="text-left w-full"
                onClick={() => openDetail("announcement", r)}
              >
                <h2 className="font-bold text-lg mb-2">{r.title}</h2>
                <p className="muted line-clamp-3 whitespace-pre-wrap">
                  {r.body}
                </p>
              </button>
              <div className="flex items-center justify-between mt-5 border-t border-slate-100 pt-4">
                <span className="text-xs muted">
                  {r.priority} · {t("เวอร์ชัน", "Revision")}{" "}
                  {r.current_revision_no}
                </span>
                <button
                  className="text-blue-600 flex items-center gap-1"
                  onClick={() => openDetail("announcement", r)}
                >
                  {t("อ่านประกาศ", "Read")}
                  <ChevronRight size={15} />
                </button>
              </div>
              {can("announcement.manage") && (
                <>
                  <div className="text-xs muted mt-3 flex gap-4">
                    <span>
                      {t("ผู้รับ", "Recipients")} {r.delivered_count}
                    </span>
                    <span>
                      {t("ผู้อ่าน", "Readers")} {r.unique_viewer_count || 0}
                    </span>
                    <span>
                      {t("เปิดรวม", "Views")} {r.total_view_count}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {JSON.parse(r.activity_json || "[]")
                      .filter(Boolean)
                      .map((x: Row) => (
                        <div
                          key={x.user_id}
                          className="flex justify-between text-xs"
                        >
                          <span>{x.name}</span>
                          <span className="muted">
                            {x.view_count} {t("ครั้ง", "views")}{" "}
                            {x.view_count === 0
                              ? `· ${t("ยังไม่อ่าน", "Unread")}`
                              : ""}
                          </span>
                        </div>
                      ))}
                  </div>
                  {r.status === "DRAFT" && (
                    <button
                      className="btn mt-3"
                      onClick={() =>
                        act(() =>
                          request(
                            url(`announcements/${r.id}/publish`),
                            "POST",
                            {},
                          ),
                        )
                      }
                    >
                      {t("เผยแพร่", "Publish")}
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
          {!data.items?.length && (
            <p className="card p-12 muted">
              {t("ยังไม่มีประกาศ", "No announcements yet")}
            </p>
          )}
        </div>
      );
    if (page === "profile")
      return (
        <div className="grid xl:grid-cols-[1.5fr_1fr] gap-5">
          <div>
            <div className="card p-6">
              <div className="flex justify-between mb-6">
                {name(data)}
                <Badge value={data.employment_status} />
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                {[
                  [t("วันเริ่มงาน", "Hire date"), data.hire_date],
                  [t("โทรศัพท์", "Phone"), data.mobile_phone],
                  [t("อีเมล", "Email"), data.personal_email],
                  [
                    t("เงินเดือน / ค่าจ้าง", "Compensation"),
                    money(data.compensation_history?.[0]?.base_salary_satang),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="muted text-xs mb-1">{label}</p>
                    <p className="font-medium">{value || "—"}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-6">
                <button
                  className="btn"
                  onClick={() =>
                    openForm(
                      t("แก้ไขข้อมูลทั่วไป", "Edit contact information"),
                      [
                        {
                          key: "mobile_phone",
                          th: "โทรศัพท์",
                          en: "Phone",
                          required: true,
                        },
                        {
                          key: "personal_email",
                          th: "อีเมล",
                          en: "Email",
                          type: "email",
                          required: true,
                        },
                        { key: "nickname", th: "ชื่อเล่น", en: "Nickname" },
                      ],
                      "profile",
                      (v) => v,
                      "PATCH",
                      data,
                    )
                  }
                >
                  {t("แก้ข้อมูลติดต่อ", "Edit contact")}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    openForm(
                      t("ขอเปลี่ยนข้อมูลสำคัญ", "Request profile change"),
                      [
                        {
                          key: "field",
                          th: "ข้อมูล",
                          en: "Field",
                          type: "select",
                          options: [
                            "first_name_th",
                            "last_name_th",
                            "national_id",
                            "bank_account",
                            "tax_id",
                            "social_security_no",
                          ].map((value) => ({ value, label: value })),
                        },
                        {
                          key: "value",
                          th: "ค่าใหม่",
                          en: "New value",
                          required: true,
                        },
                        {
                          key: "reason",
                          th: "เหตุผล",
                          en: "Reason",
                          required: true,
                        },
                      ],
                      `employees/${data.id}/profile-requests`,
                    )
                  }
                >
                  {t("ขอเปลี่ยนข้อมูล", "Request change")}
                </button>
              </div>
            </div>
            <div className="card p-6 mt-5">
              <div className="flex justify-between mb-5">
                <h2 className="font-bold text-lg">
                  {t("ประสบการณ์ทำงาน", "Work experience")}
                </h2>
                <button
                  className="btn"
                  onClick={() =>
                    openForm(
                      t("เพิ่มประสบการณ์ทำงาน", "Add work experience"),
                      [
                        {
                          key: "company_name",
                          th: "บริษัท",
                          en: "Company",
                          required: true,
                        },
                        {
                          key: "position_name",
                          th: "ตำแหน่ง",
                          en: "Position",
                          required: true,
                        },
                        {
                          key: "started_on",
                          th: "วันเริ่ม",
                          en: "Start date",
                          type: "date",
                          required: true,
                        },
                        {
                          key: "ended_on",
                          th: "วันสิ้นสุด",
                          en: "End date",
                          type: "date",
                        },
                        {
                          key: "description",
                          th: "รายละเอียด",
                          en: "Description",
                          type: "textarea",
                        },
                      ],
                      `employees/${data.id}/experiences`,
                      (v) => ({ ...v, ended_on: v.ended_on || null }),
                    )
                  }
                >
                  <Plus size={16} />
                  {t("เพิ่ม", "Add")}
                </button>
              </div>
              {data.work_experiences?.map((x: Row) => (
                <div
                  key={x.id}
                  className="border-l-2 border-blue-300 pl-4 pb-6"
                >
                  <b>{x.position_name}</b>
                  <p>{x.company_name}</p>
                  <p className="muted text-xs">
                    {x.started_on} — {x.ended_on || t("ปัจจุบัน", "Present")}
                  </p>
                  <p className="text-sm mt-2">{x.description}</p>
                </div>
              ))}
              {!data.work_experiences?.length && (
                <p className="muted">
                  {t("ยังไม่มีประสบการณ์ทำงาน", "No experience submitted yet")}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-5">
            <div className="card p-6">
              <h2 className="font-bold text-lg mb-4">
                {t("สลิปเงินเดือน", "My payslips")}
              </h2>
              {data.slips?.map((s: Row) => (
                <button
                  key={s.id}
                  className="flex items-center justify-between w-full py-3 border-b border-slate-100"
                  onClick={() => openDetail("payslip", s)}
                >
                  <span>{s.name}</span>
                  <b>{money(s.net_pay_satang)}</b>
                </button>
              ))}
              {!data.slips?.length && (
                <p className="muted">
                  {t("ยังไม่มีสลิปที่เผยแพร่", "No published payslips")}
                </p>
              )}
            </div>
            <div className="card p-6">
              <h2 className="font-bold text-lg mb-4">
                {t("คำขอเปลี่ยนข้อมูล", "Profile requests")}
              </h2>
              {data.profile_requests?.map((r: Row) => (
                <div key={r.id} className="py-3 border-b border-slate-100">
                  <p className="mb-2">{r.request_type}</p>
                  <Badge value={r.status} />
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    if (page === "users")
      return table(
        data.items || [],
        [
          {
            label: t("ผู้ใช้", "User"),
            render: (r) => (
              <div>
                <b>{r.display_name}</b>
                <p className="muted text-xs">{r.email}</p>
              </div>
            ),
          },
          {
            label: t("บทบาท", "Roles"),
            render: (r) => <span className="text-xs">{r.roles}</span>,
          },
          {
            label: t("สถานะ", "Status"),
            render: (r) => <Badge value={r.status} />,
          },
        ],
        (r) => (
          <>
            <button
              className="btn"
              onClick={() => {
                setDetailKind("permissions");
                request(url(`users/${r.id}/permissions`)).then((v) =>
                  setDetail({ ...v, display_name: r.display_name }),
                );
              }}
            >
              {t("สิทธิ์", "Permissions")}
            </button>
            <button
              className="btn"
              onClick={() =>
                openForm(
                  t("จัดการบัญชีผู้ใช้", "Manage account"),
                  [
                    {
                      key: "action",
                      th: "การดำเนินการ",
                      en: "Action",
                      type: "select",
                      options: [
                        "UNLOCK",
                        "SUSPEND",
                        "ACTIVATE",
                        "REVOKE_SESSIONS",
                        "RESET_PASSWORD",
                      ].map((value) => ({ value, label: value })),
                    },
                    {
                      key: "password",
                      th: "รหัสผ่านใหม่ (12 ตัว)",
                      en: "New password (12+)",
                      type: "password",
                    },
                    {
                      key: "reason",
                      th: "เหตุผล",
                      en: "Reason",
                      required: true,
                    },
                  ],
                  `users/${r.id}/action`,
                  (v) => {
                    if (!v.password) delete v.password;
                    return v;
                  },
                )
              }
            >
              {t("จัดการ", "Manage")}
            </button>
          </>
        ),
      );
    if (page === "audit")
      return table(
        data.items || [],
        [
          {
            label: t("วันที่", "When"),
            render: (r) => (
              <span className="text-xs">{datetime(r.created_at)}</span>
            ),
          },
          { label: t("ผู้ดำเนินการ", "Actor"), render: (r) => r.actor_name },
          {
            label: t("การดำเนินการ", "Action"),
            render: (r) => <span className="badge">{r.action}</span>,
          },
          { label: t("โมดูล", "Module"), render: (r) => r.object_type },
          { label: t("เหตุผล", "Reason"), render: (r) => r.reason || "—" },
        ],
        (r) => (
          <button
            className="btn"
            onClick={() => {
              setDetailKind("audit");
              setDetail(r);
            }}
          >
            {t("ดู Diff", "View diff")}
          </button>
        ),
      );
    if (page === "settings")
      return (
        <>
          <div className="card p-3 flex flex-wrap gap-2 mb-5">
            {[
              ["company", "บริษัท", "Company"],
              ["branches", "สาขา", "Branches"],
              ["departments", "แผนก", "Departments"],
              ["positions", "ตำแหน่ง", "Positions"],
              ["job_levels", "ระดับงาน", "Job levels"],
              ["holidays", "วันหยุด", "Holidays"],
              ["leave_types", "ประเภทลา", "Leave types"],
              ["schedules", "กะงาน", "Schedules"],
              ["transfers", "ย้ายบริษัท", "Transfers"],
            ].map(([k, th, en]) => (
              <button
                key={k}
                className={`btn ${sub === k ? "btn-primary" : ""}`}
                onClick={() => {
                  setSub(k);
                  setOffset(0);
                }}
              >
                {t(th, en)}
              </button>
            ))}
          </div>
          {sub === "company" ? (
            <div className="card p-7">
              <div className="flex items-start justify-between">
                <div>
                  <span className="badge mb-3">{data.code}</span>
                  <h2 className="text-xl font-bold">{data.display_name}</h2>
                  <p className="muted mt-2">{data.legal_name}</p>
                </div>
                <Building2 size={40} className="text-blue-400" />
              </div>
              <div className="grid sm:grid-cols-3 gap-6 my-8">
                {[
                  ["Timezone", data.timezone],
                  ["Locale", data.locale],
                  ["Currency", data.currency_code],
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="muted text-xs mb-2">{l}</p>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
              {can("company.manage") && (
                <div className="flex flex-wrap gap-3 mb-4">
                  <button
                    className="btn"
                    onClick={() =>
                      openForm(
                        t("สร้างกะงาน", "Create schedule"),
                        [
                          {
                            key: "code",
                            th: "รหัส",
                            en: "Code",
                            required: true,
                          },
                          {
                            key: "name",
                            th: "ชื่อกะ",
                            en: "Schedule name",
                            required: true,
                          },
                          {
                            key: "start",
                            th: "เวลาเริ่ม",
                            en: "Start time",
                            type: "time",
                            value: "09:00",
                            required: true,
                          },
                          {
                            key: "end",
                            th: "เวลาสิ้นสุด",
                            en: "End time",
                            type: "time",
                            value: "18:00",
                            required: true,
                          },
                          {
                            key: "break_minutes",
                            th: "พัก (นาที)",
                            en: "Break minutes",
                            type: "number",
                            value: 60,
                          },
                        ],
                        "schedules",
                        (v) => ({
                          code: v.code,
                          name: v.name,
                          days: Array.from({ length: 7 }, (_, i) => ({
                            weekday: i + 1,
                            is_workday: i < 5 ? 1 : 0,
                            start_time: v.start,
                            end_time: v.end,
                            break_minutes: Number(v.break_minutes),
                          })),
                        }),
                      )
                    }
                  >
                    {t("สร้างกะงาน", "Create schedule")}
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      openForm(
                        t("สร้างนโยบายลา", "Create leave policy"),
                        [
                          {
                            key: "leave_type_id",
                            th: "ประเภทลา",
                            en: "Leave type",
                            type: "select",
                            options: (lookups.leave_types || []).map(
                              (x: Row) => ({ value: x.id, label: x.name_th }),
                            ),
                          },
                          {
                            key: "name",
                            th: "ชื่อนโยบาย",
                            en: "Policy name",
                            required: true,
                          },
                          {
                            key: "annual_entitlement_minutes",
                            th: "สิทธิ์ต่อปี (นาที)",
                            en: "Annual entitlement (minutes)",
                            type: "number",
                            required: true,
                          },
                          {
                            key: "minimum_service_days",
                            th: "อายุงานขั้นต่ำ (วัน)",
                            en: "Minimum service days",
                            type: "number",
                            value: 0,
                          },
                          {
                            key: "accrual_method",
                            th: "วิธีสะสม",
                            en: "Accrual method",
                            type: "select",
                            options: ["ANNUAL", "MONTHLY", "DAILY", "NONE"].map(
                              (value) => ({ value, label: value }),
                            ),
                          },
                          {
                            key: "effective_from",
                            th: "วันที่มีผล",
                            en: "Effective from",
                            type: "date",
                            required: true,
                          },
                        ],
                        "leave-policies",
                      )
                    }
                  >
                    {t("นโยบายลา", "Leave policy")}
                  </button>
                </div>
              )}
              {can("company.manage") && (
                <button
                  className="btn"
                  onClick={() =>
                    openForm(
                      t("แก้ไขบริษัท", "Edit company"),
                      [
                        {
                          key: "display_name",
                          th: "ชื่อแสดงผล",
                          en: "Display name",
                          required: true,
                        },
                        {
                          key: "legal_name",
                          th: "ชื่อนิติบุคคล",
                          en: "Legal name",
                          required: true,
                        },
                        {
                          key: "timezone",
                          th: "เขตเวลา",
                          en: "Timezone",
                          required: true,
                        },
                        {
                          key: "locale",
                          th: "ภาษา",
                          en: "Locale",
                          type: "select",
                          options: [
                            { value: "th-TH", label: "ไทย" },
                            { value: "en-US", label: "English" },
                          ],
                        },
                      ],
                      "company",
                      (v) => v,
                      "PUT",
                      data,
                    )
                  }
                >
                  {t("แก้ไข", "Edit")}
                </button>
              )}
            </div>
          ) : (
            table(
              data.items || [],
              sub === "transfers"
                ? [
                    {
                      label: t("ประเภท", "Type"),
                      render: (r) => r.transfer_type,
                    },
                    {
                      label: t("วันที่มีผล", "Effective date"),
                      render: (r) => r.effective_date,
                    },
                    { label: t("เหตุผล", "Reason"), render: (r) => r.reason },
                    {
                      label: t("สถานะ", "Status"),
                      render: (r) => <Badge value={r.status} />,
                    },
                  ]
                : [
                    {
                      label: t("รหัส", "Code"),
                      render: (r) => r.code || r.holiday_date,
                    },
                    {
                      label: t("ชื่อ", "Name"),
                      render: (r) => r.name_th || r.name,
                    },
                    {
                      label: t("ภาษาอังกฤษ", "English"),
                      render: (r) => r.name_en || "—",
                    },
                  ],
              sub === "transfers"
                ? (r) =>
                    r.status === "PENDING" && (
                      <button
                        className="btn"
                        onClick={() =>
                          act(() =>
                            request(
                              url(`transfers/${r.id}/approve`),
                              "POST",
                              {},
                            ),
                          )
                        }
                      >
                        {t("อนุมัติ", "Approve")}
                      </button>
                    )
                : sub === "schedules"
                  ? (r) => (
                      <button
                        className="btn"
                        onClick={() =>
                          openForm(
                            t("กำหนดกะ", "Assign schedule"),
                            [
                              personField,
                              {
                                key: "effective_from",
                                th: "วันที่มีผล",
                                en: "Effective from",
                                type: "date",
                                required: true,
                              },
                            ],
                            `schedules/${r.id}/assign`,
                          )
                        }
                      >
                        {t("กำหนดพนักงาน", "Assign")}
                      </button>
                    )
                  : undefined,
            )
          )}
        </>
      );
    return null;
  }
  if (!me && new URLSearchParams(location.search).has("invite"))
    return <Invitation />;
  if (!me)
    return (
      <main className="min-h-screen grid lg:grid-cols-2">
        <div className="hidden lg:flex flex-col justify-between bg-blue-600 text-white p-14">
          <div className="flex gap-3 items-center font-bold text-2xl">
            <Users size={34} />
            NextHRM
          </div>
          <div>
            <p className="text-blue-200 text-sm uppercase tracking-widest mb-6">
              People. Work. Together.
            </p>
            <h1 className="text-5xl leading-tight font-bold">
              {t("ทุกคน ทุกบริษัท", "Every person.")}
              <br />
              {t("ในพื้นที่เดียว", "One workspace.")}
            </h1>
            <p className="text-blue-100 max-w-md mt-6 leading-relaxed">
              {t(
                "ดูแลพนักงาน เชื่อมเวลาทำงาน การลา และค่าตอบแทน พร้อมการตรวจสอบที่ชัดเจน",
                "Bring your people, attendance, leave and payroll together with clarity and accountability.",
              )}
            </p>
            <div className="grid grid-cols-3 gap-4 mt-12">
              {[Users, CalendarDays, Wallet].map((Icon, i) => (
                <div
                  key={i}
                  className="border border-blue-400/50 rounded-xl p-5"
                >
                  <Icon size={28} />
                  <p className="text-sm mt-3">
                    {
                      [
                        t("บุคลากร", "People"),
                        t("เวลาและการลา", "Time & leave"),
                        t("ค่าตอบแทน", "Payroll"),
                      ][i]
                    }
                  </p>
                </div>
              ))}
            </div>
          </div>
          <p className="text-blue-200 text-xs">
            NextHRM · Multi-company workspace
          </p>
        </div>
        <div className="flex items-center justify-center p-6">
          <div className="w-full max-w-sm">
            <div className="flex justify-between items-center mb-10">
              <div className="flex gap-2 items-center font-bold text-blue-600 text-xl">
                <Users />
                NextHRM
              </div>
              <button
                className="btn"
                onClick={() => setLang(lang === "th" ? "en" : "th")}
              >
                <Globe size={16} />
                {lang === "th" ? "EN" : "ไทย"}
              </button>
            </div>
            <span className="page-number">10000</span>
            <h2 className="text-3xl font-bold mb-3">
              {t("ยินดีต้อนรับกลับ", "Welcome back")}
            </h2>
            <p className="muted mb-8">
              {t("เข้าสู่พื้นที่ทำงานของคุณ", "Sign in to your workspace")}
            </p>
            <form
              className="space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setLoginError("");
                const f = new FormData(e.currentTarget);
                try {
                  await request(
                    "/api/auth/login",
                    "POST",
                    Object.fromEntries(f),
                  );
                  await identify();
                } catch (e) {
                  setLoginError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div>
                <label htmlFor="tenant_code">
                  {t("รหัส Workspace", "Workspace code")}
                </label>
                <input
                  name="tenant_code"
                  id="tenant_code"
                  required
                  autoComplete="organization"
                  placeholder="demo"
                />
              </div>
              <div>
                <label htmlFor="email">{t("อีเมล", "Email")}</label>
                <input
                  name="email"
                  id="email"
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label htmlFor="password">{t("รหัสผ่าน", "Password")}</label>
                <input
                  name="password"
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>
              {loginError && (
                <p role="alert" className="text-rose-600">
                  {loginError}
                </p>
              )}
              <button disabled={busy} className="btn btn-primary w-full">
                {busy ? <RefreshCw size={17} className="animate-spin" /> : null}
                {t("เข้าสู่ระบบ", "Sign in")}
                <ArrowUpRight size={17} />
              </button>
            </form>
            <p className="muted text-xs mt-8">
              {t(
                "ติดต่อผู้ดูแล Workspace หากบัญชีถูกล็อก",
                "Contact your workspace administrator if your account is locked.",
              )}
            </p>
          </div>
        </div>
      </main>
    );
  const visible = pages.filter(
      (p) =>
        (!p.permission || can(p.permission)) &&
        (p.key !== "employees" ||
          can("employee.manage") ||
          can("employee.team")) &&
        (p.key !== "settings" || can("company.read")),
    ),
    current = pages.find((p) => p.key === page)!;
  const addVisible =
    (page === "employees" && can("employee.manage")) ||
    (page === "attendance" && can("attendance.manage")) ||
    page === "leave" ||
    (page === "payroll" && can("payroll.prepare")) ||
    (page === "announcements" && can("announcement.manage")) ||
    (page === "users" && can("user.manage")) ||
    (page === "settings" &&
      sub !== "company" &&
      sub !== "schedules" &&
      sub !== "transfers" &&
      can("company.manage"));
  return (
    <div className="min-h-screen">
      <aside className="hidden md:flex fixed inset-y-0 w-60 bg-white border-r border-slate-200 flex-col z-30">
        <div className="px-6 h-20 flex items-center gap-3 text-blue-600">
          <Users size={30} />
          <b className="text-xl tracking-tight">NextHRM</b>
        </div>
        <div className="px-4 mb-5">
          <label className="text-[10px] tracking-widest uppercase muted">
            Workspace / Company
          </label>
          <input
            className="mb-2"
            aria-label="Find company"
            placeholder={t("ค้นหาบริษัท", "Find company")}
            value={companySearch}
            onChange={(e) => setCompanySearch(e.target.value)}
          />
          <button
            className="btn w-full mb-2 text-xs"
            onClick={() =>
              act(async () => {
                const next = pinned.includes(company)
                  ? pinned.filter((x) => x !== company)
                  : [...pinned, company];
                await request("/api/preferences", "POST", {
                  company_id: company,
                  language: lang,
                  theme: dark ? "DARK" : "LIGHT",
                  pinned: next,
                });
                setPinned(next);
              })
            }
          >
            {pinned.includes(company) ? "★" : "☆"}{" "}
            {t("ปักหมุด / ตั้งค่าเริ่มต้น", "Pin / set default")}
          </button>
          <select
            aria-label="Company"
            value={company}
            onChange={(e) => {
              if (
                form &&
                !window.confirm(
                  t("ยกเลิกข้อมูลที่ยังไม่บันทึก?", "Discard unsaved changes?"),
                )
              )
                return;
              generation.current++;
              setForm(null);
              setDetail(null);
              setData({});
              setEmployees([]);
              setNotifications({ items: [], unread: 0 });
              setCompany(e.target.value);
              setPage("dashboard");
            }}
          >
            {me.companies
              .filter(
                (co: Row) =>
                  co.display_name
                    .toLowerCase()
                    .includes(companySearch.toLowerCase()) || co.id === company,
              )
              .sort(
                (a: Row, b: Row) =>
                  Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)),
              )
              .map((co: Row) => (
                <option value={co.id} key={co.id}>
                  {co.display_name}
                </option>
              ))}
          </select>
        </div>
        <nav className="px-3 space-y-1 flex-1 overflow-auto">
          {visible.map((p) => (
            <button
              key={p.key}
              onClick={() => navigate(p.key)}
              className={`w-full flex gap-3 items-center px-4 py-3 rounded-lg text-left ${page === p.key ? "bg-blue-50 text-blue-600 font-bold" : "muted hover:bg-slate-50"}`}
            >
              <p.icon size={19} />
              {t(p.th, p.en)}
            </button>
          ))}
        </nav>
        <div className="m-4 pt-4 border-t border-slate-200">
          <p className="text-xs muted mb-3">{me.user.email}</p>
          <button
            className="flex gap-3 items-center muted"
            onClick={() =>
              act(async () => {
                await request("/api/auth/logout", "POST", {});
                setMe(null);
              })
            }
          >
            <LogOut size={18} />
            {t("ออกจากระบบ", "Sign out")}
          </button>
        </div>
      </aside>
      <div className="md:ml-60">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-5 lg:px-8 sticky top-0 z-20">
          <div className="hidden md:flex items-center text-sm muted gap-2">
            <Building2 size={17} />
            {activeCompany?.display_name}
            <ChevronRight size={14} />
            <span className="text-slate-900 font-medium">
              {t(current.th, current.en)}
            </span>
          </div>
          <select
            className="md:hidden max-w-44"
            aria-label="Company"
            value={company}
            onChange={(e) => {
              if (
                form &&
                !window.confirm(
                  t("ยกเลิกข้อมูลที่ยังไม่บันทึก?", "Discard unsaved changes?"),
                )
              )
                return;
              setCompany(e.target.value);
              setPage("dashboard");
              setDetail(null);
              setForm(null);
            }}
          >
            {me.companies.map((co: Row) => (
              <option key={co.id} value={co.id}>
                {co.display_name}
              </option>
            ))}
          </select>
          <div className="flex gap-1 sm:gap-3 items-center">
            <button
              className="p-3 rounded-lg hover:bg-slate-50"
              aria-label="Language"
              onClick={() => setLang(lang === "th" ? "en" : "th")}
            >
              <span className="text-xs font-semibold">
                {lang === "th" ? "EN" : "ไทย"}
              </span>
            </button>
            <button
              className="p-3 rounded-lg hover:bg-slate-50"
              aria-label="Toggle dark mode"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              aria-label="Notifications"
              className="relative p-3 rounded-lg hover:bg-slate-50"
              onClick={() => setShowBell(!showBell)}
            >
              <Bell size={20} />
              {notifications.unread > 0 && (
                <span className="absolute right-1 top-1 bg-rose-500 text-white rounded-full min-w-4 text-[10px] px-1">
                  {notifications.unread}
                </span>
              )}
            </button>
            <div className="hidden sm:flex items-center gap-3 pl-4 border-l border-slate-200">
              <span className="rounded-full w-9 h-9 bg-blue-50 text-blue-600 inline-flex justify-center items-center font-bold">
                {me.user.display_name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <p className="text-sm font-semibold">{me.user.display_name}</p>
                <p className="text-xs muted">
                  {t("พื้นที่ทำงาน HR", "HR workspace")}
                </p>
              </div>
            </div>
          </div>
          {showBell && (
            <div className="absolute right-3 top-18 w-[min(380px,95vw)] card shadow-xl max-h-[70dvh] overflow-auto p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-bold">
                  {t("การแจ้งเตือน", "Notifications")}
                </h2>
                <button
                  aria-label="Close notifications"
                  onClick={() => setShowBell(false)}
                >
                  <X size={17} />
                </button>
              </div>
              {notifications.items.map((n: Row) => (
                <button
                  key={n.id}
                  className={`w-full text-left p-3 border-b border-slate-100 ${!n.read_at ? "bg-blue-50 text-blue-800" : ""}`}
                  onClick={async () => {
                    setShowBell(false);
                    if (n.source_type === "announcement") {
                      navigate("announcements");
                      const list = await request(
                        url("announcements?limit=100"),
                      );
                      const ann = list.items.find(
                        (a: Row) => a.id === n.source_id,
                      );
                      if (ann) openDetail("announcement", ann);
                    } else {
                      await act(() =>
                        request(url(`notifications/${n.id}/read`), "POST", {}),
                      );
                      navigate("leave");
                    }
                  }}
                >
                  <p className="font-medium">{n.title}</p>
                  <p className="text-xs muted mt-1">{datetime(n.created_at)}</p>
                </button>
              ))}
              {!notifications.items.length && (
                <p className="muted p-4">
                  {t("ไม่มีการแจ้งเตือน", "No notifications")}
                </p>
              )}
            </div>
          )}
        </header>
        <main className="p-5 lg:p-8 pb-28 md:pb-8 max-w-[1600px] mx-auto">
          <div className="flex justify-between items-start gap-4 mb-7">
            <div>
              <span className="page-number">{current.id}</span>
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
                {t(current.th, current.en)}
              </h1>
              <p className="muted text-sm mt-2">
                {t(
                  "จัดการงานและข้อมูลของบริษัท",
                  "Manage your company’s people and work",
                )}{" "}
                · {activeCompany?.display_name}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {["employees", "attendance", "payroll", "audit"].includes(page) &&
                can("export.create") && (
                  <button className="btn" onClick={exportData}>
                    <Download size={16} />
                    <span className="hidden sm:inline">
                      {t("ส่งออก", "Export")}
                    </span>
                  </button>
                )}
              {addVisible && (
                <button className="btn btn-primary" onClick={add}>
                  <Plus size={17} />
                  {page === "leave"
                    ? t("ขอลา", "Request leave")
                    : t("เพิ่ม", "Add")}
                </button>
              )}
            </div>
          </div>
          {["employees", "audit"].includes(page) && (
            <div className="page-search mb-5 relative max-w-md">
              <Search
                className="absolute left-3 top-3 text-slate-400"
                size={18}
              />
              <input
                aria-label="Search"
                className="pl-10"
                placeholder={t("ค้นหาข้อมูล…", "Search records…")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOffset(0);
                }}
              />
            </div>
          )}
          {error ? (
            <div className="card p-8">
              <AlertCircle className="text-rose-500 mb-4" />
              <p role="alert">{error}</p>
              <button className="btn mt-4" onClick={load}>
                <RefreshCw size={16} />
                {t("ลองอีกครั้ง", "Retry")}
              </button>
            </div>
          ) : busy ? (
            <div
              className="card p-12 flex gap-3 justify-center items-center muted"
              role="status"
            >
              <RefreshCw className="animate-spin" size={20} />
              {t("กำลังโหลด…", "Loading…")}
            </div>
          ) : (
            content()
          )}
        </main>
      </div>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30 flex justify-around pb-[env(safe-area-inset-bottom)]">
        {visible
          .filter((p) =>
            ["dashboard", "employees", "attendance", "leave"].includes(p.key),
          )
          .map((p) => (
            <button
              key={p.key}
              onClick={() => navigate(p.key)}
              className={`flex flex-col items-center justify-center min-w-14 h-17 text-[10px] gap-1 ${page === p.key ? "text-blue-600 font-bold" : "muted"}`}
            >
              <p.icon size={21} />
              {t(p.th, p.en)}
            </button>
          ))}
        <button
          onClick={() => setMore(!more)}
          className="flex flex-col items-center justify-center h-17 min-w-14 text-[10px] muted gap-1"
        >
          <MoreHorizontal size={21} />
          {t("เพิ่มเติม", "More")}
        </button>
      </nav>
      {more && (
        <div className="md:hidden fixed inset-x-0 bottom-17 z-30 card mx-3 p-3 shadow-xl">
          <div className="grid grid-cols-2 gap-2">
            {visible
              .filter(
                (p) =>
                  !["dashboard", "employees", "attendance", "leave"].includes(
                    p.key,
                  ),
              )
              .map((p) => (
                <button
                  key={p.key}
                  className="btn justify-start"
                  onClick={() => navigate(p.key)}
                >
                  <p.icon size={18} />
                  {t(p.th, p.en)}
                </button>
              ))}
          </div>
          <button
            className="btn w-full mt-3"
            onClick={() =>
              act(async () => {
                await request("/api/auth/logout", "POST", {});
                setMe(null);
              })
            }
          >
            <LogOut size={17} />
            {t("ออกจากระบบ", "Sign out")}
          </button>
        </div>
      )}
      {toast && (
        <div
          className="toast fixed top-4 left-1/2 -translate-x-1/2 z-[80] bg-slate-900 text-white shadow-xl rounded-lg px-5 py-3 max-w-[90vw]"
          role="status"
        >
          {toast}
        </div>
      )}
      {form && (
        <FormModal
          key={form.id + form.title}
          form={form}
          close={() => setForm(null)}
          lang={lang}
          onError={() => {}}
          onDone={(result) => {
            notify(t("บันทึกสำเร็จ", "Saved"));
            load();
            if (result?.invitation_token) {
              setDetailKind("invitation");
              setDetail(result);
            } else setDetail(null);
          }}
        />
      )}
      {detail && (
        <div
          className="fixed inset-0 bg-slate-950/40 z-40 flex justify-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
            className="sheet bg-white w-full md:max-w-4xl md:h-screen md:max-h-screen shadow-xl printable"
            onKeyDown={(e) => {
              if (e.key === "Escape") setDetail(null);
            }}
          >
            <div className="sticky top-0 p-5 flex justify-between items-center border-b border-slate-200 bg-white z-10">
              <div>
                <span className="page-number">
                  {
                    (
                      {
                        employee: "30001",
                        payroll: "30002",
                        announcement: "30003",
                        payslip: "30004",
                        audit: "30005",
                        leave: "30006",
                        balances: "30007",
                        permissions: "30008",
                        overtime: "30009",
                        "attendance-requests": "30010",
                      } as Row
                    )[detailKind]
                  }
                </span>
                <h2 id="detail-title" className="text-xl font-bold">
                  {detail.name ||
                    detail.title ||
                    detail.display_name ||
                    t("รายละเอียด", "Details")}
                </h2>
              </div>
              <button
                className="btn"
                aria-label="Close detail"
                onClick={() => setDetail(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {detailKind === "employee" && (
                <>
                  <div className="flex items-center justify-between">
                    {name(detail)}
                    <Badge value={detail.employment_status} />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button className="btn" onClick={() => window.print()}>
                      <Printer size={16} />
                      {t("พิมพ์ประวัติ", "Print profile")}
                    </button>
                    {can("employee.manage") && (
                      <>
                        <button
                          className="btn"
                          onClick={() => employeeForm(detail)}
                        >
                          {t("แก้ไข", "Edit")}
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            openForm(
                              t(
                                "ย้ายพนักงานข้ามบริษัท",
                                "Intercompany transfer",
                              ),
                              [
                                {
                                  key: "destination_company_id",
                                  th: "บริษัทปลายทาง",
                                  en: "Destination",
                                  type: "select",
                                  options: me.companies
                                    .filter((co: Row) => co.id !== company)
                                    .map((co: Row) => ({
                                      value: co.id,
                                      label: co.display_name,
                                    })),
                                },
                                {
                                  key: "employee_no",
                                  th: "รหัสพนักงานใหม่",
                                  en: "New employee number",
                                  required: true,
                                },
                                {
                                  key: "effective_date",
                                  th: "วันที่มีผล",
                                  en: "Effective date",
                                  type: "date",
                                  required: true,
                                },
                                {
                                  key: "transfer_type",
                                  th: "ประเภท",
                                  en: "Transfer type",
                                  type: "select",
                                  options: [
                                    "TRANSFER",
                                    "SECONDMENT",
                                    "DUAL_EMPLOYMENT",
                                  ].map((value) => ({ value, label: value })),
                                },
                                {
                                  key: "salary",
                                  th: "ค่าตอบแทน (บาท)",
                                  en: "Compensation (THB)",
                                  type: "number",
                                  required: true,
                                },
                                {
                                  key: "reason",
                                  th: "เหตุผล",
                                  en: "Reason",
                                  required: true,
                                },
                              ],
                              "transfers",
                              (v) => {
                                const b: Row = {
                                  ...v,
                                  employee_id: detail.id,
                                  salary_satang: Math.round(v.salary * 100),
                                };
                                delete b.salary;
                                return b;
                              },
                            )
                          }
                        >
                          <ArrowLeftRight size={15} />
                          {t("ย้ายบริษัท", "Transfer")}
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() =>
                            openForm(
                              t(
                                "ยืนยันการเก็บพนักงานเข้าคลัง",
                                "Confirm employee archival",
                              ),
                              [
                                {
                                  key: "reason",
                                  th: "เหตุผล (ต้องยุติการจ้างก่อน)",
                                  en: "Reason (terminate employment first)",
                                  required: true,
                                },
                              ],
                              `employees/${detail.id}`,
                              (v) => v,
                              "DELETE",
                              undefined,
                              "20011",
                            )
                          }
                        >
                          <Trash2 size={15} />
                          delete
                        </button>
                      </>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-5">
                    {[
                      ["Employee no.", detail.employee_no],
                      [
                        "Name",
                        `${detail.first_name_th} ${detail.last_name_th}`,
                      ],
                      ["Hire date", detail.hire_date],
                      ["Phone", detail.mobile_phone],
                      ["Email", detail.personal_email],
                      ["National ID", detail.national_id],
                      ["Passport", detail.passport_no],
                      ["Employment type", detail.employment_type],
                      ["Termination date", detail.termination_date],
                      ["Termination reason", detail.termination_reason],
                    ].map(([l, v]) => (
                      <div key={l}>
                        <p className="text-xs muted mb-1">{l}</p>
                        <p>{v || "—"}</p>
                      </div>
                    ))}
                  </div>
                  <h3 className="font-bold">
                    {t(
                      "ที่อยู่และผู้ติดต่อฉุกเฉิน",
                      "Address & emergency contacts",
                    )}
                  </h3>
                  {detail.addresses?.map((x: Row) => (
                    <p key={x.id}>{x.address_line1}</p>
                  ))}
                  {detail.emergency_contacts?.map((x: Row) => (
                    <p key={x.id}>
                      {x.full_name} · {x.phone} · {x.relationship}
                    </p>
                  ))}
                  <h3 className="font-bold">
                    {t("บัญชีธนาคาร", "Bank accounts")}
                  </h3>
                  {can("employee.manage") && (
                    <button
                      className="btn"
                      onClick={() =>
                        openForm(
                          t(
                            "ตั้งค่าภาษีและประกันสังคม",
                            "Tax & social security profile",
                          ),
                          [
                            {
                              key: "tax_method",
                              th: "วิธีภาษี",
                              en: "Tax method",
                              type: "select",
                              options: ["PROGRESSIVE", "FIXED", "EXEMPT"].map(
                                (value) => ({ value, label: value }),
                              ),
                            },
                            {
                              key: "fixed_tax_rate_basis_points",
                              th: "อัตราคงที่ (100 = 1%)",
                              en: "Fixed rate (100 = 1%)",
                              type: "number",
                              value: 0,
                            },
                            {
                              key: "contribution_enabled",
                              th: "ประกันสังคม",
                              en: "Social security",
                              type: "select",
                              options: [
                                { value: "1", label: t("เปิด", "Enabled") },
                                { value: "0", label: t("ปิด", "Disabled") },
                              ],
                            },
                            {
                              key: "effective_from",
                              th: "วันที่มีผล",
                              en: "Effective from",
                              type: "date",
                              value: day(),
                              required: true,
                            },
                            {
                              key: "reason",
                              th: "เหตุผล",
                              en: "Reason",
                              required: true,
                            },
                          ],
                          `employees/${detail.id}/payroll-profile`,
                          (v) => ({
                            ...v,
                            contribution_enabled: Number(
                              v.contribution_enabled,
                            ),
                          }),
                          "PUT",
                        )
                      }
                    >
                      {t(
                        "ตั้งค่าภาษี / ประกันสังคม",
                        "Configure tax / social security",
                      )}
                    </button>
                  )}
                  {detail.bank_accounts?.map((x: Row) => (
                    <p key={x.id}>
                      {x.bank_code} · ••••{x.account_number_last4} ·{" "}
                      {x.verified_at
                        ? t("ยืนยันแล้ว", "Verified")
                        : t("ยังไม่ยืนยัน", "Unverified")}
                    </p>
                  ))}
                  <h3 className="font-bold">
                    {t("ประวัติการจ้างงาน", "Employment history")}
                  </h3>
                  {detail.employment_history?.map((x: Row) => (
                    <div key={x.id} className="card p-4">
                      <b>{x.event_type}</b>
                      <p className="muted text-xs">
                        {x.effective_from} —{" "}
                        {x.effective_to || t("ปัจจุบัน", "Current")}
                      </p>
                      <p className="mt-2">{x.reason}</p>
                    </div>
                  ))}
                  <h3 className="font-bold">
                    {t("ประวัติค่าตอบแทน", "Compensation history")}
                  </h3>
                  {detail.compensation_history?.map((x: Row) => (
                    <div key={x.id} className="card p-4 flex justify-between">
                      <div>
                        <b>{money(x.base_salary_satang)}</b>
                        <p className="muted text-xs">
                          {x.pay_type} · {x.effective_from} —{" "}
                          {x.effective_to || "Current"}
                        </p>
                      </div>
                      <p>{x.reason}</p>
                    </div>
                  ))}
                  <h3 className="font-bold">
                    {t("ประสบการณ์ทำงาน", "Work experience")}
                  </h3>
                  {detail.work_experiences?.map((x: Row) => (
                    <p key={x.id}>
                      {x.company_name} · {x.position_name} · {x.started_on} —{" "}
                      {x.ended_on || "Current"}
                    </p>
                  ))}
                  <h3 className="font-bold">
                    {t("คำขอเปลี่ยนข้อมูล", "Profile change requests")}
                  </h3>
                  {detail.profile_requests?.map((x: Row) => (
                    <div className="card p-4" key={x.id}>
                      <p>
                        {x.request_type} · {x.reason}
                      </p>
                      <Badge value={x.status} />
                      {x.status === "PENDING" && can("employee.manage") && (
                        <div className="flex gap-2 mt-3">
                          <button
                            className="btn"
                            onClick={() =>
                              decision(
                                `profile-requests/${x.id}/decision`,
                                "APPROVED",
                              )
                            }
                          >
                            {t("อนุมัติ", "Approve")}
                          </button>
                          <button
                            className="btn"
                            onClick={() =>
                              decision(
                                `profile-requests/${x.id}/decision`,
                                "REJECTED",
                              )
                            }
                          >
                            {t("ปฏิเสธ", "Reject")}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="no-print">
                    <label>
                      {t(
                        "แนบเอกสาร (PDF / รูปภาพ / text, ไม่เกิน 5 MB)",
                        "Attach document (PDF / image / text, max 5 MB)",
                      )}
                    </label>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.txt"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const body = new FormData();
                          body.append("file", file);
                          act(() =>
                            request(
                              url(`employees/${detail.id}/files`),
                              "POST",
                              body,
                            ),
                          );
                        }
                      }}
                    />
                    <button
                      className="btn mt-3"
                      onClick={() =>
                        act(async () => {
                          const files = await request(
                            url(`employees/${detail.id}/files`),
                          );
                          setDetail({ ...detail, files: files.items });
                        })
                      }
                    >
                      {t("ดูเอกสาร", "Show documents")}
                    </button>
                    {detail.files?.map((f: Row) => (
                      <a
                        key={f.id}
                        className="btn mt-2 ml-2"
                        href={url(`files/${f.id}`)}
                      >
                        {f.file_name}
                        <Download size={15} />
                      </a>
                    ))}
                  </div>
                </>
              )}
              {detailKind === "payroll" && (
                <>
                  <div className="flex flex-wrap gap-3">
                    <Badge value={detail.status} />
                    <span className="self-center muted">
                      {detail.period_start} — {detail.period_end}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["DRAFT", "REVIEW"].includes(detail.status) && (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={() =>
                            act(async () => {
                              await request(
                                url(`payroll/${detail.id}/calculate`),
                                "POST",
                                {},
                                { "Idempotency-Key": crypto.randomUUID() },
                              );
                              setDetail(
                                await request(url(`payroll/${detail.id}`)),
                              );
                            })
                          }
                        >
                          <RefreshCw size={16} />
                          {t("คำนวณ / คำนวณใหม่", "Calculate / recalculate")}
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            openForm(
                              t("ปรับเพิ่ม / หัก", "Manual adjustment"),
                              [
                                personField,
                                {
                                  key: "item_type",
                                  th: "ประเภท",
                                  en: "Type",
                                  type: "select",
                                  options: [
                                    { value: "EARNING", label: "EARNING" },
                                    { value: "DEDUCTION", label: "DEDUCTION" },
                                  ],
                                },
                                {
                                  key: "amount",
                                  th: "จำนวน (บาท)",
                                  en: "Amount (THB)",
                                  type: "number",
                                  required: true,
                                },
                                {
                                  key: "description",
                                  th: "รายละเอียด",
                                  en: "Description",
                                  required: true,
                                },
                                {
                                  key: "reason",
                                  th: "เหตุผล",
                                  en: "Reason",
                                  required: true,
                                },
                              ],
                              `payroll/${detail.id}/adjustments`,
                              (v) => {
                                const b: Row = {
                                  ...v,
                                  amount_satang: Math.round(v.amount * 100),
                                };
                                delete b.amount;
                                return b;
                              },
                            )
                          }
                        >
                          {t("ปรับยอด", "Adjustment")}
                        </button>
                      </>
                    )}
                    {detail.status === "REVIEW" && can("payroll.review") && (
                      <button
                        className="btn"
                        onClick={() =>
                          openForm(
                            t("ตรวจสอบและส่งอนุมัติ", "Review & submit"),
                            [
                              {
                                key: "approver_user_id",
                                th: "User ID ผู้อนุมัติ",
                                en: "Approver user ID",
                                required: true,
                              },
                              {
                                key: "comment",
                                th: "ความคิดเห็น",
                                en: "Comment",
                                required: true,
                              },
                            ],
                            `payroll/${detail.id}/submit`,
                          )
                        }
                      >
                        {t("ส่งอนุมัติ", "Submit for approval")}
                      </button>
                    )}
                    {detail.status === "PENDING_APPROVAL" &&
                      can("payroll.approve") && (
                        <button
                          className="btn btn-primary"
                          onClick={() =>
                            openForm(
                              t("อนุมัติรอบเงินเดือน", "Approve payroll"),
                              [
                                {
                                  key: "comment",
                                  th: "ความคิดเห็น",
                                  en: "Comment",
                                  required: true,
                                },
                              ],
                              `payroll/${detail.id}/approve`,
                            )
                          }
                        >
                          {t("อนุมัติ", "Approve")}
                        </button>
                      )}
                    {["APPROVED", "PAID"].includes(detail.status) &&
                      can("payroll.approve") && (
                        <button
                          className="btn"
                          onClick={() =>
                            openForm(
                              t("เปลี่ยนสถานะ", "Change status"),
                              [
                                {
                                  key: "reason",
                                  th: "เหตุผล",
                                  en: "Reason",
                                  required: true,
                                },
                              ],
                              `payroll/${detail.id}/transition`,
                              (v) => ({
                                ...v,
                                status:
                                  detail.status === "APPROVED"
                                    ? "PAID"
                                    : "CLOSED",
                              }),
                            )
                          }
                        >
                          {detail.status === "APPROVED"
                            ? t("บันทึกจ่ายแล้ว", "Mark paid")
                            : t("ปิดรอบ", "Close cycle")}
                        </button>
                      )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      [t("รายได้", "Income"), detail.run?.total_income_satang],
                      [
                        t("หัก", "Deductions"),
                        detail.run?.total_deduction_satang,
                      ],
                      [t("สุทธิ", "Net pay"), detail.run?.total_net_satang],
                    ].map(([l, v]) => (
                      <div className="card p-4" key={l}>
                        <p className="muted text-xs">{l}</p>
                        <b className="text-lg">{money(v)}</b>
                      </div>
                    ))}
                  </div>
                  {detail.run?.blocking_error_count > 0 && (
                    <div className="bg-rose-50 text-rose-700 p-4 rounded-lg flex gap-3">
                      <AlertCircle />
                      {t(
                        "ข้อผิดพลาดที่ต้องแก้ก่อนส่งอนุมัติ",
                        "Blocking errors before approval",
                      )}
                      : {detail.run.blocking_error_count}
                    </div>
                  )}
                  <label>{t("เวอร์ชันการคำนวณ", "Calculation version")}</label>
                  <select
                    value={detail.run?.version_no || ""}
                    onChange={(e) =>
                      request(
                        url(`payroll/${detail.id}?version=${e.target.value}`),
                      ).then(setDetail)
                    }
                  >
                    {detail.runs?.map((r: Row) => (
                      <option key={r.id} value={r.version_no}>
                        V{r.version_no} · {r.status}
                      </option>
                    ))}
                  </select>
                  {table(detail.results || [], [
                    { label: t("พนักงาน", "Employee"), render: name },
                    {
                      label: t("รายได้", "Gross"),
                      render: (r) => money(r.gross_income_satang),
                    },
                    {
                      label: t("ภาษี / ประกันสังคม", "Tax / SS"),
                      render: (r) => (
                        <span className="text-xs">
                          {money(r.tax_satang)} /{" "}
                          {money(r.social_security_satang)}
                        </span>
                      ),
                    },
                    {
                      label: t("สุทธิ", "Net"),
                      render: (r) => money(r.net_pay_satang),
                    },
                    {
                      label: t("ตรวจสอบ", "Review"),
                      render: (r) => <Badge value={r.review_status} />,
                    },
                  ])}
                  {detail.results
                    ?.filter(
                      (r: Row) =>
                        r.review_status === "BLOCKED" ||
                        r.review_status === "WARNING",
                    )
                    .map((r: Row) => (
                      <div key={r.id} className="card p-4">
                        <b>
                          {r.first_name_th} {r.last_name_th}
                        </b>
                        {JSON.parse(r.warning_json).map(
                          (s: string, i: number) => (
                            <p className="text-xs text-rose-600 mt-2" key={i}>
                              {s}
                            </p>
                          ),
                        )}
                      </div>
                    ))}
                  <h3 className="font-bold">
                    {t("ลำดับอนุมัติ", "Approval timeline")}
                  </h3>
                  {detail.approvals?.map((a: Row) => (
                    <div key={a.id} className="flex justify-between">
                      <span>{a.display_name}</span>
                      <Badge value={a.decision} />
                    </div>
                  ))}
                  {detail.history?.map((h: Row) => (
                    <p key={h.id} className="muted text-xs">
                      {h.from_status || "—"} → {h.to_status} ·{" "}
                      {datetime(h.changed_at)}
                    </p>
                  ))}
                </>
              )}
              {detailKind === "announcement" && (
                <>
                  <Badge value={detail.status} />
                  <h2 className="text-2xl font-bold">{detail.title}</h2>
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {detail.body}
                  </p>
                  {detail.requires_acknowledgement === 1 && (
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        act(() =>
                          request(
                            url(`announcements/${detail.id}/read`),
                            "POST",
                            { acknowledge: true },
                          ),
                        )
                      }
                    >
                      <Check size={17} />
                      {t("รับทราบ", "Acknowledge")}
                    </button>
                  )}
                </>
              )}
              {detailKind === "payslip" && (
                <>
                  <div className="flex justify-between">
                    <div>
                      <h3 className="text-2xl font-bold">
                        NextHRM · {t("สลิปเงินเดือน", "Payslip")}
                      </h3>
                      <p className="muted mt-2">
                        {activeCompany?.display_name} · {detail.slip_no}
                      </p>
                    </div>
                    <button className="btn" onClick={() => window.print()}>
                      <Printer size={17} />
                      {t("พิมพ์ / บันทึก PDF", "Print / save PDF")}
                    </button>
                  </div>
                  {name(detail.employee || {})}
                  <div className="card p-5">
                    {detail.items?.map((i: Row) => (
                      <div
                        key={i.id}
                        className="flex justify-between py-3 border-b border-slate-100"
                      >
                        <span>{i.item_name}</span>
                        <b>{money(i.amount_satang)}</b>
                      </div>
                    ))}
                    <div className="flex justify-between pt-5 text-xl text-blue-600 font-bold">
                      <span>{t("สุทธิ", "Net pay")}</span>
                      {money(detail.result?.net_pay_satang)}
                    </div>
                  </div>
                  <h3 className="font-bold">
                    {t("สะสมตั้งแต่ต้นปี", "Year to date")}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      ["Gross income", detail.result?.ytd_gross_income_satang],
                      ["Tax", detail.result?.ytd_tax_satang],
                      [
                        "Social security",
                        detail.result?.ytd_social_security_satang,
                      ],
                      ["Net pay", detail.result?.ytd_net_pay_satang],
                    ].map(([l, v]) => (
                      <div key={l}>
                        <p className="muted text-xs">{l}</p>
                        <b>{money(v)}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {detailKind === "audit" && (
                <>
                  <p>
                    {detail.action} · {detail.object_type}
                  </p>
                  <p className="muted text-xs">
                    Request ID: {detail.request_id}
                  </p>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="font-bold mb-2">Before</h3>
                      <pre className="card p-4 whitespace-pre-wrap break-all text-xs">
                        {JSON.stringify(
                          JSON.parse(detail.before_json || "null"),
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                    <div>
                      <h3 className="font-bold mb-2">After</h3>
                      <pre className="card p-4 whitespace-pre-wrap break-all text-xs">
                        {JSON.stringify(
                          JSON.parse(detail.after_json || "null"),
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  </div>
                </>
              )}
              {detailKind === "leave" && (
                <>
                  {name(detail)}
                  <Badge value={detail.status} />
                  <p>{detail.reason}</p>
                  <p>
                    {detail.start_at.slice(0, 10)} —{" "}
                    {detail.end_at.slice(0, 10)}
                  </p>
                  <button
                    className="btn"
                    onClick={() =>
                      openForm(
                        t("ยกเลิกคำขอลา", "Cancel leave request"),
                        [
                          {
                            key: "reason",
                            th: "เหตุผล",
                            en: "Reason",
                            required: true,
                          },
                        ],
                        `leave/${detail.id}/cancel`,
                      )
                    }
                  >
                    {t("ยกเลิกคำขอ", "Cancel request")}
                  </button>
                  <button
                    className="btn ml-3"
                    onClick={() =>
                      request(url(`leave/${detail.id}/approvals`)).then((v) =>
                        setDetail({ ...detail, approvals: v.items }),
                      )
                    }
                  >
                    {t("ลำดับอนุมัติ", "Approval steps")}
                  </button>
                  {detail.approvals?.map((a: Row) => (
                    <div key={a.id} className="flex justify-between">
                      <p>
                        {a.step_no}. {a.display_name}
                      </p>
                      <Badge value={a.decision} />
                    </div>
                  ))}
                </>
              )}
              {detailKind === "balances" &&
                table(detail.items || [], [
                  { label: t("พนักงาน", "Employee"), render: name },
                  { label: t("ประเภท", "Type"), render: (r) => r.name_th },
                  { label: t("ปี", "Year"), render: (r) => r.balance_year },
                  {
                    label: t("คงเหลือ (วัน)", "Remaining days"),
                    render: (r) => (r.available_minutes / 480).toFixed(2),
                  },
                ])}
              {detailKind === "invitation" && (
                <>
                  <h3 className="font-bold">
                    {t(
                      "ส่ง token นี้ให้ผู้รับคำเชิญ (หมดอายุ 48 ชั่วโมง)",
                      "Share this invitation token privately (expires in 48 hours)",
                    )}
                  </h3>
                  <textarea readOnly value={detail.invitation_token} />
                  <p className="muted">
                    {t(
                      "ผู้รับเปิดหน้ารับคำเชิญเพื่อกำหนดรหัสผ่าน",
                      "Recipient opens the invitation page to set their password",
                    )}
                  </p>
                  <a
                    className="btn"
                    href="/?invite=1"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("หน้ารับคำเชิญ", "Invitation page")}
                  </a>
                </>
              )}
              {detailKind === "permissions" && (
                <>
                  <h3 className="font-bold">Effective permissions</h3>
                  <div className="flex gap-2 flex-wrap">
                    {detail.permissions?.map((p: string) => (
                      <span key={p} className="badge">
                        {p}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {["overtime", "attendance-requests"].includes(detailKind) &&
                table(
                  detail.items || [],
                  [
                    { label: t("พนักงาน", "Employee"), render: name },
                    { label: t("วันที่", "Date"), render: (r) => r.work_date },
                    { label: t("เหตุผล", "Reason"), render: (r) => r.reason },
                    {
                      label: t("สถานะ", "Status"),
                      render: (r) => <Badge value={r.status} />,
                    },
                  ],
                  (r) =>
                    r.status === "PENDING" &&
                    (can("attendance.manage") || can("ot.approve")) ? (
                      <>
                        <button
                          className="btn"
                          onClick={() =>
                            act(() =>
                              request(
                                url(`${detailKind}/${r.id}/decision`),
                                "POST",
                                { decision: "APPROVED" },
                              ),
                            )
                          }
                        >
                          {t("อนุมัติ", "Approve")}
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            act(() =>
                              request(
                                url(`${detailKind}/${r.id}/decision`),
                                "POST",
                                { decision: "REJECTED" },
                              ),
                            )
                          }
                        >
                          {t("ปฏิเสธ", "Reject")}
                        </button>
                      </>
                    ) : null,
                )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
