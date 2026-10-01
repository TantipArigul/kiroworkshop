# การตัดสินใจด้านการออกแบบ — Foundation Unit

## สรุปบริบท
Foundation เป็น unit แรกของ incremental modular monolith สำหรับทีม 3 คน และต้องกำหนด scaffold, TypeScript stack, secure defaults, REST contract, SQLite baseline, session/auth boundary, test/quality baseline, Docker/HTTPS, observability และ design-token foundation ให้ units ถัดไปใช้ร่วมกัน MVP ใช้ simulated local executor โดยไม่มี outbound pipeline/API call รับเฉพาะข้อมูล synthetic/de-identified และต้องบังคับ owner-only authorization ใน domain unit ถัดไป

---

## คำถามเพื่อการตัดสินใจ

### D3-1: Backend Runtime และ Framework
**คำถาม**: Foundation ควรเลือก backend implementation ใดสำหรับ REST API ของ modular monolith?
- 1) Node.js LTS + Express — เรียบง่าย, ecosystem ใหญ่ และเหมาะกับ MVP **(แนะนำ)**
- 2) Node.js LTS + Fastify — schema-first และ performance-oriented
- 3) Node.js LTS + NestJS — structure มากขึ้นแต่เพิ่ม abstraction
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Node.js LTS + Express

---

### D3-2: Repository และ Workspace Structure
**คำถาม**: Repository เดียวควรจัด frontend, backend และ shared contracts อย่างไร?
- 1) pnpm workspace monorepo มี `apps/web`, `apps/api`, `packages/shared` — แยก boundary ชัดเจนและแชร์ type อย่างมีวินัย **(แนะนำ)**
- 2) Single package รวม frontend/backend ไว้ใต้ `src/`
- 3) แยก frontend และ backend เป็นหลาย repositories
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) pnpm workspace monorepo: `apps/web`, `apps/api`, `packages/shared`

---

### D3-3: Frontend Foundation
**คำถาม**: Frontend foundation ควรใช้แนวทางใด?
- 1) React SPA + Vite + React Router — build เร็ว เหมาะกับ local Docker MVP **(แนะนำ)**
- 2) React SPA + Webpack
- 3) React framework แบบ SSR
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) React SPA + Vite + React Router

---

### D3-4: API Contract และ Validation
**คำถาม**: ควรกำหนด REST API contract และ validation ที่ trust boundary อย่างไร?
- 1) REST + OpenAPI specification + Zod validation ทั้ง request/response + structured error envelope **(แนะนำ)**
- 2) REST + validation เฉพาะ controller โดยไม่มี contract specification
- 3) GraphQL + schema validation
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) REST + OpenAPI + Zod request/response validation + structured error envelope

---

### D3-5: SQLite Data Access และ Migration
**คำถาม**: Foundation ควรใช้ data-access stack ใดสำหรับ SQLite prototype?
- 1) Prisma + Prisma Migrate — type-safe schema, migrations และ test database workflow ชัดเจน **(แนะนำ)**
- 2) Drizzle ORM + migrations — น้ำหนักเบาและ SQL-oriented
- 3) Raw SQL + custom migration scripts
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Prisma + Prisma Migrate

---

### D3-6: Authentication, Session และ Password Hashing
**คำถาม**: ควรวาง minimal authentication foundation อย่างไร?
- 1) Server-side session cookie + Argon2 password hashing + RBAC roles + CSRF protection สำหรับ state-changing web requests **(แนะนำ)**
- 2) JWT bearer token + refresh-token rotation
- 3) Static shared credentials สำหรับ workshop
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Server-side session cookie + Argon2 + RBAC + CSRF protection

---

### D3-7: HTTP Security และ Rate Limiting
**คำถาม**: Secure-by-default HTTP policy ของ API ควรเป็นแบบใด?
- 1) Helmet/security headers, origin allowlist CORS, CSRF protection, request-size limits และ route-based rate limiting **(แนะนำ)**
- 2) Framework defaults โดยไม่ตั้ง security middleware เพิ่ม
- 3) เปิด CORS wildcard เพื่อความสะดวกในการพัฒนา
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Security headers, origin allowlist CORS, CSRF, request-size limits และ route-based rate limiting

---

### D3-8: Test Stack และ Correctness Properties
**คำถาม**: Foundation ควรกำหนด test strategy รวม property-based testing อย่างไร?
- 1) Vitest สำหรับ unit/integration, Supertest สำหรับ API และ fast-check สำหรับ properties เช่น authorization isolation, valid status transitions, idempotency และ redaction **(แนะนำ)**
- 2) Jest + Supertest โดยมี example tests เท่านั้น
- 3) E2E tests อย่างเดียวโดยไม่มี unit/property tests
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Vitest + Supertest + fast-check สำหรับ authorization, lifecycle, idempotency และ redaction properties

---

### D3-9: Observability Strategy
**คำถาม**: Service นี้ต้องการ observability ระดับใด?
- 1) Minimal — structured logging + health endpoint เหมาะกับ internal training prototype **(แนะนำ)**
- 2) Standard — logging + metrics + health + readiness
- 3) Full — logging + metrics + distributed tracing + alerting + dashboards
- 4) None — ไม่มี observability
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Minimal — structured logging + health endpoint

---

### D3-10: Error Tracking
**คำถาม**: ควรเก็บและรายงาน runtime errors อย่างไร?
- 1) Log-based only — structured redacted logs ที่ค้นได้จาก runtime/container logs **(แนะนำ)**
- 2) Dedicated error tracking service
- 3) Cloud-native error tracking
- 4) None — ไม่ติดตาม error เพิ่มเติม
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Log-based only — structured redacted runtime/container logs

---

### D3-11: Health และ Lifecycle Management
**คำถาม**: Containerized service ต้องมี lifecycle management ระดับใด?
- 1) Basic health endpoint only
- 2) Health + readiness + graceful shutdown **(แนะนำ)**
- 3) Health + readiness + graceful shutdown + startup probe + drain delay
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2) Health + readiness + graceful shutdown

---

### D3-12: Container, HTTPS และ Certificate Management
**คำถาม**: Foundation ควรทำ local Docker Compose และ HTTPS บน port 443 อย่างไร?
- 1) Docker Compose + reverse proxy ที่ terminate TLS + automated certificate mechanism สำหรับ hostname/deployment environment ที่กำหนด + HTTP-to-HTTPS redirect **(แนะนำ)**
- 2) Application server terminate TLS โดยตรง
- 3) HTTP-only ในทุก environment
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Docker Compose + TLS-terminating reverse proxy + automated certificate mechanism + HTTP-to-HTTPS redirect

---

### D3-13: UX/UI Direction and Brand Personality
**คำถาม**: ไม่มี design input/token/brand asset ที่ได้รับอนุญาต ควรใช้ทิศทาง UX/UI ใดสำหรับ training portal?
- 1) Light-mode clinical research workspace: calm, trustworthy, information-first, clean cards, clear status hierarchy; ใช้ product wordmark แบบข้อความและไม่มี third-party assets **(แนะนำ)**
- 2) Dark-mode analytics dashboard
- 3) High-visual marketing style ที่มี animation เด่น
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Light-mode clinical research workspace: calm, trustworthy, information-first, clean cards, clear hierarchy และ product wordmark แบบข้อความ

---

### D3-14: Design Token และ Component Strategy
**คำถาม**: ควรสร้าง runtime design system อย่างไรเพื่อให้ UI ทุก unit ใช้มาตรฐานเดียวกัน?
- 1) CSS variables สามชั้น primitive → semantic → component ในไฟล์ token runtime เดียว พร้อม responsive spacing/type scale, light mode default, accessible states และ SVG icons **(แนะนำ)**
- 2) Hardcode styles ในแต่ละ React component
- 3) ใช้ third-party template ที่มี assets/brand ภายนอก
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) CSS variable tokens สามชั้นใน runtime token file พร้อม responsive scale, light default, accessible states และ SVG icons

---

### D3-15: CI/CD และ Software Integrity Gate
**คำถาม**: Foundation ควรกำหนด quality/security gate อะไรก่อน merge/deploy?
- 1) GitHub Actions ทำ install, lint, type-check, tests, dependency/secret scan, build และ container artifact integrity check; PR review อย่างน้อย 1 คน **(แนะนำ)**
- 2) รัน build ในเครื่องโดยไม่มี automated gate
- 3) Deploy ก่อนแล้วค่อยทดสอบ
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) GitHub Actions: install, lint, type-check, tests, dependency/secret scan, build, container integrity และ PR review อย่างน้อย 1 คน

---

## สรุปการตัดสินใจ
- D3-1 Backend: Node.js LTS + Express
- D3-2 Repository: pnpm workspace monorepo (`apps/web`, `apps/api`, `packages/shared`)
- D3-3 Frontend: React SPA + Vite + React Router
- D3-4 API: REST + OpenAPI + Zod + structured error envelope
- D3-5 Data: SQLite ผ่าน Prisma + Prisma Migrate
- D3-6 Auth: Server-side session cookie + Argon2 + RBAC + CSRF
- D3-7 HTTP Security: security headers, allowlist CORS, CSRF, size limits, rate limiting
- D3-8 Testing: Vitest + Supertest + fast-check properties
- D3-9 Observability: Minimal structured logging + health endpoint
- D3-10 Error Tracking: Log-based structured redacted logs
- D3-11 Lifecycle: health + readiness + graceful shutdown
- D3-12 Deployment: Docker Compose + TLS reverse proxy + automated certificate management + HTTPS redirect
- D3-13 UX/UI: Light-mode clinical research workspace, information-first and product text wordmark
- D3-14 Tokens: Three-layer CSS variables with accessible responsive components
- D3-15 CI/CD: GitHub Actions checks + PR review + dependency/secret scan + artifact integrity

## ผลการตรวจสอบ D3
- ไม่พบ technology incompatibility: Express, pnpm, React/Vite, Zod, Prisma/SQLite และ Vitest ecosystem ทำงานร่วมกันได้
- ไม่พบ security conflict: session authentication, CSRF, allowlist CORS, HTTPS และ encryption-at-rest design requirement สอดคล้องกับ private-by-default scope
- ไม่พบ over-engineering conflict: MVP ใช้ minimal observability และ log-based error tracking; ไม่เลือก microservices, distributed events หรือ third-party tracking
- lifecycle ระดับ health/readiness/graceful shutdown สอดคล้องกับ Docker Compose
- UX/UI direction และ token strategy ปิดช่องว่างของ design input; จะ derive token values และสร้าง `design-system.md`/runtime CSS หลังการอนุมัติ D3
- ความเสี่ยงที่ต้องกำหนดใน design: วิธี key management/encryption at rest สำหรับ local SQLite/files, certificate mechanism ตาม hostname ที่ใช้จริง, user provisioning/reset workflow และ retention cleanup schedule

---

**สถานะ**: ใช้ตัวเลือกแนะนำครบทุกข้อเมื่อ 2026-10-01T07:23:33Z
