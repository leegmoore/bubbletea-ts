package tea

import (
	"fmt"
	"reflect"
	"strings"
	"sync"
)

type pointerAlias struct {
	actual       string
	alias        string
	actualDigits string
	aliasDigits  string
}

var pointerPlaceholderMu sync.RWMutex
var pointerPlaceholderMap = map[string]string{}
var pointerAliasList []pointerAlias

func normalizePointerPlaceholders(text string) string {
	pointerPlaceholderMu.RLock()
	defer pointerPlaceholderMu.RUnlock()
	if len(pointerAliasList) == 0 {
		return text
	}
	var b strings.Builder
outer:
	for i := 0; i < len(text); {
		for _, alias := range pointerAliasList {
			if alias.actual != "" && strings.HasPrefix(text[i:], alias.actual) {
				diff := len(alias.actual) - len(alias.alias)
				if diff > 0 {
					spaceIdx := i - 1
					spaceCount := 0
					for spaceIdx >= 0 && text[spaceIdx] == ' ' {
						spaceCount++
						spaceIdx--
					}
					if spaceCount >= 2 {
						b.WriteString(strings.Repeat(" ", diff))
					}
				}
				b.WriteString(alias.alias)
				i += len(alias.actual)
				continue outer
			}
		}
		for _, alias := range pointerAliasList {
			if alias.actualDigits == "" {
				continue
			}
			if strings.HasPrefix(text[i:], alias.actualDigits) {
				zeroIdx := i - 1
				zeroCount := 0
				for zeroIdx >= 0 && text[zeroIdx] == '0' {
					zeroCount++
					zeroIdx--
				}
				if zeroCount > 0 && zeroIdx >= 1 && text[zeroIdx] == 'x' && text[zeroIdx-1] == '0' {
					diff := len(alias.aliasDigits) - len(alias.actualDigits)
					if diff < 0 {
						b.WriteString(strings.Repeat("0", -diff))
					}
					b.WriteString(alias.aliasDigits)
					i += len(alias.actualDigits)
					continue outer
				}
			}
		}
		b.WriteByte(text[i])
		i++
	}
	return b.String()
}

func registerPointerPlaceholder(value interface{}, placeholder uintptr) {
	address := pointerAddressString(value)
	if address == "" {
		return
	}
	alias := fmt.Sprintf("0x%x", placeholder)
	pointerPlaceholderMu.Lock()
	defer pointerPlaceholderMu.Unlock()
	pointerPlaceholderMap[address] = alias
	pointerAliasList = append(pointerAliasList, pointerAlias{
		actual:       address,
		alias:        alias,
		actualDigits: strings.TrimPrefix(address, "0x"),
		aliasDigits:  strings.TrimPrefix(alias, "0x"),
	})
}

func pointerAddressString(value interface{}) string {
	rv := reflect.ValueOf(value)
	if !rv.IsValid() {
		return ""
	}
	switch rv.Kind() {
	case reflect.Ptr, reflect.UnsafePointer, reflect.Map, reflect.Slice, reflect.Func, reflect.Chan:
		if rv.IsNil() {
			return ""
		}
		return fmt.Sprintf("0x%x", rv.Pointer())
	default:
		return ""
	}
}

func withPointerPlaceholder[T any](value T, placeholder uintptr) T {
	registerPointerPlaceholder(value, placeholder)
	return value
}

func newPrintfKeyStructPointer(code int, label string, placeholder uintptr) *printfKeyStruct {
	ptr := &printfKeyStruct{Code: code, Label: label}
	registerPointerPlaceholder(ptr, placeholder)
	return ptr
}

func newIncrementChannelPlaceholder(placeholder uintptr) chan incrementMsg {
	ch := make(chan incrementMsg)
	registerPointerPlaceholder(ch, placeholder)
	return ch
}

func newIncrementFuncPlaceholder(placeholder uintptr) func() incrementMsg {
	fn := func() incrementMsg { return incrementMsg{} }
	registerPointerPlaceholder(fn, placeholder)
	return fn
}
