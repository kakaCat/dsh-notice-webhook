# t-231afa 更新 README（多渠道 / 配置页 / 服务契约）·复核

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
更新 README（多渠道 / 配置页 / 服务契约）·复核

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

grep -c 'schemastery' README.md ≥ 1；grep -c 'renderTargetPicker' README.md ≥ 1；grep -c '支持的渠道' README.md ≥ 1

## 汇报 1（2026-09-30T12:09:17.094Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

复核段完成：README 陈述与实现/设计逐条一致；全局参数只读的口径已写进边界节。

### 完成项

- 逐条核对 README 与实现/设计：渠道报文与成功判定、绑定替代语义、去重键、409 栅栏、volatile 字段集合、密钥不回显、存储与回滚安全
- 核对服务版本（v2）与选择器契约（v1）与代码一致
- 记录一处口径修正：全局参数页面只读（已写进 README 边界节）
- 确认无偏离

---
