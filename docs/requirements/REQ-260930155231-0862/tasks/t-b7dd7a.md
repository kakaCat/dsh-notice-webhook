# t-b7dd7a 升级绑定存储：targetBindings 段·研发

> 需求：REQ-260930155231-0862 Webhook 通知插件：在界面上配置 webhook 地址与开关（声明 Config schema + 设置表单）

## 在做什么
升级绑定存储：targetBindings 段·研发

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果

node --test test/bindings.v2.test.js 全绿（8/8）；grep -c 'targetBindings' src/bindings.js ≥ 2；node --test test/bindings.test.js 全绿（v1 回归 9/9）

## 汇报 1（2026-09-30T09:30:02.966Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

研发段完成：绑定从"一条地址"升级成"若干目标"，且回滚不丢绑定——旧版本读新文件忽略未知段不报错，8 条用例全绿、v1 回归不破。

### 完成项

- 升级 src/bindings.js：新增 targetBindings 段与 bindTargets/unbindTargets/targetIdsOf/listBindings
- 读时 targetBindings 优先、缺则回落 url 映射；写时两段一起写
- unbind/unbindTargets 双清（旧 url + 多目标）
- 落地 test/bindings.v2.test.js 并跑绿 8/8；v1 回归 9/9 不破

### 改动文件

- `src/bindings.js`
- `test/bindings.v2.test.js`

---
