# Bustransit Test Campaign Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các lỗi mà đợt test riêng bustransit (shutdown thật với Nest, redelivery trên plugin thật, chaos/soak) tìm ra: shutdown luôn kết thúc trong thời hạn đã hứa, connect không treo, topology bị xoá tự khôi phục, package khai báo đúng phiên bản Nest nó hỗ trợ.

**Architecture:** `ConnectionManager` có giới hạn thời gian cho TCP connect, cho việc chờ một lần connect đang dở và cho việc đóng channel/connection (Task 1, 3). `ConsumerRunner.stop()` tính cả lệnh cancel vào ngân sách drain (Task 3). Facade RabbitMQ chạy một vòng khai báo lại topology định kỳ, mặc định 60 giây, chỉnh qua `UseReliability({ topologyRefreshMs })` (Task 4). `package.json` khai báo `peerDependencies` (Task 2). Task 5 sửa log và thông báo lỗi gây hiểu nhầm. API public chỉ thêm một tuỳ chọn `topologyRefreshMs`.

**Tech Stack:** TypeScript 5, amqplib 0.10.9, Jest 29 + ts-jest, RabbitMQ 3.13.

**Spec:** Không có file spec. Plan dựa trên các báo cáo test trong `.superpowers/sdd/2026-10-11-rabbitmq-channel-recovery/`:
- `test-shutdown-report.md` (agent C): shutdown thật, Nest 10/11, Node 20/22.
- `test-delayed-report.md` (agent A): redelivery trên plugin thật, 6/6 pass, không có bug.
- `test-chaos-report.md` (agent B): chaos/soak 25 phút, 3 bug, script tái hiện ở scratchpad `test-chaos/repro-*.js`.

Quyết định của chủ repo: bug 3 của agent B (xoá exchange) sửa bằng **tự khôi phục định kỳ**.

## Ghi chú thực thi (2026-10-12): code khác plan ở đâu

Plan đã chạy xong theo kiểu subagent-driven, không commit. Mọi thay đổi đang staged. Code trong repo là bản đúng; review từng task và review tổng đã sửa thêm những điểm sau so với code trong các task bên dưới:

- **Task 1:**
  - Test "bounds the TCP connect" có thêm `mockClear()`.
  - Test "retries after a connect that times out" có thêm `connect.mockClear()`.
- **Task 3:**
  - Thay `stream.destroy()` bằng helper export `closeOrDestroy(connection, ms)`. Helper này huỷ socket **kèm error**, vì `destroy()` trơn không làm amqplib nhận ra và heartbeat vẫn giữ process sống. Mọi chỗ đóng connection trong `close()` và `doStart` đều đi qua helper này.
  - `close()` dùng **một deadline chung** `CLOSE_TIMEOUT_MS` (2 giây) cho đóng channel, đóng connection và chờ lần start đang dở.
  - `drain()` log warn khi lệnh cancel hết hạn.
  - Probe plugin delayed:
    - Có socket `timeout`. Lệnh connect và các thao tác channel đều nằm trong giới hạn thời gian.
    - Nhận `AbortSignal` từ facade, abort khi `stopConsuming()`. Chỉ huỷ socket ngay khi timeout hoặc abort; lỗi 406 bình thường thì đóng connection đàng hoàng.
    - Facade bỏ qua probe khi đang dừng.
  - CI: vòng chờ broker có plugin fail rõ ràng sau 120 giây. Test shutdown của bộ delayed tăng delay lên 6000 ms.
- **Task 4:**
  - Vòng refresh chạy trong `TopologyRefreshSession` (`lib/factories/brokers/rabbitmq/topology-refresh.ts`), chỉ trên channel tạm, không đụng `_topology` hay cache của publisher.
  - Exchange được kiểm tra passive trước, chỉ tạo khi thiếu. Lỗi chỉ log warn; mỗi vòng có giới hạn `readyTimeoutMs`; không có hai vòng chạy cùng lúc. `declareTopology` không có tuỳ chọn `force`.
  - `Publisher.ensureExchange` cũng chấp nhận exchange có sẵn (kiểm tra trước, thiếu mới tạo), nên lúc khởi động và lúc consumer prepare không còn 406.
  - Timer chỉ được hẹn khi `manager.current` có giá trị, không dựa vào `isConnected`.
  - `stopConsuming()` kết thúc session refresh đang chạy.
- **Task 5:** câu README về retry được thêm vào cuối bullet "Await every publish." (bullet này đã được viết lại).
- **Review tổng:**
  - Mọi tuỳ chọn reliability tối đa 2147483647 ms.
  - Không log ERROR khi chính lib huỷ socket lúc shutdown.
  - `buildTopology` luôn chạy ngay sau `publisher.open()`, kể cả khi đang dừng, để publish vẫn route đúng. Khi đang dừng chỉ bỏ qua khai báo topology, start consumer và hẹn refresh.
  - `isNotFound` chuyển sang `rabbitmq/errors.ts`.
  - Có comment giải thích vì sao delay exchange vẫn được khai báo nghiêm ngặt lúc khởi động.

Kết quả cuối:
- 164 unit test pass.
- Integration: 12 pass trên broker thường, 18/18 khi có broker có plugin delayed.
- Node 20 và 22 đều pass.
- Chạy lại các kịch bản chaos: xem `test-rerun-report.md` trong SDD workspace.

## Global Constraints

- **KHÔNG COMMIT.** Không chạy `git add`, `git commit`, `git reset`, `git stash`, `git checkout`, `git push`, `npm publish`. Chủ repo tự review mọi thay đổi. Các bước "Commit" của skill được thay bằng bước "Checkpoint" (controller chụp snapshot staged tree).
- Code nằm trên branch `fix/rabbitmq-transport-reliability`, base `7740e1a`, mọi thay đổi trước đó đang staged.
- `npm install` chỉ dùng `--legacy-peer-deps`.
- Style trong `lib/`: thụt 4 dấu cách, log có tiền tố `[RabbitMQ]`. Test trong `test/`: thụt 2 dấu cách.
- API public chỉ thêm tuỳ chọn `topologyRefreshMs` trong `ReliabilityOptions`; không đổi tên exchange, queue, binding.
- Lệnh kiểm tra:
  - Unit: `npm test`
  - Typecheck: `npm run typecheck`
  - Integration: `RABBITMQ_URL=amqp://admin:admin123@localhost:5672/linkadz RABBITMQ_MANAGEMENT_URL=http://admin:admin123@localhost:15672 npm run test:integration`

## Review Focus

1. Broker im lặng (firewall drop gói, host chết) lúc app đang kết nối hoặc reconnect, và đúng lúc đó nhận SIGTERM: process phải thoát trong khoảng `shutdownTimeoutMs` + 2 giây, không treo tới TCP timeout của hệ điều hành (đã đo được 70 giây). Test ở Task 1.
2. Connection mở xong muộn, sau khi `close()` đã trả về: connection đó phải bị đóng ngay, không có unhandled error, không reconnect. Test ở Task 1.
3. Broker im lặng khi app khởi động bình thường (không shutdown): lần connect phải thất bại sau `readyTimeoutMs` và lên lịch reconnect, không treo vô hạn. Test ở Task 1.
4. App cài lib với Nest ngoài khoảng hỗ trợ (ví dụ Nest 9): npm phải cảnh báo peer dependency. Kiểm tra ở Task 2.
5. Kết nối bình thường qua mạng chậm (TCP connect mất vài giây nhưng dưới `readyTimeoutMs`): vẫn kết nối được, socket timeout phải được amqplib gỡ sau khi mở. Kiểm tra bằng đọc `amqplib/lib/connect.js:151-153` và integration suite ở Task 1.
6. Broker bị `docker pause` (TCP còn sống nhưng không trả lời) đúng lúc SIGTERM: `stopConsuming()` và `close()` cộng lại không vượt `shutdownTimeoutMs` + 2 giây (đo được 75 giây trước khi sửa). Test ở Task 3.
7. Endpoint nhận TCP nhưng không bao giờ hoàn tất handshake AMQP (broker treo, load balancer có backend chết): connect thất bại sau `readyTimeoutMs` và thử lại. Task 1 xử lý, vì amqplib chỉ gỡ socket timeout sau khi handshake xong (`connect.js:149-153`); kiểm chứng bằng `repro-silent-endpoint.js` ở Task 1 Step 7.
8. Ops xoá exchange của message hoặc exchange phía queue khi app đang chạy, publisher và consumer ở hai process khác nhau: message bị bỏ tối đa khoảng `topologyRefreshMs`, sau đó tự khôi phục mà không cần reconnect. Test ở Task 4.

---

### Task 1: Giới hạn thời gian connect và thời gian `close()` chờ connect đang dở

**Bug (agent C, đã kiểm chứng):** `ConnectionManager.close()` chờ `this.starting` (`lib/factories/brokers/rabbitmq/connection-manager.ts:150-153`), mà `doStart()` chờ `amqp.connect()` (`:83-85`) không có timeout. Khi broker drop gói tin, SIGTERM lúc đang connect làm shutdown treo tới TCP timeout của OS: đo được 70 giây trên macOS, vượt grace 40 giây nên container bị SIGKILL. README hứa shutdown mất khoảng `shutdownTimeoutMs` cộng thời gian đóng connection.

**Cách sửa:**
- Truyền socket option `timeout: readyTimeoutMs` cho `amqp.connect`. amqplib dùng nó cho TCP connect (`node_modules/amqplib/lib/connect.js:175-181`, lỗi `connect ETIMEDOUT`) và tự gỡ khi connection đã mở (`:151-153`), nên không ảnh hưởng connection đang chạy.
- `close()` chờ lần start đang dở tối đa `CLOSE_WAIT_FOR_START_MS = 2000` ms. Nếu connection mở xong muộn hơn, nhánh `if (this.shuttingDown)` có sẵn ở `:86-90` tự đóng nó.

**Files:**
- Modify: `lib/factories/brokers/rabbitmq/connection-manager.ts:83-85` (connect options), `:138-154` (`close()`)
- Test: `test/connection-manager.spec.ts`
- Modify: `README.md` (bullet "Shutdown" trong mục Reliability), `CHANGELOG.md` (mục `### Fixed` của 0.4.0)

**Interfaces:**
- Consumes: `ReliabilityOptions.readyTimeoutMs` (đã có), `withTimeout(promise, ms, message)` từ `lib/utils/deferred.ts` (đã có).
- Produces: hằng `CLOSE_WAIT_FOR_START_MS` export từ `connection-manager.ts` (test dùng). Không đổi API public.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `describe('ConnectionManager edge cases', ...)` trong `test/connection-manager.spec.ts`. Sửa dòng import để có `CLOSE_WAIT_FOR_START_MS`:

```ts
import { CLOSE_WAIT_FOR_START_MS, ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
```

Các test:

```ts
  it('bounds the TCP connect by readyTimeoutMs', async () => {
    const { manager } = create();
    await manager.start();
    expect(amqp.connect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeout: reliability.readyTimeoutMs }),
    );
    await manager.close();
  });

  it('does not wait longer than CLOSE_WAIT_FOR_START_MS for a connect that never answers', async () => {
    const broker = createFakeBroker();
    let release!: () => void;
    (amqp.connect as unknown as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(new FakeConnection(broker, 'linkadz')))),
    );
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
    void manager.start();
    const startedAt = Date.now();
    await manager.close();
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(CLOSE_WAIT_FOR_START_MS - 50);
    expect(elapsed).toBeLessThan(CLOSE_WAIT_FOR_START_MS + 500);

    // The connection opens after close() returned: it is closed at once and nothing reconnects.
    release();
    await eventually(() => broker.connections[0].closed);
    await sleep(reliability.reconnectDelayMs * 3);
    expect(broker.connections).toHaveLength(1);
    expect(manager.isConnected).toBe(false);
  }, CLOSE_WAIT_FOR_START_MS + 5000);

  it('retries after a connect that times out while not shutting down', async () => {
    const broker = createFakeBroker();
    const connect = amqp.connect as unknown as jest.Mock;
    connect.mockImplementationOnce(() => Promise.reject(new Error('connect ETIMEDOUT')));
    connect.mockImplementation(async () => new FakeConnection(broker, 'linkadz'));
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
    await manager.start();
    await eventually(() => manager.isConnected);
    expect(connect).toHaveBeenCalledTimes(2);
    await manager.close();
  });
```

Ghi chú cho người thực hiện:
- `eventually(check: () => boolean, timeoutMs = 2000)` và `sleep(ms)` đã import ở đầu file từ `./support/broker-fixture`.
- `reliability` ở đầu file có `reconnectDelayMs: 20, readyTimeoutMs: 100`.

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `npx jest test/connection-manager.spec.ts -t "bounds the TCP connect|CLOSE_WAIT_FOR_START_MS|connect that times out"`
Expected:
- Lỗi compile vì `CLOSE_WAIT_FOR_START_MS` chưa được export. Tạm khai báo nó thì:
- "bounds the TCP connect" FAIL vì options thứ hai không có `timeout`.
- "does not wait longer" FAIL vì `close()` chờ tới khi `release()` được gọi, tức là treo tới khi Jest timeout.
- "retries after a connect that times out" đã PASS với code hiện tại (nhánh catch có sẵn). Giữ test này để khoá hành vi.

- [ ] **Step 3: Sửa `connection-manager.ts`**

Thêm hằng ngay dưới các dòng import:

```ts
/** How long close() waits for a connect still in progress; a connection that opens later is closed at once. */
export const CLOSE_WAIT_FOR_START_MS = 2000;
```

Trong `doStart()`, thay lời gọi connect:

```ts
            connection = await amqp.connect(this.connectOptions, {
                clientProperties: { connection_name: this.connectionName },
                // A broker that drops packets must not hang the connect until the OS gives up.
                // amqplib clears this socket timeout once the connection is open.
                timeout: this.reliability.readyTimeoutMs,
            });
```

Trong `close()`, thay khối chờ `this.starting`:

```ts
        // Wait for an in-flight start(), but not for a connect that never answers: doStart() closes
        // a connection that opens after shutdown began.
        if (this.starting) {
            await withTimeout(this.starting, CLOSE_WAIT_FOR_START_MS, 'close: connect still pending').catch(() => undefined);
        }
```

`withTimeout` (`lib/utils/deferred.ts:26-32`) clear timer trong `finally`, nên không để lại timer khi start xong trước hạn.

- [ ] **Step 4: Chạy test để thấy pass**

Run: `npx jest test/connection-manager.spec.ts`
Expected: PASS toàn bộ, kể cả hai test có sẵn "waits for an in-flight start() before close() resolves" và "close() waits for the real start even after a duplicate start() call". Hai test đó thả connect ngay nên vẫn đúng với thời gian chờ có giới hạn.

- [ ] **Step 5: Cập nhật docs**

README, bullet "Shutdown" trong mục Reliability: thêm câu sau ngay sau câu "The drain runs once, ...":

```markdown
If the broker cannot be reached when shutdown starts, closing waits at most 2 s for a connection attempt still in progress; each attempt gives up after `readyTimeoutMs`.
```

CHANGELOG `## [0.4.0]` → `### Fixed`, thêm dòng:

```markdown
- A connection attempt to a broker that does not answer (packets dropped) gives up after `readyTimeoutMs` and is retried, and shutdown no longer waits for it: before, SIGTERM during such an attempt could block until the operating system's TCP timeout.
```

- [ ] **Step 6: Chạy toàn bộ kiểm tra**

Run: `npm test && npm run typecheck`
Expected: tất cả PASS (136 test cũ + 3 test mới = 139).

Run integration (lệnh ở Global Constraints).
Expected: tất cả PASS. Nếu có broker plugin delayed thì chạy thêm với `RABBITMQ_DELAYED_URL`/`RABBITMQ_DELAYED_MANAGEMENT_URL` (xem README mục Contributing).

- [ ] **Step 7: Kiểm chứng lại bằng kịch bản thật của agent C**

Script tái hiện nằm ở scratchpad `test-shutdown/unreach.js` (đường dẫn đầy đủ trong `test-shutdown-report.md`). Run: `npm run build` trong repo, rồi `node unreach.js 127.0.0.2 <appdir> x` theo hướng dẫn trong report, gửi SIGTERM.
Expected: process thoát trong khoảng `shutdownTimeoutMs` + 2 giây (trước khi sửa: 70 giây).

- [ ] **Step 8: Checkpoint (không commit)**

Báo controller: danh sách file đã đổi, số test, thời gian thoát đo được ở Step 7. Controller chụp snapshot bằng `snapshot.sh`.

---

### Task 2: Khai báo `peerDependencies`

**Vấn đề (agent C):** `package.json` không có `peerDependencies`; Nest chỉ nằm trong `devDependencies` (`@nestjs/common ^10.0.0`, `@nestjs/core ^11.1.2`). Lib đã chạy được trên Nest 10.4.22 và Nest 11 (đã test), nhưng không chỗ nào khai báo khoảng hỗ trợ, nên app dùng Nest 9 hay Nest 12 không nhận được cảnh báo nào.

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md` (mục `### Changed` của 0.4.0)

**Interfaces:**
- Consumes: không.
- Produces: không.

- [ ] **Step 1: Thêm `peerDependencies`**

Trong `package.json`, thêm ngay sau `"dependencies"`:

```json
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0"
  },
```

Không thêm `mongoose`/`typeorm`: chúng chỉ cần cho phần saga persistence (ngoài phạm vi), và thêm peer bắt buộc sẽ làm app không dùng chúng bị cảnh báo.

- [ ] **Step 2: Kiểm tra**

Run: `npm install --legacy-peer-deps --package-lock-only` rồi `npm ls @nestjs/common @nestjs/core reflect-metadata`
Expected: không có lỗi `invalid`.

Run: `npm pack --dry-run`
Expected: vẫn 239 file (hoặc chênh do Task 1 không đổi file trong `dist`), `package.json` trong tarball có `peerDependencies`.

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: CHANGELOG**

`## [0.4.0]` → `### Changed`, thêm dòng:

```markdown
- `peerDependencies` now declare the supported NestJS versions (10 and 11) and `reflect-metadata`.
```

- [ ] **Step 4: Checkpoint (không commit)**

Báo controller danh sách file đã đổi và kết quả lệnh. Controller chụp snapshot.

---

### Task 3: Shutdown không vượt `shutdownTimeoutMs` khi broker ngừng trả lời

**Bug (agent B bug 1, đã kiểm chứng bằng đọc code):**
- `ConsumerRunner.drain()` `await channel.cancel(consumerTag)` trước khi bắt đầu tính ngân sách drain, và lệnh cancel không có giới hạn (`lib/factories/brokers/rabbitmq/consumer-runner.ts:106`).
- `ConnectionManager.close()` `await this.channels.closeAll()` và `connection.close()` không có giới hạn (`connection-manager.ts:146-149`; `channel-registry.ts:88-92`).
- Đo trên broker bị `docker pause` với `shutdownTimeoutMs = 5000`: `stopConsuming()` mất 45,1 giây, `close()` mất 30,2 giây. Script: scratchpad `test-chaos/repro-stalled-shutdown.js`.

**Cách sửa:**
- `drain()` lấy deadline = lúc bắt đầu + `timeoutMs`. Lệnh cancel và việc chờ message đang xử lý cùng dùng phần thời gian còn lại.
- `close()` của `ConnectionManager` giới hạn đóng channel và đóng connection trong `CLOSE_TIMEOUT_MS = 2000`. Quá hạn thì huỷ socket bên dưới (`connection.connection.stream.destroy()`; `ChannelModel.connection` ở `amqplib/lib/channel_model.js:18`, `Connection.stream` ở `amqplib/lib/connection.js:40`) để process thoát được. Broker sẽ thấy connection đứt và tự trả lại message chưa ack.

**Files:**
- Modify: `lib/factories/brokers/rabbitmq/consumer-runner.ts` (`drain`)
- Modify: `lib/factories/brokers/rabbitmq/connection-manager.ts` (`close`)
- Test: `test/consumer-runner.spec.ts`, `test/connection-manager.spec.ts`
- Modify: `README.md` (bullet Shutdown), `CHANGELOG.md` (`### Fixed`)

**Interfaces:**
- Consumes: `withTimeout` (`lib/utils/deferred.ts:26`), `CLOSE_WAIT_FOR_START_MS` (Task 1).
- Produces: hằng `CLOSE_TIMEOUT_MS` export từ `connection-manager.ts`.

- [ ] **Step 1: Viết test thất bại**

Đọc `test/consumer-runner.spec.ts` và `test/support/fake-amqp.ts` trước để dùng đúng helper tạo runner và channel giả. Thêm test vào `describe` chính của `test/consumer-runner.spec.ts`, theo cách các test có sẵn tạo runner (tên helper ở đây là `createRunner`; đổi cho khớp file):

```ts
  it('counts a cancel that never answers against the drain budget', async () => {
    const { runner, channel } = await createRunner();
    channel.cancel = jest.fn(() => new Promise(() => undefined)) as any; // the broker stopped answering
    const startedAt = Date.now();
    await runner.stop(200);
    expect(Date.now() - startedAt).toBeLessThan(400);
  });
```

Thêm vào `describe('ConnectionManager edge cases', ...)` trong `test/connection-manager.spec.ts`, và thêm `CLOSE_TIMEOUT_MS` vào dòng import từ `connection-manager`:

```ts
  it('gives up closing a connection the broker no longer answers and destroys its socket', async () => {
    const { broker, manager } = create();
    await manager.start();
    const connection = broker.connections[0] as any;
    const destroy = jest.fn();
    connection.connection = { stream: { destroy } };
    connection.close = jest.fn(() => new Promise(() => undefined));
    const startedAt = Date.now();
    await manager.close();
    expect(Date.now() - startedAt).toBeLessThan(CLOSE_TIMEOUT_MS + 500);
    expect(destroy).toHaveBeenCalled();
  }, CLOSE_TIMEOUT_MS + 5000);
```

Nếu `FakeConnection` đã có thuộc tính `connection`, giữ nguyên và chỉ gán `stream`.

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `npx jest test/consumer-runner.spec.ts test/connection-manager.spec.ts -t "never answers|no longer answers"`
Expected: cả hai FAIL vì Jest timeout (lệnh cancel hoặc close treo mãi).

- [ ] **Step 3: Sửa `consumer-runner.ts`**

Thay thân `drain()`:

```ts
    private async drain(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        const remaining = () => Math.max(0, deadline - Date.now());
        ++this.attempt;
        this.stopping = true;
        this.clearRestart();
        const { channel, consumerTag } = this;
        if (channel && consumerTag) {
            // A broker that stopped answering must not hold shutdown past its budget.
            await withTimeout(channel.cancel(consumerTag), remaining(), 'cancel timeout').catch(() => undefined);
        }
        if (this.inFlight.size > 0) {
            Logger.log(`[RabbitMQ] Waiting for ${this.inFlight.size} message(s) on '${this.def.queue}' before shutdown`);
            try {
                await withTimeout(Promise.allSettled([...this.inFlight]), remaining(), 'drain timeout');
            } catch {
                Logger.warn(
                    `[RabbitMQ] ${this.inFlight.size} message(s) on '${this.def.queue}' were still running after ${timeoutMs}ms; ` +
                    'the broker will redeliver them',
                );
            }
        }
        this.state = 'stopped';
    }
```

- [ ] **Step 4: Sửa `connection-manager.ts`**

Thêm hằng cạnh `CLOSE_WAIT_FOR_START_MS`:

```ts
/** How long close() waits for channels and the connection to close before it drops the socket. */
export const CLOSE_TIMEOUT_MS = 2000;
```

Trong `close()`, thay hai lệnh `await this.channels.closeAll();` và khối `if (connection) { await connection.close()... }`:

```ts
        const closed = (async () => {
            await this.channels.closeAll();
            if (connection) {
                await connection.close().catch((err) => Logger.warn(`[RabbitMQ] Error while closing the connection: ${err.message}`));
            }
        })();
        try {
            await withTimeout(closed, CLOSE_TIMEOUT_MS, 'close timeout');
        } catch {
            Logger.warn(`[RabbitMQ] The broker did not answer the close within ${CLOSE_TIMEOUT_MS}ms; dropping the connection`);
            closed.catch(() => undefined);
            const socket = (connection as unknown as { connection?: { stream?: { destroy?: () => void } } } | null)?.connection?.stream;
            socket?.destroy?.();
        }
```

Khối chờ `this.starting` (Task 1) giữ nguyên, nằm sau đoạn này.

- [ ] **Step 5: Chạy test để thấy pass**

Run: `npx jest test/consumer-runner.spec.ts test/connection-manager.spec.ts`
Expected: PASS toàn bộ.

- [ ] **Step 6: Docs**

README, bullet "Shutdown": thay câu "The drain runs once, so shutdown takes at most about `shutdownTimeoutMs` plus the time to close the connection." bằng:

```markdown
The drain runs once, so shutdown takes at most `shutdownTimeoutMs` plus about 2 s to close the connection, even when the broker has stopped answering.
```

CHANGELOG `### Fixed` của 0.4.0, thêm:

```markdown
- Shutdown keeps to `shutdownTimeoutMs` when the broker stops answering: cancelling consumers counts against the drain budget, and closing channels and the connection gives up after 2 s.
```

- [ ] **Step 7: Kiểm chứng bằng script của agent B**

Script `repro-stalled-shutdown.js` ở scratchpad `test-chaos/` cần broker riêng có thể `docker pause`. Dựng lại container theo lệnh trong `test-chaos-report.md` (port 5674, tên `bt-chaos`), không đụng container RabbitMQ của chủ repo. Chạy `npm run build` rồi script.
Expected: `stopConsuming()` + `close()` ≤ `shutdownTimeoutMs` + khoảng 2 giây (trước khi sửa: 45,1 + 30,2 giây). Xoá container khi xong.

- [ ] **Step 8: Checkpoint (không commit)**

Báo controller: file đã đổi, số test, thời gian đo ở Step 7.

---

### Task 4: Tự khôi phục topology định kỳ

**Bug (agent B bug 3, đã kiểm chứng bằng đọc code):**
- Ops xoá exchange của message (ví dụ `<prefix>:MsgB`): publisher nhận 404 rồi tạo lại exchange (`publisher.ts` `ensurePublishTarget`), nhưng không có binding sang exchange của queue. Mọi message sau đó unroutable, chỉ được log; `Publish` vẫn resolve. Đo được 4.666 message mất trong 70 giây, tới khi reconnect.
- Ops xoá exchange phía queue (`<prefix>:<queue>`): consumer vẫn ở trạng thái `consuming` vì không có gì báo cho nó; 2.001 message mất.
- Binding giữa các exchange chỉ được khai báo ở `onConnected` (`bustransit-broker.rabbitmq.ts:150-155`, `declareTopology` trong `topology.ts`), tức là chỉ khi kết nối lại. Process publish và process consume có thể khác nhau (api-portal publish, service-bus consume), nên process consume không có cách nào biết exchange vừa bị xoá.
- Script: scratchpad `test-chaos/repro-exchange-delete.js`.

**Cách sửa (chủ repo chọn):** sau mỗi lần setup thành công, facade hẹn giờ chạy lại toàn bộ khai báo topology của process mỗi `topologyRefreshMs` (mặc định 60000):
- Các khai báo từ `buildTopology` (exchange của message, binding sang exchange của queue).
- Với mỗi queue có runner: exchange của queue và binding queue ← exchange.
- Với queue đang bật redelivery: delay exchange và binding queue ← delay exchange.

Cách hoạt động:
- Mọi lệnh khai báo đều idempotent. Các lệnh `forgetExchange` đi trước `ensureExchange` để bỏ qua cache.
- Mỗi lúc chỉ có một vòng chạy. Không chạy khi chưa kết nối hoặc khi đang dừng. Timer được huỷ khi mất kết nối, khi `stopConsuming()` hoặc `close()`, và dùng `unref()`.
- Lỗi được log ở mức warn, không bao giờ ném ra ngoài. Mỗi queue được bọc try/catch riêng, để một queue lỗi không chặn các queue khác.

**Files:**
- Modify: `lib/factories/brokers/rabbitmq/reliability-options.ts` (thêm `topologyRefreshMs`)
- Modify: `lib/factories/brokers/bustransit-broker.rabbitmq.ts` (timer và `refreshTopology`)
- Modify: `lib/factories/brokers/rabbitmq/topology.ts` (`declareTopology` nhận tuỳ chọn bỏ qua cache)
- Test: `test/reliability-options.spec.ts`, `test/rabbitmq-broker.spec.ts`, `test/integration/rabbitmq.int-spec.ts`
- Modify: `README.md` (Reliability), `CHANGELOG.md` (`### Fixed`, `### Added`)

**Interfaces:**
- Consumes: `Publisher.forgetExchange(name)`, `Publisher.ensureExchange(name)`, `Publisher.declareDelayedExchange(name)`, `Publisher.bindQueue(queue, exchange)`, `Publisher.bindExchange(destination, source)` (đều đã có); `ConnectionManager.onDisconnected`, `isConnected`.
- Produces: `ReliabilityOptions.topologyRefreshMs: number` (mặc định 60000; `UseReliability({ topologyRefreshMs })`); `declareTopology(publisher, declarations, prefix, { force?: boolean })`.

- [ ] **Step 1: Thêm `topologyRefreshMs`**

Trong `reliability-options.ts`, interface `ReliabilityOptions` thêm:

```ts
    /** How often a consuming process declares its exchanges and bindings again, so topology an operator deleted comes back. */
    topologyRefreshMs: number;
```

`DEFAULT_RELIABILITY` thêm `topologyRefreshMs: 60000,`. Hàm `resolveReliability` đã kiểm tra mọi key là số dương nên không cần sửa.

Test trong `test/reliability-options.spec.ts`:

```ts
  it('refreshes topology every 60 s by default and accepts an override', () => {
    expect(resolveReliability().topologyRefreshMs).toBe(60000);
    expect(resolveReliability({ topologyRefreshMs: 5000 }).topologyRefreshMs).toBe(5000);
    expect(() => resolveReliability({ topologyRefreshMs: 0 })).toThrow('reliability.topologyRefreshMs');
  });
```

- [ ] **Step 2: `declareTopology` nhận `force`**

Trong `topology.ts`, đổi chữ ký và dùng `forgetExchange` khi `force`:

```ts
export async function declareTopology(
    publisher: Pick<Publisher, 'ensureExchange' | 'bindExchange' | 'forgetExchange'>,
    declarations: ExchangeDeclaration[],
    prefix: (name: string) => string,
    options: { force?: boolean } = {},
): Promise<void> {
    const ensure = (name: string) => {
        if (options.force) publisher.forgetExchange(name);
        return publisher.ensureExchange(name);
    };
    for (const { exchange, bindTo } of declarations) {
        if (!exchange) {
            Logger.warn('[RabbitMQ] Skipped an exchange without a name: a consumer has no message class');
            continue;
        }
        try {
            await ensure(prefix(exchange));
            if (bindTo) {
                await ensure(prefix(bindTo));
                await publisher.bindExchange(prefix(bindTo), prefix(exchange));
            }
        } catch (err) {
            const target = bindTo ? ` -> '${prefix(bindTo)}'` : '';
            Logger.error(`[RabbitMQ] Could not declare exchange '${prefix(exchange)}'${target}: ${err.message}`);
        }
    }
}
```

Nếu `test/topology.spec.ts` dựng publisher giả chỉ có `ensureExchange`/`bindExchange`, thêm `forgetExchange: jest.fn()` vào đó.

- [ ] **Step 3: Viết test thất bại cho facade**

Trong `test/support/broker-fixture.ts`, cho phép ghi đè reliability. Thêm vào `BrokerFixtureOptions`:

```ts
  reliability?: Partial<typeof TEST_RELIABILITY> & { topologyRefreshMs?: number };
```

và trong `startBroker`, đổi `reliability: TEST_RELIABILITY,` thành:

```ts
    reliability: { ...TEST_RELIABILITY, ...(opts.reliability ?? {}) },
```

Thêm hai test vào `describe('BusTransitBrokerRabbitMqFactory', ...)` trong `test/rabbitmq-broker.spec.ts`. Dùng `PingConsumer` từ `./support/topology-fixture` (đã import ở đầu file) và helper `pingEndpoint` có sẵn trong file. Fake broker ghi binding queue với `dest` là `queue:<tên queue>` (`test/support/fake-amqp.ts:142-148`), và binding exchange→exchange với `{ source, dest }` (`:122-130`).

```ts
  it('declares exchanges and bindings again on a timer, so a deleted exchange comes back', async () => {
    const { bus, broker } = await startBroker({
      consumers: { PingConsumer },
      endpoints: { ping: pingEndpoint(PingConsumer) },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
      reliability: { topologyRefreshMs: 50 },
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    const messageExchange = 'linkadz:PingMessage';
    const queueExchange = 'linkadz:ping';
    expect(broker.exchanges.has(messageExchange)).toBe(true);

    // An operator deletes both exchanges; RabbitMQ drops their bindings with them.
    broker.exchanges.delete(messageExchange);
    broker.exchanges.delete(queueExchange);
    broker.bindings = broker.bindings.filter(
      (b) => ![b.source, b.dest].some((name) => name === messageExchange || name === queueExchange),
    );
    const connectionsBefore = broker.connections.length;

    await eventually(() => broker.exchanges.has(messageExchange) && broker.exchanges.has(queueExchange));
    await eventually(() => broker.bindings.some((b) => b.source === messageExchange && b.dest === queueExchange));
    await eventually(() => broker.bindings.some((b) => b.source === queueExchange && b.dest === 'queue:ping'));
    expect(broker.connections.length).toBe(connectionsBefore); // no reconnect needed
    await bus.close();
  });

  it('stops refreshing topology after stopConsuming()', async () => {
    const { bus, broker } = await startBroker({
      consumers: { PingConsumer },
      endpoints: { ping: pingEndpoint(PingConsumer) },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
      reliability: { topologyRefreshMs: 50 },
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    await bus.stopConsuming();
    const asserted = broker.asserts.length;
    await sleep(200);
    expect(broker.asserts.length).toBe(asserted);
    await bus.close();
  });
```

Trước khi chạy, mở `test/support/topology-fixture.ts` để chắc tên message class của `PingConsumer` là `PingMessage`. Nếu khác thì đổi hằng `messageExchange` cho khớp, theo dạng `linkadz:<MessageClass>`.

Run: `npx jest test/rabbitmq-broker.spec.ts -t "refresh"`
Expected: test đầu FAIL vì chưa có timer, nên exchange không bao giờ được tạo lại. Test thứ hai có thể pass sẵn; giữ nó để khoá hành vi.

- [ ] **Step 4: Cài timer trong facade**

Trong `bustransit-broker.rabbitmq.ts`:

Thêm field cạnh `consumersStopping`:

```ts
    private declarations: ExchangeDeclaration[] = [];
    private topologyTimer: NodeJS.Timeout | null = null;
    private refreshingTopology = false;
```

Import `ExchangeDeclaration` từ `./rabbitmq/topology`.

Trong `setBrokerConfig`, ngay sau khi tạo `this.manager`, đăng ký huỷ timer khi mất kết nối:

```ts
        this.manager.onDisconnected(() => this.clearTopologyRefresh());
```

Trong `onConnected()`, gán `this.declarations = declarations;` ngay sau `await declareTopology(...)`, và gọi `this.scheduleTopologyRefresh();` ở cuối hàm, sau `await Promise.all(...runner.start())`. Lệnh `return` sớm khi `consumersStopping` thì không hẹn giờ.

Trong `stopConsuming()`, ngay sau `this.consumersStopping = true;`, thêm `this.clearTopologyRefresh();`. `close()` gọi `stopConsuming()` nên không cần thêm.

Thêm các hàm private:

```ts
    private scheduleTopologyRefresh(): void {
        this.clearTopologyRefresh();
        if (this.consumersStopping || !this.manager?.isConnected) return;
        this.topologyTimer = setTimeout(() => {
            this.topologyTimer = null;
            void this.refreshTopology().finally(() => this.scheduleTopologyRefresh());
        }, this.reliability.topologyRefreshMs);
        this.topologyTimer.unref();
    }

    private clearTopologyRefresh(): void {
        if (this.topologyTimer) clearTimeout(this.topologyTimer);
        this.topologyTimer = null;
    }

    /** Declares every exchange and binding of this process again: an operator may have deleted some since. */
    private async refreshTopology(): Promise<void> {
        if (this.refreshingTopology || this.consumersStopping || !this.manager?.isConnected) return;
        this.refreshingTopology = true;
        const publisher = this.requirePublisher();
        const prefix = (name: string) => this.getNameAddClusterPrefix(name);
        try {
            await declareTopology(publisher, this.declarations, prefix, { force: true });
            for (const queueName of this.runners.keys()) {
                try {
                    const queueExchange = prefix(queueName);
                    publisher.forgetExchange(queueExchange);
                    await publisher.ensureExchange(queueExchange);
                    await publisher.bindQueue(queueName, queueExchange);
                    if (this.queueRedeliveryEnabled.get(queueName)) {
                        const delayExchange = prefix(`delayed.exchange.${queueName}`);
                        publisher.forgetExchange(delayExchange);
                        await publisher.declareDelayedExchange(delayExchange);
                        await publisher.bindQueue(queueName, delayExchange);
                    }
                } catch (err) {
                    Logger.warn(`[RabbitMQ] Topology refresh for queue '${queueName}' failed: ${err.message}`);
                }
            }
        } catch (err) {
            Logger.warn(`[RabbitMQ] Topology refresh failed: ${err.message}`);
        } finally {
            this.refreshingTopology = false;
        }
    }
```

Ghi chú:
- `bindQueue` vào một queue vừa bị xoá trả 404 và đóng channel `_topology` dùng chung. Registry tự mở lại channel đó ở lần dùng sau; consumer của queue đó tự restart vì broker đã cancel nó.
- Một queue lỗi chỉ được log, không chặn các queue khác.

- [ ] **Step 5: Chạy test để thấy pass**

Run: `npx jest test/rabbitmq-broker.spec.ts test/topology.spec.ts test/reliability-options.spec.ts`
Expected: PASS.

- [ ] **Step 6: Integration test trên broker thật**

Thêm vào `test/integration/rabbitmq.int-spec.ts`. File đã import `BusTransitConsumer`, `ConsumerConfigurator`, `createBus`, `eventually` (helper integration nhận callback async có `expect`), `rawChannel`. `createBus` nhận `reliability`.

```ts
  it('brings back a deleted message exchange and its binding without a reconnect', async () => {
    class Refreshed {
      n: number;
    }
    const seen: number[] = [];
    class RefreshedConsumer extends BusTransitConsumer<Refreshed> {
      constructor() {
        super(Refreshed);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        seen.push(context.Message.n);
      }
    }
    const queue = `${prefix}-refresh`;
    const endpoint = new ConsumerConfigurator();
    endpoint.bindQueue(queue);
    endpoint.bindConsumer(RefreshedConsumer);
    const consumerBus = createBus(prefix, {
      consumers: { RefreshedConsumer },
      endpoints: { [queue]: endpoint },
      instances: new Map<unknown, unknown>([[RefreshedConsumer, new RefreshedConsumer()]]),
      reliability: { topologyRefreshMs: 500 },
    });
    // Another process that only publishes, like api-portal.
    const publisherBus = createBus(prefix, { messages: { Refreshed } });
    await consumerBus.start();
    await publisherBus.start();

    await publisherBus.publish(Object.assign(new Refreshed(), { n: 1 }));
    await eventually(async () => expect(seen).toContain(1));

    const { connection, channel } = await rawChannel();
    await channel.deleteExchange(`${prefix}:Refreshed`);
    await connection.close();

    // Publish every 100 ms; consumption must resume once the consumer's refresh re-binds the exchange.
    let n = 2;
    const deletedAt = Date.now();
    const ticker = setInterval(() => {
      void publisherBus.publish(Object.assign(new Refreshed(), { n: n++ })).catch(() => undefined);
    }, 100);
    try {
      await eventually(async () => expect(seen.some((value) => value >= 2)).toBe(true), 5000);
    } finally {
      clearInterval(ticker);
    }
    expect(Date.now() - deletedAt).toBeLessThan(3000);
    expect(consumerBus.health().connected).toBe(true);
    await publisherBus.close();
    await consumerBus.close();
  });
```

Ghi chú:
- `context.Message` là cách các consumer có sẵn trong file đọc payload. Nếu file dùng tên khác (xem `BoomConsumer`), đổi cho khớp.
- Test không cần đếm connection qua management API: `health().connected` vẫn `true` và tổng thời gian dưới 3 giây (một lần reconnect mất ít nhất `reconnectDelayMs` 5 giây) là đủ chứng minh không có reconnect.

Run: integration (lệnh ở Global Constraints).
Expected: PASS, kể cả các test cũ.

- [ ] **Step 7: Kiểm chứng bằng script của agent B**

Chạy `repro-exchange-delete.js` (scratchpad `test-chaos/`) trên container `bt-chaos` dựng lại như Task 3 Step 7, với `topologyRefreshMs` mặc định.
Expected: message ngừng bị bỏ trong vòng khoảng 60 giây sau khi xoá, không cần reconnect (trước khi sửa: 70 giây tới khi reconnect, 4.666 message). Xoá container khi xong.

- [ ] **Step 8: Docs**

README, mục Reliability, thay bullet "Do not delete delay exchanges or their bindings." bằng:

```markdown
- **Deleted topology comes back.** A consuming process declares its exchanges and bindings again every `topologyRefreshMs` (60 s by default). If an operator deletes an exchange or a binding, messages published to it in the meantime are dropped (logged as `Unroutable message`; `Publish` still resolves) until the next refresh. Do not delete exchanges or bindings of a running system.
```

Bỏ câu "If the exchange is deleted, failed messages go to `<queue>_error` until the consumer's next start..." nếu còn, hoặc đổi "the consumer's next start" thành "the next topology refresh or consumer start".

CHANGELOG 0.4.0:
- `### Fixed`: `- An exchange or binding deleted while the app runs is declared again within `topologyRefreshMs` (60 s by default). Before, messages to it were dropped until the next reconnect.`
- `### Added`: thêm `topologyRefreshMs` vào dòng mô tả `cfg.UseReliability({...})`.
- `### Known limitations`: sửa câu về delay exchange cho khớp (redelivery quay lại ở lần refresh tiếp theo).

- [ ] **Step 9: Checkpoint (không commit)**

Báo controller: file đã đổi, số test, kết quả Step 7.

---

### Task 5: Log và thông báo lỗi gây hiểu nhầm

**Vấn đề (agent B, không phải bug):**
1. Mỗi lần mất kết nối, log in "Restarting the consumer of '<queue>' in 5000ms" (`consumer-runner.ts:172`), dù việc restart đó bị huỷ ngay khi `onDisconnected` chạy. Nguyên nhân: amqplib đóng channel trước, lúc đó connection vẫn còn.
2. Publish đang chờ confirm khi connection đứt reject với câu trần "channel closed" của amqplib (`publisher.ts:269-270`, không có `closeReasons`).
3. README chưa nói: publish bị reject vì timeout hoặc channel đóng vẫn có thể đã tới broker, nên retry có thể tạo bản trùng.

**Files:**
- Modify: `lib/factories/brokers/rabbitmq/consumer-runner.ts`, `lib/factories/brokers/rabbitmq/publisher.ts`
- Test: `test/consumer-runner.spec.ts`, `test/publisher.spec.ts`
- Modify: `README.md`

**Interfaces:** không đổi.

- [ ] **Step 1: Test cho thông báo lỗi**

Trong `test/publisher.spec.ts`, ngay sau test có sẵn "rejects a publish in flight when the connection drops, and publishes again after reconnecting" (`:116-127`), thêm:

```ts
  it('explains a publish lost with its connection', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:A', {});
    broker.holdConfirms = true;
    const inFlight = publisher.publishToExchange('linkadz:A', {});
    await sleep(5);
    broker.holdConfirms = false;
    broker.connections[0].drop();
    await expect(inFlight).rejects.toThrow(/connection was lost.*may or may not have been delivered/i);
    await manager.close();
  });
```

Test có sẵn mong `/channel closed/i`. Thông báo mới vẫn chứa cụm "channel closed" nên test đó không cần sửa.

Run: `npx jest test/publisher.spec.ts -t "explains a publish lost"`
Expected: FAIL. Thông báo hiện tại là "channel closed" của amqplib.

- [ ] **Step 2: Sửa thông báo trong `publisher.ts`**

Ở chỗ reject khi confirm callback nhận lỗi (gần `:269-270`):

```ts
                    // amqplib reports "channel closed"; the broker's reason (e.g. 404 NOT_FOUND) is more useful.
                    const reason = this.closeReasons.get(channel);
                    reject(
                        reason ??
                        new Error(
                            `[RabbitMQ] The producer channel closed before the broker confirmed the message ` +
                            `(${err.message}; the connection was lost?). It may or may not have been delivered.`,
                        ),
                    );
```

- [ ] **Step 3: Log restart đúng lúc**

Trong `consumer-runner.ts`, chuyển dòng `Logger.warn(\`[RabbitMQ] Restarting the consumer of ...\`)` từ lúc hẹn giờ vào trong callback của timer, ngay trước khi gọi start lại. Nội dung:

```ts
Logger.warn(`[RabbitMQ] Restarting the consumer of '${this.def.queue}' (waited ${delay}ms)`);
```

Lúc hẹn giờ chỉ ghi `Logger.debug`. Test: nếu `test/consumer-runner.spec.ts` có test kiểm tra nội dung log này, sửa cho khớp. Không thêm test mới cho log.

- [ ] **Step 4: README**

Bullet "Await every publish." trong mục Reliability, thêm câu cuối:

```markdown
A rejected publish may still have reached the broker (for example when the connection dropped before the confirm arrived), so retrying it can deliver the message twice.
```

- [ ] **Step 5: Chạy toàn bộ kiểm tra**

Run: `npm test && npm run typecheck`, rồi integration (lệnh ở Global Constraints).
Expected: PASS.

- [ ] **Step 6: Checkpoint (không commit)**

Báo controller file đã đổi và số test.

---

### Task 6: Kiểm chứng lại toàn bộ bằng các kịch bản đã làm lộ bug

Không đổi code. Chạy lại harness của agent B (scratchpad `test-chaos/harness.js`) trên container `bt-chaos` dựng lại, cho các kịch bản: `docker restart`, pause 15 s / 70 s / 200 s, kill connection mỗi 10 s, memory alarm, xoá queue/exchange, shutdown dưới tải, và soak rút ngắn 10 phút. Chạy thêm script của agent C (`test-shutdown/unreach.js`).

- [ ] **Step 1: Chạy và ghi số liệu** vào `.superpowers/sdd/2026-10-11-rabbitmq-channel-recovery/test-rerun-report.md` theo cùng bảng với `test-chaos-report.md`.

Expected:
- Không mất message nào có `Publish` resolve, ngoại trừ khoảng tối đa `topologyRefreshMs` sau khi xoá exchange (đã ghi trong README).
- Pause 200 s: reconnect không còn treo tới khi unpause.
- Shutdown khi broker pause: ≤ `shutdownTimeoutMs` + khoảng 2 giây.
- Không có unhandled rejection; số channel ổn định.

- [ ] **Step 2: Xoá container `bt-chaos`.** Không đụng container RabbitMQ của chủ repo.

- [ ] **Step 3: Checkpoint (không commit)**

## Ngoài phạm vi

- `Host()` gán cứng `port: 5672` (`lib/factories/rabbitmq-bus-factory.configurator.ts:45`), có từ 0.3.x. `RabbitmqHostSettings` (`lib/factories/rabbitmq-host.settings.ts`) chỉ có `Username`/`Password`, nên không có cách đổi port. Cần plan riêng nếu muốn hỗ trợ (ví dụ thêm `Port(port)` vào host settings).
- Các mục bắt buộc sửa ở app (service-bus, api-portal) trong `gap-review-apps.md`.
