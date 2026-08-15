package helper

import (
	f "os"
	"strings"
)

// Export 读取文件（fs 效应源），经同包跨文件裸名调用 bare 后返回。
// 覆盖：import 别名（f "os" → f.ReadFile 命中 os 效应表）、同包跨文件裸名（bare 在 util.go）。
func Export(path string) (string, error) {
	data, err := f.ReadFile(path)
	if err != nil {
		return "", err
	}
	return bare(strings.TrimSpace(string(data))), nil
}
