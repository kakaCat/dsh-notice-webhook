# t-db8e0b 实现目标清单存储与 CRUD·研发

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
实现目标清单存储与 CRUD·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/targets.test.js 全绿（11/11）；grep -c 'class TargetStore' src/targets.js ≥ 1；node --check src/targets.js 通过

## 汇报 1（2026-09-30T09:21:30.129Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：目标清单存储落盘，11 条用例全绿；修了一处回滚 bug（落盘失败时内存必须回到落盘前）。

### 完成项

- 落地 src/targets.js：TargetStore（CRUD、校验、原子写）
- 落地 test/targets.test.js 并跑绿 11/11
- 修复 save() 落盘失败的内存回滚（不写不存在的 __previous）

### 改动文件

- `src/targets.js`
- `test/targets.test.js`

---
