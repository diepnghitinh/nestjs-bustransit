# RabbitMQ Transport Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Viết lại tầng RabbitMQ của nestjs-bustransit sao cho lỗi của một channel, một exchange hay một consumer chỉ ảnh hưởng tới đúng phần đó. Không còn kiểu một lỗi 404 làm chết toàn bộ publish như sự cố api-portal ngày 06/10/2026. Mọi lỗi phải được báo về đúng lệnh gây ra nó.

**Architecture:** `BusTransitBrokerRabbitMqFactory` (hiện 724 dòng, ôm mọi việc) trở thành một facade mỏng, ghép các thành phần nhỏ trong `lib/factories/brokers/rabbitmq/`, mỗi thành phần có test riêng:
- `ConnectionManager`: vòng đời connection, gồm ready, reconnect, blocked và shutdown.
- `ChannelRegistry`: tự bỏ channel đã chết.
- `Publisher`: confirm channel riêng; trước khi publish, kiểm tra exchange có tồn tại không trên một channel topology riêng và chỉ tạo khi còn thiếu; có cache tự xoá khi producer channel chết, timeout khi broker không xác nhận.
- `ConsumerRunner`: mỗi queue một runner độc lập, tự khởi động lại với backoff, drain khi shutdown.
- Delivery pipeline: ack, retry, redelivery, error queue; mọi lệnh ghi đều qua confirm.
- `RequestClient` cho `Send`, `probeDelayedMessagePlugin` chạy trên connection riêng, `buildTopology` là hàm thuần.

Topology, tên exchange và tên queue giữ nguyên. Một test đặc tả (characterization test) viết trên code cũ ở Task 1 đảm bảo điều này.

**Tech Stack:** TypeScript 5 (ES2021, commonjs), NestJS 10/11, amqplib 0.10.x, rxjs 7, Jest 29 + ts-jest (mới), GitHub Actions có service container `rabbitmq:3.13-management` (mới).

**Đã kiểm chứng:** Toàn bộ code và test trong plan đã được áp lên một bản sao của commit 7740e1a và chạy thật: 92 unit test pass ổn định qua nhiều lần chạy (kể cả khi chạy song song 4 bộ để giả lập máy tải nặng), typecheck của `lib` và `test` sạch, `npm run build` thành công, integration test compile được và tự bỏ qua khi không có broker. 6 integration test cũng đã chạy xanh 3 lần liên tiếp trên RabbitMQ 3.13.7 thật (`rabbitmq:3-management-alpine`, không có plugin delayed-message, vhost `linkadz`). Trên cùng broker đó, sự cố 06/10 tái hiện y hệt với thư viện 0.3.1 và không còn xảy ra với bản sửa. Chạy trên broker thật còn lộ ra một lỗi hồi quy mà broker giả không bắt được (xem quyết định thiết kế đầu tiên bên dưới).

**Spec:** Chưa có file spec trong repo. Plan dựa trên các trang review sau, và mọi số dòng trong plan đều đã đối chiếu với source:
- https://claude.ai/artifact/3MZzyJsFos7jZe5iuaq2DY (Bustransit có gây Channel closed?)
- https://claude.ai/artifact/LtPgeMfBGCGu2HCRxr2KYv (Deep Review)
- https://claude.ai/artifact/UTmAgQcy8LMnBydGHgs1bN (báo cáo sự cố)

Yêu cầu:
1. Channel bị broker đóng phải được thay bằng channel mới. Lỗi ở một channel không làm hỏng publish hay consume ở chỗ khác.
2. Publisher bảo đảm exchange đích tồn tại trước khi publish: dùng nguyên trạng nếu đã có (bất kể type hay tham số, như 0.3.x), tạo fanout durable nếu chưa có. Việc kiểm tra hay khai báo không bao giờ được làm đóng producer channel.
3. Lệnh publish bị broker từ chối, hoặc không được xác nhận trong thời hạn, phải reject đúng lệnh đó, kèm lý do từ broker.
4. Mất kết nối thì publish chờ kết nối lại có giới hạn thời gian. Shutdown thì drain message đang xử lý rồi đóng, không reconnect.
5. Một consumer lỗi (queue khai báo sai, bị broker cancel, channel chết) không chặn consumer khác hay publish, và tự thử lại với backoff.
6. Message đã thất bại chỉ được ack sau khi đã ghi chắc chắn vào error queue hoặc delayed exchange. Nếu không ghi được thì requeue, không làm mất message.
7. `Send` không rò channel và báo lỗi ngay khi queue đích không tồn tại.
8. Có API health cho healthcheck của container.

**Ngoài phạm vi (cần plan riêng):** bug saga C1, C6, C7, M1-M3; routing slip C2-C5; publish bỏ qua exchange theo message khi process có consumer (H6); RPC lồng nhau của saga (H3); `peerDependencies`.

## Quyết định thiết kế

- **Khi publish, chỉ kiểm tra exchange có tồn tại không, không assert.** Trước lần publish đầu tiên tới một exchange, Publisher dùng `checkExchange` (passive declare). Nếu exchange đã có, dùng nguyên trạng; chỉ khi broker trả 404 mới tạo fanout durable. Lý do đã được kiểm chứng trên broker thật: nếu assert với tham số của mình, một exchange đang tồn tại với tham số khác (ví dụ `durable: false` hoặc type `direct`) sẽ bị broker từ chối 406 mãi mãi. Thư viện cũ không hề khai báo phía publisher nên vẫn publish được, vì vậy assert sẽ biến một publish đang chạy tốt thành lỗi sau khi nâng cấp. Phía consumer (topology) vẫn assert như 0.3.x.
- **Exchange được kiểm tra và khai báo trên channel `_topology`, publish chạy trên channel `_producer`.** Theo AMQP, một lệnh declare bị từ chối (406, 403) sẽ đóng channel thực hiện nó. Tách hai channel ra thì một message type khai báo sai không kéo theo các lệnh publish đang chờ confirm của message type khác.
- **Cache exchange đã kiểm tra bị xoá mỗi khi `_producer` chết hoặc mất connection.** `_topology` chết (404 khi kiểm tra một exchange chưa có là chuyện bình thường) không làm xoá cache. Lý do phổ biến nhất khiến `_producer` chết là 404: một exchange mà cache tưởng còn tồn tại thì đã mất. Nếu không xoá cache, mọi lệnh publish sau đó lại 404 và kênh chết lặp đi lặp lại.
- **Kiểm tra plugin delayed-message chạy trên một connection riêng, có giới hạn thời gian, rồi đóng ngay.** Trên RabbitMQ 3.13 (đã kiểm chứng), khai báo exchange có type không tồn tại chỉ bị từ chối 406 ở mức channel, connection chính vẫn sống. Connection riêng là biện pháp phòng thủ: lệnh kiểm tra không bao giờ đụng tới connection chính dù broker phiên bản khác xử lý thế nào, và nếu lệnh kiểm tra treo thì quá trình khởi động không bị kẹt theo. Integration test ở Task 13 chạy trên image không có plugin.
- **"Ready" nghĩa là connection đã mở, producer channel sẵn sàng và đã thử khai báo topology.** Consumer được khởi động trong lúc setup, nhưng một consumer lỗi không làm setup thất bại.
- **Hành vi vhost giữ nguyên tuyệt đối.** Hiện thư viện ghép URL `amqp://u:p@host:port${vhost}`, rồi amqplib lấy phần path bỏ dấu `/` đầu (`connect.js:137`) làm vhost. Vì vậy cấu hình `/prod_linkadz` thực chất là vhost `prod_linkadz`. Bản mới truyền options dạng object với đúng giá trị đó, và giải mã username/password bằng `unescape` y như amqplib làm với URL (`connect.js:80-86`). Nhờ vậy mật khẩu chứa `@ : /` không còn làm vỡ URL.
- **Ngữ nghĩa giao nhận là at-least-once, và được ghi rõ trong tài liệu.** Message đang xử lý dở khi channel chết sẽ được broker giao lại. `Publish` bị reject vì channel đóng có thể đã kịp tới broker hoặc chưa; người gọi tự quyết định có thử lại không.

## Ghi chú thực thi (2026-10-11): code khác plan ở đâu

Plan đã được thực thi theo kiểu subagent-driven, không commit; mọi thay đổi nằm staged trên branch `fix/rabbitmq-transport-reliability` (base `7740e1a`). Các bước "Commit" trong từng task không được chạy. Code trong các task dưới đây là bản gốc của plan; review từng task và review tổng đã sửa thêm những điểm sau, và **code trong repo là bản đúng**:

- **Task 3 `ChannelRegistry`:** có bộ đếm `generation` tăng ở `clear()`/`closeAll()`; channel tạo xong ở generation cũ bị đóng và reject (`The connection was reset while the channel was opening`); pending chỉ xoá đúng promise của mình; `create()` throw đồng bộ thành rejection. `create(track)`: người tạo gọi `track(channel)` ngay sau `createChannel()`; channel đã đóng trước khi đăng ký thì không được đăng ký, tạo lại một lần rồi reject.
- **Task 4 `ConnectionManager`:** `start()` trả lại promise đang chạy; `close()` chờ lần start đang chạy; `doStart` tự lên lịch reconnect khi không có connection; listener bọc try/catch; connection mở xong sau `close()` có listener `error` trước khi đóng.
- **Task 5 probe:** connection mở muộn sau timeout có listener `error` trước khi đóng.
- **Task 6 `Publisher`:** kiểm tra exchange bằng `checkExchange` trên channel dùng-một-lần (`exchangeExists`, public), chỉ assert fanout khi thiếu; guard `declarationGeneration`; cả đường publish (kể cả bước khai báo) bị giới hạn bởi `publishTimeoutMs`; `publishRaw(..., { rejectIfUnroutable })` reject khi broker trả message về (basic.return), đồng thời quên queue trong cache.
- **Task 8 delivery pipeline:** redelivery publish lỗi thì chuyển sang error queue; `x-redelivery` không hợp lệ coi như hết lượt; bản sao vào `<queue>_error` dùng `rejectIfUnroutable`; trước redelivery kiểm tra delay exchange còn tồn tại, nếu mất thì đưa vào `<queue>_error` (không tự tạo lại, vì exchange tạo lại không có binding và plugin sẽ bỏ message).
- **Task 9 `ConsumerRunner`:** bộ đếm `attempt` tăng ở start/handleLost/onDisconnected/stop; lần start bị vượt mặt thì huỷ consumer của nó và thoát lặng lẽ.
- **Task 10 `RequestClient`:** test non-JSON kiểm `SyntaxError` và reject nhanh.
- **Task 11 facade:** `publish`/`publishAsync` chờ `whenReady()` rồi mới phân giải địa chỉ; thêm `stopConsuming()` (cũng có trong `IBusTransitBrokerInterface`, base broker và `BusTransitService`).
- **Task 12 module:** shutdown tách đôi: `beforeApplicationShutdown` gọi `stopConsuming()` (huỷ consume, drain), `onApplicationShutdown` gọi `close()` (đóng connection), để request HTTP còn dang dở vẫn publish được.
- **Task 2 `resolveReliability` / `UseReliability`:** giá trị `undefined` bị bỏ qua, dùng mặc định.
- **Task 13:** thêm test "re-creates a deleted error queue and keeps the failed message"; test tự đóng bus/connection trong `afterEach`.
- **Task 14:** CHANGELOG thêm prefetch mặc định 50, ghi chú phải `await Publish`, thay đổi interface broker; example `await` Publish.

Sửa sau gap review (`gap-review-lib.md`):

- **I1 `ConsumerRunner.stop()`:** idempotent, lần gọi thứ hai trả lại đúng promise của lần đầu; `stopConsuming()` rồi `close()` chỉ drain một lần (tổng ≈ `shutdownTimeoutMs`, không còn gấp đôi).
- **I2 delay exchange bị xoá:** `exchangeExists()` trả `false` thì xoá tên đó khỏi cache khai báo (`Publisher.forgetExchange`). `setupRedelivery` luôn assert lại delay exchange (bỏ qua cache) mỗi lần consumer start và bind queue trên channel `_topology` (`Publisher.bindQueue`), nên bind lỗi không đóng channel của consumer; consumer start lại sẽ tạo lại exchange + binding. Bind queue vào exchange của queue mà gặp 404 thì quên exchange đó trong cache để lần start sau khai báo lại.
- **I3 shutdown:** từ lúc `stopConsuming()` bắt đầu, message xử lý lỗi (sau retry tại chỗ) được `nack` requeue thay vì đưa vào delay exchange / `<queue>_error`, giống 0.3.x (giao lại sau khi restart). Lúc chạy bình thường không đổi.
- **m2:** kiểm tra delay exchange bị giới hạn bởi `publishTimeoutMs`; lỗi không phải 404 (mất kết nối, hết giờ) thì message quay lại queue sau `requeueDelayMs`, không rơi vào `<queue>_error` và giữ lượt redelivery.
- **m3 (không làm, theo quyết định controller):** `exchangeExists()` không cache câu trả lời; mỗi lần redelivery mở một channel dùng-một-lần để kiểm tra. Lý do: tin vào câu "có" đã cũ sẽ publish vào exchange đã bị xoá, và 404 đóng `_producer` dùng chung, đúng kiểu lỗi của sự cố. Delay exchange bị xoá thì redelivery không publish vào nó, message vào `<queue>_error`.
- **m4:** không park khi channel của delivery đã đóng trước lúc park (broker sẽ giao lại). Channel đóng *trong lúc* park thì vẫn có thể có bản trùng trong `<queue>_error` (at-least-once, không làm nguyên tử được).
- **m5, m1, m9 tài liệu:** CHANGELOG ghi đúng thời gian chờ (`readyTimeoutMs` cho connection, rồi `publishTimeoutMs` cho confirm); README ghi thứ tự chỉ được giữ giữa các `Publish` được await lần lượt, và mô tả lại bước Shutdown.
- **m6, m7 đóng gói/CI:** `package.json` có `files`, `types: dist/index.d.ts`, `engines.node >=20` (devDependency `@nestjs/core@11`, `mongoose@9` cần Node 20); CI chạy typecheck + unit test trên Node 20/22, integration vẫn trên Node 20.
- **m8 test:** thêm test fake broker có plugin delayed (xoá delay exchange → `<queue>_error` → consumer restart tạo lại exchange + binding), `stopConsuming()` + `close()` với runner thật, và hai integration test `Send` (request/reply; `Send` hỏng lúc shutdown thì message ở lại queue).
- **N1 (review lần 2):** `stopConsuming()` đã bắt đầu thì `onConnected()` không tạo/không start runner nào (kiểm tra cờ ngay trước khi tạo runner, không có `await` ở giữa), nên SIGTERM trong lúc setup connection đầu tiên chưa xong không còn để consumer chạy trong lúc shutdown. Message lỗi lúc đang dừng được trả lại queue sau `requeueDelayMs` (như `settle`), không nack ngay, nên không có vòng lặp nóng.
- **M4 (review lần 2):** `setupRedelivery` thử lại một lần khi lỗi không mang reply code của broker (channel `_topology` dùng chung bị đóng vì khai báo khác bị từ chối); lỗi do chính khai báo này bị từ chối (có `code`) thì vẫn tắt redelivery như trước.
- **M5 (review lần 2):** ngân sách `publishTimeoutMs` của `confirmPublish` bắt đầu trước khi mở `_producer`; mở channel bị treo thì publish reject đúng hạn, channel mở muộn được giữ cho lần publish sau.
- **Tài liệu (review lần 2):** README dặn không xoá delay exchange hay binding của nó (xoá binding làm mất message delayed; consumer khôi phục exchange + binding khi start); CHANGELOG 0.4.0 có mục "Known limitations".
- **Review lần 3:** `stopConsuming()` là thao tác cuối (ghi trong JSDoc và README): sau đó bus không consume lại, chỉ dùng khi shutdown. Timer chờ `requeueDelayMs` lúc shutdown được `unref()`. `ensureQueue` (khai báo `<queue>_error`) bị giới hạn bởi `publishTimeoutMs`; hết giờ thì rơi vào nhánh requeue của `settle`. README phân biệt: xoá delay exchange → message lỗi vào `<queue>_error` tới lần consumer start sau; chỉ xoá binding → message delayed bị mất.

Kết quả cuối: 136 unit test, 10 integration test trên RabbitMQ 3.13.7 thật, typecheck sạch.

## Global Constraints

- Không thêm runtime dependency. DevDependency thêm mới: `jest@^29.7.0`, `ts-jest@^29.2.5`, `@types/jest@^29.5.12`, `reflect-metadata@^0.2.2`, cùng `mongoose@^9.0.2` và `typeorm@^0.3.28`. Hai gói sau chỉ để build: code persistence hiện tại import chúng, nên trên máy sạch `tsc` đang fail, kể cả trước khi có thay đổi nào. Đây là lý do CI sẽ đỏ nếu thiếu hai gói này. `@types/amqplib` đã có sẵn.
- Mọi lệnh `npm install` và `npm ci` dùng `--legacy-peer-deps`: devDependencies hiện có `@nestjs/common@^10` cùng `@nestjs/core@^11`, npm báo `ERESOLVE` (đã xác nhận).
- Giữ `amqplib@^0.10.7`. Chỉ dùng API có trong 0.10.x.
- `tsconfig.json` giữ nguyên. Test dùng `tsconfig.spec.json`.
- Giữ nguyên tên exchange (`<clusterName>:<tên>`), type `fanout` durable, tên queue, tên delayed exchange (`<clusterName>:delayed.exchange.<queue>`), tên error queue (`<queue>_error`) và cấu trúc error payload.
- Thời gian mặc định: `reconnectDelayMs` 5000, `readyTimeoutMs` 10000, `publishTimeoutMs` 10000, `sendTimeoutMs` 10000, `consumerRestartMaxDelayMs` 60000, `shutdownTimeoutMs` 30000. Mọi giá trị phải là số dương; `0` bị từ chối vì nó làm mọi publish hết hạn ngay hoặc reconnect liên tục không nghỉ.
- API công khai giữ tương thích, ngoại trừ: `Publish` trả `Promise<void>` và reject khi broker từ chối hoặc không xác nhận; `close()` của broker trả Promise. Vì vậy release là **0.4.0**.
- Commit message chỉ mô tả thay đổi. **Không** có `Co-Authored-By`, không có footer "Generated with Claude Code" (theo `~/.claude/CLAUDE.md` của chủ repo).
- Làm trên branch `fix/rabbitmq-transport-reliability`, tách từ `main` (7740e1a). Không push, không `npm publish` và không cài phần mềm hệ thống khi chưa hỏi chủ repo.

## Review Focus

1. Exchange đã tồn tại với type hoặc tham số khác (ví dụ `direct`, hay `durable: false`): publish vẫn thành công như 0.3.x, không 406, producer channel không bị đóng. Một lệnh khai báo topology bị từ chối cũng không đụng tới producer. Test ở Task 6, Task 7 và Task 13.
2. Exchange bị xoá trong khi cache vẫn ghi là đã khai báo: lệnh publish kế tiếp reject kèm lý do `NOT_FOUND`, lệnh sau nữa tự khai báo lại và thành công. Test ở Task 6 và Task 13.
3. Broker chặn publisher do alarm bộ nhớ hoặc ổ đĩa: publish reject sau `publishTimeoutMs`, thông báo nói rõ broker đang chặn, không treo mãi. Test ở Task 6.
4. Một queue khai báo sai (406 khi assert): consumer đó thử lại với backoff, các consumer khác vẫn chạy và publish vẫn hoạt động. Test ở Task 9 và Task 11.
5. Shutdown khi còn message đang xử lý: chờ tối đa `shutdownTimeoutMs`, không reconnect, message chưa ack thì broker giao lại. Test ở Task 9 và Task 11.

### Edge case đã có test

Ngoài 5 mục Review Focus, các tình huống sau đều có test và đều đã chạy xanh. Những mục đánh dấu ★ là lỗi thật mà bản plan trước có, chỉ lộ ra khi chạy thử:

| Thành phần | Tình huống | Hành vi mong đợi |
|---|---|---|
| Reliability | Giá trị `0` hoặc âm ★ | Từ chối ngay lúc cấu hình |
| ConnectionManager | Gọi `start()` đồng thời | Một connection |
| ConnectionManager | `close()` trong lúc đang kết nối ★ | Không để lại connection, không ready |
| ConnectionManager | Connection chết giữa lúc setup ★ | Không báo ready; tự kết nối lại |
| Probe plugin | Connection kiểm tra bị treo ★ | Trả `false` sau `readyTimeoutMs`, đóng connection đến muộn |
| Publisher | Mất kết nối khi publish đang chờ confirm | Lệnh đó reject; lệnh sau chờ kết nối lại rồi thành công |
| Publisher | Publish sau `close()` | Reject ngay, không treo |
| Publisher | Body không serialize được | Reject, không gửi gì |
| Publisher | Nhiều publish đầu tiên chạy đồng thời ★ | Khai báo exchange một lần |
| Publisher | Exchange đã tồn tại với type/tham số khác ★ (lộ ra trên broker thật) | Publish thành công như 0.3.x, không assert đè |
| Delivery | Gửi reply thất bại ★ | Không chạy lại consumer, không vào error queue |
| Delivery | JSON hợp lệ nhưng không phải envelope (`null`) | Vào error queue |
| Delivery | Message không có headers | Vẫn được chuyển vào error queue |
| ConsumerRunner | Handler ném lỗi đồng bộ ★ | Process không sập |
| ConsumerRunner | Message tới sau khi `stop()` bắt đầu ★ | Trả lại queue, không xử lý |
| ConsumerRunner | `stop()` hai lần | An toàn |
| RequestClient | Reply của request khác | Bỏ qua |
| RequestClient | Reply không phải JSON | Reject |
| RequestClient | Mất kết nối khi đang chờ reply ★ | Reject ngay thay vì chờ hết timeout |
| Broker | Saga chạy qua pipeline mới | Saga chuyển state, gọi `Send`, ack, không vào error queue |
| Broker | Channel bị đóng nhiều lần liên tiếp | Đúng một consumer trên queue |
| Broker | `close()` hai lần, rồi publish | An toàn; publish reject rõ ràng |

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `package.json`, `jest.config.js`, `tsconfig.spec.json` | Chạy unit test | 1 |
| `test/support/fake-amqp.ts` | Broker giả theo đúng ngữ nghĩa amqplib 0.10.9 | 1 |
| `test/support/broker-fixture.ts`, `test/support/topology-fixture.ts` | Dựng broker cho test | 1 |
| `lib/utils/deferred.ts` | `createDeferred`, `withTimeout` | 2 |
| `lib/factories/brokers/rabbitmq/reliability-options.ts` | Mặc định và kiểm tra giá trị thời gian | 2 |
| `lib/factories/brokers/rabbitmq/connection-options.ts` | Chuyển `brokerInfo` thành options của amqplib, giữ nguyên ngữ nghĩa vhost | 2 |
| `lib/factories/brokers/rabbitmq/channel-registry.ts` | Channel theo tên, tự bỏ channel chết | 3 |
| `lib/factories/brokers/rabbitmq/connection-manager.ts` | Connection, ready, reconnect, blocked, close | 4 |
| `lib/factories/brokers/rabbitmq/delayed-plugin-probe.ts` | Kiểm tra plugin trên connection riêng | 5 |
| `lib/factories/brokers/rabbitmq/publisher.ts` | Producer (confirm), topology channel, cache khai báo | 6 |
| `lib/factories/brokers/rabbitmq/topology.ts` | `buildTopology` (thuần) và `declareTopology` | 7 |
| `lib/factories/brokers/rabbitmq/delivery-pipeline.ts` | Parse, gọi consumer, retry, redelivery, error queue, ack/nack | 8 |
| `lib/factories/brokers/rabbitmq/consumer-runner.ts` | Vòng đời của một consumer | 9 |
| `lib/factories/brokers/rabbitmq/request-client.ts` | `Send` (request/reply) | 10 |
| `lib/factories/brokers/bustransit-broker.rabbitmq.ts` | Facade, viết lại toàn bộ | 11 |
| `lib/interfaces/brokers/bustransit-health.interface.ts` | Kiểu dữ liệu health | 9, 12 |
| base, interface, `bustransit.service.ts`, `bustransit.core.ts`, configurator, `publish-endpoint.interface.ts`, `lib/index.ts` | API công khai | 12 |
| `test/integration/*`, `jest.integration.config.js`, `.github/workflows/ci.yml` | Test với RabbitMQ thật | 13 |
| `CHANGELOG.md`, `README.md`, `package.json` | Release 0.4.0 | 14 |

---

### Task 1: Hạ tầng test, broker giả và test đặc tả trên code cũ

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`, `tsconfig.spec.json`
- Create: `test/support/fake-amqp.ts`, `test/support/broker-fixture.ts`, `test/support/topology-fixture.ts`
- Test: `test/rabbitmq-baseline.spec.ts`, `test/rabbitmq-topology.spec.ts`

**Interfaces:**
- Produces:
  - `createFakeBroker(): FakeBroker`. Các field: `exchanges`, `queues`, `bindings: {source,dest}[]` (binding queue có `dest` là `queue:<tên>`), `published`, `asserts`, `serverCloses`, `connections`, `channels`, cờ `delayedPlugin`, `holdConfirms`, `queueConflicts: Set<string>`, `failNext`.
  - `mainConnections(broker)`: các connection không phải connection kiểm tra plugin.
  - `FakeChannel`: `confirm`, `closed`, `acks`, `nacks`, `consumers`, `serverClose(code, text)`, `deliver(queue, payload, properties?)`, `cancelFromBroker(queue)`.
  - `FakeConnection`: `name`, `closed`, `drop()`, `hardClose(code, text)`.
  - `startBroker(opts)`, `flush()`, `sleep(ms)`, `eventually(check, timeoutMs?)`.
  - `startWithTopology()`, kèm các class `PingMessage`, `PingConsumer`, `OrderState`, `OrderSubmitted`, `ChargeCard`, `OrderStateMachine`.
  - Mỗi spec bắt đầu bằng `jest.mock('amqplib', () => ({ connect: jest.fn() }));`.

- [ ] **Step 1: Tạo branch và cài devDependencies**

```bash
cd /Users/lucasngucii/Workspaces/nestjs-bustransit
git checkout -b fix/rabbitmq-transport-reliability
npm install --legacy-peer-deps
npm install --legacy-peer-deps --save-dev jest@^29.7.0 ts-jest@^29.2.5 @types/jest@^29.5.12 reflect-metadata@^0.2.2 mongoose@^9.0.2 typeorm@^0.3.28
```

`--legacy-peer-deps` là bắt buộc: không có nó, npm dừng với `ERESOLVE` vì `@nestjs/common@^10` đi cùng `@nestjs/core@^11`. Không đổi phiên bản Nest. `mongoose` và `typeorm` (cùng phiên bản `example/` đang dùng) cần để `tsc` biên dịch được `lib/persistence`.

Thêm vào `"scripts"`:

```json
"test": "jest",
"test:integration": "jest -c jest.integration.config.js --runInBand",
"typecheck": "tsc -p tsconfig.build.json --noEmit"
```

- [ ] **Step 2: Xác nhận code hiện tại build được**

Run: `npm run typecheck`
Expected: không có lỗi. Nếu thiếu `mongoose`/`typeorm`, lệnh này báo 6 lỗi `TS2307: Cannot find module 'mongoose'/'typeorm'` trong `lib/persistence`; Step 1 đã cài chúng để xử lý đúng lỗi đó.

- [ ] **Step 3: Tạo `tsconfig.spec.json` và `jest.config.js`**

`tsconfig.spec.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "types": ["jest", "node"]
  },
  "include": ["lib/**/*", "test/**/*"]
}
```

`jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/integration/'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  setupFiles: ['reflect-metadata'],
  testTimeout: 10000,
};
```

- [ ] **Step 4: Viết `test/support/fake-amqp.ts`**

Ngữ nghĩa lấy từ amqplib 0.10.9:
- `lib/channel.js:313-331`: khi server gửi ChannelClose, amqplib phát `error`, sau đó `toClosed` phát `close`.
- `lib/channel.js:39-44`: khi channel `close`, mọi confirm callback đang chờ nhận `Error('channel closed')`.
- `lib/channel.js:371-380`: gửi trên channel đã đóng ném `IllegalOperationError('Channel closed')`.
- Khai báo exchange có type không tồn tại bị từ chối 406 ở mức channel (đã kiểm chứng trên RabbitMQ 3.13.7). Lỗi cấp connection, ví dụ khi operator đóng connection, đóng toàn bộ channel.

```ts
import { EventEmitter } from 'events';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IllegalOperationError } = require('amqplib/lib/error');

export interface PublishedRecord {
  channel: number;
  exchange: string;
  routingKey: string;
  content: any;
  options: any;
}

export interface FakeBroker {
  exchanges: Map<string, string>;
  queues: Set<string>;
  bindings: { source: string; dest: string }[];
  published: PublishedRecord[];
  asserts: string[];
  serverCloses: { channel: number; code: number; text: string }[];
  connections: FakeConnection[];
  channels: FakeChannel[];
  /** false: the x-delayed-message plugin is not installed. */
  delayedPlugin: boolean;
  /** true: publisher confirms never arrive, like a broker blocking publishers. */
  holdConfirms: boolean;
  /** Queues that exist with other arguments: asserting them fails with 406. */
  queueConflicts: Set<string>;
  /** The next call of this method on any connection throws this error. */
  failNext: Partial<Record<'createChannel' | 'createConfirmChannel', Error>>;
}

export function createFakeBroker(): FakeBroker {
  return {
    exchanges: new Map(),
    queues: new Set(),
    bindings: [],
    published: [],
    asserts: [],
    serverCloses: [],
    connections: [],
    channels: [],
    delayedPlugin: true,
    holdConfirms: false,
    queueConflicts: new Set(),
    failNext: {},
  };
}

export const mainConnections = (broker: FakeBroker) => broker.connections.filter((c) => !c.name.endsWith(':probe'));

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export class FakeChannel extends EventEmitter {
  closed = false;
  acks: any[] = [];
  nacks: { message: any; requeue: boolean }[] = [];
  consumers = new Map<string, (msg: any) => void>();
  private unconfirmed: Array<(err: Error | null) => void> = [];
  private tag = 0;

  constructor(
    readonly broker: FakeBroker,
    readonly connection: FakeConnection,
    readonly id: number,
    readonly confirm: boolean,
  ) {
    super();
  }

  private guard() {
    if (this.closed) throw new IllegalOperationError('Channel closed');
  }

  private async rpc<T>(fn: () => T): Promise<T> {
    this.guard();
    await tick();
    if (this.closed) throw new Error('Channel ended, no reply will be forthcoming');
    return fn();
  }

  private refuse(code: number, label: string, text: string): never {
    this.serverClose(code, text);
    const err: any = new Error(`Operation failed: ${code} (${label}) with message "${text}"`);
    err.code = code;
    throw err;
  }

  prefetch(_count?: number) {
    return this.rpc(() => undefined);
  }

  assertExchange(name: string, type: string, _options?: any) {
    return this.rpc(() => {
      if (type === 'x-delayed-message' && !this.broker.delayedPlugin) {
        // RabbitMQ 3.13 answers with a channel-level 406 (verified against a real broker).
        this.refuse(406, 'PRECONDITION-FAILED', "PRECONDITION_FAILED - unknown exchange type 'x-delayed-message'");
      }
      this.broker.asserts.push(name);
      const existing = this.broker.exchanges.get(name);
      if (existing && existing !== type) {
        this.refuse(406, 'PRECONDITION-FAILED', `PRECONDITION_FAILED - inequivalent arg 'type' for exchange '${name}': received '${type}' but current is '${existing}'`);
      }
      this.broker.exchanges.set(name, type);
      return { exchange: name };
    });
  }

  checkExchange(name: string) {
    return this.rpc(() => {
      if (!this.broker.exchanges.has(name)) this.refuse(404, 'NOT-FOUND', `NOT_FOUND - no exchange '${name}' in vhost '/test'`);
      return {};
    });
  }

  deleteExchange(name: string) {
    return this.rpc(() => {
      this.broker.exchanges.delete(name);
      return {};
    });
  }

  bindExchange(dest: string, source: string, _pattern?: string) {
    return this.rpc(() => {
      for (const name of [source, dest]) {
        if (!this.broker.exchanges.has(name)) this.refuse(404, 'NOT-FOUND', `NOT_FOUND - no exchange '${name}' in vhost '/test'`);
      }
      this.broker.bindings.push({ source, dest });
      return {};
    });
  }

  assertQueue(queue: string, _options?: any) {
    return this.rpc(() => {
      if (this.broker.queueConflicts.has(queue)) {
        this.refuse(406, 'PRECONDITION-FAILED', `PRECONDITION_FAILED - inequivalent arg 'x-queue-type' for queue '${queue}'`);
      }
      this.broker.queues.add(queue);
      return { queue };
    });
  }

  bindQueue(queue: string, exchange: string, _pattern?: string) {
    return this.rpc(() => {
      if (!this.broker.exchanges.has(exchange)) this.refuse(404, 'NOT-FOUND', `NOT_FOUND - no exchange '${exchange}' in vhost '/test'`);
      this.broker.bindings.push({ source: exchange, dest: `queue:${queue}` });
      return {};
    });
  }

  consume(queue: string, handler: (msg: any) => void, _options?: any) {
    return this.rpc(() => {
      this.consumers.set(queue, handler);
      return { consumerTag: `ctag-${queue}` };
    });
  }

  cancel(consumerTag: string) {
    return this.rpc(() => {
      for (const queue of [...this.consumers.keys()]) {
        if (`ctag-${queue}` === consumerTag) this.consumers.delete(queue);
      }
      return { consumerTag };
    });
  }

  ack(message: any) {
    this.guard();
    this.acks.push(message);
  }

  nack(message: any, _allUpTo = false, requeue = true) {
    this.guard();
    this.nacks.push({ message, requeue });
  }

  publish(exchange: string, routingKey: string, content: Buffer, options: any = {}, cb?: (err: Error | null) => void) {
    this.guard();
    if (this.confirm) this.unconfirmed.push(cb ?? (() => undefined));
    this.broker.published.push({ channel: this.id, exchange, routingKey, content: JSON.parse(content.toString()), options });
    setImmediate(() => {
      if (this.closed) return;
      if (exchange !== '' && !this.broker.exchanges.has(exchange)) {
        this.serverClose(404, `NOT_FOUND - no exchange '${exchange}' in vhost '/test'`);
        return;
      }
      const routable =
        exchange === ''
          ? this.broker.queues.has(routingKey) || routingKey === 'amq.rabbitmq.reply-to'
          : this.broker.bindings.some((b) => b.source === exchange);
      if (options.mandatory && !routable) {
        this.emit('return', { fields: { exchange, routingKey, replyCode: 312 }, properties: options, content });
      }
      if (this.confirm && !this.broker.holdConfirms) this.unconfirmed.shift()?.(null);
    });
    return true;
  }

  sendToQueue(queue: string, content: Buffer, options?: any, cb?: (err: Error | null) => void) {
    return this.publish('', queue, content, options, cb);
  }

  async close() {
    this.guard();
    this.forceClose();
  }

  /** The broker closes this channel (channel.close frame). */
  serverClose(code: number, text: string) {
    if (this.closed) return;
    this.broker.serverCloses.push({ channel: this.id, code, text });
    const err: any = new Error(`Channel closed by server: ${code} with message "${text}"`);
    err.code = code;
    this.emit('error', err);
    this.forceClose();
  }

  forceClose() {
    if (this.closed) return;
    this.closed = true;
    let cb: ((err: Error | null) => void) | undefined;
    while ((cb = this.unconfirmed.shift())) cb(new Error('channel closed'));
    this.emit('close');
  }

  deliver(queue: string, payload: unknown, properties: Record<string, unknown> = {}) {
    const handler = this.consumers.get(queue);
    if (!handler) throw new Error(`no consumer on ${queue}`);
    const message = {
      content: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
      fields: { deliveryTag: ++this.tag, routingKey: queue, exchange: '' },
      properties: { headers: {}, ...properties },
    };
    handler(message);
    return message;
  }

  /** The broker cancels the consumer, e.g. because its queue was deleted. */
  cancelFromBroker(queue: string) {
    const handler = this.consumers.get(queue);
    this.consumers.delete(queue);
    handler?.(null);
  }
}

export class FakeConnection extends EventEmitter {
  closed = false;

  constructor(readonly broker: FakeBroker, readonly name = '') {
    super();
    broker.connections.push(this);
  }

  async createChannel() {
    return this.open('createChannel', false);
  }

  async createConfirmChannel() {
    return this.open('createConfirmChannel', true);
  }

  private open(method: 'createChannel' | 'createConfirmChannel', confirm: boolean) {
    const failure = this.broker.failNext[method];
    if (failure) {
      delete this.broker.failNext[method];
      throw failure;
    }
    if (this.closed) throw new IllegalOperationError('Connection closed');
    const channel = new FakeChannel(this.broker, this, this.broker.channels.length + 1, confirm);
    this.broker.channels.push(channel);
    return channel;
  }

  async close() {
    this.shutdown();
  }

  /** The TCP connection goes away. */
  drop() {
    this.shutdown();
  }

  /** A connection-level error from the broker (e.g. a 320 CONNECTION_FORCED when an operator closes it). */
  hardClose(code: number, text: string) {
    if (this.closed) return;
    const err: any = new Error(`Connection closed: ${code} with message "${text}"`);
    err.code = code;
    this.emit('error', err);
    this.shutdown();
  }

  private shutdown() {
    if (this.closed) return;
    this.closed = true;
    for (const channel of this.broker.channels) {
      if (channel.connection === this) channel.forceClose();
    }
    this.emit('close');
  }
}
```

- [ ] **Step 5: Viết `test/support/broker-fixture.ts`**

Fixture truyền `reliability` qua `brokerConfig`. Code cũ bỏ qua field này, nên cùng fixture dùng được cho cả code cũ lẫn code mới.

```ts
import * as amqp from 'amqplib';
import { BusTransitBrokerRabbitMqFactory } from '../../lib/factories/brokers/bustransit-broker.rabbitmq';
import { IPublishEndpoint } from '../../lib/interfaces/publish-endpoint.interface';
import { createFakeBroker, FakeBroker, FakeConnection } from './fake-amqp';

export const TEST_RELIABILITY = {
  reconnectDelayMs: 20,
  readyTimeoutMs: 200,
  publishTimeoutMs: 200,
  sendTimeoutMs: 200,
  consumerRestartMaxDelayMs: 80,
  shutdownTimeoutMs: 300,
};

export interface BrokerFixture {
  bus: BusTransitBrokerRabbitMqFactory;
  broker: FakeBroker;
  instances: Map<unknown, unknown>;
}

export interface BrokerFixtureOptions {
  messages?: Record<string, unknown>;
  consumers?: Record<string, unknown>;
  endpoints?: Record<string, unknown>;
  instances?: Map<unknown, unknown>;
  preexistingExchanges?: Record<string, string>;
  preexistingQueues?: string[];
  broker?: FakeBroker;
  start?: boolean;
}

export function mockConnect(broker: FakeBroker) {
  (amqp.connect as unknown as jest.Mock).mockImplementation(
    async (_url: unknown, socketOptions?: any) => new FakeConnection(broker, socketOptions?.clientProperties?.connection_name ?? ''),
  );
}

export async function startBroker(opts: BrokerFixtureOptions = {}): Promise<BrokerFixture> {
  const broker = opts.broker ?? createFakeBroker();
  for (const [name, type] of Object.entries(opts.preexistingExchanges ?? {})) broker.exchanges.set(name, type);
  for (const queue of opts.preexistingQueues ?? []) broker.queues.add(queue);
  mockConnect(broker);

  const bus = new BusTransitBrokerRabbitMqFactory();
  bus.setBrokerConfig({
    brokerName: 'linkadz',
    brokerType: 'RABBITMQ',
    brokerInfo: { host: 'rmq', vhost: '/test', username: 'u', password: 'p', port: 5672 },
    reliability: TEST_RELIABILITY,
  } as any);
  const instances = opts.instances ?? new Map();
  if (!instances.has(IPublishEndpoint)) instances.set(IPublishEndpoint, {});
  bus.setModuleRef({
    get: (token: any) => {
      if (!instances.has(token)) throw new Error(`no instance for ${token?.name ?? String(token)}`);
      return instances.get(token);
    },
  });
  bus.setConsumers(opts.consumers ?? {}, opts.endpoints ?? {}, opts.messages ?? {});
  if (opts.start !== false) await bus.start();
  return { bus, broker, instances };
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function eventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
```

- [ ] **Step 6: Viết `test/support/topology-fixture.ts`**

```ts
import { BusTransitConsumer } from '../../lib/factories/consumer';
import { ConsumerConfigurator } from '../../lib/factories/consumer.configurator';
import { SagaConfigurator } from '../../lib/factories/saga.configurator';
import { BusTransitStateMachine } from '../../lib/factories/saga.bustransit.state-machine';
import { SagaStateMachineInstance } from '../../lib/factories/saga.state-machine-instance';
import { SagaEvent } from '../../lib/factories/saga.event';
import { SagaState } from '../../lib/factories/saga.state';
import { BrokerFixtureOptions, startBroker } from './broker-fixture';

export class PingMessage {
  text: string;
}

export class PingConsumer extends BusTransitConsumer<PingMessage> {
  constructor() {
    super(PingMessage);
  }
}

export class OrderState extends SagaStateMachineInstance {}
export class OrderSubmitted {
  OrderId: string;
}
export class ChargeCard {
  OrderId: string;
}

export class OrderStateMachine extends BusTransitStateMachine<OrderState> {
  Charging = new SagaState('Charging');
  OrderSubmitted = new SagaEvent(OrderSubmitted);

  constructor() {
    super(OrderState);
    this.Event(this.OrderSubmitted, (x) => x.CorrelateById((m) => m.Message.OrderId));
    this.Initially(
      this.When(OrderSubmitted)
        .PublishAsync<ChargeCard>(ChargeCard, (c) => Object.assign(new ChargeCard(), { OrderId: c.Saga.CorrelationId }))
        .TransitionTo(this.Charging),
    );
  }
}

/** One plain consumer on "ping" and one saga on "order-saga", the two shapes the broker wires. */
export function startWithTopology(extra: BrokerFixtureOptions = {}) {
  const ping = new ConsumerConfigurator();
  ping.bindQueue('ping');
  ping.bindConsumer(PingConsumer);
  ping.setOptions({ PrefetchCount: 5 });

  const saga = new SagaConfigurator();
  saga.bindQueue('order-saga');
  saga.bindConsumer(OrderStateMachine);
  saga.setOptions({ PrefetchCount: 5 });

  return startBroker({
    consumers: { PingConsumer, OrderStateMachine: { machineClass: OrderStateMachine, stateClass: OrderState } },
    endpoints: { ping, 'order-saga': saga },
    instances: new Map<unknown, unknown>([
      [PingConsumer, new PingConsumer()],
      [OrderStateMachine, new OrderStateMachine()],
    ]),
    ...extra,
  });
}
```

- [ ] **Step 7: Viết test baseline và test đặc tả topology**

`test/rabbitmq-baseline.spec.ts`:

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { flush, startBroker } from './support/broker-fixture';

class OrderPlaced {
  constructor(public orderId = 'o-1') {}
}

describe('RabbitMQ broker baseline', () => {
  it('publishes to the exchange named after the message class', async () => {
    const { bus, broker } = await startBroker({
      messages: { OrderPlaced },
      preexistingExchanges: { 'linkadz:OrderPlaced': 'fanout' },
    });

    await bus.publish(new OrderPlaced());
    await flush();

    const sent = broker.published.find((p) => p.exchange === 'linkadz:OrderPlaced');
    expect(sent?.content.message).toEqual({ orderId: 'o-1' });
    expect(sent?.content.messageType).toBe('message:linkadz:OrderPlaced');
    await bus.close();
  });
});
```

`test/rabbitmq-topology.spec.ts`. Test này chốt topology của 0.3.x: các exchange, binding và queue mà bản viết lại phải tạo y hệt.

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { sleep } from './support/broker-fixture';
import { startWithTopology } from './support/topology-fixture';

describe('RabbitMQ topology (characterization of 0.3.x)', () => {
  it('declares the same exchanges, bindings and queues', async () => {
    const { bus, broker } = await startWithTopology();
    await sleep(30);

    const exchanges = [...broker.exchanges.keys()].filter((name) => name.startsWith('linkadz:')).sort();
    expect(exchanges).toEqual([
      'linkadz:ChargeCard',
      'linkadz:OrderState',
      'linkadz:OrderSubmitted',
      'linkadz:PingMessage',
      'linkadz:order-saga',
      'linkadz:ping',
    ]);
    expect(broker.exchanges.get('linkadz:ping')).toBe('fanout');

    const bindings = [...new Set(broker.bindings.map((b) => `${b.source} -> ${b.dest}`))].sort();
    expect(bindings).toEqual([
      'linkadz:OrderState -> linkadz:order-saga',
      'linkadz:OrderSubmitted -> linkadz:order-saga',
      'linkadz:PingMessage -> linkadz:ping',
      'linkadz:order-saga -> queue:order-saga',
      'linkadz:ping -> queue:ping',
    ]);
    expect([...broker.queues].sort()).toEqual(['order-saga', 'ping']);
    await bus.close();
  });
});
```

- [ ] **Step 8: Chạy test trên code cũ**

Run: `npx jest`
Expected: PASS cả hai file (2 test). Đây là đặc tả hành vi hiện tại, nên phải xanh trên code cũ. Nếu đỏ thì lỗi nằm ở fake hoặc fixture: sửa chúng cho tới khi xanh, không được sửa danh sách kỳ vọng.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json jest.config.js tsconfig.spec.json test/
git commit -m "test: add jest harness, an amqplib-faithful fake broker and a topology characterization test"
```

---

### Task 2: Các helper thuần (deferred, reliability options, connection options)

**Files:**
- Create: `lib/utils/deferred.ts`
- Create: `lib/factories/brokers/rabbitmq/reliability-options.ts`
- Create: `lib/factories/brokers/rabbitmq/connection-options.ts`
- Test: `test/deferred.spec.ts`, `test/reliability-options.spec.ts`, `test/connection-options.spec.ts`

**Interfaces:**
- Produces:
  - `interface Deferred<T> { promise; settled; resolve(value) }`, `createDeferred<T = void>()`, `withTimeout<T>(promise, ms, message): Promise<T>`
  - `interface ReliabilityOptions { reconnectDelayMs; readyTimeoutMs; publishTimeoutMs; sendTimeoutMs; consumerRestartMaxDelayMs; shutdownTimeoutMs }` (đều là `number`), `DEFAULT_RELIABILITY`, `resolveReliability(overrides?: Partial<ReliabilityOptions>): ReliabilityOptions` (ném lỗi nếu có giá trị không phải số dương)
  - `interface BrokerInfo { host; port?; vhost?; username?; password? }`, `buildConnectOptions(info: BrokerInfo): Options.Connect`

- [ ] **Step 1: Viết test**

`test/deferred.spec.ts`:

```ts
import { createDeferred, withTimeout } from '../lib/utils/deferred';

describe('deferred', () => {
  it('resolves once and reports settled', async () => {
    const d = createDeferred<number>();
    expect(d.settled).toBe(false);
    d.resolve(1);
    d.resolve(2);
    await expect(d.promise).resolves.toBe(1);
    expect(d.settled).toBe(true);
  });

  it('rejects with the given message after the timeout', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'too slow')).rejects.toThrow('too slow');
  });

  it('passes the value through when it arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'too slow')).resolves.toBe('ok');
  });
});
```

`test/reliability-options.spec.ts`:

```ts
import { DEFAULT_RELIABILITY, resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';

describe('resolveReliability', () => {
  it('uses the documented defaults', () => {
    expect(resolveReliability()).toEqual({
      reconnectDelayMs: 5000,
      readyTimeoutMs: 10000,
      publishTimeoutMs: 10000,
      sendTimeoutMs: 10000,
      consumerRestartMaxDelayMs: 60000,
      shutdownTimeoutMs: 30000,
    });
    expect(DEFAULT_RELIABILITY.shutdownTimeoutMs).toBe(30000);
  });

  it('applies overrides', () => {
    expect(resolveReliability({ shutdownTimeoutMs: 35000 }).shutdownTimeoutMs).toBe(35000);
  });

  it('rejects values that are not positive numbers', () => {
    expect(() => resolveReliability({ publishTimeoutMs: -1 })).toThrow('reliability.publishTimeoutMs must be a positive number of milliseconds, got -1');
    expect(() => resolveReliability({ readyTimeoutMs: Number.NaN })).toThrow('reliability.readyTimeoutMs');
    expect(() => resolveReliability({ publishTimeoutMs: 0 })).toThrow('reliability.publishTimeoutMs');
  });
});
```

`test/connection-options.spec.ts`:

```ts
import { buildConnectOptions } from '../lib/factories/brokers/rabbitmq/connection-options';

const base = { host: 'rmq', port: 5672, username: 'u', password: 'p' };

describe('buildConnectOptions', () => {
  it('drops the leading slash of the vhost, as amqplib did with the URL path', () => {
    expect(buildConnectOptions({ ...base, vhost: '/prod_linkadz' }).vhost).toBe('prod_linkadz');
  });

  it('uses the default vhost for "", "/" or a missing vhost', () => {
    expect(buildConnectOptions({ ...base, vhost: '' }).vhost).toBeUndefined();
    expect(buildConnectOptions({ ...base, vhost: '/' }).vhost).toBeUndefined();
    expect(buildConnectOptions({ ...base }).vhost).toBeUndefined();
  });

  it('keeps passwords with URL characters intact', () => {
    expect(buildConnectOptions({ ...base, password: 'p@ss:w/rd#1' }).password).toBe('p@ss:w/rd#1');
  });

  it('decodes percent-encoded credentials like the URL form did', () => {
    const options = buildConnectOptions({ ...base, username: 'svc%40corp', password: 'p%40ss' });
    expect(options.username).toBe('svc@corp');
    expect(options.password).toBe('p@ss');
  });

  it('leaves credentials out when both are empty, so amqplib uses guest/guest as before', () => {
    const options = buildConnectOptions({ host: 'rmq', username: '', password: '' });
    expect(options.username).toBeUndefined();
    expect(options.password).toBeUndefined();
  });

  it('defaults the port to 5672', () => {
    expect(buildConnectOptions({ host: 'rmq' }).port).toBe(5672);
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/deferred.spec.ts test/reliability-options.spec.ts test/connection-options.spec.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Viết `lib/utils/deferred.ts`**

```ts
export interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly settled: boolean;
    resolve(value: T): void;
}

export function createDeferred<T = void>(): Deferred<T> {
    let resolveFn!: (value: T) => void;
    let settled = false;
    const promise = new Promise<T>((resolve) => {
        resolveFn = resolve;
    });
    return {
        promise,
        get settled() {
            return settled;
        },
        resolve(value: T) {
            if (settled) return;
            settled = true;
            resolveFn(value);
        },
    };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 4: Viết `lib/factories/brokers/rabbitmq/reliability-options.ts`**

```ts
export interface ReliabilityOptions {
    /** Wait before reconnecting, and the first wait before restarting a consumer. */
    reconnectDelayMs: number;
    /** How long a publish or Send waits for the broker connection before failing. */
    readyTimeoutMs: number;
    /** How long a publish waits for the broker to confirm the message. */
    publishTimeoutMs: number;
    /** How long Send waits for a reply. */
    sendTimeoutMs: number;
    /** Ceiling of the doubling delay between consumer restarts. */
    consumerRestartMaxDelayMs: number;
    /** How long shutdown waits for messages in progress. Keep it below the container stop grace period. */
    shutdownTimeoutMs: number;
}

export const DEFAULT_RELIABILITY: ReliabilityOptions = {
    reconnectDelayMs: 5000,
    readyTimeoutMs: 10000,
    publishTimeoutMs: 10000,
    sendTimeoutMs: 10000,
    consumerRestartMaxDelayMs: 60000,
    shutdownTimeoutMs: 30000,
};

export function resolveReliability(overrides?: Partial<ReliabilityOptions>): ReliabilityOptions {
    const merged: ReliabilityOptions = { ...DEFAULT_RELIABILITY, ...(overrides ?? {}) };
    for (const [key, value] of Object.entries(merged)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            throw new Error(`[BusTransit] reliability.${key} must be a positive number of milliseconds, got ${value}`);
        }
    }
    return merged;
}
```

- [ ] **Step 5: Viết `lib/factories/brokers/rabbitmq/connection-options.ts`**

```ts
import type { Options } from 'amqplib';

export interface BrokerInfo {
    host: string;
    port?: number;
    vhost?: string;
    username?: string;
    password?: string;
}

/**
 * Connection options with the exact semantics of the URL the library used to build,
 * `amqp://${username}:${password}@${host}:${port}${vhost}`:
 * - amqplib took the URL path without its leading "/" as the vhost (connect.js:137), so "/prod_linkadz"
 *   means vhost "prod_linkadz" and "" or "/" mean the default vhost.
 * - amqplib ran `unescape` on URL credentials (connect.js:80-86); the same decoding is applied here.
 * - With both credentials empty amqplib used guest/guest; leaving them out keeps that.
 * Passing fields instead of a URL means "@", ":" or "/" in a password no longer break the connection.
 */
export function buildConnectOptions(info: BrokerInfo): Options.Connect {
    const path = info.vhost ?? '';
    const vhost = path.startsWith('/') ? path.slice(1) : path;
    const username = info.username ?? '';
    const password = info.password ?? '';
    const credentials = username === '' && password === ''
        ? {}
        : { username: unescape(username), password: unescape(password) };
    return {
        protocol: 'amqp',
        hostname: info.host,
        port: info.port ?? 5672,
        vhost: vhost === '' ? undefined : vhost,
        ...credentials,
    };
}
```

- [ ] **Step 6: Chạy test để thấy pass**

Run: `npx jest test/deferred.spec.ts test/reliability-options.spec.ts test/connection-options.spec.ts`
Expected: PASS (12 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/utils/deferred.ts lib/factories/brokers/rabbitmq/reliability-options.ts lib/factories/brokers/rabbitmq/connection-options.ts test/deferred.spec.ts test/reliability-options.spec.ts test/connection-options.spec.ts
git commit -m "feat(rabbitmq): add reliability options, safe connection options and a deferred helper"
```

---

### Task 3: ChannelRegistry

**Files:**
- Create: `lib/factories/brokers/rabbitmq/channel-registry.ts`
- Test: `test/channel-registry.spec.ts`

**Interfaces:**
- Produces: `class ChannelRegistry`
  - `constructor(onLost?: (name: string) => void)`
  - `get(name)`, `has(name)` (true khi đã có hoặc đang mở)
  - `register<T extends Channel>(name, channel): T`
  - `getOrCreate<T extends Channel>(name, create: () => Promise<T>): Promise<T>`
  - `clear()` (quên mọi channel mà không gọi `onLost`), `closeAll(): Promise<void>`

- [ ] **Step 1: Viết test `test/channel-registry.spec.ts`**

```ts
import { EventEmitter } from 'events';
import { ChannelRegistry } from '../lib/factories/brokers/rabbitmq/channel-registry';

class StubChannel extends EventEmitter {
  closed = false;
  async close() {
    this.closed = true;
    this.emit('close');
  }
}
const stub = () => new StubChannel() as any;

describe('ChannelRegistry', () => {
  it('creates a channel once and reuses it', async () => {
    const registry = new ChannelRegistry();
    const create = jest.fn(async () => stub());
    const a = await registry.getOrCreate('_producer', create);
    const b = await registry.getOrCreate('_producer', create);
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('shares one creation between concurrent callers', async () => {
    const registry = new ChannelRegistry();
    const create = jest.fn(async () => stub());
    const [a, b, c] = await Promise.all([
      registry.getOrCreate('q', create),
      registry.getOrCreate('q', create),
      registry.getOrCreate('q', create),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('forgets a channel that closes and reports it, so the next call opens a new one', async () => {
    const onLost = jest.fn();
    const registry = new ChannelRegistry(onLost);
    const first = await registry.getOrCreate('_producer', async () => stub());
    first.emit('close');
    expect(registry.get('_producer')).toBeUndefined();
    expect(onLost).toHaveBeenCalledWith('_producer');
    const second = await registry.getOrCreate('_producer', async () => stub());
    expect(second).not.toBe(first);
  });

  it('reports has() while a channel is opening', async () => {
    const registry = new ChannelRegistry();
    let release!: (c: any) => void;
    const pending = registry.getOrCreate('q', () => new Promise<any>((resolve) => (release = resolve)));
    expect(registry.has('q')).toBe(true);
    release(stub());
    await pending;
    expect(registry.has('q')).toBe(true);
  });

  it('does not report channels it was told to forget', async () => {
    const onLost = jest.fn();
    const registry = new ChannelRegistry(onLost);
    const channel = await registry.getOrCreate('q', async () => stub());
    registry.clear();
    channel.emit('close');
    expect(onLost).not.toHaveBeenCalled();
  });

  it('closes every channel without reporting them as lost', async () => {
    const onLost = jest.fn();
    const registry = new ChannelRegistry(onLost);
    const a = await registry.getOrCreate('a', async () => stub());
    const b = await registry.getOrCreate('b', async () => stub());
    await registry.closeAll();
    expect(a.closed && b.closed).toBe(true);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('does not keep a failed creation', async () => {
    const registry = new ChannelRegistry();
    await expect(registry.getOrCreate('q', async () => { throw new Error('no connection'); })).rejects.toThrow('no connection');
    expect(registry.has('q')).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/channel-registry.spec.ts`
Expected: FAIL, "Cannot find module '../lib/factories/brokers/rabbitmq/channel-registry'".

- [ ] **Step 3: Viết `lib/factories/brokers/rabbitmq/channel-registry.ts`**

```ts
import type { Channel } from 'amqplib';

/**
 * AMQP channels of one connection, by name.
 *
 * A channel the broker closes (404, 406, 403 ...) is dead for good in amqplib: every later call on it
 * throws "Channel closed". The registry drops such a channel when it emits "close", so the next
 * getOrCreate() opens a fresh one instead of handing out the dead object.
 */
export class ChannelRegistry {
    private readonly channels = new Map<string, Channel>();
    private readonly pending = new Map<string, Promise<Channel>>();

    constructor(private readonly onLost: (name: string) => void = () => undefined) {}

    get(name: string): Channel | undefined {
        return this.channels.get(name);
    }

    has(name: string): boolean {
        return this.channels.has(name) || this.pending.has(name);
    }

    register<T extends Channel>(name: string, channel: T): T {
        this.channels.set(name, channel);
        channel.once('close', () => {
            if (this.channels.get(name) !== channel) return;
            this.channels.delete(name);
            this.onLost(name);
        });
        return channel;
    }

    getOrCreate<T extends Channel>(name: string, create: () => Promise<T>): Promise<T> {
        const existing = this.channels.get(name);
        if (existing) return Promise.resolve(existing as T);
        const inFlight = this.pending.get(name);
        if (inFlight) return inFlight as Promise<T>;

        const created = create()
            .then((channel) => this.register(name, channel))
            .finally(() => this.pending.delete(name));
        this.pending.set(name, created);
        return created;
    }

    /** Forget every channel without reporting it lost. Used when the whole connection is gone. */
    clear(): void {
        this.channels.clear();
        this.pending.clear();
    }

    async closeAll(): Promise<void> {
        const open = [...this.channels.values()];
        this.clear();
        await Promise.all(open.map((channel) => channel.close().catch(() => undefined)));
    }
}
```

- [ ] **Step 4: Chạy test để thấy pass**

Run: `npx jest test/channel-registry.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/factories/brokers/rabbitmq/channel-registry.ts test/channel-registry.spec.ts
git commit -m "feat(rabbitmq): add a channel registry that drops channels the broker closed"
```

---

### Task 4: ConnectionManager

**Files:**
- Create: `lib/factories/brokers/rabbitmq/connection-manager.ts`
- Test: `test/connection-manager.spec.ts`

**Interfaces:**
- Consumes: `ChannelRegistry`, `createDeferred`, `withTimeout`, `ReliabilityOptions`.
- Produces: `class ConnectionManager`
  - `constructor(connectOptions: Options.Connect, connectionName: string, reliability: ReliabilityOptions, setup: (connection: ChannelModel) => Promise<void>)`
  - `readonly channels: ChannelRegistry`
  - `current: ChannelModel | null`, `isConnected: boolean`, `isBlocked: boolean`
  - `onChannelLost(listener: (name: string) => void): void`, `onDisconnected(listener: () => void): void`
  - `start(): Promise<void>` (không bao giờ throw), `whenReady(): Promise<void>`, `close(): Promise<void>`
  - Bảo đảm: gọi `start()` đồng thời chỉ mở một connection; `close()` trong lúc đang kết nối không để lại connection nào; connection chết giữa lúc setup không bao giờ được báo là ready.

- [ ] **Step 1: Viết test `test/connection-manager.spec.ts`**

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import * as amqp from 'amqplib';
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { eventually, mockConnect, sleep } from './support/broker-fixture';
import { createFakeBroker, FakeConnection, mainConnections } from './support/fake-amqp';

const reliability = resolveReliability({ reconnectDelayMs: 20, readyTimeoutMs: 100 });

function create(setup: jest.Mock = jest.fn(async () => undefined)) {
  const broker = createFakeBroker();
  mockConnect(broker);
  const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, setup);
  return { broker, manager, setup };
}

describe('ConnectionManager', () => {
  it('becomes ready after setup ran on the new connection', async () => {
    const { manager, setup, broker } = create();
    await manager.start();
    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(manager.isConnected).toBe(true);
    expect(setup).toHaveBeenCalledWith(broker.connections[0]);
    await manager.close();
  });

  it('fails whenReady with a clear message while the broker is down', async () => {
    const { manager } = create();
    (amqp.connect as unknown as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED'));
    await manager.start();
    await expect(manager.whenReady()).rejects.toThrow('[RabbitMQ] Not connected to broker after 100ms');
    await manager.close();
  });

  it('reconnects after the connection drops and runs setup again', async () => {
    const { manager, setup, broker } = create();
    const disconnected = jest.fn();
    manager.onDisconnected(disconnected);
    await manager.start();
    broker.connections[0].drop();
    expect(manager.isConnected).toBe(false);
    expect(disconnected).toHaveBeenCalledTimes(1);

    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(setup).toHaveBeenCalledTimes(2);
    expect(mainConnections(broker)).toHaveLength(2);
    await manager.close();
  });

  it('survives an error event on the connection', async () => {
    const { manager, broker } = create();
    await manager.start();
    expect(() => broker.connections[0].emit('error', new Error('heartbeat timeout'))).not.toThrow();
    await manager.close();
  });

  it('closes a half-open connection when setup fails, then retries', async () => {
    const setup = jest.fn().mockRejectedValueOnce(new Error('setup broke')).mockResolvedValue(undefined);
    const { manager, broker } = create(setup);
    await manager.start();
    expect(broker.connections[0].closed).toBe(true);
    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(broker.connections).toHaveLength(2);
    await manager.close();
  });

  it('closes channels and connection on close() and never reconnects', async () => {
    const { manager, broker } = create();
    await manager.start();
    const channel = await manager.channels.getOrCreate('_producer', () => manager.current!.createConfirmChannel());
    await manager.close();
    await sleep(60);
    expect((channel as any).closed).toBe(true);
    expect(broker.connections[0].closed).toBe(true);
    expect(broker.connections).toHaveLength(1);
  });

  it('tracks when the broker blocks and unblocks publishers', async () => {
    const { manager, broker } = create();
    await manager.start();
    broker.connections[0].emit('blocked', 'low on memory');
    expect(manager.isBlocked).toBe(true);
    broker.connections[0].emit('unblocked');
    expect(manager.isBlocked).toBe(false);
    await manager.close();
  });

  it('reports channels the broker closed', async () => {
    const { manager } = create();
    const lost = jest.fn();
    manager.onChannelLost(lost);
    await manager.start();
    const channel: any = await manager.channels.getOrCreate('_producer', () => manager.current!.createConfirmChannel());
    channel.on('error', () => undefined);
    channel.serverClose(406, 'PRECONDITION_FAILED - test');
    await eventually(() => lost.mock.calls.length === 1);
    expect(lost).toHaveBeenCalledWith('_producer');
    await manager.close();
  });
});

describe('ConnectionManager edge cases', () => {
  it('opens one connection when start() is called concurrently', async () => {
    const { manager, broker } = create();
    await Promise.all([manager.start(), manager.start(), manager.start()]);
    expect(broker.connections).toHaveLength(1);
    await manager.close();
  });

  it('leaves nothing open when close() is called while connecting', async () => {
    const broker = createFakeBroker();
    let release!: () => void;
    (amqp.connect as unknown as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(new FakeConnection(broker, 'linkadz')))),
    );
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
    const starting = manager.start();
    const closing = manager.close();
    release();
    await starting;
    await closing;
    expect(broker.connections[0].closed).toBe(true);
    expect(manager.isConnected).toBe(false);
  });

  it('is not ready when the connection dies during setup, and recovers on the next one', async () => {
    let calls = 0;
    const { manager, broker } = create(
      jest.fn(async (connection: any) => {
        calls++;
        if (calls === 1) connection.drop(); // setup itself does not throw
      }),
    );
    await manager.start();
    expect(manager.isConnected).toBe(false);
    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(calls).toBe(2);
    expect(manager.current).toBe(mainConnections(broker)[1]);
    await manager.close();
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/connection-manager.spec.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Viết `lib/factories/brokers/rabbitmq/connection-manager.ts`**

```ts
import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import type { ChannelModel, Options } from 'amqplib';
import { createDeferred, Deferred, withTimeout } from '../../../utils/deferred';
import { ChannelRegistry } from './channel-registry';
import type { ReliabilityOptions } from './reliability-options';

export type ConnectionSetup = (connection: ChannelModel) => Promise<void>;

/**
 * Owns the broker connection: connects, runs `setup` on every new connection, reconnects after a
 * loss, and tells publishers when they may publish (whenReady).
 */
export class ConnectionManager {
    readonly channels: ChannelRegistry;
    private connection: ChannelModel | null = null;
    private connecting = false;
    private shuttingDown = false;
    private blocked = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private ready: Deferred<void> = createDeferred();
    private readonly lostListeners: Array<(name: string) => void> = [];
    private readonly disconnectListeners: Array<() => void> = [];

    constructor(
        private readonly connectOptions: Options.Connect,
        private readonly connectionName: string,
        private readonly reliability: ReliabilityOptions,
        private readonly setup: ConnectionSetup,
    ) {
        this.channels = new ChannelRegistry((name) => this.lostListeners.forEach((listener) => listener(name)));
    }

    get current(): ChannelModel | null {
        return this.connection;
    }

    get isConnected(): boolean {
        return this.connection !== null && this.ready.settled;
    }

    get isBlocked(): boolean {
        return this.blocked;
    }

    onChannelLost(listener: (name: string) => void): void {
        this.lostListeners.push(listener);
    }

    onDisconnected(listener: () => void): void {
        this.disconnectListeners.push(listener);
    }

    async start(): Promise<void> {
        if (this.connecting || this.shuttingDown || this.connection) return;
        this.connecting = true;
        let connection: ChannelModel | null = null;
        try {
            connection = await amqp.connect(this.connectOptions, {
                clientProperties: { connection_name: this.connectionName },
            });
            if (this.shuttingDown) {
                await connection.close().catch(() => undefined);
                return;
            }
            const opened = connection;
            opened.on('error', (err) => Logger.error(`[RabbitMQ] Connection error: ${err.message}`));
            opened.on('close', () => this.handleClose(opened));
            opened.on('blocked', (reason) => {
                this.blocked = true;
                Logger.warn(`[RabbitMQ] The broker is blocking publishers: ${reason}`);
            });
            opened.on('unblocked', () => {
                this.blocked = false;
                Logger.log('[RabbitMQ] The broker stopped blocking publishers');
            });
            this.connection = opened;

            await this.setup(opened);
            // The connection may have closed during setup (shutdown, or the broker dropped it);
            // handleClose already scheduled what comes next. Never report a dead connection as ready.
            if (this.connection !== opened) return;

            this.ready.resolve();
            Logger.log('[RabbitMQ] Connected');
        } catch (err) {
            if (this.shuttingDown) {
                if (connection) await connection.close().catch(() => undefined);
                return;
            }
            Logger.error(`[RabbitMQ] Connection setup failed, retrying in ${this.reliability.reconnectDelayMs}ms: ${err.message}`);
            this.forget();
            if (connection) await connection.close().catch(() => undefined);
            this.scheduleReconnect();
        } finally {
            this.connecting = false;
        }
    }

    async whenReady(): Promise<void> {
        if (this.ready.settled) return;
        await withTimeout(
            this.ready.promise,
            this.reliability.readyTimeoutMs,
            `[RabbitMQ] Not connected to broker after ${this.reliability.readyTimeoutMs}ms`,
        );
    }

    async close(): Promise<void> {
        this.shuttingDown = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const connection = this.connection;
        this.connection = null;
        await this.channels.closeAll();
        if (connection) {
            await connection.close().catch((err) => Logger.warn(`[RabbitMQ] Error while closing the connection: ${err.message}`));
        }
    }

    private handleClose(connection: ChannelModel): void {
        if (connection !== this.connection) return;
        this.forget();
        if (this.shuttingDown) return;
        Logger.warn(`[RabbitMQ] Connection closed, reconnecting in ${this.reliability.reconnectDelayMs}ms`);
        this.scheduleReconnect();
    }

    private forget(): void {
        this.connection = null;
        this.blocked = false;
        this.channels.clear();
        if (this.ready.settled) this.ready = createDeferred();
        this.disconnectListeners.forEach((listener) => listener());
    }

    private scheduleReconnect(): void {
        if (this.shuttingDown || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.start();
        }, this.reliability.reconnectDelayMs);
    }
}
```

Khi đóng connection trong nhánh `catch`, connection đó không còn là `this.connection` (đã bị `forget()` xoá), nên `handleClose` bỏ qua và không đặt thêm một lần reconnect thứ hai.

- [ ] **Step 4: Chạy test để thấy pass**

Run: `npx jest test/connection-manager.spec.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/factories/brokers/rabbitmq/connection-manager.ts test/connection-manager.spec.ts
git commit -m "feat(rabbitmq): add a connection manager with readiness, reconnect and clean shutdown"
```

---

### Task 5: Kiểm tra plugin delayed-message trên connection riêng

**Files:**
- Create: `lib/factories/brokers/rabbitmq/delayed-plugin-probe.ts`
- Test: `test/delayed-plugin-probe.spec.ts`

**Interfaces:**
- Produces: `probeDelayedMessagePlugin(connectOptions: Options.Connect, connectionName: string, timeoutMs: number): Promise<boolean>`. Hàm mở connection tên `<connectionName>:probe`, luôn đóng nó (kể cả khi connection mở xong sau thời hạn), và trả `false` nếu quá `timeoutMs`. Broker gọi với `readyTimeoutMs`.

- [ ] **Step 1: Viết test `test/delayed-plugin-probe.spec.ts`**

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import * as amqp from 'amqplib';
import { probeDelayedMessagePlugin } from '../lib/factories/brokers/rabbitmq/delayed-plugin-probe';
import { mockConnect } from './support/broker-fixture';
import { createFakeBroker, FakeConnection } from './support/fake-amqp';

describe('probeDelayedMessagePlugin', () => {
  it('returns true when the plugin is installed and leaves nothing open', async () => {
    const broker = createFakeBroker();
    mockConnect(broker);
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 1000)).resolves.toBe(true);
    expect(broker.connections).toHaveLength(1);
    expect(broker.connections[0].name).toBe('linkadz:probe');
    expect(broker.connections[0].closed).toBe(true);
    expect([...broker.exchanges.keys()]).toEqual([]);
  });

  it('returns false without touching the main connection when the plugin is missing', async () => {
    const broker = createFakeBroker();
    broker.delayedPlugin = false;
    const main = new FakeConnection(broker, 'linkadz');
    mockConnect(broker);
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 1000)).resolves.toBe(false);
    expect(main.closed).toBe(false);
    expect(broker.connections[1].closed).toBe(true);
  });
});

describe('probeDelayedMessagePlugin edge cases', () => {
  it('gives up when the probe connection hangs', async () => {
    (amqp.connect as unknown as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 50)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/delayed-plugin-probe.spec.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Viết `lib/factories/brokers/rabbitmq/delayed-plugin-probe.ts`**

```ts
import * as amqp from 'amqplib';
import type { ChannelModel, Options } from 'amqplib';
import { withTimeout } from '../../../utils/deferred';

/**
 * Checks for the x-delayed-message plugin on a throwaway connection, with a time limit.
 *
 * Without the plugin, RabbitMQ 3.13 refuses the declaration with a channel-level 406. Using a separate
 * connection keeps the probe away from the main connection whatever the broker version does, and the
 * time limit keeps a hung probe from blocking start-up.
 */
export async function probeDelayedMessagePlugin(
    connectOptions: Options.Connect,
    connectionName: string,
    timeoutMs: number,
): Promise<boolean> {
    let connection: ChannelModel | null = null;
    const connecting = amqp.connect(connectOptions, {
        clientProperties: { connection_name: `${connectionName}:probe` },
    });
    try {
        connection = await withTimeout(connecting, timeoutMs, 'probe timed out');
        connection.on('error', () => undefined);
        const channel = await connection.createChannel();
        channel.on('error', () => undefined);
        const exchange = `_bustransit_probe_delayed_${process.pid}_${Date.now()}`;
        await channel.assertExchange(exchange, 'x-delayed-message', {
            autoDelete: true,
            durable: false,
            arguments: { 'x-delayed-type': 'direct' },
        });
        await channel.deleteExchange(exchange);
        return true;
    } catch {
        // A connection that opens after the timeout must still be closed.
        if (!connection) void connecting.then((late) => late.close()).catch(() => undefined);
        return false;
    } finally {
        if (connection) await connection.close().catch(() => undefined);
    }
}
```

- [ ] **Step 4: Chạy test để thấy pass**

Run: `npx jest test/delayed-plugin-probe.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/factories/brokers/rabbitmq/delayed-plugin-probe.ts test/delayed-plugin-probe.spec.ts
git commit -m "feat(rabbitmq): probe for the delayed-message plugin on a throwaway connection"
```

---

### Task 6: Publisher

**Files:**
- Create: `lib/factories/brokers/rabbitmq/publisher.ts`
- Test: `test/publisher.spec.ts`

**Interfaces:**
- Consumes: `ConnectionManager` (Task 4), `ReliabilityOptions`.
- Produces: `PRODUCER_CHANNEL = '_producer'`, `TOPOLOGY_CHANNEL = '_topology'`, `class Publisher`:
  - `constructor(connection: ConnectionManager, reliability: ReliabilityOptions)`
  - `open(): Promise<void>`: mở producer channel, dùng trong setup
  - `publishToExchange(exchange: string, body: unknown, options?: Options.Publish): Promise<void>`: chờ ready, kiểm tra exchange tồn tại (tạo fanout durable nếu thiếu), persistent, mandatory, confirm
  - `publishRaw(exchange: string, routingKey: string, body: unknown, options?: Options.Publish): Promise<void>`: chờ ready, confirm, không khai báo
  - `ensureExchange(exchange)` (assert fanout durable, dùng cho topology), `declareDelayedExchange(exchange)`, `bindExchange(destination, source)`, `ensureQueue(queue)`. Các lệnh khai báo đồng thời cho cùng một exchange chỉ gửi một lần lên broker.
  - Tên exchange truyền vào **đã có tiền tố cluster**.

- [ ] **Step 1: Viết test `test/publisher.spec.ts`**

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { Logger } from '@nestjs/common';
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { Publisher } from '../lib/factories/brokers/rabbitmq/publisher';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { flush, mockConnect, sleep } from './support/broker-fixture';
import { createFakeBroker, FakeBroker } from './support/fake-amqp';

const reliability = resolveReliability({ reconnectDelayMs: 20, readyTimeoutMs: 100, publishTimeoutMs: 100 });

async function connected(prepare?: (broker: FakeBroker) => void) {
  const broker = createFakeBroker();
  prepare?.(broker);
  mockConnect(broker);
  let publisher!: Publisher;
  const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, () => publisher.open());
  publisher = new Publisher(manager, reliability);
  await manager.start();
  return { broker, manager, publisher };
}

const producerChannels = (broker: FakeBroker) => broker.channels.filter((c) => c.confirm);

describe('Publisher', () => {
  afterEach(() => jest.restoreAllMocks());

  it('survives the 06/10 incident: publishing a message whose exchange nobody created', async () => {
    const { broker, manager, publisher } = await connected((b) => b.exchanges.set('linkadz:SyncAnalyticsCampaignBatchMessage', 'fanout'));

    await expect(publisher.publishToExchange('linkadz:AggregateUrlAnalysisFunnelMessage', { a: 1 })).resolves.toBeUndefined();
    await expect(publisher.publishToExchange('linkadz:SyncAnalyticsCampaignBatchMessage', { b: 2 })).resolves.toBeUndefined();

    expect(broker.exchanges.get('linkadz:AggregateUrlAnalysisFunnelMessage')).toBe('fanout');
    expect(producerChannels(broker)).toHaveLength(1);
    expect(producerChannels(broker)[0].closed).toBe(false);
    await manager.close();
  });

  it('opens a new producer channel after the broker closed the old one', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:OrderPlaced', {});
    producerChannels(broker)[0].serverClose(406, 'PRECONDITION_FAILED - simulated');

    await expect(publisher.publishToExchange('linkadz:OrderPlaced', {})).resolves.toBeUndefined();
    expect(producerChannels(broker)).toHaveLength(2);
    await manager.close();
  });

  it('publishes to an exchange that already exists with other settings, as 0.3.x did', async () => {
    const { broker, manager, publisher } = await connected((b) => b.exchanges.set('linkadz:LegacyEvent', 'direct'));

    await expect(publisher.publishToExchange('linkadz:LegacyEvent', {})).resolves.toBeUndefined();
    expect(broker.exchanges.get('linkadz:LegacyEvent')).toBe('direct');
    expect(broker.asserts).not.toContain('linkadz:LegacyEvent');
    expect(producerChannels(broker)[0].closed).toBe(false);
    await manager.close();
  });

  it('declares an exchange once, and again after the broker says it is gone', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:OrderPlaced', {});
    await publisher.publishToExchange('linkadz:OrderPlaced', {});
    expect(broker.asserts.filter((n) => n === 'linkadz:OrderPlaced')).toHaveLength(1);

    broker.exchanges.delete('linkadz:OrderPlaced'); // someone deleted it on the broker
    await expect(publisher.publishToExchange('linkadz:OrderPlaced', {})).rejects.toThrow(/NOT_FOUND - no exchange 'linkadz:OrderPlaced'/);
    await expect(publisher.publishToExchange('linkadz:OrderPlaced', {})).resolves.toBeUndefined();
    expect(broker.exchanges.has('linkadz:OrderPlaced')).toBe(true);
    await manager.close();
  });

  it('rejects when the broker does not confirm in time and says the broker is blocking', async () => {
    const { broker, manager, publisher } = await connected();
    broker.holdConfirms = true;
    broker.connections[0].emit('blocked', 'low on memory');

    await expect(publisher.publishToExchange('linkadz:OrderPlaced', {})).rejects.toThrow(
      "[RabbitMQ] Publish to 'linkadz:OrderPlaced' was not confirmed within 100ms (the broker is blocking publishers)",
    );
    await manager.close();
  });

  it('opens one new channel for concurrent publishes after the old one died', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:OrderPlaced', {});
    producerChannels(broker)[0].serverClose(406, 'PRECONDITION_FAILED - simulated');

    await Promise.all(Array.from({ length: 5 }, () => publisher.publishToExchange('linkadz:OrderPlaced', {})));
    expect(producerChannels(broker)).toHaveLength(2);
    await manager.close();
  });

  it('warns when a message reaches no queue', async () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const { manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:AggregateUrlAnalysisFunnelMessage', {}, { messageId: 'm-1' });
    await flush();
    expect(
      warn.mock.calls.some(([msg]) => String(msg).includes("Unroutable message m-1 to exchange 'linkadz:AggregateUrlAnalysisFunnelMessage'")),
    ).toBe(true);
    await manager.close();
  });

  it('writes to a queue through the default exchange with a confirm', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.ensureQueue('ping_error');
    await expect(publisher.publishRaw('', 'ping_error', { boom: true }, { persistent: true, mandatory: true })).resolves.toBeUndefined();
    expect(broker.published.find((p) => p.routingKey === 'ping_error')?.content).toEqual({ boom: true });
    await manager.close();
  });
});

describe('Publisher edge cases', () => {
  it('rejects a publish in flight when the connection drops, and publishes again after reconnecting', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:A', {});
    broker.holdConfirms = true;
    const inFlight = publisher.publishToExchange('linkadz:A', {});
    await sleep(5);
    broker.holdConfirms = false;
    broker.connections[0].drop();
    await expect(inFlight).rejects.toThrow(/channel closed/i);
    await expect(publisher.publishToExchange('linkadz:A', {})).resolves.toBeUndefined();
    await manager.close();
  });

  it('rejects quickly after close()', async () => {
    const { manager, publisher } = await connected();
    await manager.close();
    await expect(publisher.publishToExchange('linkadz:A', {})).rejects.toThrow('[RabbitMQ] Not connected to broker');
  });

  it('rejects a body that cannot be serialized without sending anything', async () => {
    const { broker, manager, publisher } = await connected();
    const body: any = {};
    body.self = body;
    await expect(publisher.publishToExchange('linkadz:A', body)).rejects.toThrow(/circular/i);
    expect(broker.published).toHaveLength(0);
    await manager.close();
  });

  it('declares an exchange once when the first publishes run concurrently', async () => {
    const { broker, manager, publisher } = await connected();
    await Promise.all([1, 2, 3].map(() => publisher.publishToExchange('linkadz:A', {})));
    expect(broker.asserts.filter((n) => n === 'linkadz:A')).toHaveLength(1);
    await manager.close();
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/publisher.spec.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Viết `lib/factories/brokers/rabbitmq/publisher.ts`**

```ts
import { Logger } from '@nestjs/common';
import type { Channel, ConfirmChannel, Message, Options } from 'amqplib';
import type { ConnectionManager } from './connection-manager';
import type { ReliabilityOptions } from './reliability-options';

export const PRODUCER_CHANNEL = '_producer';
export const TOPOLOGY_CHANNEL = '_topology';

/**
 * Publishes with publisher confirms on the "_producer" channel and declares exchanges and queues on a
 * separate "_topology" channel, so a refused declaration never closes the channel that carries
 * other messages.
 *
 * Before the first publish to an exchange it checks that the exchange exists (passive declare) and
 * creates it only when it is missing. An exchange that already exists is used as it is, whatever its
 * type or arguments, exactly as 0.3.x did: asserting it with our own arguments could turn a publish
 * that used to work into a 406.
 */
export class Publisher {
    private readonly declaredExchanges = new Set<string>();
    private readonly pendingDeclarations = new Map<string, Promise<void>>();
    private readonly declaredQueues = new Set<string>();
    private readonly closeReasons = new WeakMap<Channel, Error>();

    constructor(
        private readonly connection: ConnectionManager,
        private readonly reliability: ReliabilityOptions,
    ) {
        connection.onChannelLost((name) => {
            if (name !== PRODUCER_CHANNEL) return;
            // A closed producer channel usually means 404: an exchange this cache believed in is gone.
            this.forgetDeclarations();
            Logger.warn('[RabbitMQ] Producer channel was closed by the broker; a new one opens on the next publish');
        });
        connection.onDisconnected(() => this.forgetDeclarations());
    }

    async open(): Promise<void> {
        await this.producerChannel();
    }

    async publishToExchange(exchange: string, body: unknown, options: Options.Publish = {}): Promise<void> {
        await this.connection.whenReady();
        await this.ensurePublishTarget(exchange);
        await this.confirmPublish(exchange, '', body, { persistent: true, mandatory: true, ...options });
    }

    async publishRaw(exchange: string, routingKey: string, body: unknown, options: Options.Publish = {}): Promise<void> {
        await this.connection.whenReady();
        await this.confirmPublish(exchange, routingKey, body, options);
    }

    /** Uses an existing exchange as it is; creates a durable fanout exchange only when it is missing. */
    private ensurePublishTarget(exchange: string): Promise<void> {
        return this.declareOnce(exchange, async (channel) => {
            try {
                await channel.checkExchange(exchange);
            } catch (err) {
                if (err?.code !== 404 && !/NOT_FOUND/.test(String(err?.message))) throw err;
                // The 404 closed that channel; create the exchange on a fresh one.
                const fresh = await this.topologyChannel();
                await fresh.assertExchange(exchange, 'fanout', { durable: true });
            }
        });
    }

    /** Topology declarations for consumers: asserts the exchange with the arguments 0.3.x used. */
    ensureExchange(exchange: string): Promise<void> {
        return this.declareOnce(exchange, (channel) => channel.assertExchange(exchange, 'fanout', { durable: true }));
    }

    declareDelayedExchange(exchange: string): Promise<void> {
        return this.declareOnce(exchange, (channel) =>
            channel.assertExchange(exchange, 'x-delayed-message', {
                autoDelete: false,
                durable: true,
                arguments: { 'x-delayed-type': 'direct' },
            }),
        );
    }

    /** Declares once per connection; concurrent callers share one declaration. */
    private declareOnce(exchange: string, declare: (channel: Channel) => Promise<unknown>): Promise<void> {
        if (this.declaredExchanges.has(exchange)) return Promise.resolve();
        const inFlight = this.pendingDeclarations.get(exchange);
        if (inFlight) return inFlight;
        const declaration = this.topologyChannel()
            .then(declare)
            .then(() => {
                this.declaredExchanges.add(exchange);
            })
            .finally(() => this.pendingDeclarations.delete(exchange));
        this.pendingDeclarations.set(exchange, declaration);
        return declaration;
    }

    async bindExchange(destination: string, source: string): Promise<void> {
        const channel = await this.topologyChannel();
        await channel.bindExchange(destination, source, '');
    }

    async ensureQueue(queue: string): Promise<void> {
        if (this.declaredQueues.has(queue)) return;
        const channel = await this.topologyChannel();
        await channel.assertQueue(queue, { durable: true });
        this.declaredQueues.add(queue);
    }

    private forgetDeclarations(): void {
        this.declaredExchanges.clear();
        this.declaredQueues.clear();
    }

    private requireConnection() {
        const connection = this.connection.current;
        if (!connection) throw new Error('[RabbitMQ] Not connected to broker');
        return connection;
    }

    private topologyChannel(): Promise<Channel> {
        return this.connection.channels.getOrCreate(TOPOLOGY_CHANNEL, async () => {
            const channel = await this.requireConnection().createChannel();
            channel.on('error', (err: any) => {
                // 404 is the expected answer when checking an exchange that does not exist yet.
                if (err?.code === 404) Logger.debug(`[RabbitMQ] ${err.message}`);
                else Logger.error(`[RabbitMQ] Declaration refused by the broker: ${err.message}`);
            });
            return channel;
        });
    }

    private producerChannel(): Promise<ConfirmChannel> {
        return this.connection.channels.getOrCreate(PRODUCER_CHANNEL, async () => {
            const channel = await this.requireConnection().createConfirmChannel();
            channel.on('error', (err) => {
                this.closeReasons.set(channel, err);
                Logger.error(`[RabbitMQ] Channel error for '${PRODUCER_CHANNEL}': ${err.message}`);
            });
            channel.on('return', (returned: Message) => {
                Logger.warn(
                    `[RabbitMQ] Unroutable message ${returned.properties.messageId ?? ''} to exchange ` +
                    `'${returned.fields.exchange}' (routing key '${returned.fields.routingKey}'): ` +
                    'no queue is bound, the message was dropped',
                );
            });
            return channel;
        });
    }

    private async confirmPublish(exchange: string, routingKey: string, body: unknown, options: Options.Publish): Promise<void> {
        const channel = await this.producerChannel();
        const content = Buffer.from(JSON.stringify(body), 'utf-8');
        const target = exchange || `queue ${routingKey}`;
        let timer: NodeJS.Timeout | undefined;
        try {
            await new Promise<void>((resolve, reject) => {
                timer = setTimeout(() => {
                    const blocked = this.connection.isBlocked ? ' (the broker is blocking publishers)' : '';
                    reject(new Error(`[RabbitMQ] Publish to '${target}' was not confirmed within ${this.reliability.publishTimeoutMs}ms${blocked}`));
                }, this.reliability.publishTimeoutMs);
                channel.publish(exchange, routingKey, content, options, (err) => {
                    if (!err) return resolve();
                    // amqplib reports "channel closed"; the broker's reason (e.g. 404 NOT_FOUND) is more useful.
                    reject(this.closeReasons.get(channel) ?? err);
                });
            });
        } finally {
            clearTimeout(timer);
        }
    }
}
```

- [ ] **Step 4: Chạy test để thấy pass**

Run: `npx jest test/publisher.spec.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/factories/brokers/rabbitmq/publisher.ts test/publisher.spec.ts
git commit -m "feat(rabbitmq): add a confirm-based publisher that declares exchanges on a separate channel"
```

---

### Task 7: Topology

**Files:**
- Create: `lib/factories/brokers/rabbitmq/topology.ts`
- Test: `test/topology.spec.ts`

**Interfaces:**
- Consumes: `Publisher.ensureExchange`, `Publisher.bindExchange` (Task 6).
- Produces:
  - `interface ExchangeDeclaration { exchange: string; bindTo: string | null }` (tên chưa có tiền tố)
  - `interface TopologyMaps { classConsumerToEndpoint; classMessageToEndpoint; classMessageToExchange }`
  - `buildTopology(consumers, consumersToEndpoint, resolve, maps): ExchangeDeclaration[]`: chuyển nguyên logic của `startAllConsumer` (:265-283) và `createAllExchange` (:158-263), cùng thứ tự, cùng cách ghi vào các map.
  - `declareTopology(publisher, declarations, prefix): Promise<void>`: khai báo từng mục, mục nào lỗi thì ghi log rồi làm tiếp mục khác.

- [ ] **Step 1: Viết test `test/topology.spec.ts`**

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { Logger } from '@nestjs/common';
import { ConsumerConfigurator } from '../lib/factories/consumer.configurator';
import { SagaConfigurator } from '../lib/factories/saga.configurator';
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { Publisher } from '../lib/factories/brokers/rabbitmq/publisher';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { buildTopology, declareTopology, TopologyMaps } from '../lib/factories/brokers/rabbitmq/topology';
import { mockConnect } from './support/broker-fixture';
import { createFakeBroker } from './support/fake-amqp';
import { OrderState, OrderStateMachine, PingConsumer } from './support/topology-fixture';

function config() {
  const ping = new ConsumerConfigurator();
  ping.bindQueue('ping');
  ping.bindConsumer(PingConsumer);
  const saga = new SagaConfigurator();
  saga.bindQueue('order-saga');
  saga.bindConsumer(OrderStateMachine);
  const instances = new Map<unknown, unknown>([
    [PingConsumer, new PingConsumer()],
    [OrderStateMachine, new OrderStateMachine()],
  ]);
  return {
    consumers: { PingConsumer, OrderStateMachine: { machineClass: OrderStateMachine, stateClass: OrderState } } as Record<string, any>,
    endpoints: { ping, 'order-saga': saga } as Record<string, any>,
    resolve: (token: unknown) => {
      if (!instances.has(token)) throw new Error('not registered');
      return instances.get(token);
    },
  };
}

const emptyMaps = (): TopologyMaps => ({ classConsumerToEndpoint: {}, classMessageToEndpoint: {}, classMessageToExchange: {} });

describe('buildTopology', () => {
  it('produces the 0.3.x declarations and fills the routing maps', () => {
    const { consumers, endpoints, resolve } = config();
    const maps = emptyMaps();

    expect(buildTopology(consumers, endpoints, resolve, maps)).toEqual([
      { exchange: 'OrderState', bindTo: null },
      { exchange: 'OrderSubmitted', bindTo: 'order-saga' },
      { exchange: 'ChargeCard', bindTo: null },
      { exchange: 'PingMessage', bindTo: 'ping' },
      { exchange: 'OrderState', bindTo: 'order-saga' },
    ]);
    expect(maps.classMessageToExchange).toEqual({ PingMessage: 'ping', OrderState: 'order-saga' });
    expect(maps.classConsumerToEndpoint).toEqual({ PingConsumer: 'ping', OrderStateMachine: 'order-saga' });
    expect(maps.classMessageToEndpoint.OrderSubmitted.Name).toBe('order-saga');
  });

  it('skips a consumer that is not registered as a provider and keeps the rest', () => {
    const error = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const { consumers, endpoints } = config();
    const onlyPing = (token: unknown) => {
      if (token === PingConsumer) return new PingConsumer();
      throw new Error('not registered');
    };

    const declarations = buildTopology(consumers, endpoints, onlyPing, emptyMaps());
    expect(declarations).toEqual([{ exchange: 'PingMessage', bindTo: 'ping' }]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('declareTopology', () => {
  it('declares every exchange and binding, and keeps going after one is refused', async () => {
    const error = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const broker = createFakeBroker();
    broker.exchanges.set('linkadz:Legacy', 'direct');
    mockConnect(broker);
    const reliability = resolveReliability({ reconnectDelayMs: 20 });
    let publisher!: Publisher;
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, () => publisher.open());
    publisher = new Publisher(manager, reliability);
    await manager.start();

    await declareTopology(
      publisher,
      [
        { exchange: 'Legacy', bindTo: 'ping' },
        { exchange: 'PingMessage', bindTo: 'ping' },
        { exchange: 'ChargeCard', bindTo: null },
      ],
      (name) => `linkadz:${name}`,
    );

    expect(broker.exchanges.get('linkadz:PingMessage')).toBe('fanout');
    expect(broker.exchanges.get('linkadz:ChargeCard')).toBe('fanout');
    expect(broker.bindings).toContainEqual({ source: 'linkadz:PingMessage', dest: 'linkadz:ping' });
    expect(error.mock.calls.some(([msg]) => String(msg).includes("Could not declare exchange 'linkadz:Legacy'"))).toBe(true);
    expect(broker.channels.find((c) => c.confirm)?.closed).toBe(false);
    error.mockRestore();
    await manager.close();
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/topology.spec.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Viết `lib/factories/brokers/rabbitmq/topology.ts`**

```ts
import { Logger } from '@nestjs/common';
import { EndpointRegistrationConfigurator } from '../../endpoint.registration.configurator';
import { BusTransitStateMachine } from '../../saga.bustransit.state-machine';
import type { Publisher } from './publisher';

/** An exchange to declare and, when bindTo is set, the exchange it forwards to. Names without the cluster prefix. */
export interface ExchangeDeclaration {
    exchange: string;
    bindTo: string | null;
}

export interface TopologyMaps {
    classConsumerToEndpoint: Record<string, string>;
    classMessageToEndpoint: Record<string, any>;
    classMessageToExchange: Record<string, string>;
}

/**
 * The exchanges and bindings 0.3.x declared in startAllConsumer and createAllExchange, in the same
 * order, filling the same routing maps. Pure apart from the maps it fills.
 */
export function buildTopology(
    consumers: Record<string, any>,
    consumersToEndpoint: Record<string, { consumer: any }>,
    resolve: (token: unknown) => any,
    maps: TopologyMaps,
): ExchangeDeclaration[] {
    const fromEndpoints: ExchangeDeclaration[] = [];
    for (const [queueName, cfg] of Object.entries(consumersToEndpoint)) {
        const consumer = cfg.consumer;
        let messageClass: any;
        try {
            messageClass = resolve(consumer).GetMessageClass;
        } catch (err) {
            Logger.error(`[RabbitMQ] Consumer ${consumer?.name} for queue '${queueName}' is not registered as a provider; its exchanges are skipped: ${err.message}`);
            continue;
        }
        fromEndpoints.push({ exchange: messageClass?.name, bindTo: queueName });
        maps.classConsumerToEndpoint[consumer?.name] = queueName;
        maps.classMessageToExchange[messageClass?.name] = queueName;
    }

    const fromSagas: ExchangeDeclaration[] = [];
    for (const consumerData of Object.values(consumers)) {
        const consumer = consumerData?.machineClass || consumerData;
        let instance: any;
        try {
            instance = resolve(consumer);
        } catch (err) {
            Logger.error(`[RabbitMQ] Consumer ${consumer?.name} is not registered as a provider; its exchanges are skipped: ${err.message}`);
            continue;
        }
        if (consumer.EndpointRegistrationConfigurator) {
            maps.classMessageToEndpoint[instance.GetMessageClass.name] = consumer.EndpointRegistrationConfigurator;
        }
        if (Object.getPrototypeOf(consumer) !== BusTransitStateMachine) continue;

        const saga = instance as BusTransitStateMachine<any>;
        fromSagas.push({ exchange: saga.GetMessageClass.name, bindTo: null });
        for (const event of Object.keys(saga.GetEvents)) {
            if (!maps.classMessageToEndpoint[event]) {
                const endpoint = new EndpointRegistrationConfigurator();
                endpoint.Name = maps.classMessageToExchange[saga.GetMessageClass.name];
                maps.classMessageToEndpoint[event] = endpoint;
            }
            fromSagas.push({ exchange: event, bindTo: maps.classMessageToEndpoint[event].Name ?? null });
        }
        for (const behaviour of Object.keys(saga.GetBehaviours)) {
            fromSagas.push({ exchange: behaviour, bindTo: null });
        }
    }

    return [...fromSagas, ...fromEndpoints];
}

/** Declares each exchange and binding; a refused one is logged and the rest still get declared. */
export async function declareTopology(
    publisher: Pick<Publisher, 'ensureExchange' | 'bindExchange'>,
    declarations: ExchangeDeclaration[],
    prefix: (name: string) => string,
): Promise<void> {
    for (const { exchange, bindTo } of declarations) {
        if (!exchange) {
            Logger.warn('[RabbitMQ] Skipped an exchange without a name: a consumer has no message class');
            continue;
        }
        try {
            await publisher.ensureExchange(prefix(exchange));
            if (bindTo) {
                await publisher.ensureExchange(prefix(bindTo));
                await publisher.bindExchange(prefix(bindTo), prefix(exchange));
            }
        } catch (err) {
            const target = bindTo ? ` -> '${prefix(bindTo)}'` : '';
            Logger.error(`[RabbitMQ] Could not declare exchange '${prefix(exchange)}'${target}: ${err.message}`);
        }
    }
}
```

- [ ] **Step 4: Chạy test để thấy pass**

Run: `npx jest test/topology.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/factories/brokers/rabbitmq/topology.ts test/topology.spec.ts
git commit -m "feat(rabbitmq): extract topology building and declare it one exchange at a time"
```

---

### Task 8: Delivery pipeline

**Files:**
- Create: `lib/factories/brokers/rabbitmq/delivery-pipeline.ts`
- Test: `test/delivery-pipeline.spec.ts`

**Interfaces:**
- Consumes: `Publisher.publishRaw`, `Publisher.ensureQueue` (Task 6), `retryWithDelay` (`lib/factories/retry.utils.ts`).
- Produces:
  - `type DeliveryHandler = (channel: Channel, message: ConsumeMessage) => Promise<void>` (Task 9 import type này từ đây)
  - `interface RedeliveryPattern { retryType: number; retryValue: any }`
  - `interface DeliveryContext { queue; consumer; retryPattern?; redeliveryPattern?; redeliveryEnabled(): boolean; delayExchange (đã có tiền tố); resolve(token); publisher: Pick<Publisher,'publishRaw'|'ensureQueue'>; hostInfo(): object; requeueDelayMs }`
  - `redeliveryDelay(pattern, attempt): { maxRetries; delayMs }`, `createDeliveryHandler(ctx): DeliveryHandler`
  - Bảo đảm: gửi reply thất bại thì không chạy lại consumer (việc đã xong; bên gọi sẽ nhận timeout).

- [ ] **Step 1: Viết test `test/delivery-pipeline.spec.ts`**

```ts
import { BusTransitConsumer } from '../lib/factories/consumer';
import { RetryConfigurator, RetryLevel } from '../lib/factories/retry.configurator';
import { createDeliveryHandler, DeliveryContext, redeliveryDelay } from '../lib/factories/brokers/rabbitmq/delivery-pipeline';
import { IPublishEndpoint } from '../lib/interfaces/publish-endpoint.interface';
import { sleep } from './support/broker-fixture';

class PingMessage {
  text: string;
}
class PingConsumer extends BusTransitConsumer<PingMessage> {
  calls = 0;
  failTimes = 0;
  lastSaga: unknown;
  constructor() {
    super(PingMessage);
  }
  async Consume(ctx, context): Promise<any> {
    await super.Consume(ctx, context);
    this.calls++;
    this.lastSaga = ctx.Saga;
    if (this.failTimes-- > 0) throw new Error('boom');
    return { ok: true };
  }
}

function setup(overrides: Partial<DeliveryContext> = {}) {
  const consumer = new PingConsumer();
  const publisher = { publishRaw: jest.fn(async () => undefined), ensureQueue: jest.fn(async () => undefined) };
  const channel = { ack: jest.fn(), nack: jest.fn(), publish: jest.fn() };
  const handle = createDeliveryHandler({
    queue: 'ping',
    consumer: PingConsumer,
    redeliveryEnabled: () => false,
    delayExchange: 'linkadz:delayed.exchange.ping',
    resolve: (token) => (token === PingConsumer ? consumer : token === IPublishEndpoint ? {} : undefined),
    publisher,
    hostInfo: () => ({ machineName: 'test' }),
    requeueDelayMs: 20,
    ...overrides,
  });
  const message = (body: unknown, properties: Record<string, unknown> = {}) =>
    ({
      content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
      fields: { deliveryTag: 1 },
      properties: { headers: {}, ...properties },
    }) as any;
  return { consumer, publisher, channel, handle, message };
}

const retry = (level: RetryLevel, configure: (r: RetryConfigurator) => void) => {
  const r = new RetryConfigurator(level);
  configure(r);
  return r.getRetryValue();
};

describe('redeliveryDelay', () => {
  it('computes the delay for each retry type', () => {
    expect(redeliveryDelay({ retryType: 0, retryValue: 3 }, 0)).toEqual({ maxRetries: 3, delayMs: 0 });
    expect(redeliveryDelay({ retryType: 1, retryValue: [2, 1000] }, 1)).toEqual({ maxRetries: 2, delayMs: 1000 });
    expect(redeliveryDelay({ retryType: 2, retryValue: [5000, 15000] }, 1)).toEqual({ maxRetries: 2, delayMs: 15000 });
    expect(redeliveryDelay({ retryType: 3, retryValue: [3, 1000, 2] }, 2)).toEqual({ maxRetries: 3, delayMs: 4000 });
  });
});

describe('delivery pipeline', () => {
  it('runs the consumer, passes the saga header and acks', async () => {
    const { consumer, channel, handle, message } = setup();
    const msg = message({ message: { text: 'a.b.c' }, headers: { saga: { CorrelationId: 'c-1' } } });
    await handle(channel as any, msg);
    expect(consumer.calls).toBe(1);
    expect(consumer.lastSaga).toEqual({ CorrelationId: 'c-1' });
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('replies when the message asks for a reply', async () => {
    const { channel, handle, message } = setup();
    await handle(channel as any, message({ message: { text: 'x' } }, { replyTo: 'amq.rabbitmq.reply-to', correlationId: 'c-1' }));
    const [exchange, routingKey, content, options] = channel.publish.mock.calls[0];
    expect([exchange, routingKey]).toEqual(['', 'amq.rabbitmq.reply-to']);
    expect(JSON.parse(content.toString())).toEqual({ ok: true });
    expect(options).toEqual({ correlationId: 'c-1' });
  });

  it('moves a message that is not JSON to the error queue, then acks', async () => {
    const { consumer, publisher, channel, handle, message } = setup();
    const msg = message('not json');
    await handle(channel as any, msg);
    expect(consumer.calls).toBe(0);
    expect(publisher.ensureQueue).toHaveBeenCalledWith('ping_error');
    const [, queue, payload, options] = publisher.publishRaw.mock.calls[0] as any[];
    expect(queue).toBe('ping_error');
    expect(payload.message).toBe('not json');
    expect(options).toEqual({ persistent: true, mandatory: true });
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('retries in place, then moves the message to the error queue', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      retryPattern: retry(RetryLevel.retry, (r) => r.Immediate(2)),
    });
    consumer.failTimes = 5;
    await handle(channel as any, message({ message: { text: 'x' } }));
    expect(consumer.calls).toBe(3);
    const [, , payload] = publisher.publishRaw.mock.calls[0] as any[];
    expect(payload.error.message).toBe('boom');
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('schedules a delayed redelivery instead of the error queue while attempts remain', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }, { messageId: 'm-1', headers: { 'x-redelivery': 1 } }));
    const [exchange, routingKey, body, options] = publisher.publishRaw.mock.calls[0] as any[];
    expect([exchange, routingKey]).toEqual(['linkadz:delayed.exchange.ping', '']);
    expect(body.message).toEqual({ text: 'x' });
    expect(options.headers).toMatchObject({ 'x-delay': 15000, 'x-redelivery': 2 });
    expect(options.persistent).toBe(true);
    expect(options.messageId).toBe('m-1');
    expect(publisher.ensureQueue).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('goes to the error queue once redelivery attempts are used up', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }, { headers: { 'x-redelivery': 2 } }));
    expect((publisher.publishRaw.mock.calls[0] as any[])[1]).toBe('ping_error');
  });

  it('requeues instead of acking when the failed message cannot be parked', async () => {
    const { consumer, publisher, channel, handle, message } = setup();
    consumer.failTimes = 1;
    publisher.publishRaw.mockRejectedValueOnce(new Error('[RabbitMQ] Not connected to broker after 10000ms'));
    const msg = message({ message: { text: 'x' } });
    await handle(channel as any, msg);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it('does not throw when the channel is already closed at ack time', async () => {
    const { channel, handle, message } = setup();
    channel.ack.mockImplementation(() => {
      throw new Error('Channel closed');
    });
    await expect(handle(channel as any, message({ message: { text: 'x' } }))).resolves.toBeUndefined();
  });
});

describe('delivery pipeline edge cases', () => {
  it('does not run the consumer again when sending the reply fails', async () => {
    const { consumer, publisher, channel, handle, message } = setup();
    channel.publish.mockImplementation(() => {
      throw new Error('Channel closed');
    });
    await handle(channel as any, message({ message: { text: 'x' } }, { replyTo: 'amq.rabbitmq.reply-to', correlationId: 'c-1' }));
    expect(consumer.calls).toBe(1);
    expect(publisher.publishRaw).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('moves JSON that is not an envelope to the error queue', async () => {
    const { publisher, channel, handle, message } = setup();
    await handle(channel as any, message('null'));
    expect((publisher.publishRaw.mock.calls[0] as any[])[1]).toBe('ping_error');
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('parks a message that has no headers', async () => {
    const { publisher, channel, handle, message } = setup();
    const msg = message('not json');
    msg.properties = {};
    await handle(channel as any, msg);
    expect(publisher.publishRaw).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/delivery-pipeline.spec.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Viết `lib/factories/brokers/rabbitmq/delivery-pipeline.ts`**

```ts
import { Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { defer, lastValueFrom } from 'rxjs';
import { IMessage } from '../../../interfaces/message.interface';
import { IPublishEndpoint } from '../../../interfaces/publish-endpoint.interface';
import { BehaviorContext } from '../../behavior.context';
import { retryWithDelay } from '../../retry.utils';
import type { Publisher } from './publisher';

export type DeliveryHandler = (channel: Channel, message: ConsumeMessage) => Promise<void>;

export interface RedeliveryPattern {
    retryType: number;
    retryValue: any;
}

export interface DeliveryContext {
    queue: string;
    consumer: unknown;
    retryPattern?: { pipe: any };
    redeliveryPattern?: RedeliveryPattern;
    redeliveryEnabled: () => boolean;
    /** Delayed exchange of this queue, with the cluster prefix. */
    delayExchange: string;
    resolve: (token: unknown) => any;
    publisher: Pick<Publisher, 'publishRaw' | 'ensureQueue'>;
    hostInfo: () => object;
    /** Wait before handing a message back to the queue when it could not be parked. */
    requeueDelayMs: number;
}

export function redeliveryDelay(pattern: RedeliveryPattern, attempt: number): { maxRetries: number; delayMs: number } {
    switch (pattern.retryType) {
        case 1: // Retry.Interval
            return { maxRetries: pattern.retryValue[0], delayMs: pattern.retryValue[1] };
        case 2: // Retry.Intervals
            return {
                maxRetries: pattern.retryValue.length,
                delayMs: attempt < pattern.retryValue.length ? pattern.retryValue[attempt] : 0,
            };
        case 3: // Retry.Exponential
            return {
                maxRetries: pattern.retryValue[0],
                delayMs: pattern.retryValue[1] * Math.pow(pattern.retryValue[2], attempt),
            };
        case 0: // Retry.Immediate
        default:
            return { maxRetries: pattern.retryValue, delayMs: 0 };
    }
}

/**
 * Handles one delivery: parse, run the consumer with in-place retries, then either ack, or park the
 * message (delayed redelivery or error queue) and ack only once the broker confirmed the parked copy.
 * If the copy cannot be written the message goes back to the queue instead of being lost.
 */
export function createDeliveryHandler(ctx: DeliveryContext): DeliveryHandler {
    return async (channel, message) => {
        let body: any;
        try {
            body = JSON.parse(message.content.toString());
        } catch (err) {
            Logger.error(`[RabbitMQ] Message on '${ctx.queue}' is not valid JSON: ${err.message}`);
            await settle(ctx, channel, message, () => moveToErrorQueue(ctx, message, message.content.toString(), err));
            return;
        }

        try {
            const retryPipe = ctx.retryPattern?.pipe ?? retryWithDelay({ maxRetryAttempts: 0, delay: 0 });
            await lastValueFrom(defer(() => invoke(ctx, channel, message, body)).pipe(retryPipe));
            ack(ctx.queue, channel, message);
        } catch (err) {
            Logger.error(`[RabbitMQ] Message on '${ctx.queue}' failed: ${err.message}`);
            await settle(ctx, channel, message, async () => {
                if (!(await redeliver(ctx, message, body))) await moveToErrorQueue(ctx, message, body, err);
            });
        }
    };
}

async function invoke(ctx: DeliveryContext, channel: Channel, message: ConsumeMessage, body: any): Promise<any> {
    const consumer = ctx.resolve(ctx.consumer);
    consumer.producer = ctx.resolve(IPublishEndpoint);

    const behavior = new BehaviorContext<any, any>();
    behavior.Saga = body.headers?.saga;

    const result = await consumer.Consume(behavior, { ...message, Message: body.message } as unknown as IMessage<any>);

    const { replyTo, correlationId } = message.properties;
    if (replyTo && correlationId) {
        try {
            channel.publish('', replyTo, Buffer.from(JSON.stringify(result ?? true)), { correlationId });
        } catch (err) {
            // The work is done; failing here would run the consumer again. The caller times out instead.
            Logger.warn(`[RabbitMQ] Could not send the reply for a message on '${ctx.queue}': ${err.message}`);
        }
    }
    return result;
}

async function redeliver(ctx: DeliveryContext, message: ConsumeMessage, body: any): Promise<boolean> {
    const pattern = ctx.redeliveryPattern;
    if (!pattern?.retryValue) return false;
    if (!ctx.redeliveryEnabled()) {
        Logger.warn(
            `[RabbitMQ] Redelivery pattern configured but DISABLED for queue '${ctx.queue}' - ` +
            'x-delayed-message plugin not available. Message will be sent to error queue.',
        );
        return false;
    }
    const attempt = Number(message.properties.headers?.['x-redelivery'] ?? 0);
    const { maxRetries, delayMs } = redeliveryDelay(pattern, attempt);
    if (attempt >= maxRetries) {
        Logger.warn(`[RabbitMQ] Redelivery: Max attempts (${maxRetries}) reached for message`);
        return false;
    }
    Logger.log(`[RabbitMQ] Redelivery: Attempt ${attempt + 1}/${maxRetries}: retrying in ${delayMs}ms`);
    // No "mandatory": the delayed-message plugin does not support it.
    await ctx.publisher.publishRaw(ctx.delayExchange, '', body, {
        persistent: true,
        messageId: message.properties.messageId,
        correlationId: message.properties.correlationId,
        replyTo: message.properties.replyTo,
        headers: { ...message.properties.headers, 'x-delay': delayMs, 'x-redelivery': attempt + 1 },
    });
    return true;
}

async function moveToErrorQueue(ctx: DeliveryContext, message: ConsumeMessage, payload: unknown, err: Error): Promise<void> {
    const errorQueue = `${ctx.queue}_error`;
    const errorPayload = {
        headers: message.properties.headers,
        message: payload,
        host: ctx.hostInfo(),
        error: { stack: err.stack, message: err.message, timestamp: new Date().toISOString() },
        retryHistory: {
            immediateRetries: message.properties.headers?.['x-retry-count'] ?? 0,
            redeliveryAttempts: message.properties.headers?.['x-redelivery'] ?? 0,
        },
    };
    await ctx.publisher.ensureQueue(errorQueue);
    await ctx.publisher.publishRaw('', errorQueue, errorPayload, { persistent: true, mandatory: true });
    Logger.error(
        `Message moved to error queue: ${errorQueue}. ` +
        `Immediate retries: ${errorPayload.retryHistory.immediateRetries}, ` +
        `Redelivery attempts: ${errorPayload.retryHistory.redeliveryAttempts}`,
    );
}

async function settle(ctx: DeliveryContext, channel: Channel, message: ConsumeMessage, park: () => Promise<void>): Promise<void> {
    try {
        await park();
        ack(ctx.queue, channel, message);
    } catch (err) {
        Logger.error(`[RabbitMQ] Could not park a failed message from '${ctx.queue}': ${err.message}. It goes back to the queue in ${ctx.requeueDelayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, ctx.requeueDelayMs));
        try {
            channel.nack(message, false, true);
        } catch (nackErr) {
            Logger.warn(`[RabbitMQ] Could not requeue on '${ctx.queue}': ${nackErr.message}. The broker will redeliver the message.`);
        }
    }
}

function ack(queue: string, channel: Channel, message: ConsumeMessage): void {
    try {
        channel.ack(message);
    } catch (err) {
        Logger.warn(`[RabbitMQ] Could not ack on '${queue}': ${err.message}. The broker will redeliver the message.`);
    }
}
```

- [ ] **Step 4: Chạy test để thấy pass**

Run: `npx jest test/delivery-pipeline.spec.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/factories/brokers/rabbitmq/delivery-pipeline.ts test/delivery-pipeline.spec.ts
git commit -m "feat(rabbitmq): add a delivery pipeline that only acks failed messages once they are parked"
```

---

### Task 9: ConsumerRunner

**Files:**
- Create: `lib/interfaces/brokers/bustransit-health.interface.ts`
- Create: `lib/factories/brokers/rabbitmq/consumer-runner.ts`
- Test: `test/consumer-runner.spec.ts`

**Interfaces:**
- Consumes: `ConnectionManager` (Task 4), `DeliveryHandler` (Task 8), `withTimeout` (Task 2).
- Produces:
  - `type ConsumerStatus = 'starting' | 'consuming' | 'restarting' | 'stopped'`, `interface BusTransitHealth { connected: boolean; blocked: boolean; consumers: Record<string, ConsumerStatus> }`
  - `interface ConsumerDefinition { queue: string; prefetch: number; prepare(channel): Promise<void>; handle: DeliveryHandler }`
  - `class ConsumerRunner`: `constructor(def, connection, reliability)`, `status: ConsumerStatus`, `start(): Promise<void>` (không bao giờ throw), `stop(timeoutMs: number): Promise<void>`
  - Bảo đảm: handler ném lỗi đồng bộ không làm sập process; message tới sau khi `stop()` bắt đầu được trả lại queue (nack, requeue) chứ không được xử lý dở.
  - Tên channel trong registry: `consumer:<queue>`

- [ ] **Step 1: Viết `lib/interfaces/brokers/bustransit-health.interface.ts`**

```ts
export type ConsumerStatus = 'starting' | 'consuming' | 'restarting' | 'stopped';

export interface BusTransitHealth {
    /** Connected to the broker and ready to publish. */
    connected: boolean;
    /** The broker is blocking publishers (memory or disk alarm). */
    blocked: boolean;
    /** State of the consumer of each queue. */
    consumers: Record<string, ConsumerStatus>;
}
```

- [ ] **Step 2: Viết test `test/consumer-runner.spec.ts`**

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { ConsumerRunner } from '../lib/factories/brokers/rabbitmq/consumer-runner';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { eventually, mockConnect, sleep } from './support/broker-fixture';
import { createFakeBroker, FakeBroker } from './support/fake-amqp';

const reliability = resolveReliability({ reconnectDelayMs: 20, consumerRestartMaxDelayMs: 80, readyTimeoutMs: 200 });

async function run(options: { prepare?: (broker: FakeBroker) => void; handle?: jest.Mock } = {}) {
  const broker = createFakeBroker();
  options.prepare?.(broker);
  mockConnect(broker);
  const handle = options.handle ?? jest.fn(async (channel: any, message: any) => channel.ack(message));
  let runner!: ConsumerRunner;
  const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, () => runner.start());
  runner = new ConsumerRunner(
    {
      queue: 'ping',
      prefetch: 5,
      prepare: async (channel) => {
        await channel.assertQueue('ping', { durable: true });
      },
      handle,
    },
    manager,
    reliability,
  );
  await manager.start();
  return { broker, manager, runner, handle };
}

const pingChannel = (broker: FakeBroker) => broker.channels.find((c) => c.consumers.has('ping') && !c.closed);

describe('ConsumerRunner', () => {
  it('consumes and dispatches messages', async () => {
    const { broker, manager, runner, handle } = await run();
    expect(runner.status).toBe('consuming');
    pingChannel(broker)!.deliver('ping', { message: { text: 'hi' } });
    await eventually(() => handle.mock.calls.length === 1);
    await manager.close();
  });

  it('restarts after the broker closes its channel', async () => {
    const { broker, manager, runner, handle } = await run();
    const first = pingChannel(broker)!;
    first.serverClose(406, 'PRECONDITION_FAILED - unknown delivery tag 1');
    expect(runner.status).toBe('restarting');

    await eventually(() => runner.status === 'consuming');
    const second = pingChannel(broker)!;
    expect(second).not.toBe(first);
    second.deliver('ping', { message: { text: 'after restart' } });
    await eventually(() => handle.mock.calls.length === 1);
    await manager.close();
  });

  it('keeps retrying with a growing delay while the queue cannot be declared, then recovers', async () => {
    const { broker, manager, runner } = await run({ prepare: (b) => b.queueConflicts.add('ping') });
    expect(runner.status).toBe('restarting');
    await sleep(150);
    const attempts = broker.serverCloses.length;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(5);

    broker.queueConflicts.delete('ping');
    await eventually(() => runner.status === 'consuming', 1000);
    await manager.close();
  });

  it('restarts when the broker cancels the consumer', async () => {
    const { broker, manager, runner } = await run();
    pingChannel(broker)!.cancelFromBroker('ping');
    await eventually(() => runner.status === 'restarting');
    await eventually(() => runner.status === 'consuming');
    expect(pingChannel(broker)).toBeDefined();
    await manager.close();
  });

  it('stops taking messages and waits for the ones in progress on stop()', async () => {
    const handle = jest.fn(async (channel: any, message: any) => {
      await sleep(60);
      channel.ack(message);
    });
    const { broker, manager, runner } = await run({ handle });
    const channel = pingChannel(broker)!;
    channel.deliver('ping', { message: { text: 'slow' } });

    await runner.stop(500);
    expect(channel.acks).toHaveLength(1);
    expect(channel.consumers.has('ping')).toBe(false);
    expect(runner.status).toBe('stopped');
    await manager.close();
  });

  it('gives up waiting after the shutdown timeout', async () => {
    const handle = jest.fn(() => new Promise<void>(() => undefined));
    const { broker, manager, runner } = await run({ handle });
    pingChannel(broker)!.deliver('ping', { message: { text: 'stuck' } });
    const started = Date.now();
    await runner.stop(50);
    expect(Date.now() - started).toBeLessThan(200);
    await manager.close();
  });

  it('starts again on the new connection after a reconnect', async () => {
    const { broker, manager, runner } = await run();
    broker.connections[0].drop();
    expect(runner.status).toBe('stopped');
    await eventually(() => runner.status === 'consuming');
    expect(pingChannel(broker)?.connection).toBe(broker.connections[1]);
    await manager.close();
  });
});

describe('ConsumerRunner edge cases', () => {
  it('survives a handler that throws synchronously', async () => {
    const { broker, manager } = await run({ handle: jest.fn(() => { throw new Error('sync boom'); }) });
    expect(() => pingChannel(broker)!.deliver('ping', { message: {} })).not.toThrow();
    await sleep(10);
    await manager.close();
  });

  it('hands back a message delivered after stop() began instead of processing it', async () => {
    const handle = jest.fn(async (channel: any, message: any) => {
      await sleep(40);
      channel.ack(message);
    });
    const { broker, manager, runner } = await run({ handle });
    const channel = pingChannel(broker)!;
    const deliverRaw = channel.consumers.get('ping')!;
    channel.deliver('ping', { message: { n: 1 } });
    const stopping = runner.stop(500);
    deliverRaw({ content: Buffer.from('{"message":{}}'), fields: { deliveryTag: 99 }, properties: { headers: {} } });
    await stopping;
    expect(handle).toHaveBeenCalledTimes(1);
    expect(channel.nacks.map((n) => n.message.fields.deliveryTag)).toEqual([99]);
    expect(channel.nacks[0].requeue).toBe(true);
    await manager.close();
  });

  it('can be stopped twice', async () => {
    const { manager, runner } = await run();
    await runner.stop(50);
    await runner.stop(50);
    expect(runner.status).toBe('stopped');
    await manager.close();
  });
});
```

- [ ] **Step 3: Chạy test để thấy fail**

Run: `npx jest test/consumer-runner.spec.ts`
Expected: FAIL, "Cannot find module '../lib/factories/brokers/rabbitmq/consumer-runner'".

- [ ] **Step 4: Viết `lib/factories/brokers/rabbitmq/consumer-runner.ts`**

```ts
import { Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import type { ConsumerStatus } from '../../../interfaces/brokers/bustransit-health.interface';
import { withTimeout } from '../../../utils/deferred';
import type { ConnectionManager } from './connection-manager';
import type { DeliveryHandler } from './delivery-pipeline';
import type { ReliabilityOptions } from './reliability-options';

export interface ConsumerDefinition {
    queue: string;
    prefetch: number;
    /** Runs on the consumer's own channel before consuming: queue, bindings, redelivery. */
    prepare: (channel: Channel) => Promise<void>;
    handle: DeliveryHandler;
}

/**
 * Runs the consumer of one queue on its own channel. A failure here (refused declaration, channel
 * closed or consumer cancelled by the broker) restarts this consumer only, with a doubling delay.
 */
export class ConsumerRunner {
    private state: ConsumerStatus = 'stopped';
    private channel: Channel | null = null;
    private consumerTag: string | null = null;
    private stopping = false;
    private restartTimer: NodeJS.Timeout | null = null;
    private restartDelay: number;
    private readonly inFlight = new Set<Promise<void>>();

    constructor(
        private readonly def: ConsumerDefinition,
        private readonly connection: ConnectionManager,
        private readonly reliability: ReliabilityOptions,
    ) {
        this.restartDelay = reliability.reconnectDelayMs;
        connection.onChannelLost((name) => {
            if (name === this.channelName) this.handleLost();
        });
        connection.onDisconnected(() => {
            // The connection setup starts every consumer again once it reconnects.
            this.clearRestart();
            this.channel = null;
            this.consumerTag = null;
            this.state = 'stopped';
        });
    }

    get status(): ConsumerStatus {
        return this.state;
    }

    private get channelName(): string {
        return `consumer:${this.def.queue}`;
    }

    async start(): Promise<void> {
        if (this.stopping || this.state === 'starting' || this.state === 'consuming') return;
        this.clearRestart();
        this.state = 'starting';
        let channel: Channel | null = null;
        try {
            channel = await this.connection.channels.getOrCreate(this.channelName, () => this.openChannel());
            await this.def.prepare(channel);
            const opened = channel;
            const { consumerTag } = await opened.consume(this.def.queue, (message) => this.dispatch(opened, message), { noAck: false });
            if (this.stopping) {
                await opened.cancel(consumerTag).catch(() => undefined);
                this.state = 'stopped';
                return;
            }
            this.channel = opened;
            this.consumerTag = consumerTag;
            this.state = 'consuming';
            this.restartDelay = this.reliability.reconnectDelayMs;
            Logger.log(`[RabbitMQ] Consuming '${this.def.queue}'`);
        } catch (err) {
            Logger.error(`[RabbitMQ] Could not start the consumer of '${this.def.queue}': ${err.message}`);
            this.state = 'restarting';
            if (channel) await channel.close().catch(() => undefined);
            this.scheduleRestart();
        }
    }

    async stop(timeoutMs: number): Promise<void> {
        this.stopping = true;
        this.clearRestart();
        const { channel, consumerTag } = this;
        if (channel && consumerTag) await channel.cancel(consumerTag).catch(() => undefined);
        if (this.inFlight.size > 0) {
            Logger.log(`[RabbitMQ] Waiting for ${this.inFlight.size} message(s) on '${this.def.queue}' before shutdown`);
            try {
                await withTimeout(Promise.allSettled([...this.inFlight]), timeoutMs, 'drain timeout');
            } catch {
                Logger.warn(
                    `[RabbitMQ] ${this.inFlight.size} message(s) on '${this.def.queue}' were still running after ${timeoutMs}ms; ` +
                    'the broker will redeliver them',
                );
            }
        }
        this.state = 'stopped';
    }

    private async openChannel(): Promise<Channel> {
        const connection = this.connection.current;
        if (!connection) throw new Error('[RabbitMQ] Not connected to broker');
        const channel = await connection.createChannel();
        channel.on('error', (err) => Logger.error(`[RabbitMQ] Channel error for '${this.def.queue}': ${err.message}`));
        await channel.prefetch(this.def.prefetch);
        return channel;
    }

    private dispatch(channel: Channel, message: ConsumeMessage | null): void {
        if (!message) {
            Logger.warn(`[RabbitMQ] The broker cancelled the consumer of '${this.def.queue}' (was the queue deleted?)`);
            void channel.close().catch(() => undefined);
            return;
        }
        if (this.stopping) {
            // Delivered after shutdown began: hand it back instead of starting work we would not wait for.
            try {
                channel.nack(message, false, true);
            } catch {
                // channel already closed: the broker requeues it anyway
            }
            return;
        }
        const task: Promise<void> = Promise.resolve()
            .then(() => this.def.handle(channel, message))
            .catch((err) => Logger.error(`[RabbitMQ] Unhandled error while handling a message on '${this.def.queue}': ${err.message}`))
            .finally(() => this.inFlight.delete(task));
        this.inFlight.add(task);
    }

    private handleLost(): void {
        this.channel = null;
        this.consumerTag = null;
        if (this.stopping) {
            this.state = 'stopped';
            return;
        }
        this.scheduleRestart();
    }

    private scheduleRestart(): void {
        if (this.stopping || this.restartTimer) return;
        if (!this.connection.current) {
            this.state = 'stopped';
            return;
        }
        this.state = 'restarting';
        const delay = this.restartDelay;
        this.restartDelay = Math.min(this.restartDelay * 2, this.reliability.consumerRestartMaxDelayMs);
        Logger.warn(`[RabbitMQ] Restarting the consumer of '${this.def.queue}' in ${delay}ms`);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.start();
        }, delay);
    }

    private clearRestart(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }
}
```

Khi cả connection rớt, amqplib đóng từng channel trước rồi mới phát `close` cho connection. Do đó `handleLost` có thể đặt hẹn giờ restart trước, rồi `onDisconnected` huỷ hẹn giờ đó và chuyển runner về `stopped`. Sau khi kết nối lại, setup của connection gọi `start()` cho mọi runner.

- [ ] **Step 5: Chạy test để thấy pass**

Run: `npx jest test/consumer-runner.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/interfaces/brokers/bustransit-health.interface.ts lib/factories/brokers/rabbitmq/consumer-runner.ts test/consumer-runner.spec.ts
git commit -m "feat(rabbitmq): run each consumer independently with restart backoff and graceful stop"
```

---

### Task 10: RequestClient (`Send`)

**Files:**
- Create: `lib/factories/brokers/rabbitmq/request-client.ts`
- Modify: `lib/utils/date.ts`
- Test: `test/request-client.spec.ts`

**Interfaces:**
- Consumes: `ConnectionManager.whenReady`, `ConnectionManager.current`.
- Produces: `REPLY_QUEUE = 'amq.rabbitmq.reply-to'`, `class RequestClient`: `constructor(connection, reliability)`, `send(queue: string, body: unknown, messageName: string): Promise<any>`. Hàm `send` luôn đóng channel tạm, kể cả khi lỗi hay hết thời gian, và reject ngay khi channel đóng trước lúc có reply (ví dụ mất kết nối).

- [ ] **Step 1: Viết test `test/request-client.spec.ts`**

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { RequestClient } from '../lib/factories/brokers/rabbitmq/request-client';
import { addMilliseconds } from '../lib/utils/date';
import { eventually, mockConnect } from './support/broker-fixture';
import { createFakeBroker, FakeBroker } from './support/fake-amqp';

const reliability = resolveReliability({ reconnectDelayMs: 20, readyTimeoutMs: 100, sendTimeoutMs: 300 });

async function connected(queues: string[] = []) {
  const broker = createFakeBroker();
  queues.forEach((q) => broker.queues.add(q));
  mockConnect(broker);
  const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
  await manager.start();
  return { broker, manager, client: new RequestClient(manager, reliability) };
}

const replyChannel = (broker: FakeBroker) => broker.channels.find((c) => c.consumers.has('amq.rabbitmq.reply-to'));

describe('RequestClient', () => {
  it('returns the reply and closes its temporary channel', async () => {
    const { broker, manager, client } = await connected(['ping']);
    const pending = client.send('ping', { message: { text: 'hi' } }, 'Ping');
    await eventually(() => broker.published.some((p) => p.routingKey === 'ping'));

    const sent = broker.published.find((p) => p.routingKey === 'ping')!;
    const temp = replyChannel(broker)!;
    temp.deliver('amq.rabbitmq.reply-to', { ok: 1 }, { correlationId: sent.options.correlationId });

    await expect(pending).resolves.toEqual({ ok: 1 });
    expect(temp.closed).toBe(true);
    await manager.close();
  });

  it('fails fast when no queue has that name', async () => {
    const { broker, manager, client } = await connected();
    const started = Date.now();
    await expect(client.send('ping', {}, 'Ping')).rejects.toThrow(
      "[RabbitMQ] Send failed: no queue named 'ping'. Check the endpoint name configured for Ping.",
    );
    expect(Date.now() - started).toBeLessThan(150);
    expect(replyChannel(broker)?.closed).toBe(true);
    await manager.close();
  });

  it('times out without a reply and still closes the channel', async () => {
    const { broker, manager, client } = await connected(['ping']);
    await expect(client.send('ping', {}, 'Ping')).rejects.toThrow('No response received after 300ms');
    expect(replyChannel(broker)?.closed).toBe(true);
    await manager.close();
  });
});

describe('addMilliseconds', () => {
  it('adds milliseconds', () => {
    const start = new Date('2026-10-11T00:00:00.000Z');
    expect(addMilliseconds(start, 10000).toISOString()).toBe('2026-10-11T00:00:10.000Z');
  });
});

describe('RequestClient edge cases', () => {
  it('ignores replies that belong to other requests', async () => {
    const { broker, manager, client } = await connected(['ping']);
    const pending = client.send('ping', {}, 'Ping');
    await eventually(() => broker.published.length === 1);
    const temp = replyChannel(broker)!;
    temp.deliver('amq.rabbitmq.reply-to', { other: true }, { correlationId: 'someone-else' });
    temp.deliver('amq.rabbitmq.reply-to', { mine: true }, { correlationId: broker.published[0].options.correlationId });
    await expect(pending).resolves.toEqual({ mine: true });
    await manager.close();
  });

  it('rejects a reply that is not JSON', async () => {
    const { broker, manager, client } = await connected(['ping']);
    const pending = client.send('ping', {}, 'Ping');
    await eventually(() => broker.published.length === 1);
    replyChannel(broker)!.deliver('amq.rabbitmq.reply-to', 'not json', { correlationId: broker.published[0].options.correlationId });
    await expect(pending).rejects.toThrow();
    await manager.close();
  });

  it('fails fast when the connection drops while waiting for the reply', async () => {
    const { broker, manager, client } = await connected(['ping']);
    const pending = client.send('ping', {}, 'Ping');
    await eventually(() => broker.published.length === 1);
    const started = Date.now();
    broker.connections[0].drop();
    await expect(pending).rejects.toThrow('the channel closed before a reply arrived');
    expect(Date.now() - started).toBeLessThan(150);
    await manager.close();
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/request-client.spec.ts`
Expected: FAIL. Không tìm thấy module `request-client`; nếu chạy riêng, test `addMilliseconds` cũng sai vì hàm hiện tại cộng nhầm vào số phút.

- [ ] **Step 3: Viết `lib/factories/brokers/rabbitmq/request-client.ts`**

```ts
import type { Message } from 'amqplib';
import { v7 as uuidv7 } from 'uuid';
import type { ConnectionManager } from './connection-manager';
import type { ReliabilityOptions } from './reliability-options';

export const REPLY_QUEUE = 'amq.rabbitmq.reply-to';

/** Request/reply over RabbitMQ direct reply-to, on a temporary channel that is always closed. */
export class RequestClient {
    constructor(
        private readonly connection: ConnectionManager,
        private readonly reliability: ReliabilityOptions,
    ) {}

    async send(queue: string, body: unknown, messageName: string): Promise<any> {
        await this.connection.whenReady();
        const connection = this.connection.current;
        if (!connection) throw new Error('[RabbitMQ] Not connected to broker');

        const correlationId = uuidv7();
        const timeout = this.reliability.sendTimeoutMs;
        const channel = await connection.createChannel();
        let timer: NodeJS.Timeout | undefined;
        try {
            return await new Promise((resolve, reject) => {
                channel.on('error', reject);
                channel.on('close', () => reject(new Error('[RabbitMQ] Send failed: the channel closed before a reply arrived')));
                channel.on('return', (returned: Message) =>
                    reject(new Error(
                        `[RabbitMQ] Send failed: no queue named '${returned.fields.routingKey}'. ` +
                        `Check the endpoint name configured for ${messageName}.`,
                    )),
                );
                timer = setTimeout(() => reject(new Error(`No response received after ${timeout}ms`)), timeout);

                channel
                    .consume(
                        REPLY_QUEUE,
                        (reply) => {
                            if (!reply || reply.properties.correlationId !== correlationId) return;
                            try {
                                resolve(JSON.parse(reply.content.toString()));
                            } catch (error) {
                                reject(error);
                            }
                        },
                        { noAck: true },
                    )
                    .then(() => {
                        channel.publish('', queue, Buffer.from(JSON.stringify(body), 'utf-8'), {
                            replyTo: REPLY_QUEUE,
                            correlationId,
                            persistent: true,
                            mandatory: true,
                        });
                    })
                    .catch(reject);
            });
        } finally {
            clearTimeout(timer);
            await channel.close().catch(() => undefined);
        }
    }
}
```

- [ ] **Step 4: Sửa `lib/utils/date.ts`**

```ts
export function addMilliseconds(date: Date, milliseconds: number): Date {
    return new Date(date.getTime() + milliseconds);
}
```

- [ ] **Step 5: Chạy test để thấy pass**

Run: `npx jest test/request-client.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/factories/brokers/rabbitmq/request-client.ts lib/utils/date.ts test/request-client.spec.ts
git commit -m "feat(rabbitmq): add a request client that always closes its channel and fails fast on unknown queues"
```

---

### Task 11: Viết lại `BusTransitBrokerRabbitMqFactory` thành facade

**Files:**
- Modify (viết lại toàn bộ): `lib/factories/brokers/bustransit-broker.rabbitmq.ts`
- Modify: `lib/interfaces/brokers/bustransit-broker.options.interface.ts`
- Test: `test/rabbitmq-broker.spec.ts`; `test/rabbitmq-baseline.spec.ts` và `test/rabbitmq-topology.spec.ts` (Task 1) phải vẫn pass.

**Interfaces:**
- Consumes: mọi thành phần của Task 2-10.
- Produces (Task 12 dùng):
  - `IBusTransitBrokerOptions.reliability?: Partial<ReliabilityOptions>`
  - `BusTransitBrokerRabbitMqFactory`: `start(): Promise<void>`, `close(): Promise<void>`, `publish(message, ctx?): Promise<void>`, `publishAsync(message, ctx?): Promise<any>`, `health(): BusTransitHealth`, giữ `isDelayedMessagePluginSupported()` và `isRedeliveryEnabledForQueue(queue)`.

- [ ] **Step 1: Viết test `test/rabbitmq-broker.spec.ts`**

```ts
jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { BusTransitConsumer } from '../lib/factories/consumer';
import { ConsumerConfigurator } from '../lib/factories/consumer.configurator';
import { RetryConfigurator, RetryLevel } from '../lib/factories/retry.configurator';
import { eventually, sleep, startBroker } from './support/broker-fixture';
import { createFakeBroker, mainConnections } from './support/fake-amqp';
import { OrderStateMachine, PingConsumer, startWithTopology } from './support/topology-fixture';
import { IPublishEndpoint } from '../lib/interfaces/publish-endpoint.interface';

class SyncAnalyticsCampaignBatchMessage {
  batchId = 'b-1';
}
class AggregateUrlAnalysisFunnelMessage {}
class OrderPlaced {
  orderId = 'o-1';
}
class PingMessage {
  text: string;
}
class SlowPingConsumer extends BusTransitConsumer<PingMessage> {
  done = 0;
  constructor() {
    super(PingMessage);
  }
  async Consume(ctx, context) {
    await super.Consume(ctx, context);
    await sleep(80);
    this.done++;
  }
}

function pingEndpoint(consumer: unknown, redelivery = false) {
  const endpoint = new ConsumerConfigurator();
  endpoint.bindQueue('ping');
  endpoint.bindConsumer(consumer as any);
  endpoint.setOptions({ PrefetchCount: 5 });
  if (redelivery) endpoint.UseDelayedRedelivery((r: RetryConfigurator) => r.Intervals(1000));
  return endpoint;
}

describe('BusTransitBrokerRabbitMqFactory', () => {
  it('survives the 06/10 incident end to end', async () => {
    const { bus, broker } = await startBroker({
      messages: { SyncAnalyticsCampaignBatchMessage, AggregateUrlAnalysisFunnelMessage },
      preexistingExchanges: { 'linkadz:SyncAnalyticsCampaignBatchMessage': 'fanout' },
    });
    await expect(bus.publish(new AggregateUrlAnalysisFunnelMessage())).resolves.toBeUndefined();
    await expect(bus.publish(new SyncAnalyticsCampaignBatchMessage())).resolves.toBeUndefined();
    expect(broker.channels.filter((c) => c.confirm)).toHaveLength(1);
    expect(broker.channels.find((c) => c.confirm)!.closed).toBe(false);
    await bus.close();
  });

  it('starts and publishes on a broker without the delayed-message plugin', async () => {
    const broker = createFakeBroker();
    broker.delayedPlugin = false;
    const consumer = new SlowPingConsumer();
    const { bus } = await startBroker({
      broker,
      messages: { OrderPlaced },
      consumers: { SlowPingConsumer },
      endpoints: { ping: pingEndpoint(SlowPingConsumer, true) },
      instances: new Map<unknown, unknown>([[SlowPingConsumer, consumer]]),
    });
    expect(bus.health().connected).toBe(true);
    expect(mainConnections(broker)[0].closed).toBe(false);
    expect(bus.isDelayedMessagePluginSupported()).toBe(false);
    expect(bus.isRedeliveryEnabledForQueue('ping')).toBe(false);
    await expect(bus.publish(new OrderPlaced())).resolves.toBeUndefined();
    await bus.close();
  });

  it('keeps publishing and other consumers running when one queue cannot be declared', async () => {
    const broker = createFakeBroker();
    broker.queueConflicts.add('ping');
    const { bus } = await startWithTopology({ broker });
    expect(bus.health()).toEqual({
      connected: true,
      blocked: false,
      consumers: { ping: 'restarting', 'order-saga': 'consuming' },
    });
    await expect(bus.publish(new OrderPlaced())).resolves.toBeUndefined();
    await bus.close();
  });

  it('waits for messages in progress on close and does not reconnect', async () => {
    const consumer = new SlowPingConsumer();
    const { bus, broker } = await startBroker({
      consumers: { SlowPingConsumer },
      endpoints: { ping: pingEndpoint(SlowPingConsumer) },
      instances: new Map<unknown, unknown>([[SlowPingConsumer, consumer]]),
    });
    const channel = broker.channels.find((c) => c.consumers.has('ping'))!;
    channel.deliver('ping', { message: { text: 'slow' }, headers: {} });
    await sleep(10);

    await bus.close();
    expect(consumer.done).toBe(1);
    expect(channel.acks).toHaveLength(1);
    expect(mainConnections(broker)[0].closed).toBe(true);
    await sleep(60);
    expect(mainConnections(broker)).toHaveLength(1);
    expect(bus.health().consumers.ping).toBe('stopped');
  });

  it('lets a publish made before start() wait for the connection', async () => {
    const { bus } = await startBroker({ messages: { OrderPlaced }, start: false });
    const pending = bus.publish(new OrderPlaced());
    await bus.start();
    await expect(pending).resolves.toBeUndefined();
    await bus.close();
  });

  it('resumes publishing and consuming after the connection drops', async () => {
    const { bus, broker } = await startWithTopology();
    mainConnections(broker)[0].drop();
    await expect(bus.publish(new OrderPlaced())).resolves.toBeUndefined();
    await eventually(() => bus.health().consumers.ping === 'consuming');
    expect(mainConnections(broker)).toHaveLength(2);
    await bus.close();
  });
});

describe('BusTransitBrokerRabbitMqFactory edge cases', () => {
  it('still runs a saga through the new delivery pipeline', async () => {
    const send = jest.fn(async () => ({ charged: true }));
    const machine = new OrderStateMachine();
    const { bus, broker } = await startWithTopology({
      instances: new Map<unknown, unknown>([
        [PingConsumer, new PingConsumer()],
        [OrderStateMachine, machine],
        [IPublishEndpoint, { Send: send, Publish: jest.fn() }],
      ]),
    });
    const channel = broker.channels.find((c) => c.consumers.has('order-saga') && !c.closed)!;
    channel.deliver('order-saga', { messageType: 'message:linkadz:OrderSubmitted', message: { OrderId: 'o-1' }, headers: {} });
    await eventually(() => channel.acks.length === 1);

    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as any[])[0]).toMatchObject({ OrderId: 'o-1' });
    const saved = await (machine as any).repository.findByCorrelationId('o-1');
    expect(saved.CurrentState).toBe('Charging');
    expect(broker.published.some((p) => p.routingKey === 'order-saga_error')).toBe(false);
    await bus.close();
  });

  it('keeps exactly one consumer on a queue after repeated channel losses', async () => {
    const { bus, broker } = await startWithTopology();
    for (let i = 0; i < 3; i++) {
      broker.channels.find((c) => c.consumers.has('ping') && !c.closed)?.serverClose(406, `PRECONDITION_FAILED - loss ${i}`);
      await sleep(i === 0 ? 5 : 30);
    }
    await eventually(() => bus.health().consumers.ping === 'consuming', 1500);
    await sleep(150);
    expect(broker.channels.filter((c) => c.consumers.has('ping') && !c.closed)).toHaveLength(1);
    await bus.close();
  });

  it('can be closed twice and rejects publishes afterwards', async () => {
    const { bus } = await startBroker({ messages: { OrderPlaced } });
    await bus.close();
    await bus.close();
    await expect(bus.publish(new OrderPlaced())).rejects.toThrow('[RabbitMQ] Not connected to broker');
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/rabbitmq-broker.spec.ts`
Expected: FAIL. Không có `health()`; test sự cố 06/10 ném `Channel closed`; test không có plugin bị kẹt trong vòng lặp reconnect hoặc ném lỗi.

- [ ] **Step 3: Thêm `reliability` vào `IBusTransitBrokerOptions`**

Thay toàn bộ `lib/interfaces/brokers/bustransit-broker.options.interface.ts`:

```ts
import type { ReliabilityOptions } from '../../factories/brokers/rabbitmq/reliability-options';

export interface IBusTransitModuleOptions {
}

export interface IBusTransitBrokerOptions {
    brokerName: string;
    brokerType: string;
    brokerInfo: any;
    reliability?: Partial<ReliabilityOptions>;
}
```

- [ ] **Step 4: Viết lại toàn bộ `lib/factories/brokers/bustransit-broker.rabbitmq.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { Channel } from 'amqplib';
import * as os from 'os';
import { v7 as uuidv7 } from 'uuid';
import { IBusTransitBrokerOptions } from '../../interfaces/brokers/bustransit-broker.options.interface';
import { BusTransitHealth } from '../../interfaces/brokers/bustransit-health.interface';
import { IMessage } from '../../interfaces/message.interface';
import { addMilliseconds } from '../../utils/date';
import { BehaviorContext } from '../behavior.context';
import { ConsumerConfigurator } from '../consumer.configurator';
import { BusTransitBrokerBaseFactory } from './bustransit-broker.base';
import { buildConnectOptions } from './rabbitmq/connection-options';
import { ConnectionManager } from './rabbitmq/connection-manager';
import { ConsumerRunner } from './rabbitmq/consumer-runner';
import { probeDelayedMessagePlugin } from './rabbitmq/delayed-plugin-probe';
import { createDeliveryHandler } from './rabbitmq/delivery-pipeline';
import { Publisher } from './rabbitmq/publisher';
import { ReliabilityOptions, resolveReliability } from './rabbitmq/reliability-options';
import { REPLY_QUEUE, RequestClient } from './rabbitmq/request-client';
import { buildTopology, declareTopology } from './rabbitmq/topology';

@Injectable()
export class BusTransitBrokerRabbitMqFactory extends BusTransitBrokerBaseFactory {
    brokerName = 'RabbitMq';
    brokerConfig: IBusTransitBrokerOptions;
    private channelProducer = '_producer';
    private reliability: ReliabilityOptions = resolveReliability();
    private manager: ConnectionManager | null = null;
    private publisher: Publisher | null = null;
    private requests: RequestClient | null = null;
    private readonly runners = new Map<string, ConsumerRunner>();
    private delayedMessagePluginSupported = false;
    private queueRedeliveryEnabled = new Map<string, boolean>();

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {
        this.brokerConfig = brokerConfig;
        this.reliability = resolveReliability(brokerConfig.reliability);
        // Built here, not in start(), so a publish made before bootstrap waits for the connection
        // (up to readyTimeoutMs) instead of failing.
        this.manager = new ConnectionManager(
            buildConnectOptions(brokerConfig.brokerInfo),
            brokerConfig.brokerName,
            this.reliability,
            () => this.onConnected(),
        );
        this.publisher = new Publisher(this.manager, this.reliability);
        this.requests = new RequestClient(this.manager, this.reliability);
    }

    public async start(): Promise<void> {
        await this.requireManager().start();
    }

    public async close(): Promise<void> {
        if (!this.manager) return;
        await Promise.all([...this.runners.values()].map((runner) => runner.stop(this.reliability.shutdownTimeoutMs)));
        await this.manager.close();
    }

    public health(): BusTransitHealth {
        return {
            connected: this.manager?.isConnected ?? false,
            blocked: this.manager?.isBlocked ?? false,
            consumers: Object.fromEntries([...this.runners].map(([queue, runner]) => [queue, runner.status])),
        };
    }

    public isDelayedMessagePluginSupported(): boolean {
        return this.delayedMessagePluginSupported;
    }

    public isRedeliveryEnabledForQueue(queueName: string): boolean {
        return this.queueRedeliveryEnabled.get(queueName) ?? false;
    }

    // Message functions
    async publish<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<void> {
        const exchange = this.getNameAddClusterPrefix(
            this.classMessageToExchange[message.constructor.name] ??
            this.classMessageToEndpoint[message.constructor.name]?.Name ??
            message.constructor.name,
        );
        const msg = {
            messageId: uuidv7(),
            type: 'publish',
            sourceAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/${this.channelProducer}`,
            destinationAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/exchange/${exchange}`,
            messageType: `message:${this.brokerConfig.brokerName}:${message.constructor.name}`,
            message: message,
            sentTime: new Date().toString(),
            expirationTime: null,
            headers: {
                saga: ctx?.Saga,
            },
        } as IMessage<any>;
        await this.requirePublisher().publishToExchange(exchange, msg, { messageId: msg.messageId });
    }

    async publishAsync<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<any> {
        const classMessage = this.classMessageToEndpoint[message.constructor.name];
        const endpoint = classMessage?.EndpointRegistrationConfigurator?.Name ?? classMessage?.Name ?? message.constructor.name;
        const msg = {
            messageId: uuidv7(),
            type: 'publishAsync',
            sourceAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/${REPLY_QUEUE}`,
            destinationAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/queue/${endpoint ?? ''}`,
            messageType: `message:${this.brokerConfig.brokerName}:${message.constructor.name}`,
            message: message,
            sentTime: new Date().toString(),
            expirationTime: addMilliseconds(new Date(), this.reliability.sendTimeoutMs).toString(),
            headers: {
                saga: ctx?.Saga,
            },
        } as IMessage<any>;
        Logger.debug(`[x] Sent msg to ${endpoint}, replyTo ${REPLY_QUEUE}`);
        if (!this.requests) throw new Error('[RabbitMQ] Broker is not configured');
        return this.requests.send(endpoint, msg, message.constructor.name);
    }

    private async onConnected(): Promise<void> {
        const publisher = this.requirePublisher();
        await publisher.open();

        this.delayedMessagePluginSupported = await probeDelayedMessagePlugin(
            buildConnectOptions(this.brokerConfig.brokerInfo),
            this.brokerConfig.brokerName,
            this.reliability.readyTimeoutMs,
        );
        if (this.delayedMessagePluginSupported) {
            Logger.log('[RabbitMQ] ✓ x-delayed-message plugin is available');
        } else {
            Logger.warn(
                '[RabbitMQ] ⚠ WARNING: x-delayed-message plugin is NOT installed or not enabled. ' +
                'Delayed redelivery will not work. ' +
                'Please install the plugin: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange',
            );
        }

        const declarations = buildTopology(this.consumers, this.consumersToEndpoint, (token) => this.moduleRef.get(token as any), {
            classConsumerToEndpoint: this.classConsumerToEndpoint,
            classMessageToEndpoint: this.classMessageToEndpoint,
            classMessageToExchange: this.classMessageToExchange,
        });
        await declareTopology(publisher, declarations, (name) => this.getNameAddClusterPrefix(name));

        for (const [queueName, cfg] of Object.entries(this.consumersToEndpoint)) {
            if (!this.runners.has(queueName)) {
                this.runners.set(queueName, this.createRunner(queueName, cfg as ConsumerConfigurator));
            }
        }
        // Each runner handles its own failures; one bad queue never fails the connection setup.
        await Promise.all([...this.runners.values()].map((runner) => runner.start()));
    }

    private createRunner(queueName: string, cfg: ConsumerConfigurator): ConsumerRunner {
        const options = (cfg.options ?? {}) as { PrefetchCount?: number };
        const queueExchange = this.getNameAddClusterPrefix(queueName);
        const delayExchange = this.getNameAddClusterPrefix(`delayed.exchange.${queueName}`);
        const publisher = this.requirePublisher();
        return new ConsumerRunner(
            {
                queue: queueName,
                prefetch: options.PrefetchCount ?? 50,
                prepare: async (channel) => {
                    await publisher.ensureExchange(queueExchange);
                    await channel.assertQueue(queueName, { durable: true });
                    await channel.bindQueue(queueName, queueExchange, '');
                    await this.setupRedelivery(channel, queueName, cfg.redeliveryPattern, delayExchange);
                },
                handle: createDeliveryHandler({
                    queue: queueName,
                    consumer: cfg.consumer,
                    retryPattern: cfg.retryPattern,
                    redeliveryPattern: cfg.redeliveryPattern,
                    redeliveryEnabled: () => this.queueRedeliveryEnabled.get(queueName) ?? false,
                    delayExchange,
                    resolve: (token) => this.moduleRef.get(token as any),
                    publisher,
                    hostInfo: () => this.getSystemInfo(),
                    requeueDelayMs: this.reliability.reconnectDelayMs,
                }),
            },
            this.requireManager(),
            this.reliability,
        );
    }

    private async setupRedelivery(channel: Channel, queueName: string, redeliveryPattern: unknown, delayExchange: string): Promise<void> {
        if (!redeliveryPattern) {
            this.queueRedeliveryEnabled.set(queueName, false);
            return;
        }
        if (!this.delayedMessagePluginSupported) {
            this.queueRedeliveryEnabled.set(queueName, false);
            Logger.warn(
                `[RabbitMQ] Redelivery pattern configured for queue '${queueName}' but x-delayed-message plugin is NOT available. ` +
                'Redelivery is DISABLED. Install plugin: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange',
            );
            return;
        }
        try {
            await this.requirePublisher().declareDelayedExchange(delayExchange);
            await channel.bindQueue(queueName, delayExchange, '');
            this.queueRedeliveryEnabled.set(queueName, true);
            Logger.log(`[RabbitMQ] ✓ Redelivery enabled for queue '${queueName}'`);
        } catch (error) {
            this.queueRedeliveryEnabled.set(queueName, false);
            Logger.error(`[RabbitMQ] ✗ Could not set up redelivery for queue '${queueName}': ${error.message}. Redelivery is DISABLED.`);
        }
    }

    private requireManager(): ConnectionManager {
        if (!this.manager) throw new Error('[RabbitMQ] Broker is not configured');
        return this.manager;
    }

    private requirePublisher(): Publisher {
        if (!this.publisher) throw new Error('[RabbitMQ] Broker is not configured');
        return this.publisher;
    }

    private getSystemInfo() {
        return {
            machineName: os.hostname(),
            processName: process.title,
            processId: process.pid,
            frameworkVersion: process.version,
            operatingSystemVersion: `${os.type()} ${os.release()}`,
        };
    }

    protected getNameAddClusterPrefix(name: string) {
        return `${this.brokerConfig.brokerName ? `${this.brokerConfig.brokerName}:` : ''}${name}`;
    }
}
```

Code cũ bị xoá hẳn: `start` cũ, `checkDelayedMessagePlugin`, `createAllExchange`, `startAllConsumer` override, `createChannel`, `bindConsumerToQueue`, `checkQueueAndAssert`, `assertExchange`, `getProducerChannel`, `close` rỗng, `channelList`, đoạn `secs` ack trễ và các import rxjs.

- [ ] **Step 5: Chạy toàn bộ unit test và typecheck**

Run: `npx jest && npm run typecheck`
Expected: PASS mọi file test (88 test tính tới Task 11; riêng `rabbitmq-broker.spec.ts` có 9), kể cả `rabbitmq-baseline` và `rabbitmq-topology` của Task 1. Typecheck không lỗi. Nếu test đặc tả topology đỏ, sửa code cho tới khi topology khớp; không được sửa test.

- [ ] **Step 6: Commit**

```bash
git add lib/ test/rabbitmq-broker.spec.ts
git commit -m "refactor(rabbitmq): rebuild the RabbitMQ broker as a facade over isolated components

One failing channel, exchange or consumer no longer takes down publishing or
consuming elsewhere. Topology is unchanged (characterization test)."
```

---

### Task 12: API công khai (async lifecycle, health, cấu hình reliability)

**Files:**
- Modify: `lib/factories/brokers/bustransit-broker.base.ts`
- Modify: `lib/interfaces/brokers/bustransit-broker-factory.interface.ts`
- Modify: `lib/interfaces/publish-endpoint.interface.ts:4`
- Modify: `lib/bustransit.service.ts:42-48`, `lib/bustransit.core.ts:109-115`
- Modify: `lib/factories/rabbitmq-bus-factory.configurator.ts`, `lib/interfaces/rabbitmq-bus-factory.configurator.interface.ts`
- Modify: `lib/index.ts`
- Test: `test/public-api.spec.ts`

**Interfaces:**
- Consumes: `BusTransitHealth`, `ReliabilityOptions`, `health()` của broker.
- Produces:
  - `BusTransitService.getHealth(): BusTransitHealth`, `BusTransitService.close(): Promise<void>`, `BusTransitService.startBroker(): Promise<void>`
  - `IRabbitMqBusFactoryConfigurator.UseReliability(options: Partial<ReliabilityOptions>): void`
  - `IPublishEndpoint.Publish: <T>(message, ctx?) => Promise<void>`
  - Export từ package: `BusTransitHealth`, `ConsumerStatus`, `ReliabilityOptions`

- [ ] **Step 1: Viết test `test/public-api.spec.ts`**

```ts
import { BusTransitCoreModule } from '../lib/bustransit.core';
import { BusTransitService } from '../lib/bustransit.service';
import { RabbitMqBusFactoryConfigurator } from '../lib/factories/rabbitmq-bus-factory.configurator';

describe('public API', () => {
  it('keeps reliability settings whether UseReliability comes before or after Host', () => {
    const before = new RabbitMqBusFactoryConfigurator();
    before.UseReliability({ shutdownTimeoutMs: 35000 });
    before.Host('rmq', '/prod', (h) => h.Username('u'));
    expect(before.getOptions().reliability).toEqual({ shutdownTimeoutMs: 35000 });

    const after = new RabbitMqBusFactoryConfigurator();
    after.Host('rmq', '/prod', (h) => h.Username('u'));
    after.UseReliability({ readyTimeoutMs: 5000 });
    expect(after.getOptions().reliability).toEqual({ readyTimeoutMs: 5000 });
  });

  it('rejects invalid reliability settings at configuration time', () => {
    const cfg = new RabbitMqBusFactoryConfigurator();
    expect(() => cfg.UseReliability({ publishTimeoutMs: -5 })).toThrow('reliability.publishTimeoutMs must be a positive number of milliseconds');
  });

  it('waits for the broker to close on application shutdown', async () => {
    let closed = false;
    const service = {
      close: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        closed = true;
      },
    } as unknown as BusTransitService;
    const core = new BusTransitCoreModule({} as any, {} as any, service);
    await core.onApplicationShutdown();
    expect(closed).toBe(true);
  });

  it('reports health from the broker', () => {
    const health = { connected: true, blocked: false, consumers: { ping: 'consuming' as const } };
    const service = Object.create(BusTransitService.prototype) as BusTransitService;
    (service as any).broker = { health: () => health };
    expect(service.getHealth()).toBe(health);
  });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `npx jest test/public-api.spec.ts`
Expected: FAIL. Chưa có `UseReliability` và `getHealth`; `onApplicationShutdown` không await.

- [ ] **Step 3: Base class và interface của broker**

`lib/factories/brokers/bustransit-broker.base.ts`: thêm import `import {BusTransitHealth} from "../../interfaces/brokers/bustransit-health.interface";` rồi thay các method `start`, `close`, `publish`:

```ts
    public async start(): Promise<void> {}
    public startAllConsumer() {}

    public async close(): Promise<void> {}

    public health(): BusTransitHealth {
        return { connected: false, blocked: false, consumers: {} };
    }

    // Message functions
    async publish<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<void> {
        throw Error('Function implement')
    }

    async publishAsync<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<any> {
        throw Error('Function implement')
    }
```

`lib/interfaces/brokers/bustransit-broker-factory.interface.ts`, thay toàn bộ:

```ts
import {BehaviorContext} from "../../factories/behavior.context";
import {IBusTransitBrokerOptions} from "./bustransit-broker.options.interface";
import {BusTransitHealth} from "./bustransit-health.interface";

export interface IBusTransitBrokerInterface {
    start(): Promise<void>;
    close(): Promise<void>;
    health(): BusTransitHealth;
    publish<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<void>;
    publishAsync<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<any>;
    setBrokerConfig(brokerConfig: IBusTransitBrokerOptions);
}
```

`lib/interfaces/publish-endpoint.interface.ts:4`:

```ts
    Publish: <T>(message: T, ctx?: BehaviorContext<any, T>) => Promise<void>;
```

- [ ] **Step 4: Service và core module**

`lib/bustransit.service.ts`: thêm import `import {BusTransitHealth} from "./interfaces/brokers/bustransit-health.interface";`, rồi thay `startBroker` và `close`:

```ts
  startBroker(): Promise<void> {
    return this.broker?.start() ?? Promise.resolve();
  }

  async close(): Promise<void> {
    await this.broker?.close();
  }

  getHealth(): BusTransitHealth {
    return this.broker?.health() ?? { connected: false, blocked: false, consumers: {} };
  }
```

`lib/bustransit.core.ts:109-115`:

```ts
    async onApplicationShutdown(): Promise<void> {
        await this.busTransitService.close();
    }

    onApplicationBootstrap(): void {
        // Do not block app boot on the broker: publishes wait for the connection (readyTimeoutMs).
        void this.busTransitService.startBroker();
    }
```

- [ ] **Step 5: `UseReliability` trên configurator**

`lib/factories/rabbitmq-bus-factory.configurator.ts`: thêm import `import {ReliabilityOptions, resolveReliability} from "./brokers/rabbitmq/reliability-options";` và method:

```ts
    UseReliability(options: Partial<ReliabilityOptions>): void {
        resolveReliability(options); // fail at configuration time on invalid values
        this.options = { ...this.options, reliability: { ...(this.options.reliability ?? {}), ...options } };
    }
```

`Host()` đang dùng `...this.options`, nên `reliability` được giữ lại dù `UseReliability` gọi trước hay sau `Host`.

`lib/interfaces/rabbitmq-bus-factory.configurator.interface.ts`: thêm import `import type {ReliabilityOptions} from "../factories/brokers/rabbitmq/reliability-options";` và dòng sau trong interface:

```ts
    UseReliability(options: Partial<ReliabilityOptions>): void;
```

- [ ] **Step 6: Export kiểu dữ liệu công khai**

Thêm vào cuối `lib/index.ts`:

```ts
// Transport reliability
export * from './interfaces/brokers/bustransit-health.interface';
export type { ReliabilityOptions } from './factories/brokers/rabbitmq/reliability-options';
```

- [ ] **Step 7: Chạy toàn bộ test, typecheck và build**

Run: `npx jest && npx tsc -p tsconfig.spec.json --noEmit && npm run typecheck && npm run build`
Expected: 92 test PASS, typecheck của cả `lib` và `test` không lỗi, build tạo `dist/`. Chạy `npx jest` thêm 2 lần nữa để chắc không có test chập chờn.

- [ ] **Step 8: Commit**

```bash
git add lib/ test/public-api.spec.ts
git commit -m "feat: expose broker health, reliability settings and an awaited shutdown

IPublishEndpoint.Publish now returns Promise<void>."
```

---

### Task 13: Integration test với RabbitMQ thật và CI

**Files:**
- Create: `jest.integration.config.js`
- Create: `test/integration/support.ts`, `test/integration/rabbitmq.int-spec.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: toàn bộ broker (Task 11-12).
- Produces: `npm run test:integration` chạy khi có `RABBITMQ_URL`, bỏ qua khi không có.

- [ ] **Step 1: Viết `jest.integration.config.js`**

```js
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/*.int-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  setupFiles: ['reflect-metadata'],
  testTimeout: 30000,
};
```

- [ ] **Step 2: Viết `test/integration/support.ts`**

```ts
import * as amqp from 'amqplib';
import { BusTransitBrokerRabbitMqFactory } from '../../lib/factories/brokers/bustransit-broker.rabbitmq';
import { IPublishEndpoint } from '../../lib/interfaces/publish-endpoint.interface';

export const RABBITMQ_URL = process.env.RABBITMQ_URL;
export const MANAGEMENT_URL = process.env.RABBITMQ_MANAGEMENT_URL;
export const describeWithBroker = RABBITMQ_URL ? describe : describe.skip;

function brokerInfoFromUrl(raw: string) {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 5672),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    vhost: url.pathname === '/' ? '' : url.pathname,
  };
}

export function createBus(
  prefix: string,
  opts: { messages?: Record<string, unknown>; consumers?: Record<string, unknown>; endpoints?: Record<string, unknown>; instances?: Map<unknown, unknown> } = {},
) {
  const bus = new BusTransitBrokerRabbitMqFactory();
  bus.setBrokerConfig({
    brokerName: prefix,
    brokerType: 'RABBITMQ',
    brokerInfo: brokerInfoFromUrl(RABBITMQ_URL!),
    reliability: { reconnectDelayMs: 200, readyTimeoutMs: 5000, publishTimeoutMs: 5000, sendTimeoutMs: 5000, consumerRestartMaxDelayMs: 1000, shutdownTimeoutMs: 2000 },
  });
  const instances = opts.instances ?? new Map();
  instances.set(IPublishEndpoint, {});
  bus.setModuleRef({
    get: (token: any) => {
      if (!instances.has(token)) throw new Error(`no instance for ${token?.name}`);
      return instances.get(token);
    },
  });
  bus.setConsumers(opts.consumers ?? {}, opts.endpoints ?? {}, opts.messages ?? {});
  return bus;
}

export async function rawChannel() {
  const connection = await amqp.connect(RABBITMQ_URL!);
  const channel = await connection.createChannel();
  channel.on('error', () => undefined);
  return { connection, channel };
}

function management() {
  const url = new URL(MANAGEMENT_URL!);
  const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
  return { origin: `${url.protocol}//${url.host}`, headers: { authorization: auth } };
}

/** Closes the broker connection whose client-provided name is `name`, as an operator would. */
export async function killConnection(name: string, timeoutMs = 20000): Promise<number> {
  const { origin, headers } = management();
  const deadline = Date.now() + timeoutMs;
  // The management API lists a new connection only after its next stats refresh.
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${origin}/api/connections`, { headers })).json()) as any[];
    const targets = list.filter((c) => c.client_properties?.connection_name === name);
    if (targets.length > 0) {
      for (const target of targets) {
        await fetch(`${origin}/api/connections/${encodeURIComponent(target.name)}`, { method: 'DELETE', headers });
      }
      return targets.length;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return 0;
}

/** Deletes every exchange and queue whose name starts with `prefix` in the vhost of RABBITMQ_URL. */
export async function cleanup(prefix: string): Promise<void> {
  if (!MANAGEMENT_URL) return;
  const { origin, headers } = management();
  // amqplib reads the URL path without its leading "/" as the vhost; an empty path is the default vhost "/".
  const vhost = encodeURIComponent(decodeURIComponent(new URL(RABBITMQ_URL!).pathname.slice(1)) || '/');
  for (const kind of ['exchanges', 'queues']) {
    const items = (await (await fetch(`${origin}/api/${kind}/${vhost}`, { headers })).json()) as any[];
    for (const item of items.filter((i) => i.name.startsWith(prefix))) {
      await fetch(`${origin}/api/${kind}/${vhost}/${encodeURIComponent(item.name)}`, { method: 'DELETE', headers });
    }
  }
}

export async function eventually<T>(attempt: () => Promise<T>, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError;
}
```

- [ ] **Step 3: Viết `test/integration/rabbitmq.int-spec.ts`**

```ts
import { BusTransitConsumer } from '../../lib/factories/consumer';
import { ConsumerConfigurator } from '../../lib/factories/consumer.configurator';
import { cleanup, createBus, describeWithBroker, eventually, killConnection, MANAGEMENT_URL, rawChannel } from './support';

describeWithBroker('RabbitMQ transport against a real broker', () => {
  const prefix = `it${Date.now()}`;
  afterAll(() => cleanup(prefix));

  it('starts and publishes whether or not the delayed-message plugin is installed', async () => {
    class AnyMessage {}
    const bus = createBus(prefix, { messages: { AnyMessage } });
    await bus.start();
    expect(bus.health().connected).toBe(true);
    await expect(bus.publish(new AnyMessage())).resolves.toBeUndefined();
    await bus.close();
  });

  it('publishes a message whose exchange nobody declared, and keeps publishing', async () => {
    class FunnelTrigger {}
    class AnalyticsBatch {
      id = 1;
    }
    const bus = createBus(prefix, { messages: { FunnelTrigger, AnalyticsBatch } });
    await bus.start();
    await expect(bus.publish(new FunnelTrigger())).resolves.toBeUndefined();
    await expect(bus.publish(new AnalyticsBatch())).resolves.toBeUndefined();

    const { connection, channel } = await rawChannel();
    await expect(channel.checkExchange(`${prefix}:FunnelTrigger`)).resolves.toBeDefined();
    await connection.close();
    await bus.close();
  });

  it('publishes to exchanges that already exist with other settings, as 0.3.x did', async () => {
    class Legacy {}
    class NotDurable {}
    const { connection, channel } = await rawChannel();
    await channel.assertExchange(`${prefix}:Legacy`, 'direct', { durable: true });
    await channel.assertExchange(`${prefix}:NotDurable`, 'fanout', { durable: false });
    await connection.close();

    const bus = createBus(prefix, { messages: { Legacy, NotDurable } });
    await bus.start();
    await expect(bus.publish(new Legacy())).resolves.toBeUndefined();
    await expect(bus.publish(new NotDurable())).resolves.toBeUndefined();
    await bus.close();
  });

  it('reproduces the 06/10 incident and keeps publishing', async () => {
    class SyncAnalyticsCampaignBatchMessage {
      batchId = 'b1';
    }
    class AggregateUrlAnalysisFunnelMessage {}
    const { connection, channel } = await rawChannel();
    await channel.assertExchange(`${prefix}:SyncAnalyticsCampaignBatchMessage`, 'fanout', { durable: true });
    await connection.close();

    const bus = createBus(prefix, { messages: { SyncAnalyticsCampaignBatchMessage, AggregateUrlAnalysisFunnelMessage } });
    await bus.start();
    await expect(bus.publish(new SyncAnalyticsCampaignBatchMessage())).resolves.toBeUndefined();
    await expect(bus.publish(new AggregateUrlAnalysisFunnelMessage())).resolves.toBeUndefined();
    await expect(bus.publish(new SyncAnalyticsCampaignBatchMessage())).resolves.toBeUndefined();
    await bus.close();
  });

  it('recovers when an exchange is deleted behind its back', async () => {
    class Volatile {}
    const bus = createBus(prefix, { messages: { Volatile } });
    await bus.start();
    await bus.publish(new Volatile());

    const { connection, channel } = await rawChannel();
    await channel.deleteExchange(`${prefix}:Volatile`);
    await connection.close();

    await expect(bus.publish(new Volatile())).rejects.toThrow(/NOT_FOUND/);
    await expect(bus.publish(new Volatile())).resolves.toBeUndefined();
    await bus.close();
  });

  (MANAGEMENT_URL ? it : it.skip)('consumes again after an operator kills the connection', async () => {
    class Ping {
      n: number;
    }
    const received: number[] = [];
    class PingConsumer extends BusTransitConsumer<Ping> {
      constructor() {
        super(Ping);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        received.push(context.Message.n);
      }
    }
    const queue = `${prefix}-ping`;
    const endpoint = new ConsumerConfigurator();
    endpoint.bindQueue(queue);
    endpoint.bindConsumer(PingConsumer);
    endpoint.setOptions({ PrefetchCount: 5 });
    const bus = createBus(prefix, {
      consumers: { PingConsumer },
      endpoints: { [queue]: endpoint },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
    });
    await bus.start();

    await bus.publish(Object.assign(new Ping(), { n: 1 }));
    await eventually(async () => expect(received).toContain(1));

    expect(await killConnection(prefix)).toBeGreaterThan(0);
    await eventually(() => bus.publish(Object.assign(new Ping(), { n: 2 })));
    await eventually(async () => expect(received).toContain(2));
    expect(bus.health().consumers[queue]).toBe('consuming');
    await bus.close();
  });
});
```

- [ ] **Step 4: Viết `.github/workflows/ci.yml`**

User `guest` của RabbitMQ chỉ được kết nối từ loopback, mà runner kết nối vào container qua mạng bridge. Vì vậy workflow tạo user riêng.

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      rabbitmq:
        # Plain image on purpose: no delayed-message plugin, to prove the broker starts without it.
        image: rabbitmq:3.13-management
        env:
          RABBITMQ_DEFAULT_USER: bustransit
          RABBITMQ_DEFAULT_PASS: bustransit
        ports:
          - 5672:5672
          - 15672:15672
        options: >-
          --health-cmd "rabbitmq-diagnostics -q ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    env:
      RABBITMQ_URL: amqp://bustransit:bustransit@localhost:5672
      RABBITMQ_MANAGEMENT_URL: http://bustransit:bustransit@localhost:15672
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci --legacy-peer-deps
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:integration
      - run: npm run build
```

- [ ] **Step 5: Chạy integration test**

Run (broker của chủ repo, `rabbitmq:3-management-alpine`, vhost `linkadz`):

```bash
RABBITMQ_URL=amqp://admin:admin123@localhost:5672/linkadz \
RABBITMQ_MANAGEMENT_URL=http://admin:admin123@localhost:15672 \
npm run test:integration
```

Expected: PASS (6 tests). Đã kiểm chứng trên RabbitMQ 3.13.7.

Nếu broker local không chạy, hỏi chủ repo trước khi push để CI chạy; không tự cài phần mềm, không tự push. Khi không có biến môi trường, `npm run test:integration` phải báo 6 test skipped và không có lỗi. `cleanup` lấy vhost từ `RABBITMQ_URL`; broker local chỉ có vhost `linkadz`, không có vhost `/`.

- [ ] **Step 6: Commit**

```bash
git add jest.integration.config.js test/integration/ .github/workflows/ci.yml
git commit -m "test: add integration tests against a real RabbitMQ and a CI workflow"
```

---

### Task 14: Release 0.4.0

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`

**Interfaces:**
- Consumes: mọi task trước.
- Produces: branch sẵn sàng phát hành.

- [ ] **Step 1: Bump version và thêm `prepare`**

`package.json`: đặt `"version": "0.4.0"` và thêm script `"prepare": "npm run build"`. Khi cài dependency từ git, npm chạy `prepare`, nhờ đó api-portal và service-bus cài được trực tiếp từ git tag.

- [ ] **Step 2: Ghi CHANGELOG**

Thêm ngay dưới `# Changelog`:

```markdown
## [0.4.0] - 2026-10-11

The RabbitMQ transport was rebuilt so that one failing channel, exchange or consumer no longer
takes down publishing or consuming elsewhere. Exchange names, queue names and bindings are unchanged.

### Fixed
- A channel closed by the broker (404, 406, 403) is replaced. Before, one bad publish made every later publish fail with `Channel closed` until the process restarted.
- Before the first publish to an exchange, the publisher checks that it exists and creates it (fanout, durable) only when it is missing; an existing exchange is used as it is, whatever its type or arguments. Publishing a message whose consumer is not deployed yet no longer kills the producer channel.
- Publish uses publisher confirms: the publish the broker refuses is the one that rejects, with the broker's reason.
- The x-delayed-message plugin check runs on a throwaway connection with a time limit, so it can neither disturb the main connection nor hang start-up.
- Connection `error` events are handled; a publish made while reconnecting waits up to 10 s; shutdown drains messages in progress (up to 30 s) and closes the connection.
- Each consumer runs on its own channel and restarts on its own, with a doubling delay up to 60 s, after a refused declaration, a closed channel or a cancel from the broker.
- Messages are acked as soon as they are handled. A leftover delay held each ack one second per `.` in the payload.
- A failed message is acked only after its copy in `<queue>_error` or the delayed exchange is confirmed. If it cannot be written, the message goes back to the queue instead of being lost.
- Messages that are not JSON go to `<queue>_error`.
- `Send` closes its temporary channel and fails fast when no queue has the endpoint name.
- Passwords containing `@`, `:` or `/` work. The vhost is read exactly as before.

### Added
- `BusTransitService.getHealth()` returns `{ connected, blocked, consumers }` for health checks.
- `cfg.UseReliability({...})` sets reconnect, ready, publish, send, consumer restart and shutdown timings.

### Changed
- `IPublishEndpoint.Publish` returns `Promise<void>` and rejects when the broker refuses or does not confirm the message. Await it.
- A published message that reaches no queue is logged as `Unroutable message` instead of being dropped silently.
```

- [ ] **Step 3: Thêm mục "Reliability" vào README**

Thêm ngay trước `## Roadmap`:

````markdown
## Reliability

- **Await every publish.** `Publish` resolves once RabbitMQ confirms the message and rejects when the broker refuses it or does not confirm within `publishTimeoutMs`.
- **Publishers make sure their exchange exists.** An existing exchange is used as it is. A missing one is created (fanout, durable), so publishing a message type before its consumer is deployed is safe: the message is logged as `Unroutable message`, and other publishes keep working.
- **Failures stay local.** A channel the broker closes is reopened on next use. Each consumer restarts on its own. A lost connection reconnects every `reconnectDelayMs`.
- **At-least-once delivery.** A message in progress when its channel dies is delivered again. Make consumers idempotent.
- **Shutdown.** Call `app.enableShutdownHooks()`. Shutdown stops consuming, waits up to `shutdownTimeoutMs` for messages in progress, then closes the connection. Keep `shutdownTimeoutMs` below your container's stop grace period.

```ts
x.UsingRabbitMq(configService.get('APP_NAME'), (context, cfg) => {
    cfg.UseReliability({ shutdownTimeoutMs: 35000 }); // ESB containers get 40 s to stop
    // ...
});
```

Health check:

```ts
@Get('health/bus')
health() {
    const health = this.busTransitService.getHealth();
    if (!health.connected) throw new ServiceUnavailableException(health);
    return health;
}
```
````

- [ ] **Step 4: Build và chạy toàn bộ unit test**

Run: `npm run build && npx jest`
Expected: build không lỗi, mọi unit test PASS. Kiểm tra thêm: `ls dist/factories/brokers/rabbitmq` liệt kê đủ 10 file `.js` của Task 2-10; `ls dist | grep -c test` ra `0`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md README.md
git commit -m "chore: release 0.4.0"
```

- [ ] **Step 6: Dừng lại, hỏi chủ repo cách phát hành**

Không push, không `npm publish`. Báo branch `fix/rabbitmq-transport-reliability` đã sẵn sàng, rồi hỏi chủ repo chọn một trong các hướng:
1. Push lên `origin` (fork `lucasngucii/nestjs-bustransit`), tạo tag `v0.4.0`. Hai app cài bằng `"nestjs-bustransit": "github:lucasngucii/nestjs-bustransit#v0.4.0"`.
2. Mở PR lên repo gốc `diepnghitinh/nestjs-bustransit` để chủ package publish lên npm.
3. Làm cả hai.

Kèm ghi chú nâng cấp cho hai app:
- **service-bus**: `schedule-analytics-campaigns.use-case.ts:103` gọi `Publish` mà không `await`; từ 0.4.0 lệnh này reject khi lỗi nên phải `await`. Các container ESB có stop grace 40 s, nên đặt `cfg.UseReliability({ shutdownTimeoutMs: 35000 })`.
- **api-portal**: các controller trong `internal.controller.ts` (:306, :317, :328) cần trả lỗi khi `Result` thất bại. Thêm endpoint health dùng `getHealth()` để healthcheck của swarm restart pod khi mất broker lâu.
- **Cả hai**: gọi `app.enableShutdownHooks()` trong `main.ts`, nếu chưa có.
