# t-aec5db 客户端半：目标编辑与动作·联调

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
客户端半：目标编辑与动作·联调

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

grep -c "'/targets'\|/targets/delete\|/test'" client.js ≥ 3（四个动作路径已接线）；node --test test/rpc.write.test.js 全绿（8/8）

## 汇报 1（2026-09-30T10:56:10.954Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

联调段完成：页面四个动作与后端端点逐一对齐，409 分支口径一致。

### 完成项

- 联调：页面写操作与 rpc.write 的四个端点逐一对齐（路径/字段/返回值）
- 联调：409 分支消费 buildState 的最新态（含 revision）
- 验证：rpc.write.test.js 8/8 覆盖同一契约

---
