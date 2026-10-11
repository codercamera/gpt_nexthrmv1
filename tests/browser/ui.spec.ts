import { test, expect } from "@playwright/test";
async function login(page: any, user = "admin", url = "/") {
  await page.goto(url);
  await page.getByLabel("รหัส Workspace").fill("demo");
  await page.getByLabel("อีเมล", { exact: true }).fill(`${user}@test.com`);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("test123456789");
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "หน้าหลัก", exact: true }),
  ).toBeVisible();
}
test("Vite development UI logs in and connects its proxied WebSocket", async ({
  page,
}) => {
  await login(page, "admin", "http://localhost:5173");
  const connected = await page.evaluate(async () => {
    const me = await (await fetch("/api/me")).json();
    return new Promise<boolean>((resolve) => {
      const ws = new WebSocket(
        `ws://${location.host}/ws?company=${me.companies[0].id}`,
      );
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);
      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });
  });
  expect(connected).toBe(true);
});
test("desktop login, all admin pages, language and dark mode", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  for (const name of [
    "บุคลากร",
    "เวลาทำงาน",
    "การลา",
    "ค่าตอบแทน",
    "ประกาศ",
    "ข้อมูลของฉัน",
    "ตั้งค่า",
    "ผู้ใช้และสิทธิ์",
    "Audit Log",
  ]) {
    await page
      .locator("aside")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "กำลังโหลด" }),
    ).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Audit log", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("create employee using UI persists after reload", async ({ page }) => {
  await login(page);
  await page
    .locator("aside")
    .getByRole("button", { name: "บุคลากร", exact: true })
    .click();
  await page.getByRole("button", { name: "เพิ่ม", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("รหัสพนักงาน").fill(`E2E-${Date.now()}`);
  await modal.getByLabel("ชื่อ", { exact: false }).first().fill("Browser");
  await modal.getByLabel("นามสกุล").fill("Test");
  await modal.getByLabel("ค่าตอบแทน (บาท)").fill("25000");
  await modal.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(
    page.getByText("Browser Test", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await page
    .locator("aside")
    .getByRole("button", { name: "บุคลากร", exact: true })
    .click();
  await expect(
    page.getByText("Browser Test", { exact: true }).first(),
  ).toBeVisible();
});
test("company switch clears previous employee list", async ({ page }) => {
  await login(page);
  await page
    .locator("aside")
    .getByRole("button", { name: "บุคลากร", exact: true })
    .click();
  await expect(page.getByText("NEXT-006").first()).toBeVisible();
  await page
    .locator("aside")
    .getByLabel("Company", { exact: true })
    .selectOption({ label: "North Company" });
  await expect(
    page.getByRole("heading", { name: "หน้าหลัก", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("NEXT-006")).toHaveCount(0);
});
test("mobile uses bottom navigation, cards, hidden search and all settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.locator("aside")).not.toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "บุคลากร", exact: true })
    .click();
  await expect(page.locator(".mobile-card").first()).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "เพิ่มเติม", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ตั้งค่า", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "แผนก", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("employee sees own profile and no payroll/admin navigation", async ({
  page,
}) => {
  await login(page, "employee");
  await expect(
    page
      .locator("aside")
      .getByRole("button", { name: "ค่าตอบแทน", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator("aside")
      .getByRole("button", { name: "ผู้ใช้และสิทธิ์", exact: true }),
  ).toHaveCount(0);
  await page
    .locator("aside")
    .getByRole("button", { name: "ข้อมูลของฉัน", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "ประสบการณ์ทำงาน", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("สมชาย ใจดี", { exact: true })).toBeVisible();
});
test("print employee profile has visible report content", async ({ page }) => {
  await login(page);
  await page
    .locator("aside")
    .getByRole("button", { name: "บุคลากร", exact: true })
    .click();
  await page
    .getByRole("button", { name: "รายละเอียด", exact: false })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".printable")).toBeVisible();
  await expect(
    page.locator(".printable").getByText("Employee no.", { exact: true }),
  ).toBeVisible();
});

test("WebSocket events stay within company and forbidden employee channel is rejected", async ({
  page,
}) => {
  await login(page);
  const me = await (await page.request.get("/api/me")).json();
  const a = me.companies.find((c: any) => c.code === "NEXT").id,
    b = me.companies.find((c: any) => c.code === "NORTH").id;
  await page.evaluate(
    async ({ a, b }) => {
      (window as any).eventsA = [];
      (window as any).eventsB = [];
      await Promise.all(
        [a, b].map(
          (company, i) =>
            new Promise<void>((resolve, reject) => {
              const ws = new WebSocket(
                `ws://${location.host}/ws?company=${company}`,
              );
              ws.onmessage = (e) =>
                (i ? (window as any).eventsB : (window as any).eventsA).push(
                  JSON.parse(e.data),
                );
              ws.onopen = () => resolve();
              ws.onerror = () => reject(Error("WS failed"));
            }),
        ),
      );
    },
    { a, b },
  );
  const response = await page.request.post(
    `/api/companies/${a}/announcements`,
    {
      data: {
        title: "WS isolation",
        body: "Only company A",
        status: "PUBLISHED",
      },
    },
  );
  expect(response.status()).toBe(201);
  await expect
    .poll(() => page.evaluate(() => (window as any).eventsA.length))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).eventsB.length)).toBe(0);
  await page
    .locator("aside")
    .getByRole("button", { name: "ออกจากระบบ", exact: true })
    .click();
  await login(page, "employee");
  const rejected = await page.evaluate(
    (company) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/ws?company=${company}`);
        ws.onopen = () => resolve(false);
        ws.onerror = () => resolve(true);
      }),
    b,
  );
  expect(rejected).toBe(true);
});
