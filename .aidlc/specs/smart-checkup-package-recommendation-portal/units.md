# Units of Work

## สรุป
- **Units**: 5 units — Foundation, Identity & Access, Submission & Job Lifecycle, Pipeline Catalog & Nextflow Executor, Results & Guidance
- **กลยุทธ์**: Domain-Driven
- **Architecture**: Modular monolith
- **Story Distribution**: Identity & Access 3 stories; Submission & Job Lifecycle 7 stories; Pipeline Catalog & Nextflow Executor 6 stories; Results & Guidance 5 stories
- **Key Dependencies**: Foundation → ทุก domain unit; Identity & Access → Submission & Job Lifecycle; Submission & Job Lifecycle → Pipeline Catalog & Nextflow Executor; Submission & Job Lifecycle + Pipeline Catalog & Nextflow Executor → Results & Guidance
- **Development Sequence**: Foundation → Identity & Access → Submission & Job Lifecycle → Pipeline Catalog & Nextflow Executor → Results & Guidance → integration verification

## ภาพรวม
แบ่ง feature เป็น 5 units (เพิ่ม Pipeline Catalog & Nextflow Executor ตาม requirements Add-on 2026-10-18) เพื่อแยก ownership ตาม bounded context และทำงานเป็นลำดับที่ปลอดภัยสำหรับทีม 3 คน โดย deploy เป็น modular monolith เดียว Foundation จัดหา contract และ secure defaults ร่วมกัน; domain units เป็นเจ้าของ logic และข้อมูลของตน ไม่ import implementation ภายในข้าม boundary

**กลยุทธ์**: Domain-Driven

**เหตุผล**: Identity, Job Lifecycle และ Results/Guidance มี aggregate และการเปลี่ยนแปลงที่แยกกันชัดเจน การแบ่งตามชั้นเทคนิคจะทำให้ทุก story ต้องข้ามหลาย units ขณะที่ microservices เกินความจำเป็นสำหรับ MVP และทีมขนาดเล็ก

---

## Unit 0: Foundation

**Purpose**: สร้าง shared infrastructure และ conventions ที่ domain units ทุกตัวใช้ร่วมกัน โดยไม่มี business story เป็นเจ้าของ
**Priority**: High
**Complexity**: High
**Stories**: None — infrastructure only
**Type**: Infrastructure
**Owner**: Developer 1

### Responsibilities
- Repository scaffold และ module/folder boundary สำหรับ modular monolith
- Environment-based configuration, `.env.example` และ secret exclusion
- Docker Compose baseline, build/release/run separation และ HTTPS deployment configuration contract
- Shared types/contracts, API response/error pattern และ validation boundary
- Authentication/session scaffolding และ authorization middleware contract
- SQLite connection, migrations, transaction convention และ data-access baseline
- Structured redacted logging, audit event contract, error handling และ security defaults
- Base quality controls: formatter/lint/type-check/test scripts, dependency lockfile, CI/CD base config และ artifact integrity/security-check hooks

### Dependencies
| Depends On | Type | Description |
|---|---|---|
| (none) | — | Foundation ไม่มี upstream dependency |

---

## Unit 1: Identity & Access

**Purpose**: จัดการ authenticated session, owner-only authorization, least-privilege Admin และ protected audit access เพื่อเป็น trust boundary สำหรับข้อมูลทุก Job
**Priority**: High
**Complexity**: High
**Stories**: 3 stories — US-001, US-002, US-015
**Owner**: Developer 1

### Commands
| Command | Description | Actor |
|---|---|---|
| AuthenticateUser | ตรวจข้อมูลยืนยันตัวตนและเริ่ม secure session | ผู้ใช้ระบบ |
| LogoutUser | ยกเลิก session ปัจจุบัน | ผู้ใช้ระบบ |
| AuthorizeResourceAccess | ตรวจ owner/explicit permission ก่อนอ่านหรือเปลี่ยน resource | ระบบ |
| RecordAuditEvent | สร้าง audit event ที่ผ่านการ redaction | ระบบ |
| QueryAuthorizedAuditEvents | อ่าน audit events ภายใต้สิทธิ์ที่กำหนด | Trainer/Admin หรือ Developer ที่ได้รับสิทธิ์ |

### Domain Model
**Aggregates**: Identity (root: User), AuditTrail (root: AuditEvent)

**Entities**: User, RoleAssignment, Session, AuditEvent

**Value Objects**: UserId, Role, SessionId, Permission, AuditOutcome, AuditEventType

### Domain Events
**Publishes**:
- `UserAuthenticated` — เมื่อสร้าง authenticated session สำเร็จ
- `UserLoggedOut` — เมื่อ session ถูกยกเลิก
- `AuthorizationDenied` — เมื่อ owner/permission check ไม่ผ่าน
- `AuditEventRecorded` — เมื่อมี security/operational event ที่ผ่าน redaction

**Subscribes**:
- `JobSubmitted` จาก Submission & Job Lifecycle — สร้าง audit event
- `JobStatusChanged` จาก Submission & Job Lifecycle — สร้าง audit event
- `ResultDownloaded` จาก Results & Guidance — สร้าง audit event

### Dependencies
| Depends On | Type | Description |
|---|---|---|
| Foundation | Data/API | ใช้ session/auth middleware contract, shared error/logging/audit types และ SQLite baseline |

---

## Unit 2: Submission & Job Lifecycle

**Purpose**: รับ sample/structured input, validate mock upload, สร้างและเก็บ Job, ควบคุม lifecycle ผ่าน simulated local executor และบังคับ retention/deletion
**Priority**: High
**Complexity**: High
**Stories**: 7 stories — US-003, US-004, US-005, US-006, US-007, US-008, US-014
**Owner**: Developer 2

### Commands
| Command | Description | Actor |
|---|---|---|
| LoadSampleData | เติม sample input และ basic parameters ที่ authored ในระบบ | Research Staff/Trainer |
| ValidateJobInput | ตรวจ parameters และ mock file constraints | ระบบ |
| SubmitJob | สร้าง Job ที่ไม่ซ้ำหลัง validation และ readiness check | Research Staff |
| StartSimulatedJob | เปลี่ยน Job จาก Queued เป็น Running | Simulated executor |
| CompleteJob | เปลี่ยน Job เป็น Completed พร้อม result reference | Simulated executor |
| FailJob | เปลี่ยน Job เป็น Failed พร้อม safe error summary | Simulated executor |
| DeleteJob | ลบ Job/input/result ตาม owner request | Owner |
| CleanupExpiredJob | ลบข้อมูล Job ที่ครบ retention | Scheduled system process |

### Domain Model
**Aggregates**: Job (root: Job), JobRetention (root: Job)

**Entities**: Job, JobInput, JobStatusEvent, JobExecutionAttempt, DeletionRecord

**Value Objects**: JobId, JobStatus, InputParameters, FileDescriptor, StatusTransition, RetentionDeadline, SafeErrorSummary

### Domain Events
**Publishes**:
- `SampleDataLoaded` — เมื่อเติม sample input สำเร็จ
- `JobSubmitted` — เมื่อ Job ถูกสร้างในสถานะ Queued
- `JobStatusChanged` — เมื่อเปลี่ยนสถานะผ่าน allowed transition
- `JobFailed` — เมื่อ simulated executor ล้มเหลว
- `JobDeleted` — เมื่อ owner deletion หรือ retention cleanup สำเร็จ

**Subscribes**:
- `UserAuthenticated` จาก Identity & Access — อนุญาตให้เริ่ม protected operation

### Dependencies
| Depends On | Type | Description |
|---|---|---|
| Foundation | Data/API | ใช้ shared types, validation, database migration, storage boundary, error/logging และ API contract |
| Identity & Access | API/Event | ตรวจ authenticated owner และ authorization contract ทุก protected command/resource query |

---

## Unit 4: Pipeline Catalog & Nextflow Executor (Add-on 2026-10-18)

**Purpose**: ให้ผู้ใช้เลือก pipeline จาก registry ที่ review แล้ว, ส่ง FASTQ input พร้อม run name และรัน `si-lol/wf-renamefastq` ผ่าน local Nextflow แบบ offline ตามลำดับคิว พร้อมแสดงความคืบหน้า, Cancel และบันทึก output manifest
**Priority**: High
**Complexity**: High
**Stories**: 6 stories — US-016, US-017, US-018, US-019, US-020, US-021
**Owner**: Developer 2
**Source**: requirements Add-on 2026-10-18, D1A-10

### Commands
| Command | Description | Actor |
|---|---|---|
| ListPipelines | อ่าน pipeline registry พร้อม readiness ต่อ pipeline | Research Staff/Trainer |
| UploadRunInput | รับ FASTQ file/folder และ sample sheet แบบ streaming ภายใต้ขีดจำกัด | Research Staff |
| ValidateRunInput | ตรวจ input layout, ไฟล์, sample sheet และชื่อที่ปลอดภัยก่อนสร้าง Job | ระบบ |
| LaunchPipelineRun | สร้าง Job ของ pipeline ที่เลือกพร้อม run name และ options ผ่าน Job lifecycle เดิม | Research Staff |
| DispatchQueuedRun | เลือก Job `Queued` ถัดไปเมื่อมี slot ว่างตาม `MAX_CONCURRENT_RUNS` | Executor |
| StartNextflowRun | สร้าง params file และเริ่ม Nextflow process ด้วย pinned revision แบบ offline | Executor |
| TrackRunProgress | อ่าน trace เพื่ออัปเดตขั้นตอนที่เสร็จและขั้นตอนปัจจุบัน | Executor |
| RecordRunOutputs | ตรวจ output และบันทึก output manifest ก่อน `Completed` | Executor |
| CancelJob | หยุด Job `Queued`/`Running` ของทุก pipeline และเปลี่ยนเป็น `Cancelled` | Owner |
| CleanupRunWorkspace | ลบ `work/` และไฟล์ชั่วคราวเมื่อ run จบ/ถูก cancel | Executor |
| CheckPipelineReadiness | ตรวจ Nextflow, Java, Docker daemon และ asset ที่ pre-pull | ระบบ |

### Domain Model
**Aggregates**: PipelineCatalog (root: PipelineDefinition — read-only จาก registry), PipelineRun (root: Job — ขยาย Job aggregate ของ Submission & Job Lifecycle ผ่าน port ไม่ import implementation ภายใน)

**Entities**: PipelineDefinition, JobInputFile, RunOutputEntry (output manifest), RunProgress

**Value Objects**: PipelineId, PipelineRevision, RunName, InputLayout (`SINGLE_FILE` / `SAMPLE_FOLDER` / `BARCODE_FOLDERS`), SampleSheet, Barcode, SampleAlias, RunOptions, ResourceCaps, QueuePosition, FailedStep

### Domain Events
**Publishes**:
- `JobSubmitted` (ผ่าน Job lifecycle เดิม) — เมื่อ Nextflow run ถูกสร้างในสถานะ Queued
- `JobStatusChanged` (รวม `to: CANCELLED`) — เมื่อ run เริ่ม, จบ, ล้ม หรือถูก cancel
- `RunProgressUpdated` — เมื่อขั้นตอนของ Nextflow เปลี่ยน
- `RunOutputsRecorded` — เมื่อบันทึก output manifest ก่อน Completed

**Subscribes**:
- `UserAuthenticated` จาก Identity & Access — อนุญาต protected operation
- `JobDeleted` จาก Submission & Job Lifecycle — หยุด process ที่ค้างและลบ workspace ของ run

### Dependencies
| Depends On | Type | Description |
|---|---|---|
| Foundation | Data/API | Shared kernel (`JOB_STATUSES` เพิ่ม `CANCELLED`), storage boundary, config, error/logging, migration |
| Identity & Access | API | `requireAuthenticated`, owner authorization, `AuditService.record` |
| Submission & Job Lifecycle | API/Data/Event | Job aggregate, status machine, idempotent submit, retention/delete, polling UI; เพิ่ม executor port ให้เลือก simulated หรือ Nextflow ต่อ pipeline |

### Boundary Notes
- เป็นเจ้าของ module ใหม่ `pipelines` (registry, upload/validation, Nextflow adapter, progress, output manifest) และหน้า catalog/launch
- การแก้ module `jobs` (executor port, transitions `→ CANCELLED`, overview/detail UI) และ shared kernel ทำใน PR เดียวกันภายใต้ Add-on; Developer 2 เป็นเจ้าของ `jobs` อยู่แล้ว ส่วน shared kernel ต้องแจ้ง Developer 1
- Output manifest เป็น contract ให้ Results & Guidance (แจ้ง Developer 3)

---

## Unit 3: Results & Guidance

**Purpose**: แสดง completed result, deterministic mock package recommendation, authorized download, tutorial/sample output และ landing compliance
**Priority**: High
**Complexity**: Medium
**Stories**: 5 stories — US-009, US-010, US-011, US-012, US-013
**Owner**: Developer 3

### Commands
| Command | Description | Actor |
|---|---|---|
| ViewCompletedResult | อ่าน result ที่ผ่าน owner authorization | Job owner |
| GenerateMockRecommendation | ประเมิน deterministic mock rule สำหรับ completed result | ระบบ |
| DownloadResultArtifact | ส่ง artifact ที่ authorized และ sanitized | Job owner |
| OpenTutorial | แสดง tutorial, sample input/output และ interpretation guidance | Research Staff/Trainer |
| RenderLandingCompliance | แสดง MIT License และ cookie behavior ที่ privacy-preserving | ผู้เยี่ยมชม |

### Domain Model
**Aggregates**: ResultPresentation (root: ResultArtifact), Recommendation (root: PackageRecommendation), Guidance (root: TutorialContent)

**Entities**: ResultArtifact, PackageRecommendation, RecommendationRuleVersion, TutorialContent, ReferenceLink

**Value Objects**: ResultId, ArtifactDescriptor, RecommendationReason, RuleVersion, ResultStatusLabel, InterpretationNote

### Domain Events
**Publishes**:
- `RecommendationGenerated` — เมื่อ completed result มี deterministic mock recommendation
- `ResultDownloaded` — เมื่อ authorized download สำเร็จ
- `TutorialOpened` — เมื่อผู้ใช้เปิด interactive guidance

**Subscribes**:
- `JobStatusChanged` จาก Submission & Job Lifecycle — refresh result availability; เริ่ม generate recommendation เฉพาะเมื่อสถานะ Completed
- `JobDeleted` จาก Submission & Job Lifecycle — ทำให้ result/recommendation/download unavailable
- `UserAuthenticated` จาก Identity & Access — ตรวจ user context สำหรับ protected result operations

### Dependencies
| Depends On | Type | Description |
|---|---|---|
| Foundation | API/Data | ใช้ shared result/API types, sanitization, accessibility/error patterns และ configuration |
| Identity & Access | API | ตรวจ owner authorization ก่อน view/download/result access |
| Submission & Job Lifecycle | Data/API/Event | ใช้ Job status, safe input/result references และ lifecycle events เพื่อกำหนด result availability |
| Pipeline Catalog & Nextflow Executor | Data/API | ใช้ output manifest ของ Nextflow run เพื่อออกแบบผลลัพธ์/download ของทุก pipeline; สถานะ `Cancelled` ไม่มี final result (Add-on 2026-10-18) |

---

## Context Map

| Upstream | Downstream | Pattern |
|---|---|---|
| Foundation | Identity & Access | Shared Kernel — shared config, types, error/logging, DB and security contracts |
| Foundation | Submission & Job Lifecycle | Shared Kernel — validation/storage/API/DB contracts |
| Foundation | Results & Guidance | Shared Kernel — response, sanitization, accessibility and configuration contracts |
| Identity & Access | Submission & Job Lifecycle | Customer/Supplier — identity provides authentication/authorization contract |
| Identity & Access | Results & Guidance | Customer/Supplier — identity provides owner authorization contract |
| Submission & Job Lifecycle | Identity & Access | Publisher/Subscriber — lifecycle publishes auditable events |
| Submission & Job Lifecycle | Results & Guidance | Customer/Supplier + Publisher/Subscriber — jobs provide persisted state and lifecycle events to result presentation |
| Foundation | Pipeline Catalog & Nextflow Executor | Shared Kernel — status contract, storage, config, DB and security contracts |
| Identity & Access | Pipeline Catalog & Nextflow Executor | Customer/Supplier — authentication, owner authorization and audit |
| Submission & Job Lifecycle | Pipeline Catalog & Nextflow Executor | Customer/Supplier — Job aggregate and executor port; pipelines plug in an executor without importing jobs internals |
| Pipeline Catalog & Nextflow Executor | Results & Guidance | Customer/Supplier — output manifest and run metadata for result presentation |
| Pipeline Catalog & Nextflow Executor | Local Nextflow + Docker | Anti-Corruption Layer — adapter converts Nextflow exit code/trace into Job statuses, progress and safe summaries |

## Development Sequence

### Phase 1: Foundation
- [ ] Unit 0: Foundation — สร้าง shared secure baseline และ merge เข้า `main` ก่อนเริ่ม domain unit

### Phase 2: Identity Boundary
- [ ] Unit 1: Identity & Access — ทำ protected session, authorization และ audit contract บน foundation

### Phase 3: Job Core
- [ ] Unit 2: Submission & Job Lifecycle — ทำ sample/input, Job lifecycle, simulated executor, monitoring และ retention โดยพึ่ง identity boundary

### Phase 3b: Pipeline Catalog (Add-on 2026-10-18)
- [ ] Unit 4: Pipeline Catalog & Nextflow Executor — ทำ catalog, FASTQ launch/validation, local Nextflow queue/progress/cancel และ output manifest บน Job lifecycle เดิม

### Phase 4: Result Experience
- [ ] Unit 3: Results & Guidance — ทำ completed result, mock recommendation, download, tutorial และ landing compliance โดยพึ่ง Job state, authorization และ output manifest ของ Nextflow run

### Phase 5: Integration Verification
- [ ] ตรวจ end-to-end flow, authorization isolation, retention/cleanup, error states, build และ container/HTTPS configuration

## File Ownership and Branch Plan

| Unit | Owner | Branch | Initial folder boundary |
|---|---|---|---|
| Foundation | Developer 1 | `feat/foundation` | shared config, shared contracts, infrastructure scaffolding |
| Identity & Access | Developer 1 | `feat/identity-access` | identity/auth/audit modules |
| Submission & Job Lifecycle | Developer 2 | `feat/submission-job-lifecycle` | jobs/submission/executor modules |
| Pipeline Catalog & Nextflow Executor | Developer 2 | `feat/pipeline-catalog-nextflow` | pipelines module + catalog/launch pages; coordinated edits to jobs module and shared kernel |
| Results & Guidance | Developer 3 | `feat/results-guidance` | results/guidance modules |

> Foundation ต้อง merge เข้า `main` ก่อนแตก branch ของ domain unit ทุกตัว; branch จะสร้างเมื่อเริ่ม unit จริงเท่านั้น และต้องผ่าน PR review อย่างน้อย 1 คนก่อน merge
