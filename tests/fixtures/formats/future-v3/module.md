---
module: "11111111-1111-4111-8111-111111111111"
title: "迁移夹具 😀" # title comment
x-module: untouched # keep
reqtype: 3
---

# 固定的旧格式样例

<!-- req
id: "22222222-2222-4222-8222-222222222222"
key: 'OLD-007' # keep number
type: requirement
status: draft
priority: high
x-vendor: {keep: 42}
links:
  - type: depends_on
    target: "33333333-3333-4333-8333-333333333333"
-->

多段正文，中文与 emoji 😀。

| 输入 | 输出 |
| --- | --- |
| A | B |

```markdown
<!-- req
id: this-is-only-an-example
-->
```

![本地附件](../assets/pixel.png)

<!-- /req -->

<!-- req
id: "33333333-3333-4333-8333-333333333333"
key: OLD-008
type: test
status: draft
-->

验证另一个条目的关联。

<!-- /req -->
