# API.g.cs 生成器去重方案（InitDeity，2026-08-13）

> 数据：API.g.cs 2503 chunks 方法名复制统计（iter44 引擎扫描）。

## 复制模式实测

| 复制倍数 | 方法 | 性质 |
| --- | --- | --- |
| ×94 | ObjectResponseResult（类）、PrepareRequest | 每个 Client 类各一份 |
| ×47 | ReadObjectResponseAsync / BaseUrl / Compress / ConvertToString / ContentIsGzipEncoded / JsonSerializerSettings / CreateSerializerSettings / Text / ProcessResponse / ProcessApiException / UpdateJsonSerializerSettings / EnableRequestCompression … | 60+ Client 类的公共 helper 全复制 |

- **top10 复制方法占 23% chunk**（564/2503）——约 47 个方法 × 47-94 份复制
- 附带债：ConvertToString 自递归（60+ 自环主体）、ReadObjectResponseAsync 效应源 top（50 调用/份）

## 方案（生成器侧，generate_locust_sdk）

### 方案 A：抽公共基类（推荐）

```
ApiClientBase（生成一次）
├── PrepareRequest / ProcessResponse / ProcessApiException
├── ConvertToString / ContentIsGzipEncoded / Compress / EnableRequestCompression
├── ReadObjectResponseAsync / CreateSerializerSettings / UpdateJsonSerializerSettings
└── ObjectResponseResult（嵌套类） / BaseUrl（虚属性或字段）
```

- 每个 Client 类 `class XxxClient : ApiClientBase`——**删除 47 个复制方法 × 60+ 客户端**
- 行为风险：方法签名/可见性必须保持（项目代码调用 `client.PrepareRequest(...)`——继承后调用不变 ✓；静态方法需改实例或保留 static 转发）
- **改动量**：生成器模板抽基类（一次）+ 重新生成（全量替换 API.g.cs）——项目代码零改动（除非调用静态成员）

### 方案 B：组合 helper 类（保守替代）

```
ApiClientHelpers（静态类，生成一次）
所有 Client 类的复制方法 → ApiClientHelpers.Xxx(...) 转发（1 行/份）
```

- 保留 Client 类的方法签名（转发）——项目代码零改动
- 减少复制体量（每份从 30-60 行 → 1 行转发）但保留 47×60 转发方法

### 决策

- 生成器可完全掌控模板 → **方案 A**（抽基类）；若 Client 类有序列化/反射要求（方法必须在本类）→ 方案 B
- 验证：重新生成后 codeaudit 重扫——自环 60 → 0、效应源 ReadObjectResponseAsync 47 份 → 1、unknown 预计再降（生成代码重复判定合并）

## 附带建议

- ObjectResponseResult 构造器（94 份 × 状态写）——随基类抽取一并消除
- 生成器加**重复检测门禁**：模板生成后自动 diff 公共方法签名，防复制模式复活
