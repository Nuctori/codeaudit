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
 * - 事件订阅（+= / AddListener）不建回调边（事件触发是运行时语义，第一版不建模）。
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
	object_creation_expression: "object",
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
};

const builtinMethodReturns: Record<string, Record<string, string>> = {
	string: {
		ToUpper: "string",
		ToLower: "string",
		Trim: "string",
		Substring: "string",
	},
};

/** 框架命名空间（迭代19 C#/Unity）：this.gameObject/this.transform 等 MonoBehaviour 组件属性链
 *  （obj=this、attr="gameObject.SetActive" 含 . → 分支 1 放行 → 2.5 前缀命中 → io/state 保守）。 */
const frameworkIo: Record<string, readonly string[]> = {
  this: [
    "gameObject", "transform", "rigidbody", "collider", "renderer", "audio",
    "animation", "animator", "camera", "light", "networkView", "terrain",
    "particleSystem", "spriteRenderer", "meshRenderer", "canvas", "rectTransform",
    "navMeshAgent", "characterController", "material", "shader",
  ],
  // Unity 隐式 this 组件属性（MonoBehaviour 里 gameObject = this.gameObject——迭代19）
  gameObject: ["SetActive", "GetComponent", "transform", "layer", "tag", "name", "AddComponent"],
  transform: ["position", "rotation", "localPosition", "localScale", "Translate", "Rotate", "SetParent", "SetAsLastSibling", "GetComponent"],
  // System 命名空间前缀（迭代19）：System.Console.WriteLine → obj="System"、attr="Console.WriteLine"
  // 迭代21 T4 修正：只列 io 边界类——纯类型（Math/String/Guid 等）移除（frameworkIo 固定 io，
  // 纯类型进前缀会假 IMPURE 毒化判别力——F19；纯类落 ? 诚实）
  System: [
    "Console", "Environment", "Diagnostics", "IO", "Net", "Data", "Threading",
    "Process", "GC",
    // 迭代23 收紧：Reflection/Text/Globalization/Runtime/RuntimeTypeHandle 移除——
    // 反射元数据读（GetTypeInfo/GetCustomAttribute）纯读取、Text 纯计算、Globalization 文化数据读、
    // Runtime 服务非 io（P/Invoke Marshal 例外落 UNKNOWN 非假纯）；移除后这些调用落 ? → UNKNOWN
    // （audit 公理 3：? 构成效应源，绝不假纯），可标注确证（方案 A，设计见 docs/iter23/frameworkio-design.md）
  ],
  // UnityEngine 命名空间前缀（迭代21 T4：missSlots global:UnityEngine 265 驱动）——只列 io/state 类
  UnityEngine: [
    "Object", "Application", "SceneManager", "GameObject", "Component", "Transform",
    "Debug", "Physics", "Input", "Screen", "Resources", "Camera", "QualitySettings",
  ],
};

/** System 纯子命名空间白名单（迭代30，全限定 System.* obj="System" 回退）。
 *  严格白名单：语料（iter30 1869 站点逐段聚合）+ .NET 领域双重确证才可入列；漏条落 ? 非假纯。
 *  不列入：Reflection（IntrospectionExtensions/CustomAttributeExtensions 纯读取但
 *  Assembly.LoadFrom=fs、MethodInfo.Invoke=动态——iter23 裁定 UNKNOWN 诚实，不整体放纯）、
 *  Runtime（FormatterServices 序列化底层）、Activator（反射 new≈new 本身判 ?）、
 *  DateTimeOffset（UtcNow=clock）。与 frameworkIo.System 9 条不相交（Text 已在 iter23 移出 io 侧）。 */
const frameworkPure: Record<string, readonly string[]> = {
  System: ["Uri", "Linq", "Convert", "Enum", "Text", "Array", "Math", "TimeSpan", "Guid", "Collections"],
};

/** C# chunk 节点：类/方法/构造/局部函数。属性访问器第一版不建（自动属性无逻辑）。 */
const chunkNodes = [
	"class_declaration",
	"struct_declaration",
	"interface_declaration",
	"method_declaration",
	"constructor_declaration",
	"local_function_statement",
];

const classNodes = [
	"class_declaration",
	"struct_declaration",
	"interface_declaration",
];
const callNodes = ["invocation_expression", "object_creation_expression"];
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
const assignmentTargets = [
	"assignment_expression",
	"variable_declarator",
];
const hofCallsArgs = new Set<string>([
	// LINQ 静态运算符（迭代30：frameworkPure 命中 Enumerable.* 时须保留回调边——ForEach(xs, Save)
	// 的回调 Save 写 Console 若被吞 = 假纯；此前 C2 只记变量 receiver 链，静态 obj=Enumerable 可建模）
	"ForEach", "Select", "Where", "Count", "Any", "All", "First", "FirstOrDefault",
	"ToDictionary", "ToLookup", "Aggregate", "Sum", "Min", "Max", "Average", "OrderBy",
	"OrderByDescending", "ThenBy", "SelectMany", "GroupBy", "Zip", "SkipWhile", "TakeWhile",
]);
const hofAlwaysArgs = new Set<string>();
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
	nestingNodes,
	selfNames,
	impureBuiltins,
	pureBuiltins: new Set<string>(["nameof"]), // C# 编译期名字提取（迭代21 T4：missSlots 463 站点——纯）
	impureModules,
	pureModules,
	impureGlobals,
	pureGlobals,
	hofCallsArgs,
	hofAlwaysArgs,
	assignmentTargets,
	literalReceivers,
	builtinTypeEffects,
	builtinMethodReturns,
	implicitThis: true, // C# 类内裸名方法调用 = this 方法（迭代19）
	frameworkIo,
	frameworkPure,

	extractImports: extractCSharpImports,
	resolveModule(): string | null {
		// C# using 不解析到项目文件（类跨文件可见——第一版返回 null：外部/标准库）。
		// 项目内跨文件类调用 → ?（诚实未知，标注工作流覆盖）。
		return null;
	},
};
