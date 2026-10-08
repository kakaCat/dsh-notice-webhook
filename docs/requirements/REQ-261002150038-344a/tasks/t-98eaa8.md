# t-98eaa8 设置页预览：卡片区不再显示「类型」行·联调

> 需求：REQ-261002150038-344a 通知去噪：Dive 自动轮不推送 + 卡片删除重复的「类型」行

## 在做什么
设置页预览：卡片区不再显示「类型」行·联调

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
`npx vitest run <本卡接口/契约对应的测试文件>` → 全绿（请求样例与期望响应一致）

---
## 汇报 1（2026-10-02T07:12:10.982Z，窗口 session-eda4a33c-31bc-4d31-901d-5a9c640287bf）

这一步做完，设置页整体没被这处改动影响——预览变了，页面照旧装载。

### 完成项

- 三个客户端测试文件一起跑：node --test test/client-render.test.js test/client-hooks.test.js test/client-service.test.js → 42 passed / 0 failed
- 确认给卡片区加 data-dnw-region 属性不影响设置页其余组件（渲染、hooks、服务接线三类用例全绿）
- client.js 仍只依赖 react（测试用 requireShim 限制），未引入新依赖

### 改动文件

- `client.js`

### 下一步

复核子卡：对照设计接口 §5 与 TC-21…TC-23 核对。

---
