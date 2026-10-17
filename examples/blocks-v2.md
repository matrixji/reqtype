---
reqtype: 2
module: "d48c30fc-3b01-497f-a718-0878bb73f330"
title: "区块与正文引用示例"
---

# 登录能力

本模块演示 begin/end 区块与正文引用。实现方案参考 [[[登录限制:req-7b5d99ec-15fd-4818-a892-571ba39bca22]]]。

<!-- req:begin
id: "7b5d99ec-15fd-4818-a892-571ba39bca22"
key: "REQ-101"
title: "登录失败计数"
type: requirement
status: draft
priority: normal
-->

软件应在离线状态下记录登录失败次数，并在连续三次失败后给出提示。

| 输入 | 结果 |
| --- | --- |
| 第三次失败 | 显示重试提示 |

```ts title="计数器示意"
const shouldWarn = (failures: number) => failures >= 3;
```

<!-- req:end -->

<!-- req:begin
id: "69ae8b3e-0240-47fd-a457-44310f7a8710"
key: "REQ-102"
title: "验证登录失败提示"
type: test
status: draft
links:
  - type: verifies
    target: "7b5d99ec-15fd-4818-a892-571ba39bca22"
-->

按照 [[[登录失败计数:req-7b5d99ec-15fd-4818-a892-571ba39bca22]]]，连续输入三次无效凭据，检查提示。

<!-- req:end -->

代码中的示例保持字面量：

```markdown
<!-- req:begin
id: this-is-only-an-example
-->
[[[示例:req-7b5d99ec-15fd-4818-a892-571ba39bca22]]]
<!-- req:end -->
```
