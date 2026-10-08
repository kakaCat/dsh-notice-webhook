# t-be5e03 装载到 profile 并做真实 Host 验收·研发

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
装载到 profile 并做真实 Host 验收·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --check index.js 通过；grep -c 'export { Config' index.js ≥ 1；node -e "import('./index.js').then(m=>console.log(typeof m.Config))" 输出 function

## 汇报 1（2026-09-30T12:00:40.837Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

准备段完成：活体装载证据采集齐全。

### 完成项

- 采集活体证据：plugin_manager 清单、host Config.listConfigs、client Slots.listSubTree
- profile 链接解析双半验证
- 记录未做项与原因（真实投递需先配目标；目标清单当前为空）

---
## 汇报 2（2026-09-30T12:03:57.511Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：真实装载验证（走 profile 解析路径）暴露了两个真 bug——Config 没导出导致 schema 声明失效、测试污染用户真实状态目录；两者都已修复并清理残留，随后活体查询确认插件在运行中的 Host 里生效。

### 完成项

- 真实装载验证暴露并修复 bug 1：Config 未从插件入口导出（Loader 读不到 schema）→ index.js 增加 export { Config, VOLATILE_KEYS }
- 真实装载验证暴露并修复 bug 2：测试写用户真实状态目录（25 条残留）→ test/e2e.local.test.js 与 test/compat.test.js 补传临时 targets 路径
- 清理真实状态目录残留（删前备份到 /tmp/dsh-notice-webhook-targets.test-junk.bak）
- 采集活体证据：plugin_manager 清单、host Config.listConfigs(status=schema)、client Slots.listSubTree(occupant dsh-notice-webhook/order 21/active)

### 改动文件

- `index.js`
- `test/e2e.local.test.js`
- `test/compat.test.js`

---
