import type { SyntaxNode, RawImport } from "../pack";
import type { LangPack } from "../pack";
import type { Effect } from "../../core/types";

/**
 * C# 语言包（迭代19：InitDeity Unity 真实项目驱动——3028 个 C# 文件是工具最大盲区）。
 *
 * 设计裁决（多角度审计 2026-08-11）：
 * - 调用解析主通道 = impureGlobals **类名效应表**（File/Debug/PlayerPrefs/UnityWebRequest…
 *   C# 调用形态是 obj=类名，非命名空间）；using/namespace 不绑定 local（与 Python 的
 *   `import os` 不同——C# using 让成员可见但不绑定名）→ extractImports 只处理 using 别名。
 * - 项目内跨文件类调用 → ?（诚实未知，标注工作流覆盖——与 TS 未 import 同语义，第一版）。
 * - Unity 生命周期（Awake/Start/Update/OnDestroy）与普通方法同判定（框架调用不建边，
 *   方法独立判定——与 TS this 方法同语义）。
 * - 事件订阅（+= / AddListener）不建回调边（事件触发是运行时语义，第一版不建模）；
 *   方法组实参（RemoveListener(Handler) 中的 Handler）不再经属性读取通道误建调用边（iter53 修复：
 *   argument 位置裸标识符跳过 prop-read 发射；框架成员方法组如 Console.WriteLine 仍走效应表——两通道并存）。
 * - 属性访问器（get/set 块）不建 chunk（自动属性无逻辑；自定义 getter 有方法体——经
 *   property_declaration 的 value 子节点 method 提取？第一版：属性不建，方向安全）。
 */

const impureBuiltins: Record<string, Effect> = {
	// 裸名调用罕见（C# 方法必须实例/类限定）——Unity 全局静态（MonoBehaviour 裸调，迭代20）
	Destroy: "state",
	Instantiate: "state",
	DestroyImmediate: "state",
	FindObjectOfType: "state",
	FindObjectsOfType: "state",
	DontDestroyOnLoad: "state",
	Console: "io",
};

/** C#/.NET/Unity 类名效应表（调用形态 obj=类名——第一版主通道）。 */
const impureGlobals: Record<string, Effect | readonly string[]> = {
	// Unity 核心
	Debug: "io", // Debug.Log/Warning/Error
	Console: "io", // System.Console（迭代21：Console.WriteLine 的 obj=Console 走 impureGlobals——此前只在 impureBuiltins）
	PlayerPrefs: "state", // SetFloat/GetFloat/DeleteAll——持久化存档
	Application: "io", // OpenURL/Quit/RequestUserAuthorization
	WWW: "net",
	UnityWebRequest: "net",
	Resources: "fs", // Load/UnloadUnusedAssets——读资产
	AssetBundle: "fs",
	AssetDatabase: "fs", // 编辑器资产 API
	Screen: "io", // 分辨率/全屏——设备状态
	SystemInfo: "state", // 设备信息（运行时只读——保守 io/state）
	Input: "state", // GetKey/GetMouseButton——输入状态
	Time: "clock", // Time.time/deltaTime——时间
	DateTime: "clock",
	Random: "random", // UnityEngine.Random 与 System.Random 同名冲突——保守 random
	// Unity 对象/场景/动画（迭代19 补充——对象管理与场景状态）
	GameObject: "state", // Find/Instantiate/Destroy——对象生命周期
	Object: "state", // UnityEngine.Object（FindObjectOfType/Instantiate/Destroy）
	Instantiate: "state",
	Destroy: "state",
	SceneManager: "state", // LoadScene/UnloadScene
	Scene: "state",
	Animator: "state", // SetTrigger/SetBool——动画状态
	Animation: "state",
	AudioSource: "io", // Play/Stop——音频输出
	AudioClip: "fs",
	AudioListener: "io",
	Camera: "io", // 渲染输出
	RenderTexture: "state",
	Texture2D: "state", // EncodeToPNG/ReadPixels
	Texture: "state",
	Graphics: "io", // 渲染
	Shader: "state",
	Material: "state", // SetColor/SetTexture——材质状态
	Rigidbody: "state", // 物理状态
	Transform: "state", // position/rotation——对象状态（保守）
	RectTransform: "state",
	Navigation: "state", // 寻路（NavMeshAgent）
	NavMeshAgent: "state",
	Canvas: "state",
	UI: "state",
	EventSystem: "state",
	Physics: "state", // Raycast——物理查询（保守 state）
	Physics2D: "state",
	Collider: "state",
	ParticleSystem: "io", // Play/Stop——视觉输出（保守 io）
	TrailRenderer: "io",
	SpriteRenderer: "io",
	MeshRenderer: "io",
	Light: "io",
	Handheld: "io", // Vibration/PlayFullScreenMovie
	AndroidJavaObject: "io", // 平台桥
	AndroidJavaClass: "io",
	Gizmos: "io", // 编辑器绘制
	// 网络/持久化（Unity 侧）
	NetCall: "net",
	Network: "net",
	Ping: "net",
	JSON: "fs", // Unity 老 JSON API（读写）
	JsonUtility: "state", // FromJson/ToJson（保守 state——序列化）
	XmlSerializer: "fs",
	Serialization: "fs",
	// 迭代19 补充（InitDeity 标注后形态驱动）
	Assert: "io", // UnityEngine.Assertions——断言失败抛异常（保守 io）
	DOTween: "state", // 第三方补间动画（修改对象状态）
	DOTweenAnimation: "state",
	EditorGUILayout: "io", // Unity 编辑器 GUI
	EditorGUI: "io",
	GUI: "io",
	GUILayout: "io",
	Debugger: "io", // System.Diagnostics
	UniTask: "state", // 异步任务
	GCHandle: "state",
	// 等待/协程（迭代19 深挖）：Task.Delay/WaitForSeconds 是时钟等待；StartCoroutine 是协程生命周期
	Task: "clock",
	WaitForSeconds: "clock",
	WaitForSecondsRealtime: "clock",
	WaitUntil: "clock",
	WaitWhile: "clock",
	WaitForEndOfFrame: "clock",
	StartCoroutine: "state",
	StopCoroutine: "state",
	// Unity 全局静态方法（迭代20：MonoBehaviour 里裸调用 Destroy/Instantiate——obj=null；
	// Destroy/Instantiate 已在上面 GameObject 区——这里补其余全局）
	DestroyImmediate: "state",
	FindObjectOfType: "state",
	FindObjectsOfType: "state",
	DontDestroyOnLoad: "state",
	// .NET IO/网络/DB
	File: "fs", // ReadAllText/WriteAllText/Exists
	FileStream: "fs",
	Directory: "fs",
	Path: "fs", // Combine 纯但保守 fs（读路径状态）
	StreamReader: "fs",
	StreamWriter: "fs",
	BinaryReader: "fs",
	BinaryWriter: "fs",
	FileInfo: "fs",
	DirectoryInfo: "fs",
	WebRequest: "net",
	HttpClient: "net",
	HttpListener: "net",
	WebClient: "net",
	Socket: "net",
	TcpClient: "net",
	UdpClient: "net",
	SmtpClient: "net",
	SqlConnection: "db",
	SqlCommand: "db",
	SqlDataReader: "db",
	MySqlConnection: "db",
	NpgsqlConnection: "db",
	MongoDB: "db",
	// 环境/进程
	Environment: "io", // GetEnvironmentVariable/GetFolderPath
	Process: "io",
	ProcessStartInfo: "io",
	// 日志/追踪（非 Unity）
	Trace: "io",
	EventLog: "io",
};

const pureGlobals = new Set<string>([
	"Math", // Math.Abs/Max——纯计算
	"String", // String.Concat/Format——纯
	"Convert", // ToInt32/ToString——纯
	"Guid", // NewGuid——纯
	"Enum", // Parse——纯
	"TimeSpan", // FromSeconds——纯
	"Vector2",
	"Vector3",
	"Vector4",
	"Quaternion",
	"Color",
	"Rect", // Unity 数学结构
	"Mathf", // Unity 数学
	"StringBuilder", // 可变字符串——纯（无 io）
	// 迭代44 候选2（双评审）：System 枚举名——枚举成员是编译期常量（C# 规范），读取无副作用；
	// 语料实证频次（InitDeity）：StringComparison.Ordinal 86/单文件、TaskStatus 1187、BindingFlags 570。
	// 入 pureGlobals 而非 frameworkPure：obj=裸首段形态匹配；项目类同名由 globalClasses 优先
	//（L1249）+ assigned/moduleAssigned 遮蔽守卫双保险（iter41 免费保护）；B 方案（无条件枚举判纯）
	// 否决——无类型系统无法识别枚举 vs 类，泛化 = 插件静态 getter 假纯（A7 结构违反）。
	"StringComparison",
	"TaskStatus",
	"BindingFlags",
	"AttributeTargets",
	// 迭代44-r3（标注运营实证）：DOTween 枚举——Ease.Linear 18 条读取落 ?（枚举成员编译期常量，
	// 与 System 枚举同族论证）；第三方枚举语义相同（成员无副作用）。语料实证频次驱动，不预测性扩表。
	"Ease",
	"LoopType",
	"PathType",
	// 内建值类型静态方法（int.Parse/TryParse 等——纯计算；迭代19 C#）
	"int",
	"long",
	"float",
	"double",
	"string", // C# builtin（迭代20）：string.IsNullOrWhiteSpace/Format/Concat 纯
	"decimal",
	"bool",
	"char",
	"byte",
	"sbyte",
	"short",
	"ushort",
	"uint",
	"ulong",
	"object",
	"Array",
	"List",
	"Dictionary",
	// NUnit 断言类（迭代33 TP5：InitDeity 675 站 StringAssert/Does 未入表 → 假 UNKNOWN）——
	// 抛异常≠副作用；不动 "Assert"（撞 UnityEngine.Assertions——impureGlobals.Assert 优先）
	"StringAssert",
	"Does",
]);

/** .NET 基础类型字面量接收者（链式方法：list.Add / "s".ToUpper）。 */
const literalReceivers: Record<string, string> = {
	string_literal: "string",
	character_literal: "string",
	integer_literal: "number",
	real_literal: "number",
	true: "boolean",
	false: "boolean",
	null_literal: "null",
	// 迭代33 C1：object_creation_expression 移除（曾短路为 "object" 导致 new C().m() 链断）——
	// receiverTypeOf 对 C# 构造器改走 class:TypeName 分支（与 TS new_expression 对称）
	array_creation_expression: "array",
};

/** 内建类型硬纯方法（无参数协议分派）；表外 → ?（F9 同 TS）。 */
const builtinTypeEffects: Record<string, Record<string, "pure" | "hof">> = {
	string: {
		ToUpper: "pure",
		ToLower: "pure",
		Trim: "pure",
		Substring: "pure",
		Replace: "pure",
		Split: "pure",
		Contains: "pure",
		StartsWith: "pure",
		EndsWith: "pure",
		IndexOf: "pure",
		LastIndexOf: "pure",
		Concat: "pure",
		Format: "pure",
		Join: "pure",
		Compare: "pure",
		Equals: "pure",
		GetHashCode: "pure",
		ToCharArray: "pure",
		PadLeft: "pure",
		PadRight: "pure",
		Remove: "pure",
		Insert: "pure",
		TrimStart: "pure",
		TrimEnd: "pure",
		ToLowerInvariant: "pure",
		ToUpperInvariant: "pure",
		ToString: "pure",
		IsNullOrEmpty: "pure",
		IsNullOrWhiteSpace: "pure",
	},
	number: {
		ToString: "pure",
		CompareTo: "pure",
		Equals: "pure",
	},
	boolean: { ToString: "pure" },
	array: {
		// 数组方法（LINQ 扩展是动态——链上方法不在此表）
		Length: "pure",
	},
	// 序列/集合 monad 操作（迭代31：与 builtinMethodReturns 的 IEnumerable/List/Dictionary 键对齐——
	// 变量绑定（A1 待办）启用后 xs.Select 解析到 IEnumerable 时分支 0 判定表必须覆盖，否则链解析了
	// 却判空落 ? 浪费判别力。hof = 纯算子但回调须保留（LINQ 上下文 linqHof 兜底））。
	IEnumerable: {
		Select: "hof",
		SelectMany: "hof",
		Where: "hof",
		OrderBy: "hof",
		OrderByDescending: "hof",
		ThenBy: "hof",
		ThenByDescending: "hof",
		GroupBy: "hof",
		Aggregate: "hof",
		Zip: "hof",
		Join: "hof",
		GroupJoin: "hof",
		ToDictionary: "hof",
		ToLookup: "hof",
		SkipWhile: "hof",
		TakeWhile: "hof",
		ForEach: "hof",
		Skip: "pure",
		Take: "pure",
		Distinct: "pure",
		Reverse: "pure",
		Concat: "pure",
		Union: "pure",
		Intersect: "pure",
		Except: "pure",
		Cast: "pure",
		OfType: "pure",
		DefaultIfEmpty: "pure",
		Append: "pure",
		Prepend: "pure",
		ToList: "pure",
		ToArray: "pure",
		ToHashSet: "pure",
	},
	List: {
		Add: "pure",
		Remove: "pure",
		RemoveAt: "pure",
		Clear: "pure",
		Contains: "pure",
		IndexOf: "pure",
		Insert: "pure",
		Sort: "hof", // 迭代38 规则5：Comparison 回调义务（原标 pure 丢回调——B1 连带修复）
		ToArray: "pure",
		ToList: "pure",
		Count: "pure",
	},
	Dictionary: {
		Add: "pure",
		Remove: "pure",
		ContainsKey: "pure",
		ContainsValue: "pure",
		TryGetValue: "pure",
		Keys: "pure",
		Values: "pure",
		Count: "pure",
		ToList: "pure",
	},
	// 迭代52 P2：System.Type 反射元数据读判纯（typeof(X).GetMethod 等——元数据读无用户代码；
	// Invoke/GetValue/SetValue 动态执行不列入 → ? 诚实）。与 builtinMethodReturns["Type"] 成对。
	Type: {
		GetMethod: "pure",
		GetMethods: "pure",
		GetProperty: "pure",
		GetProperties: "pure",
		GetField: "pure",
		GetFields: "pure",
		GetConstructor: "pure",
		GetConstructors: "pure",
		GetTypeInfo: "pure",
		GetElementType: "pure",
		GetGenericArguments: "pure",
		IsAssignableFrom: "pure",
		IsSubclassOf: "pure",
		IsInstanceOfType: "pure",
		IsEnum: "pure",
		IsAbstract: "pure",
		IsInterface: "pure",
		ToString: "pure",
		Name: "pure",
		FullName: "pure",
		Namespace: "pure",
	},
	MethodInfo: {
		Name: "pure",
		DeclaringType: "pure",
		ReturnType: "pure",
		IsStatic: "pure",
		IsPublic: "pure",
		ToString: "pure",
	},
	PropertyInfo: {
		Name: "pure",
		PropertyType: "pure",
		CanRead: "pure",
		CanWrite: "pure",
		ToString: "pure",
	},
	FieldInfo: {
		Name: "pure",
		FieldType: "pure",
		IsStatic: "pure",
		IsPublic: "pure",
		ToString: "pure",
	},
	TypeInfo: {
		GetDeclaredMethod: "pure",
		GetDeclaredMethods: "pure",
		GetDeclaredProperty: "pure",
		GetDeclaredField: "pure",
		AsType: "pure",
	},
	// 迭代52 P1（数学家注入实测 -1927 站）：StringBuilder/Queue/Stack/HashSet/Uri——InitDeity
	// API.g.cs 生成代码高频（urlBuilder_.Append 等）。S1 红线：变异方法必须**成对**进 builtinMutators
	//（参数共享 StringBuilder 不补 mutator → 容器变异判纯 = 假纯 A6 S1 违约）。
	StringBuilder: {
		Append: "pure",
		AppendLine: "pure",
		AppendFormat: "pure",
		Insert: "pure",
		Remove: "pure",
		Replace: "pure",
		Clear: "pure",
		ToString: "pure",
		Length: "pure",
	},
	Queue: {
		Enqueue: "pure",
		Dequeue: "pure",
		Peek: "pure",
		Clear: "pure",
		Count: "pure",
		Contains: "pure",
		ToArray: "pure",
	},
	Stack: {
		Push: "pure",
		Pop: "pure",
		Peek: "pure",
		Clear: "pure",
		Count: "pure",
		Contains: "pure",
		ToArray: "pure",
	},
	HashSet: {
		Add: "pure",
		Remove: "pure",
		Clear: "pure",
		Contains: "pure",
		Count: "pure",
		UnionWith: "pure",
		IntersectWith: "pure",
		ExceptWith: "pure",
		SymmetricExceptWith: "pure",
		ToArray: "pure",
	},
	Uri: {
		Append: "pure",
		ToString: "pure",
		GetLeftPart: "pure",
		AbsoluteUri: "pure",
		Host: "pure",
		PathAndQuery: "pure",
		Query: "pure",
		Scheme: "pure",
	},
};

/** 迭代38 B：参数共享容器方法变异 → state 效应（与参数下标写 d[0]=1 同语义统一，iter36 §b-7）。
 *  Sort 同时在 builtinTypeEffects 标 hof（Comparison 回调义务保留，规则5）。 */
const builtinMutators: Record<string, ReadonlySet<string>> = {
	List: new Set(["Add", "Remove", "RemoveAt", "Clear", "Insert", "Sort"]),
	Dictionary: new Set(["Add", "Remove", "Clear"]),
	// 迭代52 P1：S1 红线成对——StringBuilder/Queue/Stack/HashSet 变异方法（与 builtinTypeEffects 同步）
	StringBuilder: new Set([
		"Append",
		"AppendLine",
		"AppendFormat",
		"Insert",
		"Remove",
		"Replace",
		"Clear",
	]),
	Queue: new Set(["Enqueue", "Dequeue", "Clear"]),
	Stack: new Set(["Push", "Pop", "Clear"]),
	HashSet: new Set([
		"Add",
		"Remove",
		"Clear",
		"UnionWith",
		"IntersectWith",
		"ExceptWith",
		"SymmetricExceptWith",
	]),
};

const builtinMethodReturns: Record<string, Record<string, string>> = {
	string: {
		ToUpper: "string",
		ToLower: "string",
		Trim: "string",
		TrimStart: "string",
		TrimEnd: "string",
		Substring: "string",
		Replace: "string",
		Split: "string",
		PadLeft: "string",
		PadRight: "string",
		Remove: "string",
		Insert: "string",
		Concat: "string",
		Join: "string",
		Format: "string",
		ToCharArray: "array",
		ToLowerInvariant: "string",
		ToUpperInvariant: "string",
		ToString: "string",
	},
	// 迭代52-r3（数学家实证 urlBuilder_ 1150 站）：StringBuilder 链式返回（.Append(x).Append(y)——
	// 变异方法返回自身；ToString 断链为 string）。与 builtinTypeEffects/builtinMutators 成对。
	StringBuilder: {
		Append: "StringBuilder",
		AppendLine: "StringBuilder",
		AppendFormat: "StringBuilder",
		Insert: "StringBuilder",
		Remove: "StringBuilder",
		Replace: "StringBuilder",
		Clear: "StringBuilder",
		ToString: "string",
		Length: "number",
	},
	Queue: {
		Enqueue: "Queue",
		Dequeue: "Queue",
		Peek: "number",
		ToArray: "array",
		Count: "number",
	},
	Stack: {
		Push: "Stack",
		Pop: "Stack",
		Peek: "number",
		ToArray: "array",
		Count: "number",
	},
	HashSet: {
		Add: "HashSet",
		Remove: "HashSet",
		Clear: "HashSet",
		UnionWith: "HashSet",
		IntersectWith: "HashSet",
		ExceptWith: "HashSet",
		ToArray: "array",
		Count: "number",
	},
	array: {
		ToList: "List",
		ToArray: "array",
		ToDictionary: "Dictionary",
		Length: "number",
	},
	List: {
		ToArray: "array",
		ToList: "List",
		ToDictionary: "Dictionary",
		Count: "number",
	},
	Dictionary: {
		ToList: "List",
		ToArray: "array",
		Count: "number",
		Keys: "IEnumerable",
		Values: "IEnumerable",
	},
	IEnumerable: {
		Select: "IEnumerable",
		SelectMany: "IEnumerable",
		Where: "IEnumerable",
		OrderBy: "IEnumerable",
		OrderByDescending: "IEnumerable",
		ThenBy: "IEnumerable",
		ThenByDescending: "IEnumerable",
		GroupBy: "IEnumerable",
		Skip: "IEnumerable",
		Take: "IEnumerable",
		SkipWhile: "IEnumerable",
		TakeWhile: "IEnumerable",
		Distinct: "IEnumerable",
		Reverse: "IEnumerable",
		Concat: "IEnumerable",
		Union: "IEnumerable",
		Intersect: "IEnumerable",
		Except: "IEnumerable",
		Cast: "IEnumerable",
		OfType: "IEnumerable",
		DefaultIfEmpty: "IEnumerable",
		Append: "IEnumerable",
		Prepend: "IEnumerable",
		Zip: "IEnumerable",
		Join: "IEnumerable",
		GroupJoin: "IEnumerable",
		ToList: "List",
		ToArray: "array",
		ToDictionary: "Dictionary",
		ToHashSet: "List",
		Count: "number",
		Sum: "number",
		Min: "number",
		Max: "number",
		Average: "number",
		First: "number",
		FirstOrDefault: "number",
		Last: "number",
		LastOrDefault: "number",
		Single: "number",
		SingleOrDefault: "number",
		Any: "boolean",
		All: "boolean",
		Contains: "boolean",
		SequenceEqual: "boolean",
		ElementAt: "number",
		ElementAtOrDefault: "number",
		Aggregate: "number",
	},
	// 迭代52 P2（数学家 F 类）：System.Type 反射元数据读（typeof(X).GetMethod/GetProperty/GetField/
	// GetTypeInfo/IsAssignableFrom…——元数据读纯，无用户代码执行；Invoke 是动态执行 → 不列入）。
	Type: {
		GetMethod: "MethodInfo",
		GetMethods: "MethodInfo",
		GetProperty: "PropertyInfo",
		GetProperties: "PropertyInfo",
		GetField: "FieldInfo",
		GetFields: "FieldInfo",
		GetConstructor: "ConstructorInfo",
		GetConstructors: "ConstructorInfo",
		GetTypeInfo: "TypeInfo",
		GetElementType: "Type",
		GetGenericArguments: "array",
		IsAssignableFrom: "boolean",
		IsSubclassOf: "boolean",
		IsInstanceOfType: "boolean",
		IsEnum: "boolean",
		IsAbstract: "boolean",
		IsInterface: "boolean",
		ToString: "string",
		Name: "string",
		FullName: "string",
		Namespace: "string",
		Assembly: "object",
	},
	// 迭代52 P2：反射成员元数据读（GetMethod 等返回的 MethodInfo/PropertyInfo/FieldInfo——元数据
	// 读纯；Invoke/GetValue/SetValue 动态执行 → 不列入，落 ? 诚实）。
	MethodInfo: {
		Name: "string",
		DeclaringType: "Type",
		ReturnType: "Type",
		IsStatic: "boolean",
		IsPublic: "boolean",
		ToString: "string",
	},
	PropertyInfo: {
		Name: "string",
		PropertyType: "Type",
		CanRead: "boolean",
		CanWrite: "boolean",
		ToString: "string",
	},
	FieldInfo: {
		Name: "string",
		FieldType: "Type",
		IsStatic: "boolean",
		IsPublic: "boolean",
		ToString: "string",
	},
	TypeInfo: {
		GetDeclaredMethod: "MethodInfo",
		GetDeclaredMethods: "MethodInfo",
		GetDeclaredProperty: "PropertyInfo",
		GetDeclaredField: "FieldInfo",
		AsType: "Type",
	},
};

/** 纯构造类型（迭代33 C1：new X() 构造器建模——X ∈ 清单 → 纯分配无副作用）。
 *  语料确证（InitDeity <unresolved> 构造器 top 20：List 128/Dictionary 78/Vector2 51/
 *  JsonSerializerSettings 47/Color 44/Vector3 41/GUIContent 39/异常族 ~75/HashSet 16/Rect 16/
 *  UnityEvent 10/WaitForSeconds 9）+ .NET 领域双重确证。未列框架类型 → ? 诚实（红线：绝不给"未知皆纯"）。
 *  注意：Random:random/WaitForSeconds:clock/FileStream:fs 走 impureGlobals（构造即效应），不入此表。 */
const pureCtor = new Set<string>([
	"List",
	"Dictionary",
	"HashSet",
	"Queue",
	"Stack",
	"LinkedList",
	"SortedDictionary",
	"Vector2",
	"Vector3",
	"Vector4",
	"Quaternion",
	"Color",
	"Color32",
	"Rect",
	"RectInt",
	"GUIContent",
	"GUIStyle",
	"RectOffset",
	"Sprite",
	"JsonSerializerSettings",
	"JsonSerializer",
	"JsonConvert",
	"Exception",
	"ArgumentException",
	"ArgumentNullException",
	"ArgumentOutOfRangeException",
	"InvalidOperationException",
	"NotImplementedException",
	"NotSupportedException",
	"KeyNotFoundException",
	"UnityEvent",
	"StringBuilder",
	"StringReader",
	"StringWriter",
	"byte",
	"byte[]",
	"string",
	"String",
	"object",
	"char",
	"int",
	"long",
	"float",
	"double",
	"bool",
	"TimeSpan",
	"Guid",
	"Uri",
	"Mathf",
	// 迭代44 候选4 首批（InitDeity top-miss 数据）：System.Net.Http 消息构造——纯分配
	//（生成代码 API.g.cs 高频：ctor:HttpRequestMessage/HttpMethod/StringContent miss 站）
	"HttpRequestMessage",
	"HttpMethod",
	"StringContent",
	// Random/WaitForSeconds/FileStream 等不在表——构造即效应走 impureGlobals（random/clock/fs）
]);

/** Unity 隐式 this 组件属性（MonoBehaviour 里 gameObject = this.gameObject——迭代19）。
 *  单一数据源：frameworkIo.gameObject 与 frameworkAttrPrefix.gameObject 共享（iter37 审计次要观察：双份清单漂移风险）。 */
const gameObjectMembers: readonly string[] = [
	"SetActive",
	"GetComponent",
	"transform",
	"layer",
	"tag",
	"name",
	"AddComponent",
];

/** 框架命名空间（迭代19 C#/Unity）：this.gameObject/this.transform 等 MonoBehaviour 组件属性链
 *  （obj=this、attr="gameObject.SetActive" 含 . → 分支 1 放行 → 2.5 前缀命中 → io/state 保守）。 */
const frameworkIo: Record<string, readonly string[]> = {
	this: [
		"gameObject",
		"transform",
		"rigidbody",
		"collider",
		"renderer",
		"audio",
		"animation",
		"animator",
		"camera",
		"light",
		"networkView",
		"terrain",
		"particleSystem",
		"spriteRenderer",
		"meshRenderer",
		"canvas",
		"rectTransform",
		"navMeshAgent",
		"characterController",
		"material",
		"shader",
	],
	// Unity 隐式 this 组件属性（MonoBehaviour 里 gameObject = this.gameObject——迭代19）
	gameObject: gameObjectMembers,
	transform: [
		"position",
		"rotation",
		"localPosition",
		"localScale",
		"Translate",
		"Rotate",
		"SetParent",
		"SetAsLastSibling",
		"GetComponent",
	],
	// System 命名空间前缀（迭代19）：System.Console.WriteLine → obj="System"、attr="Console.WriteLine"
	// 迭代21 T4 修正：只列 io 边界类——纯类型（Math/String/Guid 等）移除（frameworkIo 固定 io，
	// 纯类型进前缀会假 IMPURE 毒化判别力——F19；纯类落 ? 诚实）
	System: [
		"Console",
		"Environment",
		"Diagnostics",
		"IO",
		"Net",
		"Data",
		"Threading",
		"Process",
		"GC",
		// 迭代23 收紧：Reflection/Text/Globalization/Runtime/RuntimeTypeHandle 移除——
		// 反射元数据读（GetTypeInfo/GetCustomAttribute）纯读取、Text 纯计算、Globalization 文化数据读、
		// Runtime 服务非 io（P/Invoke Marshal 例外落 UNKNOWN 非假纯）；移除后这些调用落 ? → UNKNOWN
		// （audit 公理 3：? 构成效应源，绝不假纯），可标注确证（方案 A，设计见 docs/iter23/frameworkio-design.md）
	],
	// UnityEngine 命名空间前缀（迭代21 T4：missSlots global:UnityEngine 265 驱动）——只列 io/state 类
	UnityEngine: [
		"Object",
		"Application",
		"SceneManager",
		"GameObject",
		"Component",
		"Transform",
		"Debug",
		"Physics",
		"Input",
		"Screen",
		"Resources",
		"Camera",
		"QualitySettings",
	],
};

/** 对象属性前缀白名单（迭代37 P0-1：引擎 gameObject 前缀硬编码数据化——消除引擎唯一语言常量）。
 *  obj="gameObject" 前缀语义 = 原 frameworkIo.gameObject 清单（X.gameObject.SetActive/GetComponent/... → io）；
 *  link.ts 在 assigned 守卫之前查此表（局部变量 receiver 形态）；白名单 miss → ? 诚实。 */
const frameworkAttrPrefix: Record<string, readonly string[]> = {
	gameObject: gameObjectMembers,
};

/** System 纯子命名空间成员级白名单（迭代32，compromise-audit C1 结构性收紧）。
 *  结构 Record<ns, Record<type, "pure"|"hof" | Record<member, "pure"|"hof">>>：
 *  type 键 = attr 去掉 obj 段后的第一段（类型/子命名空间名），段前缀匹配（rest===key || rest.startsWith(key+".")）。
 *  整类型键（pure/hof）= 该类型同质（无副作用/委托形参 → pure；委托重载无条件调用 → hof）。
 *  异质类型（Array）用嵌套成员表：type 键值 = Record<member, tag>，按剩余段匹配。
 *  语义：pure = 无副作用成员、无委托形参；hof = 成员接收委托且无条件调用（回调义务保留）。
 *  未列键 → 落 ?（诚实，fall-through 到分支 4 missTable → UNKNOWN——iter30 已验证方向安全）。
 *  准入：iter30 语料逐段聚合（Uri 882/Linq 461/Convert 238/Enum 97/Text 55/Array 14/Math 5/
 *  TimeSpan 3/Guid 3）+ .NET 领域双重确证；漏条方向恒 ? 非假纯。
 *  不列入：Reflection（Assembly.LoadFrom=fs、MethodInfo.Invoke=动态）、Runtime、Activator、
 *  DateTimeOffset（UtcNow=clock）、Linq.Expressions（编译执行）——iter23/iter30 裁定 UNKNOWN 诚实。
 *  回调不变量（link.ts 内建）：hof 命中且 argFns 非空 → addArgEdges(unconditional=true) →
 *  未解析记 UNKNOWN——"纯前缀吞回调"假纯结构通道关闭（iter30/iter31 三活洞根因）。
 *  pure 成员忽略 argFns（值实参被 argFnsOf 收集是常态——纯成员无委托形参，语言事实排除假纯）。 */
const frameworkPure: Record<
	string,
	Record<string, "pure" | "hof" | Record<string, "pure" | "hof">>
> = {
	System: {
		// 整类 pure（同质子树：无 io、无委托形参）
		Uri: "pure", // 语料 882 站全 EscapeDataString；BCL 全静态方法无委托
		Convert: "pure", // 语料 238 站；ToXxx/ChangeType/IsDBNull 纯计算
		Enum: "pure", // 语料 97 站；Parse/GetName/IsDefined/GetValues 静态元数据读
		Math: "pure", // 语料 5 站；Max/Min/Abs/Sqrt/Pow/Round 全纯
		TimeSpan: "pure", // 语料 3 站；FromSeconds/Parse/Compare 纯
		Guid: "pure", // 语料 3 站；Parse/NewGuid/ToString 纯（NewGuid=随机源先例同 pureGlobals.Guid）
		Collections: "pure", // System.Collections.Generic.List<int>.Add 静态式；无委托形参（实例方法不在此通道）
		// Linq 整类 hof（1 键取代 linqHof 29 算子表）：委托重载（Select/Where/OrderBy/ForEach…）
		// 无条件调用回调；无委托成员（Range/Skip/Take）无回调不触发门——整类与逐成员正确性等价且更小
		Linq: "hof",
		// Text 子命名空间（迭代32 复审修正：必须嵌套在 Text 键下——匹配按 rest 首段 "Text" 查，
		// 顶层散键 StringBuilder/Encoding 会导致 System.Text.* 整子树 miss 落 ?，55 站翻纯→?）
		Text: {
			StringBuilder: "pure", // Append/AppendLine/ToString 纯计算（对象内缓冲）
			Encoding: "pure", // UTF8/UTF8Encoding/GetBytes/GetString 纯计算（含 UTF8Encoding 类型——语料 WriteApkConf.Write）
			RegularExpressions: "pure", // Regex.IsMatch/Match/Replace 纯计算
		},
		// Array 异质（唯一）：6 个委托形参成员 hof + 其余 pure——嵌套成员表按剩余段匹配
		Array: {
			Find: "hof",
			FindAll: "hof",
			Exists: "hof",
			TrueForAll: "hof",
			ForEach: "hof",
			ConvertAll: "hof",
			Sort: "pure",
			Reverse: "pure",
			Copy: "pure",
			Clear: "pure",
			Resize: "pure",
			IndexOf: "pure",
			LastIndexOf: "pure",
			Contains: "pure",
			BinarySearch: "pure",
			Empty: "pure",
			Clone: "pure",
		},
	},
};

/**
 * C# chunk 节点：类/方法/构造/局部函数/属性声明（迭代40 B5：属性访问器假纯洞闭合——
 * 自定义 getter/setter 体调用归属属性 chunk；自动属性 = 空 chunk，读取判纯的锚点）。
 */
const chunkNodes = [
	"class_declaration",
	"struct_declaration",
	"interface_declaration",
	"enum_declaration", // 迭代42 候选3：enum 成员读取判纯锚点（编译期常量，无用户代码）
	"method_declaration",
	"constructor_declaration",
	"local_function_statement",
	"property_declaration",
];

const classNodes = [
	"class_declaration",
	"struct_declaration",
	"interface_declaration",
	"enum_declaration", // 迭代42 候选3：双表（chunkNodes + classNodes）——只加 classNodes 不产 chunk，globalClasses 索引不到
];
const callNodes = ["invocation_expression", "object_creation_expression"];
// 迭代40 B5 + M5：属性读取形态（obj.Prop 读值 / 裸名属性读 / obj?.Prop 条件读）→ 调用点（prop 标记）。
// member_access_expression = obj.Prop；identifier = 隐式 this 裸名读（C# 类内裸名属性/字段——
// 局部变量/参数读取 miss 判纯，双向安全）；conditional_access_expression = obj?.Prop（M5：
// flattenCallTarget 已支持 conditional 解包——member_binding 内标识符拍平为 obj.Prop）。
const propertyReadNodes = [
	"member_access_expression",
	"identifier",
	"conditional_access_expression",
];
// 属性读取形态排除（parent 形态——调用目标链/赋值左值/++/-- 已有各自通道）
const propertyReadSkipMorphs = [
	"member_access_expression", // 链中段（a.b.c 的 a.b——末段处理）
	"invocation_expression", // 调用目标（obj.M() 的 obj.M——callOf 处理）
	"assignment_expression", // 赋值左值（stateWritePos 处理）
	"augmented_assignment_expression",
	"postfix_unary_expression", // ++/-- 写形态
	"prefix_unary_expression",
];
// 属性读取形态排除（parent 声明/类型位——无运行时读取：声明、类型参数、特性、标签、cast/is/as 等）
const propertyReadSkipParents = [
	"variable_declaration",
	"event_field_declaration", // 迭代43 B：事件字段初始化器 RHS（public event Action OnX = HandleX;）
	// 的 identifier 经 equals_value_clause 直父被误判 prop 读 → 意外获得 handler 边（双计噪音）
	"attribute_list", // 迭代43 诊断：attribute 参数是编译期常量（枚举/typeof/字符串）——
	"attribute", // 无运行时属性读取；缺失时 [JsonProperty(Required = Required.Default)]
	"attribute_argument_list", // 的枚举参数被 B5 通道误建 prop 边 → 生成代码 unknown 暴涨
	"attribute_argument",
	"name_equals",
	"type_argument", // 迭代44-r2：泛型类型实参（WorldAnchor<T> 的 T）——类型位置无运行时读取（T·bare 同源）
	"type_argument_list",
	"using_directive", // 迭代43 诊断：using 声明的 qualified_name（using Newtonsoft.Json;）被
	"qualified_name", // B5 identifier 通道误当调用 → module chunk unknown 噪音；类型位置无运行时读取
	"alias_qualified_name", // global:: 限定符（typeof(global::System.X)——审计实证：真实节点是
	// alias_qualified_name，global_keyword 是死条目（000c0f8 修正）
	"if_directive", // 迭代44-r3：预处理指令（#if UNITY_EDITOR 的符号被当裸名调用，110 实证）——
	"elif_directive", // 编译期符号无运行时读取
	"else_directive",
	"endif_directive",
	"define_directive",
	"undef_directive",
	"region_directive",
	"endregion_directive",
	"line_directive", // 迭代45 O-C6 机检：13 个 directive 节点族与 grammar 对拍全量入表——
	"error_directive", // #line/#error/#warning/#pragma/#nullable 编译期符号，无运行时读取；
	"warning_directive", // 漏任一 → B5 通道误收 → unknown 噪音（安全-未知，局部）
	"pragma_directive",
	"nullable_directive",
	"extern_alias_directive",
	"field_declaration",
	"property_declaration",
	"method_declaration",
	"constructor_declaration",
	"local_function_statement",
	"class_declaration",
	"struct_declaration",
	"interface_declaration",
	"enum_declaration",
	"enum_member_declaration",
	"delegate_declaration",
	"namespace_declaration",
	"object_creation_expression",
	"generic_name",
	"type_argument_list",
	"type_parameter_list",
	"type_parameter",
	"base_list",
	"using_directive",
	"attribute_list",
	"attribute",
	"sizeof_expression",
	"typeof_expression",
	"nameof_expression",
	"member_binding_expression",
	"operator_declaration",
	"conversion_operator_declaration",
	"destructor_declaration",
	"indexer_declaration",
	"label_statement",
	"goto_statement",
	"implicit_this_expression",
	"cast_expression",
	"as_expression",
	"is_expression",
	"array_type",
	"nullable_type",
	"pointer_type",
	"default_expression",
	"type_pattern",
	"declaration_pattern",
	"recursive_pattern",
	"base_expression",
	"checked_expression",
	"unchecked_expression",
];
// 属性读取排除的 name/type 槽位（声明名位无运行时读取，value 位保留）：
// variable_declarator 无 name 命名字段（探针实证）→ "__child0" = children[0]（语法固定）
const propertyReadNameSlots: Record<string, readonly string[]> = {
	variable_declarator: ["__child0"],
	parameter: ["name", "type"],
	catch_declaration: ["name"],
};
const nestingNodes = [
	"if_statement",
	"for_statement",
	"foreach_statement",
	"while_statement",
	"do_statement",
	"switch_statement",
	"try_statement",
	"method_declaration",
	"local_function_statement",
	"lambda_expression",
	"anonymous_method_expression",
	"class_declaration",
];
const selfNames = ["this", "base"];
const assignmentTargets = ["assignment_expression", "variable_declarator"];
/** 全局 HOF（不含 LINQ 撞名算子——Math.Max/string.Contains/String.Join 等纯静态方法不得被当 HOF）。
 *  迭代32 起 LINQ 静态运算符的回调义务由 frameworkPure 成员级 hof 标记 + addArgEdges(unconditional)
 *  承担（linqHof 表已删除——Linq: "hof" 1 键取代 29 算子表）。
 *  迭代31 MEDIUM-2：Join/GroupJoin 移出——String.Join(",", parts) 走 pureGlobals.String 门误伤
 *  （argFnsOf 收 parts → 未解析 → ?）；LINQ 上下文由 frameworkPure.Linq 覆盖。 */
const hofCallsArgs = new Set<string>([
	"ForEach",
	"Select",
	"Where",
	"OrderBy",
	"OrderByDescending",
	"ThenBy",
	"SelectMany",
	"GroupBy",
	"Zip",
	"SkipWhile",
	"TakeWhile",
	"ToDictionary",
	"ToLookup",
	"Aggregate",
]);
const hofAlwaysArgs = new Set<string>([
	// 全局必然调用实参的 HOF（迭代31 S3 修复）：命名框架成员回调解析失败记 UNKNOWN 防假纯。
	// 与 hofCallsArgs 同源（无条件调用子集）；不含 LINQ 撞名算子（见 linqHof 注释——LINQ 上下文
	// 由 frameworkPure + linqHof 覆盖，Math.Max/string.Contains/String.Join 等纯静态不误伤）。
	"ForEach",
	"Select",
	"Where",
	"OrderBy",
	"OrderByDescending",
	"ThenBy",
	"SelectMany",
	"GroupBy",
	"Zip",
	"SkipWhile",
	"TakeWhile",
	"ToDictionary",
	"ToLookup",
	"Aggregate",
]);
const impureModules: Record<string, Effect | readonly string[]> = {};
const pureModules = new Set<string>([
	"System",
	"System.Collections",
	"System.Collections.Generic",
	"System.Linq",
	"System.Text",
	"System.Text.RegularExpressions",
	"System.Globalization",
	"System.Threading",
	"System.Threading.Tasks",
	"System.Numerics",
]);

export function extractCSharpImports(root: SyntaxNode): RawImport[] {
	// C# using 不绑定 local（成员可见非名绑定）——只处理 using 别名（using File = System.IO.File）
	const out: RawImport[] = [];
	const visit = (n: SyntaxNode): void => {
		if (n.type === "using_directive" || n.type === "using_declaration") {
			const name =
				n.childForFieldName("name") ??
				n.children.find(
					(c) => c.type === "identifier" || c.type === "qualified_name",
				);
			// using X = Y：别名绑定 → 本地名 X 指向模块 Y（调用 X.fn 走 effectFromModule(Y, fn)）
			if (n.children.some((c) => c.text === "=")) {
				const eqIdx = n.children.findIndex((c) => c.text === "=");
				const alias = n.children[eqIdx - 1];
				const target = n.children[eqIdx + 1];
				if (alias && target) {
					out.push({ local: alias.text, module: target.text, imported: null });
				}
			}
			void name;
		}
		for (const c of n.children) visit(c);
	};
	visit(root);
	return out;
}

export const csharpPack: LangPack = {
	name: "csharp",
	extensions: [".cs"],
	wasm: "tree-sitter-c_sharp.wasm",
	chunkNodes,
	classNodes,
	callNodes,
	propertyReadNodes, // 迭代40 B5：属性读取形态（obj.Prop）→ prop 调用点
	propertyReadSkipMorphs, // 形态排除（调用目标链/赋值左值/++/--）
	propertyReadSkipParents, // 声明/类型位排除
	propertyReadNameSlots, // name/type 槽位排除（variable_declarator 用 __child0）
	bareArgReadSkipParents: ["argument", "named_argument", "argument_list"], // 迭代53：裸 identifier 实参位
	propMissIsPure: true, // C# 静态语义：成员 miss + 属性读取 → 纯（动态语言不设 → ? 诚实）
	interfaceHeuristicMinBases: 2, // 迭代40 P0-3 B03：base_list ≥2（基类+接口）→ 全方法隐含 virtual
	ctorTypeFields: { object_creation_expression: "type" }, // 迭代40 P0-3 H02：new X() 类型名字段
	ctorMarkNodes: ["object_creation_expression"], // 迭代40 P0-3 H02：仅 C# 产 ctor 标记（TS 走裸名+ctor-merge）
	typeOfNodes: ["type_of_expression"], // 迭代52 P2：typeof(X) 链根（反射元数据读，纯）
	virtualModifiers: ["virtual", "override", "abstract"], // 迭代40 P0-3 H03：virtual 族修饰符
	sealedModifiers: ["sealed"], // 迭代40 P0-3 H03：sealed 修饰符（不可再覆写）
	// 迭代40 P0-3 批3：形状数据化
	classMemberBodyNodes: ["method_declaration", "constructor_declaration"], // H04
	classMemberBodyStopNodes: [
		"local_function_statement",
		"lambda_expression",
		"anonymous_method_expression",
		"class_declaration",
		"struct_declaration",
		"interface_declaration",
	], // H04
	foreachNodes: ["for_each_statement"], // H07
	foreachInToken: "in", // H07
	throwArgFields: { throw_statement: "argument" }, // H09
	typeNameNodes: ["generic_name", "qualified_name"], // H13
	patternNameNodes: ["tuple_pattern", "array_pattern", "as_pattern_target"], // H15
	fnLiteralNodes: ["anonymous_method_expression", "lambda_expression"], // H16（C# 匿名方法/表达式 lambda）
	paramListNodeTypes: ["parameter_list"], // H18：参数列表节点类型（assignedNames walk）
	paramListField: "parameters", // H18：参数列表字段名（paramNames/paramTypesOf）
	argWrapNodes: ["argument"], // P0-3 漏网：C# 实参包装解包
	interfaceNodes: ["interface_declaration"], // P0-3 漏网：接口方法无条件 virtual
	eventFieldNodes: ["event_field_declaration"], // 迭代43 B：事件声明节点
	eventSubscribeOps: ["+="], // 迭代43 B：事件订阅运算符
	staticModifiers: ["static"], // 迭代43 r2：static 初始化器单元拆分
	compileTimeOps: ["nameof"], // 迭代44-r2：编译期操作符（实参不提取）。第五轮审计 law:minimality：
	// 门只认 invocation_expression + identifier fn——typeof(T) 是 type_of_expression、default(T) 是
	// default_expression（探针实证）→ 两条目在门处不可达（死条目）；其类型实参抑制已由
	// propertyReadSkipParents（typeof_expression/default_expression）承接，删除零行为变化。
	catchDeclNodes: ["catch_declaration"], // 迭代40 P0-3 B01：类型化 catch（第五轮审计：此前全语言
	// 无生产者 → 死机制——catch (IOException e) 坍缩 "*" → throwsTypes 过度减法，方向不安全；
	// catch_declaration 的 type 字段探针实证存在）
	heritageSkipNodes: [
		// 迭代44-r3：继承提取跳过（痛点2 根因数据化）；迭代45 O-C5 机检全量补齐
		"predefined_type", // 枚举底层类型（enum X : int）
		"if_directive", // 预处理指令（#if 内类声明混入 base_list）——漏任一 → 误判动态 heritage
		"elif_directive", // → 语言级降级（全库多态/隐式 this → unknown，-37% 级）
		"else_directive",
		"endif_directive",
		"define_directive",
		"undef_directive",
		"region_directive", // 迭代45：13 个 directive 节点族与 grammar 对拍全量入表（region 族
		"endregion_directive", // 与 #if 同族——tree-sitter 把预处理指令挂在 token 流可及处）
		"line_directive",
		"error_directive",
		"warning_directive",
		"pragma_directive",
		"pragma_directive_repeat", // grammar 变体（iter45 O-C5 机检实证）
		"nullable_directive",
		"extern_alias_directive",
	],
	complexityNodes: [
		// 迭代44-r4：MCCabe 分支节点（C# 控制流形态）
		"if_statement",
		"switch_statement",
		"case_switch_label", // 普通 case X:（Iter-53 审计补：iter47 偏差表声明"每 case +1 已核实"，
		// 但 case_pattern_switch_label 只覆盖 pattern case——普通 case 零计数与声明不符）
		"case_pattern_switch_label",
		"for_statement",
		"for_each_statement",
		"while_statement",
		"do_statement",
		"conditional_expression", // 三元
		"catch_clause",
	],
	complexityOps: ["&&", "||", "??"], // 短路逻辑运算符
	valueWrapNodes: ["equals_value_clause"], // P0-3 漏网：C# 赋值 value 包装解包
	incDecTokens: ["++", "--"], // P0-3 漏网：增减操作符（writeUnary 只认增减）
	nestingNodes,
	selfNames,
	impureBuiltins,
	pureBuiltins: new Set<string>(), // 空表：nameof/typeof/default 由 compileTimeOps 在提取侧吸收（迭代44-r2）——
	// 链接侧裸名通道永不咨询（第四轮审计 law:minimality：此前的 "nameof" 条目是死条目，零 hit/miss 实证）
	impureModules,
	pureModules,
	impureGlobals,
	pureGlobals,
	hofCallsArgs,
	hofAlwaysArgs,
	assignmentTargets,
	// 迭代39 P2-1：AST 形状投影（π 数据侧——extractor 节点类型判定走此表）
	astShapes: {
		writeStmts: [],
		writeAssigns: ["assignment_expression", "augmented_assignment_expression"],
		writeUpdates: [],
		writeUnary: ["postfix_unary_expression", "prefix_unary_expression"],
		memberNodes: ["member_access_expression", "conditional_access_expression"],
		memberWrapNodes: ["member_binding_expression"],
		callShapes: ["invocation_expression"],
		ctorCallNodes: ["object_creation_expression"],
		paramNodes: ["parameter"],
		throwNodes: ["throw_statement"],
		catchNodes: ["catch_clause"], // 迭代39 审计必修 4：C# grammar 有 catch_clause，原代码对全语言返回 "*"——保持等价
		heritageNodes: ["base_list"],
		thisNodes: ["this_expression"],
		methodNodes: ["method_declaration"],
		unwrapNodes: [
			"parenthesized_expression",
			"as_expression",
			"non_null_expression",
		],
		stmtWrapNodes: ["expression_statement"],
		bindAssigns: ["assignment_expression"],
		declNodes: ["variable_declarator"],
		initializerParentNodes: ["initializer_expression"],
		exportStmtNodes: [],
	},
	literalReceivers,
	literalMutatorExempt: ["string", "array"], // 迭代52-r3 G1：字面量接收者变异豁免（str/数组字面量不可共享）
	builtinTypeEffects,
	builtinMethodReturns,
	implicitThis: true, // C# 类内裸名方法调用 = this 方法（迭代19）
	assignmentScopesLocals: false,
	bareNameMeansThisInMethod: true, // C# 方法内裸字段写 = this 字段（self.x，迭代37 P0-2）
	trustedCtor: true, // C# new X() 必返回实例或抛（迭代38 规则7）
	polymorphicMethods: false, // 迭代39 B7：C# 非 virtual 静态分派精确，仅 virtual 族降 ?
	builtinMutators,
	frameworkIo,
	frameworkAttrPrefix, // 迭代37 P0-1：X.gameObject.* 前缀白名单（数据化）
	frameworkPure,
	pureCtor, // 迭代33 C1：new X() 构造器建模——纯构造类型清单

	extractImports: extractCSharpImports,
	resolveModule(): string | null {
		// C# using 不解析到项目文件（类跨文件可见——第一版返回 null：外部/标准库）。
		// 项目内跨文件类调用 → ?（诚实未知，标注工作流覆盖）。
		return null;
	},
};
