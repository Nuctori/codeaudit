package main

import (
	"fmt"

	"codeaudit-fixture/helper"
)

func main() {
	fmt.Println(helper.Export("data.txt"), rootHelper())
}
