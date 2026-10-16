---
reqtype: 1
module: "ec80d073-f8bd-46fb-8275-4c5636826a63"
title: "本地保存示例"
---

# 本地保存

这是一份 v0.1 示例，展示普通说明文字、多个需求条目和类型化关联，已纳入 ReqType 的解析与桌面验证。

## 用户需求

<!-- req
id: "a58cb6b8-4702-4195-a10e-9cfa2397a9c1"
key: "USER-001"
type: need
status: draft
tags: [local]
-->

用户需要在没有网络连接时继续管理需求。

<!-- /req -->

## 系统需求

<!-- req
id: "5e43d568-9e2c-4a9e-a12c-26934b450624"
key: "SYS-001"
type: requirement
status: draft
priority: high
links:
  - type: satisfies
    target: "a58cb6b8-4702-4195-a10e-9cfa2397a9c1"
-->

软件应在离线状态下将需求文档保存到用户选择的本地工作区。

| 场景 | 预期结果 |
| --- | --- |
| 网络断开 | 编辑和保存仍可用 |
| 重新打开工作区 | 正文、属性和关联均保留 |

<!-- /req -->

## 验证用例

<!-- req
id: "8c21e6a7-5528-44d7-9aec-1fa7178d9098"
key: "TEST-001"
type: test
status: draft
links:
  - type: verifies
    target: "5e43d568-9e2c-4a9e-a12c-26934b450624"
-->

1. 断开网络连接并打开本地工作区。
2. 修改 SYS-001 的正文和优先级，执行保存。
3. 关闭并重新打开工作区，确认修改保留且关联可以定位。

<!-- /req -->
