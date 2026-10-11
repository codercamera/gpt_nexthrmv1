# NextHRM

ระบบ HRM จาก **HRM System Design Version 3** ใช้ React 19 + Tailwind 4 + Bun + Hono + SQLite พร้อม TypeScript ทั้ง Frontend/Backend

Source specification: https://app.notion.com/p/HRM-System-Design-Version-3-3f2f08f523368197a053fb8f4c606a22

อ่านขอบเขตที่ทำแล้วและข้อจำกัดอย่างละเอียดใน [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) ก่อนนำไปใช้จริง ระบบนี้เป็น implementation สำหรับตรวจรับและทดสอบ ยังไม่ใช่ payroll engine ที่ผ่านการรับรองเพื่อจ่ายเงินจริง

## เริ่มใช้งาน

ติดตั้ง **Bun 1.3.10** แล้วรัน:

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run db:migrate
SEED_PASSWORD='your-test-password-12-plus' bun run db:seed
bun run build
bun start
```

เปิด http://localhost:3000 — **Bun/Hono ให้บริการทั้ง API และ React ใน process เดียว** ไม่ต้องเปิด Vite สำหรับ production

Windows PowerShell ตั้งรหัส seed ด้วย `$env:SEED_PASSWORD='your-test-password-12-plus'` แล้ว `bun run db:seed`

Workspace code: `demo`

| Email | Role |
|---|---|
| admin@test.com | Tenant admin, 2 companies |
| hr@test.com | HR / Payroll preparer |
| reviewer@test.com | Company admin / reviewer |
| approver@test.com | Company admin / approver |
| manager@test.com | Department manager |
| employee@test.com | Employee self-service |

รหัสผ่านทั้งหมดคือค่าที่กำหนดใน `SEED_PASSWORD` ไม่สร้างบัญชีอัตโนมัติเมื่อเริ่ม server และไม่ฝังรหัสผ่านไว้ใน application

Demo data ระบุ tax exemption และปิด social security เพื่อทดสอบ workflow เท่านั้น ต้องตั้งข้อมูลภาษี ประกันสังคม กะ และสิทธิ์การลาตามบริษัทจริงก่อนใช้งาน

## พัฒนา

```bash
bun run dev
# อีก terminal สำหรับ HMR เท่านั้น
bun run dev:ui
```

## ทดสอบ

```bash
bun test tests/system.test.ts
bun run build
bunx playwright install --with-deps chromium
# browser tests ต้องใช้ demo seed ที่รหัสผ่าน test123456789 เท่านั้น ใน DB ทดสอบ
DATABASE_PATH=./data/e2e.sqlite SEED_PASSWORD=test123456789 bun run db:seed
DATABASE_PATH=./data/e2e.sqlite bun run test:e2e
```

Browser tests จะเริ่ม server เองหากไม่มี server ทดสอบเปิดอยู่ ใช้ database แยกจาก production และห้ามรันทดสอบ browser บนข้อมูลจริง

`CHROMIUM_EXECUTABLE` รองรับ Chromium ที่ติดตั้งภายนอกเมื่อ environment ดาวน์โหลด Playwright browser ไม่ได้

GitHub Actions ทดสอบ build, integration/security, และ browser flows บนทุก push / pull request

## Production / Docker

ตั้งค่าต่อไปนี้:

- `NODE_ENV=production`
- `APP_ORIGIN=https://your-hrm-domain.example` (ต้องตรงกับ origin จริง)
- `DATA_ENCRYPTION_KEY` เป็น random 32 bytes hexadecimal; เก็บ key นอกฐานข้อมูลและสำรองแยกกัน
- `DATABASE_PATH` และ `FILE_STORAGE_PATH` อยู่บน persistent volume เดียวกับ instance

```bash
bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker build -t nexthrm .
docker run --env-file .env -e NODE_ENV=production -p 3000:3000 -v nexthrm-data:/data nexthrm
```

ใช้ **หนึ่ง instance** สำหรับ SQLite และ WebSocket ในรุ่นนี้ หากต้องการหลาย replica ต้องออกแบบ distributed event bus และ shared storage ก่อน

Demo seed ต้องรันโดยผู้ดูแลอย่างชัดเจนเท่านั้น สำหรับ production ใหม่ให้ใช้ seed เฉพาะ environment สำหรับตรวจรับ หรือเตรียม tenant/admin bootstrap ที่แยกจาก demo

## ฐานข้อมูล / สำรอง

- Schema ต้นฉบับ 67 ตารางอยู่ใน `docs/NOTION-SCHEMA-ORIGINAL.sql`
- Baseline ใน `migrations/003_multi_company_schema.sql` ปรับ `employees.user_id` ให้ไม่ UNIQUE เพื่อรองรับบุคคลเดียวทำงานหลายบริษัท
- Migration `004_runtime.sql` เพิ่ม idempotency, export download history, attendance correction requests และ immutable triggers
- เปิด foreign keys, WAL, busy timeout ทุก connection; การเขียนหลายตารางใช้ immediate transaction
- เงินเก็บสตางค์, วันใช้ YYYY-MM-DD, timestamp ที่ application เขียนใช้ ISO UTC

```bash
bun run db:backup ./data/backups/hrm-before-release.sqlite
```

แผนกู้คืน: หยุด server, สำรอง DB ปัจจุบัน, ตรวจ `PRAGMA integrity_check` / `foreign_key_check` ของ backup, แทนที่ DB ด้วย backup, กู้ encryption key และไฟล์แนบรุ่นเดียวกัน, แล้วเริ่ม application version เดิม ตรวจสิทธิ์และยอดเงินหลัง restore ไม่ใช้ down migration ลบข้อมูลทางการเงิน

ดู [docs/OPERATIONS.md](docs/OPERATIONS.md) และ [docs/TEST-REPORT.md](docs/TEST-REPORT.md)
