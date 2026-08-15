package helper

// bare 纯函数：同包跨文件被 Export 调用（Go 包作用域裸名——bareNamesCrossFile）。
func bare(s string) string {
	n := len(s)
	return s[:n]
}

// Convert 纯转换：类型转换（int/string/rune）不是调用点——高频盲区回归
// （转换被当裸名调用 → 假 unknown 的修复锚点）。
func Convert(x float64) string {
	return string(int(x))
}
