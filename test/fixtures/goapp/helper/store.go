package helper

import (
	"fmt"
	"time"
)

type Store struct {
	path string
}

// Save 写日志并读时钟：fmt.Println（io）+ time.Now（clock）直接效应；
// s.log(v) 是 receiver 方法调用（Go 无 this，receiver 参数名自定）→ 动态分派 ?（已知限制）。
func (s *Store) Save(v string) {
	s.log(v)
	fmt.Println(v, time.Now())
}

func (s *Store) log(v string) {
	fmt.Println("log:", v)
}
