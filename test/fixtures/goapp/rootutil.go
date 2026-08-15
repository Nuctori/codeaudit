package main

// rootHelper 根目录包跨文件函数：被 main.go 的 main 裸名调用
// （根目录包场景——link.ts bareNamesCrossFile 的 dir="" 分支修复锚点）。
func rootHelper() int {
	return 42
}
