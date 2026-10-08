# t-3b3e5b 前端：设置页「关心事件」与保存语义·复核

> 需求：REQ-261001203114-19b6 会话异常中断通知：turn/end 按 reason 分类，error/interrupted 不再谎报完成

## 在做什么
前端：设置页「关心事件」与保存语义·复核

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 得到什么结果
对照 `docs/requirements/<REQ>/design/` 逐条核对；`npx vitest run <相关测试文件>` → 全绿；无偏离时显式写明「无偏离」及依据

---
## 汇报 1（2026-10-01T12:53:11.534Z，窗口 session-7b01a16b-35da-4360-9fc7-cc419417ae5e）

前端复核通过：只动了「关心事件」清单与保存语义，界面其余部分与对外契约未变。

### 完成项

- 复核 layout/样式/图标/renderTargetPicker 契约未被触碰（只改 EVENTS 与 save 载荷）
- 复核旧 Host 组合：不认识 eventsMode 时按既有白名单行为工作，不报错
- 复核未全勾与全勾两条提交路径的取值与 design/frontend.md §2 一致
- 无偏离

### 改动文件

- `client.js`

---
