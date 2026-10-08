# t-ddc493 兼容与回滚收尾·复核

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
兼容与回滚收尾·复核

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/compat.v2.test.js 全绿（8/8）；grep -c 'targetBindings' src/bindings.js ≥ 1；对照 design/data-model.md 的回滚安全逐条给出结论

## 汇报 1（2026-09-30T10:46:34.068Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

复核段完成：兼容与回滚行为与设计一致，无偏离。

### 完成项

- 对照 data-model.md 回滚安全（旧版本忽略未知键）与 interfaces.md legacy 映射
- 核对卸载残留口径（只留两份 json、无 .tmp）
- 确认无偏离：同 url 去重、坏文件不覆盖、零迁移均按设计落地

---
