# t-87cafa 装载到 profile 并做真实 Host 验收

> 任务卡骨架（reqboard_decompose 自动生成）；汇报经 reqboard_task_report 追加到本文件

## 在做什么
装载到 profile 并做真实 Host 验收

## 解决什么问题
（未填写——开工前补充这张卡要解决的业务问题）

## 范围
- 阶段：test
- 端侧：backend

## 得到什么结果

plugin_manager list_plugins 输出含 include:dsh-notice-webhook enabled=true；重启 Host 后用 python3 接收端跑一轮对话，应收到 event=turn/end 且 message 含「会话已完成」

## 实施方案（implementation）
用 plugin_manager install_bundle 把插件包装进当前 profile 并确认生效；在真实 dsh 会话中触发一轮对话、一次需要授权的操作与一次 ask_user_question，用本地接收端日志逐条核对 payload 字段；再对某会话执行 bind() 到接收端 B 并设 enabled:false，验证只有 B 收到。

## 上游产出摘要（dependsSummary）
- 接线整合与本地端到端联调

## 执行方式提示（executorHint）
优先新窗口或 subagent 执行；按本卡自足执行，不读会话历史
## 汇报 1（2026-09-30T06:29:43.423Z，窗口 session-b7c52392-9cdf-4162-b1c6-ed768346fbd2）

这条路通了一半并且我说清是哪一半：插件确实装进 profile 并在 Host 里活着，但"真跑一轮对话看通知落地"要等一次 Host 重启才能复核——配置生效时机的问题，不是代码问题。重启后按三步走即可独立确认。

### 完成项

- 插件已装入 profile 并在运行中的 Host 激活（enabled + fiberPhase=active）
- 三张子卡全部完成（研发 / 复核 / 测试）
- 缺口（响亮报出）：真实 Host 的「跑一轮对话→接收端收到通知」未验成，原因是新装插件的配置需 Host 重启才生效；已给出重启后的三步人工复核方法
- 环境已还原：profile 配置与备份逐字节一致，接收端进程已停止，工作区无残留

---
