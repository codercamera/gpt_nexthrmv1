# Operations

## Storage and keys

SQLite WAL และไฟล์แนบต้องอยู่บน persistent disk. Server ไม่เรียก demo seed อัตโนมัติ. Development encryption key สร้างครั้งเดียวใน `data/development.key`; production ต้องมี `DATA_ENCRYPTION_KEY`.

สำรอง SQLite ด้วย VACUUM INTO ผ่าน `bun run db:backup`, สำรอง encrypted attachments และ encryption key แยกจากไฟล์ฐานข้อมูล. Backup ต้องมี retention policy ที่องค์กรกำหนด. การเปลี่ยน key ต้อง decrypt/re-encrypt โดย migration ที่วางแผนไว้; การเปลี่ยน env key อย่างเดียวทำให้ข้อมูลเดิมอ่านไม่ได้.

## Restore / rollback

1. หยุด instance และ background jobs
2. เก็บ DB/attachments ปัจจุบันก่อน rollback
3. ตรวจ backup ด้วย `PRAGMA integrity_check` และ `PRAGMA foreign_key_check`
4. Restore DB, attachments, encryption key ที่สอดคล้องกัน
5. เริ่ม release เดิมและทดสอบ login, company access, payroll totals

Automatic tests ตรวจ VACUUM backup → reopen → migration idempotence → integrity → row counts. ไม่ได้จำลอง disaster recovery ของ hosting provider หรือ restore ไฟล์แนบทั้ง volume.

## Payroll controls

บริษัทต้องกำหนด verified statutory settings ที่ `PUT /api/companies/:company/payroll-rules`. ห้ามตั้ง verified โดยไม่ทบทวนสูตรจริง. API รับอัตรา social security, เพดานสะสมรายเดือน, annual tax bands, allowances และ reason และบันทึก audit.

รุ่นนี้คำนวณค่าจ้างรายเดือนตามจำนวนวันปฏิทินจริง (prorate วันเริ่ม/ยุติจ้าง), รายวัน/ชั่วโมงตาม attendance, OT จากอัตราวันหาร 8 ชั่วโมง, unpaid leave หักสัดส่วน 480 นาที, fixed tax และ annualized progressive tax ของ monthly cycle. Progressive withholding ใน daily/weekly/biweekly ถูก BLOCKED เพื่อรอสูตรที่อนุมัติ. ห้ามใช้ demo tax settings กับข้อมูลจริง.

ตัวจัดทำ ผู้ตรวจ และผู้อนุมัติแยก user. Calculation retry ต้องส่ง `Idempotency-Key`. เมื่อ APPROVED สร้างสลิปและล็อกผลคำนวณ. PAID เป็นการบันทึกสถานะโดยผู้มีสิทธิ์ ไม่มีการโอนเงินจริง.

## Security

TLS ต้องทำที่ reverse proxy. Cookie HttpOnly, SameSite Strict, Secure ใน production. Mutation ตรวจ Origin. Sessions อายุ 8 ชั่วโมง, เก็บ hash เท่านั้น, เปลี่ยนรหัสผ่านเพิกถอน sessions.

ไฟล์แนบเข้ารหัส AES-256-GCM, จำกัด 5 MB/type allowlist, ดาวน์โหลดผ่าน permission route เท่านั้น. CSV ป้องกัน formula injection. Audit redacts secrets และใช้ SQLite trigger ป้องกันแก้/ลบ. WebSocket ตรวจ company, tenant, origin และสิทธิ์ซ้ำก่อนส่งทุก event. Health เปิดเผยเฉพาะ status และ quick_check.

Test keys/passwords ใน tests ใช้สำหรับ DB แยกเท่านั้น. อย่าเปิด production ด้วยรหัส test หรือ dev key. Secret management, penetration test, malware scan, key rotation และ retention policy ต้องตรวจตามสภาพแวดล้อมจริงก่อน production.
